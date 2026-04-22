// Overview page — friendly landing for every role, with the shared pipeline
// widget at the bottom so everyone sees what's going on.

import { db } from "../firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, fmtRelative, statusPill } from "./ui.js";
import { renderPipeline } from "./pipeline.js";

const ROLE_GREETINGS = {
  admin: "You're running the show today. Here's what's active.",
  editor: "Your editing queue + the broader pipeline.",
  writer: "Your drafts and what the rest of the newsroom is working on.",
  newsletter_builder: "Compose a new issue or review past campaigns.",
  marketing: "Growth pulse and collaboration pipeline.",
};

export async function mount(ctx, container) {
  container.innerHTML = "";

  // Hero
  const hero = el("div", { class: "card" });
  const firstName = (ctx.profile.name || "").split(" ")[0] || ctx.profile.email;
  hero.innerHTML = `
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:20px;">
      <div>
        <div class="section-title" style="margin:0 0 6px 0;">Welcome back</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.01em;">Hi, ${esc(firstName)}.</div>
        <div style="color:var(--muted);margin-top:6px;max-width:560px;line-height:1.5;">
          ${esc(ROLE_GREETINGS[ctx.role] || "Here's your Catalyst workspace.")}
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${ctx.role === "writer" || ctx.role === "editor" || ctx.role === "admin" ? `<a class="btn btn-accent" href="#/writer/draft">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Start a draft
        </a>` : ""}
        ${ctx.role === "newsletter_builder" || ctx.role === "admin" ? `<a class="btn btn-primary" href="#/newsletter/builder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><polyline points="22,6 12,13 2,6"/></svg>
          Build newsletter
        </a>` : ""}
      </div>
    </div>`;
  container.appendChild(hero);

  // Quick stats
  const statsGrid = el("div", { class: "grid grid-4", style: { marginTop: "20px" } });
  statsGrid.innerHTML = `
    <div class="stat"><div class="stat-label">Drafts in progress</div><div class="stat-value" data-k="drafts">…</div></div>
    <div class="stat"><div class="stat-label">Awaiting review</div><div class="stat-value" data-k="pending">…</div></div>
    <div class="stat"><div class="stat-label">Published this month</div><div class="stat-value" data-k="published">…</div></div>
    <div class="stat"><div class="stat-label">Active subscribers</div><div class="stat-value" data-k="subs">…</div></div>`;
  container.appendChild(statsGrid);

  loadQuickStats(statsGrid, ctx).catch((err) => console.warn("stats failed", err));

  // Recent activity
  const recent = el("div", { class: "card", style: { marginTop: "20px" } });
  recent.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Recent articles</div>
        <div class="card-subtitle">The last 6 updates from the newsroom</div>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/writer/feed">See all &rarr;</a>
    </div>
    <div class="card-body" id="recent-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(recent);
  loadRecentArticles(recent.querySelector("#recent-body"), ctx);

  // Newsletter reminder (admin only)
  if (ctx.role === "admin" || ctx.role === "newsletter_builder") {
    const nlCard = el("div", { class: "card", style: { marginTop: "20px" } });
    nlCard.innerHTML = `<div class="card-body" id="nl-reminder"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
    container.appendChild(nlCard);
    loadNewsletterReminder(nlCard.querySelector("#nl-reminder"), ctx);
  }

  // Catalyst bot (admin only) — writer reminders + Saturday digest
  if (ctx.role === "admin") {
    const botCard = el("div", { class: "card", style: { marginTop: "20px" } });
    botCard.innerHTML = `<div class="card-body" id="bot-panel"></div>`;
    container.appendChild(botCard);
    mountBotPanel(botCard.querySelector("#bot-panel"), ctx);
  }

  // Staff directory
  const staff = el("div", { class: "card", style: { marginTop: "20px" } });
  staff.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">The team</div>
        <div class="card-subtitle">Everyone on staff and what they do</div>
      </div>
      ${ctx.role === "admin" ? `<a class="btn btn-ghost btn-sm" href="#/admin/users">Manage &rarr;</a>` : ""}
    </div>
    <div class="card-body" id="staff-body"><div class="loading-state"><div class="spinner"></div>Loading&hellip;</div></div>`;
  container.appendChild(staff);
  loadStaff(staff.querySelector("#staff-body"), ctx);

  // Shared pipeline
  const pipeline = el("div", { class: "card", style: { marginTop: "20px" } });
  pipeline.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Catalyst in the Capital — Editorial workflow</div>
        <div class="card-subtitle">Live from the scheduler database</div>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/pipeline/interviews">Full view &rarr;</a>
    </div>
    <div id="pipeline-mount"></div>`;
  container.appendChild(pipeline);
  renderPipeline(pipeline.querySelector("#pipeline-mount"), ctx, { compact: true });
}

async function loadQuickStats(gridEl, ctx) {
  try {
    const storiesRef = collection(db, "stories");
    const drafts = await getDocs(query(storiesRef, where("status", "==", "draft")));
    const pending = await getDocs(query(storiesRef, where("status", "==", "pending")));
    const published = await getDocs(query(storiesRef, where("status", "==", "published")));

    const monthCutoff = new Date();
    monthCutoff.setDate(monthCutoff.getDate() - 30);
    const publishedThisMonth = published.docs.filter((d) => {
      const pub = d.data().publishedAt;
      return pub && new Date(pub) > monthCutoff;
    }).length;

    gridEl.querySelector('[data-k="drafts"]').textContent = drafts.size;
    gridEl.querySelector('[data-k="pending"]').textContent = pending.size;
    gridEl.querySelector('[data-k="published"]').textContent = publishedThisMonth;

    // Subscribers — only for roles that can read subscribers, otherwise hide.
    if (["admin", "marketing", "editor", "newsletter_builder"].includes(ctx.role) || ctx.role === "admin") {
      try {
        const subs = await getDocs(query(collection(db, "subscribers"), where("status", "==", "active")));
        gridEl.querySelector('[data-k="subs"]').textContent = subs.size;
      } catch (err) {
        gridEl.querySelector('[data-k="subs"]').textContent = "—";
      }
    } else {
      gridEl.querySelector('[data-k="subs"]').textContent = "—";
    }
  } catch (err) {
    console.warn("Quick stats failed:", err);
    gridEl.querySelectorAll("[data-k]").forEach((n) => (n.textContent = "—"));
  }
}

const ROLE_META = {
  admin:              { label: "Administrator",      group: "Leadership",  order: 1, color: "#7c3aed" },
  editor:             { label: "Editor",             group: "Editorial",   order: 2, color: "#0f766e" },
  writer:             { label: "Writer",             group: "Editorial",   order: 3, color: "#0891b2" },
  newsletter_builder: { label: "Newsletter Builder", group: "Publishing",  order: 4, color: "#b45309" },
  marketing:          { label: "Marketing",          group: "Publishing",  order: 5, color: "#db2777" },
  reader:             { label: "Reader",             group: "Community",   order: 6, color: "#64748b" },
};

const GROUP_ORDER = ["Leadership", "Editorial", "Publishing", "Community"];

async function loadStaff(mount, ctx) {
  try {
    const snap = await getDocs(query(collection(db, "users"), limit(200)));
    if (snap.empty) {
      mount.innerHTML = `<div class="empty-state">No teammates found yet.</div>`;
      return;
    }

    // Group by role-group, filter out readers unless viewer is admin.
    const showReaders = ctx.role === "admin";
    const people = [];
    snap.forEach((d) => {
      const u = d.data();
      const role = u.role || "reader";
      if (role === "reader" && !showReaders) return;
      if ((u.status || "active") === "inactive") return;
      people.push({ id: d.id, ...u, role });
    });

    if (!people.length) {
      mount.innerHTML = `<div class="empty-state">No teammates found yet.</div>`;
      return;
    }

    // Sort by role order, then by name.
    people.sort((a, b) => {
      const ao = ROLE_META[a.role]?.order ?? 99;
      const bo = ROLE_META[b.role]?.order ?? 99;
      if (ao !== bo) return ao - bo;
      return (a.name || a.email || "").localeCompare(b.name || b.email || "");
    });

    // Group
    const groups = {};
    for (const p of people) {
      const g = ROLE_META[p.role]?.group || "Community";
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }

    mount.innerHTML = "";
    for (const gName of GROUP_ORDER) {
      const list = groups[gName];
      if (!list || !list.length) continue;

      const section = el("div", { class: "staff-group" });
      section.innerHTML = `
        <div class="staff-group-head">
          <span class="staff-group-title">${esc(gName)}</span>
          <span class="staff-group-count">${list.length}</span>
        </div>
        <div class="staff-grid"></div>`;
      const grid = section.querySelector(".staff-grid");

      list.forEach((p) => {
        const meta = ROLE_META[p.role] || ROLE_META.reader;
        const name = p.name || p.email || "Unknown";
        const init = getInitials(name);
        const card = el("div", { class: "staff-card" });
        card.innerHTML = `
          <div class="staff-avatar" style="background:${meta.color};">${esc(init)}</div>
          <div class="staff-info">
            <div class="staff-name">${esc(name)}</div>
            <div class="staff-role" style="color:${meta.color};">${esc(meta.label)}</div>
            ${p.email ? `<div class="staff-email">${esc(p.email)}</div>` : ""}
          </div>`;
        grid.appendChild(card);
      });

      mount.appendChild(section);
    }
  } catch (err) {
    console.warn("[overview] staff load failed", err);
    mount.innerHTML = `<div class="error-state">Could not load the team. ${esc(err?.message || "")}</div>`;
  }
}

function getInitials(nameOrEmail) {
  const s = String(nameOrEmail || "").trim();
  if (!s) return "?";
  if (s.includes("@")) return s[0].toUpperCase();
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function loadNewsletterReminder(mount, ctx) {
  try {
    const res = await ctx.authedFetch("/api/newsletter/history");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const sent = (data.campaigns || []).filter((c) => c.status === "sent");
    const last = sent[0] || null;
    const lastDate = last ? new Date(last.sentAt || last.createdAt) : null;
    const now = Date.now();
    const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
    const overdue = !lastDate || (now - lastDate.getTime()) > TWO_WEEKS;
    const daysSince = lastDate ? Math.floor((now - lastDate.getTime()) / (24 * 60 * 60 * 1000)) : null;

    const bannerColor = overdue ? "var(--accent, #e85d04)" : "var(--success, #0f766e)";
    const bannerBg   = overdue ? "#fff7ed" : "#f0fdf4";
    const bannerBorder = overdue ? "#fed7aa" : "#bbf7d0";

    mount.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:44px;height:44px;border-radius:12px;background:${bannerBg};border:1px solid ${bannerBorder};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${bannerColor}" stroke-width="2"><path d="M4 4h16v16H4z"/><polyline points="22,6 12,13 2,6"/></svg>
          </div>
          <div>
            <div style="font-weight:700;font-size:15px;color:var(--ink);">
              ${overdue
                ? (lastDate ? `Newsletter overdue — last sent ${daysSince} day${daysSince === 1 ? "" : "s"} ago` : "No newsletter has been sent yet")
                : `Newsletter sent ${daysSince === 0 ? "today" : daysSince + " day" + (daysSince === 1 ? "" : "s") + " ago"}`}
            </div>
            <div style="font-size:13px;color:var(--muted);margin-top:2px;">
              ${last
                ? `Last issue: <strong>${esc(last.subject || "(no subject)")}</strong> · ${last.recipientCount || 0} recipients · sent by ${esc(last.createdBy || "unknown")}`
                : "Send your first newsletter to keep subscribers engaged."}
            </div>
          </div>
        </div>
        <a class="btn ${overdue ? "btn-accent" : "btn-secondary"} btn-sm" href="#/newsletter/builder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><polyline points="22,6 12,13 2,6"/></svg>
          ${overdue ? "Send newsletter now" : "Build next issue"}
        </a>
      </div>`;
  } catch (err) {
    mount.innerHTML = `<div class="hint">Could not load newsletter status.</div>`;
  }
}

async function loadRecentArticles(mount, ctx) {
  try {
    const storiesRef = collection(db, "stories");
    const snap = await getDocs(query(storiesRef, orderBy("updatedAt", "desc"), limit(6)));
    if (snap.empty) {
      mount.innerHTML = `<div class="empty-state">No articles yet. Be the first to submit a draft.</div>`;
      return;
    }
    const list = el("div", {});
    snap.forEach((d) => {
      const a = d.data();
      const row = el("div", { class: "article-row" });
      row.innerHTML = `
        <div>
          <div class="article-title">${esc(a.title || "Untitled")}</div>
          <div class="article-meta">
            by ${esc(a.authorName || a.author || "Unknown")} · ${fmtRelative(a.updatedAt)} · ${statusPill(a.status)}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${a.status === "published" && a.url
            ? `<a class="btn btn-secondary btn-xs" href="${esc(a.url)}" target="_blank" rel="noopener">View</a>`
            : ""}
        </div>`;
      list.appendChild(row);
    });
    mount.innerHTML = "";
    mount.appendChild(list);
  } catch (err) {
    mount.innerHTML = `<div class="error-state">Could not load recent articles. ${esc(err?.message || "")}</div>`;
  }
}

// ─── Catalyst bot control panel ─────────────────────────────────────────────

function mountBotPanel(mount, ctx) {
  const render = (state = "idle", result = null, err = null) => {
    mount.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:44px;height:44px;border-radius:12px;background:#0b0b0d;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round">
              <rect x="3" y="8" width="18" height="12" rx="2"/>
              <path d="M12 2v6"/>
              <circle cx="8.5" cy="13" r="1.2"/>
              <circle cx="15.5" cy="13" r="1.2"/>
              <path d="M9 17h6"/>
            </svg>
          </div>
          <div>
            <div style="font-weight:700;font-size:15px;color:var(--ink);">Catalyst editorial bot</div>
            <div style="font-size:13px;color:var(--muted);margin-top:2px;">
              Daily writer reminders (deadlines + 10-day idle checks) and a Saturday admin digest with copy-paste messages.
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" data-bot-action="preview" title="Compute what would be sent — nothing leaves the building.">Preview (dry run)</button>
          <button class="btn btn-ghost btn-sm" data-bot-action="digest-preview" title="Preview the Saturday digest without emailing anyone.">Preview digest</button>
          <a class="btn btn-ghost btn-sm" href="#/admin/users" title="Pause Catalyst bot reminders for specific writers.">Manage exemptions</a>
          <button class="btn btn-secondary btn-sm" data-bot-action="digest-to-admins" title="Email the Saturday digest to the admin team right now.">Send digest to admins</button>
          <button class="btn btn-accent btn-sm" data-bot-action="run" title="Send every writer their reminder email now.">Run bot now</button>
        </div>
      </div>
      <div id="bot-status" style="margin-top:14px;"></div>
    `;

    const statusEl = mount.querySelector("#bot-status");
    if (state === "running") {
      statusEl.innerHTML = `<div class="hint" style="display:flex;align-items:center;gap:8px;"><div class="spinner"></div>Running — this takes a few seconds…</div>`;
    } else if (state === "error") {
      statusEl.innerHTML = `<div class="error-state">${esc(err?.message || err || "Something went wrong.")}</div>`;
    } else if (state === "done" && result) {
      statusEl.innerHTML = renderBotResult(result);
      wireBotResultHandlers(statusEl, result);
    }

    mount.querySelectorAll("[data-bot-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.botAction;
        // "preview"          → compute writer reminders + force-preview the digest, dry run
        // "digest-preview"   → only show what the digest would contain, no send
        // "digest-to-admins" → force-send the digest to the admin team right now
        // "run"              → send all writer reminders AND force-send digest
        const payload =
          action === "preview"         ? { mode: "auto", dryRun: true, forceDigest: true } :
          action === "digest-preview"  ? { mode: "digest", dryRun: true } :
          action === "digest-to-admins" ? { mode: "digest-to-admins" } :
                                          { mode: "auto", forceDigest: true };

        if (action === "digest-to-admins") {
          if (!confirm("Send the Saturday digest email to all admins right now?")) return;
        }
        if (action === "run") {
          if (!confirm("This will actually email every planned writer. Continue?")) return;
        }

        render("running");
        try {
          const res = await ctx.authedFetch("/api/bot/run", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
          render("done", data);
        } catch (e) {
          render("error", null, e);
        }
      });
    });
  };

  render();
}

function renderBotResult(r) {
  const w = r.writerReminders || {};
  const d = r.adminDigest || {};
  const items = Array.isArray(w.items) ? w.items : [];
  const skipped = Array.isArray(w.skipped) ? w.skipped : [];

  const headerTone = r.dryRun
    ? { bg: "#eff6ff", border: "#bfdbfe", ink: "#1e3a8a", title: "Preview — nothing sent." }
    : { bg: "#f0fdf4", border: "#bbf7d0", ink: "#14532d", title: "Bot run complete." };

  return `
    <div style="background:${headerTone.bg};border:1px solid ${headerTone.border};border-radius:12px;padding:14px 16px;">
      <div style="font-weight:700;font-size:14px;color:${headerTone.ink};margin-bottom:6px;">${headerTone.title}</div>
      <div style="font-size:13px;color:${headerTone.ink};line-height:1.6;">
        Scanned <strong>${r.projectsScanned}</strong> projects across <strong>${r.usersScanned}</strong> users.
        Writer reminders: <strong>${w.planned || 0}</strong> planned${r.dryRun ? "" : `, <strong>${w.sent || 0}</strong> sent`}${skipped.length ? `, <strong>${skipped.length}</strong> skipped` : ""}${w.errors?.length ? `, <strong>${w.errors.length}</strong> failed` : ""}.
        ${d.sent ? ` Admin digest <strong>sent</strong> to <strong>${d.recipientCount}</strong> recipient${d.recipientCount === 1 ? "" : "s"}.` : ""}
        ${d.skipped ? ` Digest: ${esc(d.skipped)}.` : ""}
        ${d.error ? ` Digest error: <strong>${esc(d.error)}</strong>.` : ""}
      </div>
      ${w.errors?.length ? `<div style="margin-top:10px;font-size:12px;color:#991b1b;"><strong>Errors:</strong> ${w.errors.map(e => esc(e.error)).join("; ")}</div>` : ""}
    </div>

    ${items.length ? renderPlannedReminders(items) : ""}
    ${skipped.length ? renderSkippedReminders(skipped) : ""}
    ${d.rows ? renderDigestPreview(d) : ""}
  `;
}

function renderPlannedReminders(items) {
  const rows = items.map((it, idx) => {
    const kindBadge = kindLabel(it.kind);
    const meta = [
      it.daysUntilDeadline != null ? `${it.daysUntilDeadline}d to deadline` : null,
      it.daysInactive != null ? `${it.daysInactive}d idle` : null,
    ].filter(Boolean).join(" · ");

    return `
      <div style="border-top:1px solid var(--hairline,#e5e7eb);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:12px 14px;gap:12px;cursor:pointer;" data-reminder-toggle="${idx}">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;font-size:14px;color:var(--ink,#111);">
              <span style="display:inline-block;background:${kindBadge.bg};color:${kindBadge.ink};font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:2px 8px;border-radius:999px;margin-right:8px;vertical-align:middle;">${esc(kindBadge.text)}</span>
              ${esc(it.writerName || it.writerEmail)}
              <span style="color:var(--muted,#6b7280);font-weight:400;"> — ${esc(it.projectTitle || "(untitled)")}</span>
            </div>
            <div style="margin-top:4px;font-size:12px;color:var(--muted,#6b7280);">
              <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(it.writerEmail)}</span>
              ${meta ? ` · ${esc(meta)}` : ""}
            </div>
            <div style="margin-top:6px;font-size:13px;color:var(--ink-2,#374151);line-height:1.45;">
              <strong>Subject:</strong> ${esc(it.subject || "(no subject)")}
            </div>
          </div>
          <button class="btn btn-ghost btn-xs" type="button" style="flex-shrink:0;" data-reminder-toggle="${idx}">View full email &rarr;</button>
        </div>
        <div data-reminder-body="${idx}" style="display:none;padding:0 14px 14px 14px;">
          <div style="border:1px solid var(--hairline,#e5e7eb);border-radius:10px;overflow:hidden;background:#fff;">
            <iframe data-reminder-frame="${idx}" sandbox="allow-same-origin" style="width:100%;border:0;display:block;background:#fff;min-height:200px;" scrolling="no"></iframe>
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="margin-top:14px;border:1px solid var(--hairline,#e5e7eb);border-radius:12px;overflow:hidden;">
      <div style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted,#6b7280);">
        Planned writer emails (${items.length})
      </div>
      ${rows}
    </div>
  `;
}

function renderSkippedReminders(skipped) {
  // Group by reason so admins see "writer-not-found ×5" rather than a flat list.
  const byReason = {};
  for (const s of skipped) {
    if (!byReason[s.reason]) byReason[s.reason] = [];
    byReason[s.reason].push(s);
  }

  const REASON_LABELS = {
    "writer-not-found":  { label: "Writer not found in users",   hint: "The project's authorId / authorName / authorEmail doesn't match any row in the users collection. The writer won't be emailed until they sign in (which creates their user doc) or the authorId on the project is healed." },
    "writer-has-no-email": { label: "Writer has no email",        hint: "Their users/{uid} doc is missing an email field." },
    "writer-exempt":     { label: "Writer reminder exemption",   hint: "An admin paused Catalyst bot reminder nudges for this writer, either indefinitely or until a specific date." },
    "cooldown-active":   { label: "7-day cooldown active",        hint: "A reminder of this kind was already sent within the past 7 days." },
    "project-complete":  { label: "Story already published",      hint: "timeline['Suggestions Reviewed'] is true." },
    "no-activity-data":  { label: "No activity/deadline data",    hint: "The project has no deadline, no updatedAt, and no activity entries — nothing to compare against." },
    "not-idle-yet":      { label: "Near idle, not triggered yet", hint: "Close to but still under the 10-day idle threshold." },
  };

  const sections = Object.entries(byReason).map(([reason, list]) => {
    const meta = REASON_LABELS[reason] || { label: reason, hint: "" };
    const tone = reason === "writer-not-found" || reason === "writer-has-no-email"
      ? { bg: "#fef2f2", border: "#fecaca", ink: "#991b1b" }
      : reason === "writer-exempt"
        ? { bg: "#eff6ff", border: "#bfdbfe", ink: "#1d4ed8" }
      : { bg: "#f8fafc", border: "#e5e7eb", ink: "#374151" };

    return `
      <div style="border:1px solid ${tone.border};background:${tone.bg};border-radius:10px;padding:12px 14px;margin-top:10px;">
        <div style="font-weight:700;font-size:13px;color:${tone.ink};">${esc(meta.label)} <span style="font-weight:500;color:var(--muted,#6b7280);">(${list.length})</span></div>
        ${meta.hint ? `<div style="margin-top:4px;font-size:12px;color:var(--muted,#6b7280);line-height:1.5;">${esc(meta.hint)}</div>` : ""}
        <div style="margin-top:8px;display:grid;gap:6px;">
          ${list.slice(0, 25).map((s) => `
            <div style="font-size:12.5px;color:${tone.ink};line-height:1.45;">
              <strong>${esc(s.projectTitle || "(untitled)")}</strong>
              ${s.writerName ? ` — ${esc(s.writerName)}` : ""}
              ${s.authorName && !s.writerName ? ` — author on project: ${esc(s.authorName)}` : ""}
              ${s.writerEmail ? ` <span style="color:var(--muted,#6b7280);font-family:ui-monospace,monospace;">${esc(s.writerEmail)}</span>` : ""}
              ${s.authorEmail && !s.writerEmail ? ` <span style="color:var(--muted,#6b7280);font-family:ui-monospace,monospace;">${esc(s.authorEmail)}</span>` : ""}
              ${s.daysInactive != null ? ` <span style="color:var(--muted,#6b7280);">· ${s.daysInactive}d idle</span>` : ""}
              ${s.kind ? ` <span style="color:var(--muted,#6b7280);">· ${esc(s.kind)}</span>` : ""}
              ${s.lastSentAt ? ` <span style="color:var(--muted,#6b7280);">· last sent ${esc(fmtShort(s.lastSentAt))}</span>` : ""}
              ${s.exemption ? ` <span style="color:var(--muted,#6b7280);">· ${esc(formatBotExemptionLabel(s.exemption))}</span>` : ""}
              ${s.exemption?.reason ? ` <span style="color:var(--muted,#6b7280);">· ${esc(s.exemption.reason)}</span>` : ""}
            </div>
          `).join("")}
          ${list.length > 25 ? `<div style="font-size:12px;color:var(--muted,#6b7280);">…and ${list.length - 25} more.</div>` : ""}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="margin-top:14px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted,#6b7280);padding:0 4px;">
        Skipped (${skipped.length}) — why these writers didn't make the list
      </div>
      ${sections}
    </div>
  `;
}

function renderDigestPreview(d) {
  const rows = Array.isArray(d.rows) ? d.rows : [];
  const flaggedRows = rows.filter((r) => r.flaggedCount > 0);

  const writerBlocks = rows.map((row) => {
    const flagged = row.flaggedCount > 0;
    const exempt = row.exemption;
    const headerBg = exempt ? "#eff6ff" : (flagged ? "#fff4e5" : "#f8fafc");
    const headerInk = exempt ? "#1d4ed8" : (flagged ? "#92400e" : "var(--ink,#111)");
    const projList = row.projects.map((p) => `
      <li style="margin:3px 0;color:var(--ink-2,#374151);">
        <strong>${esc(p.title)}</strong> — ${esc(p.stage)}
        ${p.flags && p.flags.length ? ` <span style="color:#9b1c1c;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">${p.flags.map(esc).join(" · ")}</span>` : ""}
      </li>
    `).join("");

    const copy = row.copyPasteMessage
      ? `
        <div style="margin-top:10px;background:#0b0b0d;border-radius:10px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.22em;color:#a1a1a6;text-transform:uppercase;margin-bottom:6px;">Copy-paste message</div>
          <div style="color:#f2f2f5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6;white-space:pre-wrap;">${esc(row.copyPasteMessage)}</div>
        </div>`
      : "";

    return `
      <div style="border:1px solid var(--hairline,#e5e7eb);border-radius:10px;overflow:hidden;margin-top:10px;">
        <div style="padding:10px 14px;background:${headerBg};">
          <div style="font-weight:700;color:${headerInk};font-size:14px;">
            ${esc(row.writerName || "Unassigned")}
            ${exempt ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.16em;color:#1d4ed8;text-transform:uppercase;margin-left:8px;">Reminders paused</span>` : ""}
            ${!exempt && flagged ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.16em;color:#9b1c1c;text-transform:uppercase;margin-left:8px;">Needs attention</span>` : ""}
          </div>
          ${row.writerEmail ? `<div style="font-size:12px;color:var(--muted,#6b7280);margin-top:2px;font-family:ui-monospace,monospace;">${esc(row.writerEmail)}</div>` : ""}
          ${exempt ? `<div style="font-size:12px;color:#1d4ed8;margin-top:4px;line-height:1.5;">${esc(formatBotExemptionLabel(exempt))}${exempt.reason ? ` · ${esc(exempt.reason)}` : ""}</div>` : ""}
        </div>
        <div style="padding:10px 14px;">
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.55;">${projList}</ul>
          ${copy}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="margin-top:14px;border:1px solid var(--hairline,#e5e7eb);border-radius:12px;overflow:hidden;">
      <div style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted,#6b7280);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <span>Admin digest preview — ${rows.length} writer${rows.length === 1 ? "" : "s"}, ${flaggedRows.length} flagged</span>
        ${d.recipients ? `<span style="text-transform:none;letter-spacing:0;font-weight:500;color:var(--muted,#6b7280);">Recipients: ${d.recipients.map(esc).join(", ")}</span>` : ""}
      </div>
      <div style="padding:10px 14px 14px 14px;">
        <div style="font-size:13px;color:var(--ink-2,#374151);margin-bottom:4px;"><strong>Subject:</strong> ${esc(d.subject || "")}</div>
        ${writerBlocks}
      </div>
    </div>
  `;
}

function kindLabel(kind) {
  if (kind === "deadline-overdue") return { text: "Overdue", bg: "#fde8e8", ink: "#9b1c1c" };
  if (kind === "deadline-1d")      return { text: "Due tomorrow", bg: "#fff4e5", ink: "#92400e" };
  if (kind === "deadline-3d")      return { text: "Due in 3d", bg: "#fff4e5", ink: "#92400e" };
  if (kind === "idle")             return { text: "Idle nudge",  bg: "#eef2ff", ink: "#3730a3" };
  return { text: kind || "reminder", bg: "#f3f4f6", ink: "#374151" };
}

function fmtShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatBotExemptionLabel(exemption) {
  if (!exemption) return "";
  if (!exemption.untilDate) return "Reminders paused indefinitely";
  const d = new Date(`${exemption.untilDate}T12:00:00`);
  const when = isNaN(d.getTime())
    ? exemption.untilDate
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `Reminders paused until ${when}`;
}

function wireBotResultHandlers(root, result) {
  const items = result?.writerReminders?.items || [];
  const loaded = new Set();

  root.querySelectorAll("[data-reminder-toggle]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = el.dataset.reminderToggle;
      const body = root.querySelector(`[data-reminder-body="${idx}"]`);
      if (!body) return;
      const willShow = body.style.display === "none";
      body.style.display = willShow ? "block" : "none";
      if (willShow && !loaded.has(idx)) {
        loaded.add(idx);
        const frame = body.querySelector(`[data-reminder-frame="${idx}"]`);
        const html = items[Number(idx)]?.html;
        if (frame && html) loadIntoFrame(frame, html);
      }
    });
  });
}

function loadIntoFrame(frame, html) {
  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  const resize = () => {
    try {
      const h = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 600;
      frame.style.height = h + "px";
    } catch {}
  };
  if (doc.readyState === "complete") {
    resize();
  } else {
    frame.addEventListener("load", resize, { once: true });
  }
  setTimeout(resize, 50);
  setTimeout(resize, 300);
}
