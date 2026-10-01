// Overview page — friendly landing for every role, with the shared pipeline
// widget at the bottom so everyone sees what's going on.

import { db } from "../firebase-config.js";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  deleteDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, fmtRelative, statusPill, confirmDialog } from "./ui.js";
import { renderPipeline } from "./pipeline.js?v=edition-1";
import { renderScheduleCalendar, isStaff } from "./schedule-calendar.js";

// Shortcuts at the top of Overview, per role: the three or four things that
// person opens most. Only routes they can reach are listed.
const SHORTCUTS = {
  admin:              [["#/admin/articles", "Articles & approvals"], ["#/pipeline/all", "Story Tracker"], ["#/admin/tasks", "Action items"], ["#/admin/submissions", "Submissions inbox"]],
  editor:             [["#/editor/queue", "Editing queue"], ["#/pipeline/mine", "My assignments"], ["#/writer/draft", "Write a draft"], ["#/tasks", "Team tasks"]],
  writer:             [["#/writer/draft", "Write a draft"], ["#/writer/mine", "My articles"], ["#/pipeline/mine", "My assignments"], ["#/writer/guidelines", "Editorial standards"]],
  marketing:          [["#/planner", "Planner"], ["#/marketing/social", "Social media posts"], ["#/marketing/analytics", "Subscribers & growth"], ["#/tasks", "Team tasks"]],
  social_media:       [["#/planner", "Planner"], ["#/marketing/social", "Social media posts"], ["#/tasks", "Team tasks"]],
  newsletter_builder: [["#/newsletter/builder", "Newsletter builder"], ["#/newsletter/history", "Campaign history"], ["#/tasks", "Team tasks"]],
};

function greetingFor(name) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = String(name || "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}.` : `${part}.`;
}

export async function mount(ctx, container) {
  container.innerHTML = "";
  const isAdmin = ctx.role === "admin";
  container.classList.add("ov");

  // Greeting + shortcuts
  const hello = el("section", { class: "ov-hello" });
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const shortcuts = SHORTCUTS[ctx.role] || [["#/pipeline/all", "Story Tracker"], ["#/tasks", "Team tasks"], ["#/directory", "Team & messages"]];
  hello.innerHTML = `
    <div class="ov-hello-text">
      <p class="ov-date">${esc(today)}</p>
      <h2 class="ov-greeting">${esc(greetingFor(ctx.profile?.name || ctx.user?.displayName))}</h2>
      <p class="ov-lede">Here&rsquo;s the newsroom at a glance. Every section is in the menu; pin the pages you use most.</p>
    </div>
    <nav class="ov-shortcuts" aria-label="Shortcuts">
      ${shortcuts.map(([href, label]) => `<a class="ov-shortcut" href="${href}"><span>${esc(label)}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>`).join("")}
    </nav>`;
  container.appendChild(hello);

  // Staff announcements — admin-authored banners everyone on staff sees.
  // Loaded best-effort so a failure never blanks the page.
  const announceMount = el("div", { id: "overview-announcements" });
  container.appendChild(announceMount);
  loadAnnouncements(announceMount, ctx);

  // Admin + newsletter builder: the latest stories beside the newsletter
  // status, side by side.
  if (isAdmin || ctx.role === "newsletter_builder") {
    const row = el("div", { class: "ov-row" });
    if (isAdmin) {
      const recent = el("div", { class: "card ov-recent" });
      recent.innerHTML = `
        <div class="card-header">
          <div>
            <div class="card-title">Latest from the newsroom</div>
            <div class="card-subtitle">The six most recently updated stories.</div>
          </div>
          <a class="btn btn-ghost btn-sm" href="#/writer/feed">See all</a>
        </div>
        <div class="card-body card-body--flush" id="recent-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
      row.appendChild(recent);
      loadRecentArticles(recent.querySelector("#recent-body"), ctx);
    }
    const side = el("div", { class: "ov-side" });
    const nlCard = el("div", { class: "card" });
    nlCard.innerHTML = `<div class="card-body" id="nl-reminder"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
    side.appendChild(nlCard);
    loadNewsletterReminder(nlCard.querySelector("#nl-reminder"), ctx);
    side.appendChild(directoryCard());
    row.appendChild(side);
    container.appendChild(row);
  }

  // Editorial calendar — every staff member sees the month's publish dates,
  // ready-by dates (publish − 1 week, for the social team), interviews, and
  // their own deadlines + progress nudges.
  if (isStaff(ctx.role)) {
    try {
      renderScheduleCalendar(container, ctx);
    } catch (err) {
      console.warn("[overview] schedule calendar failed", err);
    }
  }

  if (!isAdmin && ctx.role !== "newsletter_builder") container.appendChild(directoryCard());

  // For non-admins the Overview ends here — the snapshot and the bot below
  // are the admin's newsroom-wide view.
  if (!isAdmin) return;

  const pipeline = el("div", { class: "card" });
  pipeline.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Story Tracker</div>
        <div class="card-subtitle">Where every story stands right now.</div>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/pipeline/all">Open the tracker</a>
    </div>
    <div id="pipeline-mount"></div>`;
  container.appendChild(pipeline);
  renderPipeline(pipeline.querySelector("#pipeline-mount"), ctx, { compact: true });

  // Catalyst bot (admin only): the controls and its email log, folded into
  // one panel so they don't push the rest of the page down.
  const bot = el("details", { class: "card ov-bot" });
  bot.innerHTML = `
    <summary class="ov-bot-summary">
      <span class="ov-bot-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M8.5 13.5h.01M15.5 13.5h.01M9 17h6"/></svg></span>
      <span class="ov-bot-text">
        <span class="card-title">Reminder bot</span>
        <span class="card-subtitle">Daily nudges to writers and editors, a Saturday digest for admins, and every email it has sent.</span>
      </span>
      <span class="ov-bot-stat" id="ov-bot-stat"></span>
      <svg class="ov-bot-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </summary>
    <div class="card-body" id="bot-panel"></div>
    <div class="card-body ov-bot-log" id="bot-email-log"></div>`;
  container.appendChild(bot);
  mountBotPanel(bot.querySelector("#bot-panel"), ctx);
  mountBotEmailLog(bot.querySelector("#bot-email-log"), ctx);
}

function directoryCard() {
  const c = el("a", { class: "card ov-link-card", href: "#/directory" });
  c.innerHTML = `
    <span class="ov-link-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18.5 19a5 5 0 0 0-2.6-4.4"/></svg></span>
    <span><span class="card-title">Team &amp; messages</span><span class="card-subtitle">Everyone&rsquo;s role and contact details, and a private message button.</span></span>
    <svg class="ov-link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
  return c;
}

// ─── Staff announcement banners ──────────────────────────────────────────────
// Red, hard-to-miss banners admins post from Advanced tools → Announcements.
// Everyone on staff sees active ones at the top of their Overview. Non-admins
// can dismiss a banner for themselves (remembered in localStorage); admins see
// a "Remove for everyone" button that deletes the announcement.

const DISMISS_KEY = "catalyst.dashboard.dismissedAnnouncements";

function getDismissed() {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function setDismissed(ids) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(ids.slice(-100))); } catch {}
}

async function loadAnnouncements(mount, ctx) {
  const isAdmin = ctx.role === "admin";
  let items = [];
  try {
    const snap = await getDocs(query(collection(db, "announcements"), limit(50)));
    const now = Date.now();
    items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => {
        if (a.active === false) return false;
        // Optional auto-expiry: hide once expiresAt passes.
        if (a.expiresAt && Date.parse(a.expiresAt) && Date.parse(a.expiresAt) < now) return false;
        return true;
      })
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  } catch (err) {
    console.warn("[overview] announcements load failed", err);
    return; // silent — never block the Overview
  }

  const dismissed = isAdmin ? [] : getDismissed();
  const render = () => {
    const visible = items.filter((a) => !dismissed.includes(a.id));
    if (!visible.length) { mount.innerHTML = ""; return; }
    mount.innerHTML = "";
    for (const a of visible) {
      mount.appendChild(announcementBanner(a, ctx, isAdmin, {
        onDismiss: () => {
          dismissed.push(a.id);
          setDismissed(dismissed);
          render();
        },
        onRemove: async (banner) => {
          const ok = await confirmDialog(
            "Remove this announcement for everyone on staff?",
            { confirmText: "Remove", danger: true });
          if (!ok) return;
          try {
            await deleteDoc(doc(db, "announcements", a.id));
            items = items.filter((x) => x.id !== a.id);
            render();
            ctx.toast("Announcement removed.", "success");
          } catch (err) {
            ctx.toast(`Could not remove: ${err?.message || err}`, "error");
          }
        },
      }));
    }
  };
  render();
}

function announcementBanner(a, ctx, isAdmin, { onDismiss, onRemove }) {
  const title = a.title || "Announcement";
  const wrap = el("div", {
    style: "margin-bottom:18px;background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #b91c1c;border-radius:12px;padding:16px 18px;display:flex;gap:14px;align-items:flex-start;",
  });

  const link = String(a.link || "").trim();
  const linkIsHash = link.startsWith("#/");
  const linkBtn = link
    ? `<a href="${esc(link)}"${linkIsHash ? "" : ` target="_blank" rel="noopener"`} class="btn btn-sm" style="background:#b91c1c;color:#fff;border-color:#b91c1c;margin-top:10px;display:inline-flex;align-items:center;gap:6px;">
         ${esc(a.linkLabel || "Open link")}
         <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
       </a>`
    : "";

  wrap.innerHTML = `
    <div style="width:34px;height:34px;border-radius:9px;background:#b91c1c;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </div>
    <div style="min-width:0;flex:1;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#b91c1c;margin-bottom:3px;">Staff announcement</div>
      <div style="font-size:16px;font-weight:700;letter-spacing:-0.01em;line-height:1.35;color:var(--ink,#0a0a0c);">${esc(title)}</div>
      ${a.message ? `<div style="margin-top:6px;font-size:14px;line-height:1.6;color:var(--ink-2,#374151);white-space:pre-wrap;">${esc(a.message)}</div>` : ""}
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        ${linkBtn}
      </div>
      <div style="margin-top:10px;font-size:11.5px;color:var(--muted,#6b7280);">
        ${a.createdByName ? `Posted by ${esc(a.createdByName)}` : "Posted by the admins"}${a.createdAt ? ` · ${esc(fmtRelative(a.createdAt))}` : ""}${a.emailed ? " · emailed to staff" : ""}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
      ${isAdmin
        ? `<button type="button" data-act="remove" class="btn btn-ghost btn-xs" style="color:#b91c1c;white-space:nowrap;">Remove for everyone</button>`
        : `<button type="button" data-act="dismiss" aria-label="Dismiss" title="Dismiss" style="border:0;background:transparent;cursor:pointer;color:#b91c1c;padding:2px 6px;font-size:18px;line-height:1;">&times;</button>`}
    </div>`;

  wrap.querySelector('[data-act="dismiss"]')?.addEventListener("click", () => onDismiss());
  wrap.querySelector('[data-act="remove"]')?.addEventListener("click", () => onRemove(wrap));
  return wrap;
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

    mount.innerHTML = `
      <div class="ov-nl">
        <p class="ov-nl-kicker"><span class="ov-dot ${overdue ? "is-late" : "is-ok"}" aria-hidden="true"></span>Newsletter</p>
        <p class="ov-nl-title">${overdue
          ? (lastDate ? `Last sent ${daysSince} day${daysSince === 1 ? "" : "s"} ago` : "No issue sent yet")
          : `Sent ${daysSince === 0 ? "today" : daysSince + " day" + (daysSince === 1 ? "" : "s") + " ago"}`}</p>
        <p class="ov-nl-meta">${last
          ? `${esc(last.subject || "(no subject)")} · ${last.recipientCount || 0} recipients`
          : "Send the first issue to keep subscribers engaged."}</p>
        <p class="ov-nl-meta">${overdue ? "We aim to send one every two weeks." : "On schedule (every two weeks)."}</p>
        <a class="btn ${overdue ? "btn-primary" : "btn-secondary"} btn-sm" href="#/newsletter/builder">${overdue ? "Build the next issue" : "Open the builder"}</a>
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
    const list = el("div", { class: "ov-stories" });
    snap.forEach((d) => {
      const a = d.data();
      const live = a.status === "published" && a.url;
      const row = el(live ? "a" : "div", { class: "ov-story", ...(live ? { href: a.url, target: "_blank", rel: "noopener" } : {}) });
      row.innerHTML = `
        <span class="ov-story-main">
          <span class="ov-story-title">${esc(a.title || "Untitled")}</span>
          <span class="ov-story-meta">${esc(a.authorName || a.author || "Unknown")} · ${fmtRelative(a.updatedAt)}</span>
        </span>
        ${statusPill(a.status)}`;
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
  if (kind === "deadline-overdue")     return { text: "Overdue",        bg: "#fde8e8", ink: "#9b1c1c" };
  if (kind === "deadline-1d")          return { text: "Due tomorrow",   bg: "#fff4e5", ink: "#92400e" };
  if (kind === "deadline-3d")          return { text: "Due in 3d",      bg: "#fff4e5", ink: "#92400e" };
  if (kind === "idle")                 return { text: "Idle nudge",     bg: "#eef2ff", ink: "#3730a3" };
  if (kind === "editor-idle")          return { text: "Editor idle",    bg: "#eef2ff", ink: "#3730a3" };
  if (kind === "editor-just-assigned") return { text: "Editor assigned",bg: "#ecfeff", ink: "#155e75" };
  if (kind === "interview-prep")       return { text: "Interview soon", bg: "#f5f3ff", ink: "#5b21b6" };
  if (kind === "interview-followup")   return { text: "Post-interview", bg: "#f5f3ff", ink: "#5b21b6" };
  if (kind === "post-approval-idle")   return { text: "Post-approval",  bg: "#eef2ff", ink: "#3730a3" };
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

// ─── Bot email activity log ──────────────────────────────────────────────────
//
// Shows the last 50 days of bot-sent writer/editor emails. Rows turn red when
// the recipient hasn't moved their project since the email — i.e. they were
// nudged and ignored it. Admin digests are intentionally excluded (not
// actionable per-recipient).

function mountBotEmailLog(mount, ctx) {
  const render = (state, data, err) => {
    const headerHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <div class="card-title">Emails the bot has sent</div>
          <div class="card-subtitle">Open a row to see why it was sent and the full message. &ldquo;No change since&rdquo; means the story hasn&rsquo;t moved since that nudge.</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-email-log-action="refresh">Refresh</button>
      </div>
      <div id="bot-email-log-body" style="margin-top:14px;"></div>
    `;
    mount.innerHTML = headerHtml;
    const body = mount.querySelector("#bot-email-log-body");

    if (state === "loading") {
      body.innerHTML = `<div class="hint" style="display:flex;align-items:center;gap:8px;"><div class="spinner"></div>Loading…</div>`;
    } else if (state === "error") {
      body.innerHTML = `<div class="error-state">${esc(err?.message || err || "Could not load email log.")}</div>`;
    } else if (state === "ready") {
      body.innerHTML = renderBotEmailLog(data);
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const ignored = entries.filter((e) => e.ignored).length;
      const stat = document.getElementById("ov-bot-stat");
      if (stat) stat.textContent = entries.length ? `${entries.length} sent${ignored ? ` · ${ignored} unanswered` : ""}` : "";
      // Each row opens to show why it was sent and the full message.
      body.querySelectorAll("[data-email-log-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const panel = body.querySelector(`[data-email-log-detail="${CSS.escape(btn.getAttribute("data-email-log-toggle"))}"]`);
          if (!panel) return;
          panel.hidden = !panel.hidden;
          btn.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
        });
      });
      const list = body.querySelector(".bl-list");
      body.querySelector(".bl-more")?.addEventListener("click", (ev) => { list.dataset.collapsed = "0"; ev.currentTarget.remove(); });
      body.querySelectorAll("[data-bl-filter]").forEach((b) => b.addEventListener("click", () => {
        body.querySelectorAll("[data-bl-filter]").forEach((x) => x.classList.toggle("is-on", x === b));
        list.dataset.filter = b.dataset.blFilter;
      }));
    }

    mount.querySelector("[data-email-log-action='refresh']")?.addEventListener("click", load);
  };

  const load = async () => {
    render("loading");
    try {
      const res = await ctx.authedFetch("/api/bot/email-log");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      render("ready", data);
    } catch (e) {
      render("error", null, e);
    }
  };

  load();
}

function renderBotEmailLog(data) {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) {
    return `<div class="empty-state">The bot hasn&rsquo;t sent any emails yet.</div>`;
  }
  const ignoredCount = entries.filter((e) => e.ignored).length;

  const rows = entries.map((e, idx) => {
    const k = kindLabel(e.kind);
    const reason = e.reason || reasonFromLogEntry(e);
    const bodyText = e.bodyText || "";
    const facts = [
      e.daysUntilDeadline != null ? (e.daysUntilDeadline < 0 ? `${-e.daysUntilDeadline}d past deadline` : `${e.daysUntilDeadline}d to deadline`) : null,
      e.daysInactive != null ? `${e.daysInactive}d idle` : null,
      e.projectMissing ? "project deleted" : null,
      e.projectComplete ? "story finished" : null,
    ].filter(Boolean).join(" · ");
    return `
      <li class="bl-row${e.ignored ? " is-ignored" : ""}" data-ignored="${e.ignored ? "1" : "0"}">
        <button type="button" class="bl-head" aria-expanded="false" data-email-log-toggle="${idx}">
          <span class="bl-kind" style="--k-bg:${k.bg};--k-ink:${k.ink}">${esc(k.text)}</span>
          <span class="bl-who"><strong>${esc(e.recipientName || e.recipientEmail || "(unknown)")}</strong>${e.projectTitle ? ` <span class="bl-about">· ${esc(e.projectTitle)}</span>` : ""}</span>
          <span class="bl-facts">${esc(facts)}</span>
          ${e.ignored ? `<span class="bl-flag">No change in ${Math.floor(e.daysSinceSent)}d</span>` : `<span class="bl-flag bl-flag--quiet"></span>`}
          <span class="bl-date">${esc(fmtShort(e.sentAt))}</span>
        </button>
        <div class="bl-detail" data-email-log-detail="${idx}" hidden>
          ${e.subject ? `<p class="bl-subject"><span>Subject</span> ${esc(e.subject)}</p>` : ""}
          ${e.recipientEmail ? `<p class="bl-subject"><span>To</span> ${esc(e.recipientEmail)}</p>` : ""}
          ${reason ? `<p class="bl-why"><span>Why it was sent</span>${esc(reason)}</p>` : ""}
          ${bodyText ? `<pre class="bl-body">${esc(bodyText)}</pre>` : `<p class="bl-none">No message body on file (sent before messages were saved).</p>`}
        </div>
      </li>`;
  }).join("");

  return `
    <div class="bl-bar">
      <p class="bl-summary">${entries.length} email${entries.length === 1 ? "" : "s"} in the last 50 days${ignoredCount ? ` · <strong>${ignoredCount} with no change since</strong>` : ""}</p>
      <div class="bl-filter" role="group" aria-label="Show">
        <button type="button" class="is-on" data-bl-filter="all">All</button>
        <button type="button" data-bl-filter="ignored">No change since</button>
      </div>
    </div>
    <ul class="bl-list" data-collapsed="1">${rows}</ul>
    ${entries.length > 8 ? `<button type="button" class="btn btn-secondary btn-sm bl-more">Show all ${entries.length}</button>` : ""}`;
}

// Backfill a "why" string for old log rows that pre-date the `reason` field.
// Mirrors the server-side reasonForReminder() but works from the stored
// daysInactive / daysUntilDeadline signals.
function reasonFromLogEntry(e) {
  if (!e) return "";
  const k = e.kind;
  const dD = e.daysUntilDeadline;
  const dI = e.daysInactive;
  if (k === "deadline-overdue") {
    const past = dD != null ? Math.abs(dD) : null;
    return past != null
      ? `Deadline passed ${past} day${past === 1 ? "" : "s"} ago and the project hasn't been marked complete.`
      : `Deadline has passed and the project isn't marked complete.`;
  }
  if (k === "deadline-1d") return `Deadline is tomorrow — final reminder before it's due.`;
  if (k === "deadline-3d") return dD != null ? `Deadline is in ${dD} day${dD === 1 ? "" : "s"} — early heads-up.` : `Deadline is approaching.`;
  if (k === "idle") return dI != null ? `No project activity for ${dI} day${dI === 1 ? "" : "s"} — checking in.` : `Project has been idle — checking in.`;
  if (k === "editor-idle") return dI != null ? `Editor hasn't moved this draft in ${dI} day${dI === 1 ? "" : "s"}.` : `Editor hasn't moved this draft recently.`;
  if (k === "editor-just-assigned") return `Editor was recently assigned — gentle nudge to start reviewing.`;
  if (k === "interview-prep") return `Interview is coming up — sending prep tips.`;
  if (k === "interview-followup") return `Interview already happened but "Interview Complete" hasn't been checked off.`;
  if (k === "post-approval-idle") return `Proposal was approved a while ago and the writer hasn't moved it.`;
  if (k === "proposal-no-schedule") return `Proposal was approved but no interview date is on file yet.`;
  return "";
}
