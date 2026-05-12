// Submissions inbox — admin triage for the public collaborate page.
//
// Two streams in one collection (`collaboration_requests`), separated by
// the `source` field:
//   • "join-team"      → applications to join the editorial team
//   • "proposal-form"  → article / proposal submissions
//   • everything else  → catch-all "Other" tab
//
// Render shape: a tab strip across the top (All / Join the team / Proposals
// / Other) with unread badges, then a single-column list of cards. Click a
// card to expand the full message + admin triage controls (status, note,
// reply via mailto). Status updates round-trip to /api/admin/submissions
// and re-render in place — no full reload.

import { el, esc, fmtRelative, fmtDate, toast } from "./ui.js";

const TABS = [
  { id: "all",       label: "All",            sourceMatch: () => true },
  { id: "join-team", label: "Join the team",  sourceMatch: (s) => s === "join-team" },
  { id: "proposal",  label: "Proposals",      sourceMatch: (s) => s === "proposal-form" || s === "proposal" },
  { id: "other",     label: "Other",          sourceMatch: (s) => s !== "join-team" && s !== "proposal-form" && s !== "proposal" },
];

const STATUS_PILL = {
  new:       { label: "New",        cls: "pill-pending" },
  reviewing: { label: "Reviewing",  cls: "pill-reviewing" },
  replied:   { label: "Replied",    cls: "pill-approved" },
  archived:  { label: "Archived",   cls: "pill-rejected" },
};

const SOURCE_LABEL = {
  "join-team":      "Join the team",
  "proposal-form":  "Article proposal",
  "proposal":       "Article proposal",
  "collaborate-form": "Collaborate form",
};

export async function mount(ctx, container) {
  container.innerHTML = "";

  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Submissions inbox</div>
        <div class="card-subtitle">People who reached out through the public collaborate page — Join-the-Team applications and article proposals.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="input" id="sub-search" placeholder="Search name, email, message…" style="width:260px;">
        <button class="btn btn-secondary btn-sm" id="sub-refresh" type="button">Refresh</button>
      </div>
    </div>

    <!-- Tab strip — counts injected after first load. -->
    <div id="sub-tabs" style="display:flex;gap:6px;padding:14px 20px 0;border-bottom:1px solid var(--hairline);flex-wrap:wrap;"></div>

    <div class="card-body" id="sub-body" style="padding-top:14px;">
      <div class="loading-state"><div class="spinner"></div>Loading submissions…</div>
    </div>
  `;
  container.appendChild(card);

  const els = {
    body:    card.querySelector("#sub-body"),
    tabs:    card.querySelector("#sub-tabs"),
    search:  card.querySelector("#sub-search"),
    refresh: card.querySelector("#sub-refresh"),
  };

  // View state. activeTab/search drive the rendered list; submissions is
  // the canonical server snapshot, mutated in place on status updates.
  let submissions = [];
  let counts = { joinTeam: 0, proposal: 0, other: 0, total: 0, unread: 0 };
  let activeTab = "all";
  let expandedId = null;

  async function load() {
    els.body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading submissions…</div>`;
    try {
      const res = await ctx.authedFetch("/api/admin/submissions");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      submissions = data.submissions || [];
      counts = data.counts || counts;
      renderTabs();
      renderList();
    } catch (err) {
      els.body.innerHTML = `<div class="error-state">Could not load submissions: ${esc(err.message)}</div>`;
    }
  }

  function renderTabs() {
    els.tabs.innerHTML = TABS.map((t) => {
      const count = t.id === "all" ? counts.total
        : t.id === "join-team" ? counts.joinTeam
        : t.id === "proposal" ? counts.proposal
        : counts.other;
      const active = t.id === activeTab;
      return `
        <button type="button"
                class="btn btn-ghost btn-sm sub-tab"
                data-tab="${esc(t.id)}"
                aria-pressed="${active}"
                style="border-radius:8px 8px 0 0;border:0;border-bottom:2px solid ${active ? "var(--ink)" : "transparent"};padding:10px 16px;font-weight:${active ? "700" : "500"};color:${active ? "var(--ink)" : "var(--muted)"};background:transparent;">
          ${esc(t.label)}
          <span style="margin-left:6px;font-size:11px;color:${active ? "var(--ink-2)" : "var(--muted-light)"};font-weight:600;">${count}</span>
        </button>`;
    }).join("");

    els.tabs.querySelectorAll(".sub-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        renderTabs();
        renderList();
      });
    });
  }

  function renderList() {
    const tab = TABS.find((t) => t.id === activeTab) || TABS[0];
    const q = els.search.value.trim().toLowerCase();
    const filtered = submissions.filter((s) => {
      if (!tab.sourceMatch(s.source)) return false;
      if (!q) return true;
      const hay = `${s.name} ${s.email} ${s.message} ${s.role} ${s.articleTitle}`.toLowerCase();
      return hay.includes(q);
    });

    if (!filtered.length) {
      els.body.innerHTML = `<div class="empty-state" style="padding:24px;">${
        q ? "No submissions match your search." :
        activeTab === "join-team" ? "No team applications yet." :
        activeTab === "proposal"  ? "No article proposals yet." :
        "No submissions yet."
      }</div>`;
      return;
    }

    els.body.innerHTML = filtered.map((s) => renderRow(s)).join("");

    // Wire row interactions (expand toggle, status select, save note,
    // mark replied, archive). Delegated via the body element so we
    // re-bind cleanly after every renderList() call.
    els.body.querySelectorAll("[data-row]").forEach((rowEl) => {
      const id = rowEl.dataset.row;
      const sub = submissions.find((x) => x.id === id);
      if (!sub) return;

      rowEl.querySelector("[data-expand]")?.addEventListener("click", () => {
        expandedId = (expandedId === id) ? null : id;
        renderList();
      });

      rowEl.querySelector("[data-status]")?.addEventListener("change", async (ev) => {
        await saveStatus(sub, ev.target.value);
      });

      rowEl.querySelector("[data-mark-replied]")?.addEventListener("click", () => {
        saveStatus(sub, "replied");
      });

      rowEl.querySelector("[data-archive]")?.addEventListener("click", () => {
        saveStatus(sub, "archived");
      });

      rowEl.querySelector("[data-save-note]")?.addEventListener("click", async () => {
        const note = rowEl.querySelector("[data-note]").value;
        await saveNote(sub, note);
      });
    });
  }

  function renderRow(s) {
    const expanded = expandedId === s.id;
    const pill = STATUS_PILL[s.status] || STATUS_PILL.new;
    const sourceLabel = SOURCE_LABEL[s.source] || s.source || "Other";
    const portfolio = s.portfolio
      ? `<a href="${esc(s.portfolio)}" target="_blank" rel="noopener" style="color:var(--ink);text-decoration:underline;">${esc(s.portfolio)}</a>`
      : "—";
    const phone = s.phone ? esc(s.phone) : "—";
    const articleTitle = s.articleTitle ? esc(s.articleTitle) : "—";

    // Subject line for the reply mailto. Mirrors the team-notification
    // email subject ([Team Application] / [Article/Proposal Submission])
    // so the threaded reply lands in the same conversation.
    const subjectLabel = s.source === "join-team"
      ? "Team Application"
      : "Article/Proposal Submission";
    const replyMailto =
      `mailto:${encodeURIComponent(s.email)}` +
      `?subject=${encodeURIComponent(`Re: [${subjectLabel}] ${s.name}`)}`;

    // Header row (always visible). The full detail block only renders
    // when expanded — keeps the long list scannable at rest.
    const header = `
      <div style="display:grid;grid-template-columns:1fr auto auto auto auto;gap:14px;align-items:center;padding:14px 18px;cursor:pointer;" data-expand>
        <div style="min-width:0;">
          <div style="font-weight:700;color:var(--ink);font-size:14px;">${esc(s.name || "(no name)")}
            <span style="font-weight:400;color:var(--muted-light);margin-left:8px;font-size:12px;">${esc(sourceLabel)}</span>
          </div>
          <div style="color:var(--muted);font-size:12px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${esc(s.email)}${s.role ? " · " + esc(s.role) : ""}${articleTitle !== "—" ? " · " + articleTitle : ""}
          </div>
        </div>
        <span class="pill ${pill.cls}" style="font-size:11px;">${esc(pill.label)}</span>
        <span style="color:var(--muted);font-size:12px;white-space:nowrap;">${s.createdAt ? esc(fmtRelative(s.createdAt)) : "—"}</span>
        <a href="${esc(replyMailto)}" class="btn btn-ghost btn-xs" onclick="event.stopPropagation();" style="white-space:nowrap;">Reply</a>
        <span style="color:var(--muted-light);font-size:14px;line-height:1;">${expanded ? "▾" : "▸"}</span>
      </div>`;

    if (!expanded) {
      return `<div class="sub-row" data-row="${esc(s.id)}" style="border-bottom:1px solid var(--hairline);">${header}</div>`;
    }

    // Expanded detail block — every field the public form captured, plus
    // admin triage controls (status pulldown, note, mark replied, archive).
    const detail = `
      <div style="padding:6px 18px 22px 18px;background:var(--surface-2);border-top:1px solid var(--hairline);">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 28px;margin-bottom:18px;">
          ${field("Email", `<a href="mailto:${esc(s.email)}" style="color:var(--ink);text-decoration:underline;">${esc(s.email)}</a>`)}
          ${field("Phone", phone)}
          ${field("Position / interest", s.role ? esc(s.role) : "—")}
          ${field("Article title", articleTitle)}
          ${field("Portfolio / link", portfolio)}
          ${field("Source", esc(sourceLabel))}
          ${field("Submitted", s.createdAt ? `${esc(fmtDate(s.createdAt))} · ${esc(fmtRelative(s.createdAt))}` : "—")}
          ${s.reviewedAt ? field("Last reviewed", `${esc(fmtDate(s.reviewedAt))} by ${esc(s.reviewedBy || "—")}`) : ""}
        </div>

        <div style="background:var(--surface);border:1px solid var(--hairline);border-radius:10px;padding:16px 18px;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Message</div>
          <div style="white-space:pre-wrap;color:var(--ink);font-size:14px;line-height:1.55;">${esc(s.message || "(no message)")}</div>
        </div>

        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase;">
            Status
            <select class="input" data-status style="width:160px;font-weight:500;text-transform:none;letter-spacing:0;color:var(--ink);">
              ${["new", "reviewing", "replied", "archived"].map((st) => `
                <option value="${st}" ${s.status === st ? "selected" : ""}>${(STATUS_PILL[st] || {label:st}).label}</option>
              `).join("")}
            </select>
          </label>

          <label style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:240px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase;">
            Internal note
            <div style="display:flex;gap:6px;">
              <input class="input" data-note value="${esc(s.reviewerNote || "")}" placeholder="Notes for the team — only visible here." style="flex:1;font-weight:500;text-transform:none;letter-spacing:0;color:var(--ink);">
              <button type="button" class="btn btn-secondary btn-sm" data-save-note>Save</button>
            </div>
          </label>

          <div style="display:flex;gap:6px;align-self:flex-end;">
            <a href="${esc(replyMailto)}" class="btn btn-accent btn-sm">Reply via email</a>
            <button type="button" class="btn btn-secondary btn-sm" data-mark-replied>Mark replied</button>
            <button type="button" class="btn btn-ghost btn-sm" data-archive>Archive</button>
          </div>
        </div>
      </div>`;

    return `<div class="sub-row" data-row="${esc(s.id)}" style="border-bottom:1px solid var(--hairline);">${header}${detail}</div>`;
  }

  // Per-field renderer used inside the expanded detail block. Centralised
  // so every label/value pair has the same alignment, casing, and spacing.
  function field(label, valueHtml) {
    return `
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;color:var(--muted-light);text-transform:uppercase;margin-bottom:4px;">${esc(label)}</div>
        <div style="font-size:13px;color:var(--ink);word-break:break-word;">${valueHtml}</div>
      </div>`;
  }

  async function saveStatus(sub, status) {
    if (sub.status === status) return;
    const previous = sub.status;
    sub.status = status; // optimistic
    if (previous === "new" && status !== "new") counts.unread = Math.max(0, counts.unread - 1);
    if (previous !== "new" && status === "new") counts.unread++;
    renderTabs();
    renderList();
    try {
      const res = await ctx.authedFetch("/api/admin/submissions", {
        method: "POST",
        body: JSON.stringify({ id: sub.id, patch: { status } }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      sub.reviewedAt = data.update?.reviewedAt || new Date().toISOString();
      sub.reviewedBy = data.update?.reviewedBy || sub.reviewedBy;
      toast(`Marked ${STATUS_PILL[status]?.label?.toLowerCase() || status}.`, "success");
    } catch (err) {
      sub.status = previous; // rollback
      renderTabs();
      renderList();
      toast(`Status update failed: ${err.message}`, "error");
    }
  }

  async function saveNote(sub, note) {
    try {
      const res = await ctx.authedFetch("/api/admin/submissions", {
        method: "POST",
        body: JSON.stringify({ id: sub.id, patch: { reviewerNote: note } }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      sub.reviewerNote = note;
      sub.reviewedAt = data.update?.reviewedAt || sub.reviewedAt;
      sub.reviewedBy = data.update?.reviewedBy || sub.reviewedBy;
      toast("Note saved.", "success");
    } catch (err) {
      toast(`Note save failed: ${err.message}`, "error");
    }
  }

  els.refresh.addEventListener("click", load);
  els.search.addEventListener("input", debounced(renderList, 200));

  await load();
}

function debounced(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
