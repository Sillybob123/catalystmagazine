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
      // Read as text first so we can show a useful error if the body isn't
      // JSON (Cloudflare 5xx pages, redirect HTML, etc.) instead of the
      // browser's generic "string did not match the expected pattern".
      const rawText = await res.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        const snippet = rawText.slice(0, 180).replace(/\s+/g, " ").trim();
        throw new Error(`Server returned non-JSON (HTTP ${res.status}). Snippet: ${snippet || "(empty body)"}`);
      }
      if (!res.ok || !data.ok) {
        const detail = data.message || data.error || `HTTP ${res.status}`;
        throw new Error(detail);
      }
      submissions = data.submissions || [];
      counts = data.counts || counts;
      renderTabs();
      renderList();
    } catch (err) {
      console.error("[submissions] load failed:", err);
      els.body.innerHTML = `<div class="error-state" style="white-space:pre-wrap;">Could not load submissions: ${esc(err.message)}</div>`;
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

      rowEl.querySelector("[data-archive]")?.addEventListener("click", () => {
        saveStatus(sub, "archived");
      });

      rowEl.querySelector("[data-save-note]")?.addEventListener("click", async () => {
        const note = rowEl.querySelector("[data-note]").value;
        await saveNote(sub, note);
      });

      rowEl.querySelector("[data-copy-msg]")?.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const txt = rowEl.querySelector("[data-msg-body]")?.textContent || "";
        try {
          await navigator.clipboard.writeText(txt);
          toast("Message copied to clipboard.", "success");
        } catch {
          toast("Copy failed — select the text manually.", "error");
        }
      });
    });
  }

  function renderRow(s) {
    const expanded = expandedId === s.id;
    const pill = STATUS_PILL[s.status] || STATUS_PILL.new;
    const sourceLabel = SOURCE_LABEL[s.source] || s.source || "Other";
    const isJoinTeam = s.source === "join-team";

    // Source-specific visual tag. Join-team applications get a darker
    // chip; proposals get a lighter outline. Lets admins triage at a
    // glance without having to read the source label.
    const sourceChip = isJoinTeam
      ? `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:var(--ink);color:#fff;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Join the team</span>`
      : `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:transparent;border:1px solid var(--border-strong);color:var(--ink-2);font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Article proposal</span>`;

    const portfolioHtml = s.portfolio
      ? `<a href="${esc(s.portfolio)}" target="_blank" rel="noopener" style="color:var(--ink);text-decoration:underline;">${esc(s.portfolio)}</a>`
      : "—";

    // Subject line for the reply mailto. Mirrors the team-notification
    // email subject ([Team Application] / [Article/Proposal Submission])
    // so the threaded reply lands in the same conversation.
    const subjectLabel = isJoinTeam ? "Team Application" : "Article/Proposal Submission";
    const replyMailto =
      `mailto:${encodeURIComponent(s.email)}` +
      `?subject=${encodeURIComponent(`Re: [${subjectLabel}] ${s.name}`)}`;

    // Avatar — first letters of name (or '?' if empty). Single deliberate
    // identity cue per row so the eye locks on the person, not the data.
    const initialsStr = (s.name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";

    // ── Compact header row (always visible). Restructured from the
    //    previous compact list into a richer "envelope" style: avatar +
    //    name + source chip on top, then a 2-line preview of the message
    //    so admins can decide whether to expand without committing.
    //    Click anywhere on the header (except links/buttons) to expand.
    const messagePreview = (s.message || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    const header = `
      <div style="padding:18px 22px;cursor:pointer;display:grid;grid-template-columns:48px 1fr auto;gap:16px;align-items:flex-start;" data-expand>
        <!-- Avatar -->
        <div style="width:42px;height:42px;border-radius:50%;background:${isJoinTeam ? "var(--ink)" : "var(--surface-2)"};color:${isJoinTeam ? "#fff" : "var(--ink)"};border:1px solid var(--hairline);font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;letter-spacing:0.02em;flex-shrink:0;">
          ${esc(initialsStr)}
        </div>

        <!-- Identity + preview -->
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="font-weight:700;color:var(--ink);font-size:15px;">${esc(s.name || "(no name)")}</span>
            ${sourceChip}
            <span class="pill ${pill.cls}" style="font-size:10px;">${esc(pill.label)}</span>
            ${s.reviewerNote ? `<span title="${esc(s.reviewerNote)}" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);font-style:italic;">📝 internal note</span>` : ""}
          </div>
          <div style="color:var(--muted);font-size:12px;margin-bottom:8px;display:flex;gap:14px;flex-wrap:wrap;">
            <span><a href="mailto:${esc(s.email)}" onclick="event.stopPropagation();" style="color:var(--ink-2);text-decoration:none;">${esc(s.email)}</a></span>
            ${s.phone ? `<span>📞 ${esc(s.phone)}</span>` : ""}
            ${s.role ? `<span>Role: <strong style="color:var(--ink-2);font-weight:600;">${esc(s.role)}</strong></span>` : ""}
            ${s.articleTitle ? `<span>Pitch: <em style="color:var(--ink-2);">${esc(s.articleTitle)}</em></span>` : ""}
          </div>
          <div style="color:var(--ink-2);font-size:13px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
            ${esc(messagePreview)}${s.message && s.message.length > messagePreview.length ? "…" : ""}
          </div>
        </div>

        <!-- Right rail: time + chevron -->
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;">
          <span style="color:var(--muted);font-size:12px;white-space:nowrap;">${s.createdAt ? esc(fmtRelative(s.createdAt)) : "—"}</span>
          <span style="color:var(--muted-light);font-size:18px;line-height:1;">${expanded ? "▾" : "▸"}</span>
        </div>
      </div>`;

    if (!expanded) {
      return `<div class="sub-row" data-row="${esc(s.id)}" style="border-bottom:1px solid var(--hairline);background:${s.status === "new" ? "var(--surface)" : "var(--surface)"};">${header}</div>`;
    }

    // ── Expanded detail. Everything the submitter typed, in their own
    //    words, structured as a "submission record" with the long-form
    //    message at the top (the most important field), the form-field
    //    answers in a labeled grid below, and the admin triage controls
    //    pinned at the bottom in their own footer band.

    // Form-field "answers" block — every input the submitter filled in,
    // shown in the order it appeared on the public form so admins can
    // reconstruct what the submitter saw.
    const orderedFields = isJoinTeam
      ? [
          { label: "Full name", value: s.name },
          { label: "Email", value: s.email, type: "email" },
          { label: "Phone", value: s.phone },
          { label: "Position / interest", value: s.role },
          ...(s.selectedRole === "Other" || s.otherRole
            ? [{ label: "Other role (custom)", value: s.otherRole }]
            : []),
          { label: "Portfolio / link", value: s.portfolio, type: "link" },
        ]
      : [
          { label: "Full name", value: s.name },
          { label: "Email", value: s.email, type: "email" },
          { label: "Article title / pitch", value: s.articleTitle },
          { label: "Portfolio / supporting link", value: s.portfolio, type: "link" },
        ];

    const submitMeta = [
      { label: "Submission ID", value: s.id, mono: true },
      { label: "Source", value: sourceLabel },
      { label: "Submitted", value: s.createdAt ? `${fmtDate(s.createdAt)} · ${fmtRelative(s.createdAt)}` : "—" },
      ...(s.reviewedAt ? [{ label: "Last reviewed", value: `${fmtDate(s.reviewedAt)} by ${s.reviewedBy || "—"}` }] : []),
      ...(s.ip ? [{ label: "Submitter IP", value: s.ip, mono: true }] : []),
    ];

    const detail = `
      <div style="padding:0 22px 0 22px;background:var(--surface-2);border-top:1px solid var(--hairline);">

        <!-- ── Long-form message (the most important field) ────────── -->
        <div style="background:var(--surface);border:1px solid var(--hairline);border-radius:12px;padding:20px 22px;margin:18px 0;box-shadow:0 1px 0 rgba(0,0,0,0.02);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:var(--muted);text-transform:uppercase;">${isJoinTeam ? "Why they want to join" : "What they're proposing"}</div>
            <button type="button" class="btn btn-ghost btn-xs" data-copy-msg style="font-size:11px;">Copy message</button>
          </div>
          <div data-msg-body style="white-space:pre-wrap;color:var(--ink);font-size:14.5px;line-height:1.65;font-family:Georgia,'Times New Roman',serif;">${esc(s.message || "(no message provided)")}</div>
        </div>

        <!-- ── Form-field answers ────────────────────────────────── -->
        <div style="background:var(--surface);border:1px solid var(--hairline);border-radius:12px;padding:18px 22px;margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:var(--muted);text-transform:uppercase;margin-bottom:14px;">Form responses</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px 32px;">
            ${orderedFields.map(renderAnswer).join("")}
          </div>
        </div>

        <!-- ── Submission metadata ───────────────────────────────── -->
        <div style="background:transparent;padding:8px 4px 16px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.16em;color:var(--muted-light);text-transform:uppercase;margin-bottom:10px;">Submission record</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px 22px;">
            ${submitMeta.map((m) => `
              <div style="display:flex;gap:6px;align-items:baseline;font-size:12px;color:var(--muted);">
                <span>${esc(m.label)}:</span>
                <span style="color:var(--ink-2);${m.mono ? "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;" : ""}font-weight:500;">${esc(m.value || "—")}</span>
              </div>`).join("")}
          </div>
        </div>

        <!-- ── Admin triage footer ───────────────────────────────── -->
        <div style="background:var(--surface);border:1px solid var(--hairline);border-radius:12px;padding:16px 18px;margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:var(--muted);text-transform:uppercase;margin-bottom:12px;">Admin triage</div>
          <div style="display:grid;grid-template-columns:160px 1fr auto;gap:12px;align-items:flex-end;">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;font-weight:700;letter-spacing:0.1em;color:var(--muted-light);text-transform:uppercase;">
              Status
              <select class="input" data-status style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--ink);">
                ${["new", "reviewing", "replied", "archived"].map((st) => `
                  <option value="${st}" ${s.status === st ? "selected" : ""}>${(STATUS_PILL[st] || {label:st}).label}</option>
                `).join("")}
              </select>
            </label>

            <label style="display:flex;flex-direction:column;gap:4px;font-size:10px;font-weight:700;letter-spacing:0.1em;color:var(--muted-light);text-transform:uppercase;">
              Internal note (only visible here)
              <div style="display:flex;gap:6px;">
                <input class="input" data-note value="${esc(s.reviewerNote || "")}" placeholder="e.g. follow up after midterms" style="flex:1;font-weight:500;text-transform:none;letter-spacing:0;color:var(--ink);">
                <button type="button" class="btn btn-secondary btn-sm" data-save-note>Save note</button>
              </div>
            </label>

            <div style="display:flex;gap:6px;">
              <a href="${esc(replyMailto)}" class="btn btn-accent btn-sm">Reply via email</a>
              <button type="button" class="btn btn-ghost btn-sm" data-archive>Archive</button>
            </div>
          </div>
        </div>
      </div>`;

    return `<div class="sub-row" data-row="${esc(s.id)}" style="border-bottom:1px solid var(--hairline);">${header}${detail}</div>`;
  }

  // Per-field renderer for the "Form responses" grid. Renders the label
  // exactly as it appeared on the public form, plus the submitted value
  // in a way that matches its semantic type (mailto link, external
  // anchor, plain text). Empty values render as a muted em-dash so the
  // grid doesn't develop holes when an optional field was skipped.
  function renderAnswer({ label, value, type }) {
    let rendered;
    if (!value) {
      rendered = `<span style="color:var(--muted-light);">— not provided</span>`;
    } else if (type === "email") {
      rendered = `<a href="mailto:${esc(value)}" style="color:var(--ink);text-decoration:underline;">${esc(value)}</a>`;
    } else if (type === "link") {
      rendered = `<a href="${esc(value)}" target="_blank" rel="noopener" style="color:var(--ink);text-decoration:underline;word-break:break-all;">${esc(value)}</a>`;
    } else {
      rendered = esc(value);
    }
    return `
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:0.12em;color:var(--muted-light);text-transform:uppercase;margin-bottom:6px;">${esc(label)}</div>
        <div style="font-size:14px;color:var(--ink);line-height:1.5;word-break:break-word;">${rendered}</div>
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
