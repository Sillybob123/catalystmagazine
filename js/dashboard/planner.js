// Planner — the social media / marketing command center.
//
// One page that answers: what's publishing soon, what social work is due for
// each story, who's been assigned what, who to ask when something's unclear,
// and what just went live.
//
// Sections:
//   1. Stat strip — publishing soon / in pipeline / published 30d / actions due
//   2. Post assignments — "make a post for X, due by Y" tasks. Admins and
//      users granted '#/planner/assign' (Users & roles → Extra access) can
//      assign; the assignee gets an email (/api/notify/assignment) and can
//      mark the task done here.
//   3. Up next — every active story sorted by publication date, each with a
//      plain-language prep plan (1 week before → 3 days after), the proposal,
//      and a comment chat with the author (message + email, via
//      /api/notify/comment).
//   4. Just published — recent live stories cross-referenced against the
//      social_posts board so "needs a post" is impossible to miss.
//   5. Channels — quick access to the LinkedIn company page and the
//      @thecatalystdc Instagram (embedded preview where the platform allows).
//
// Data: `projects`, `social_posts`, `social_assignments`, and the assignable
// team via the client SDK (staff read); published stories via the same
// anonymous REST query the public site uses.

import { db } from "../firebase-dual-config.js";
import {
  collection,
  doc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, openModal, toast, fmtDate, fmtRelative, slugify, confirmDialog } from "./ui.js";

const LINKEDIN_URL = "https://www.linkedin.com/company/catalystdc/";
const INSTAGRAM_URL = "https://www.instagram.com/thecatalystdc/";

// Suggested social prep relative to a story's publication date. Pure
// guidance computed from dates — nothing to persist. `when` is the
// plain-language phrase shown to the team so the dates explain themselves.
const CADENCE = [
  { offset: -7, when: "1 week before publish", label: "Draft the announcement copy" },
  { offset: -3, when: "3 days before",         label: "Design graphics / pick photos" },
  { offset: -1, when: "day before",            label: "Schedule posts (LinkedIn + Instagram)" },
  { offset: 0,  when: "publish day",           label: "Post everywhere + tag the author" },
  { offset: 3,  when: "3 days after",          label: "Follow-up — share a quote or behind-the-scenes" },
];

const PLATFORMS = ["any", "instagram", "linkedin", "twitter", "facebook"];

// Content types for the tracker — the team's recurring formats, each with a
// stable chip color so the table scans like the old spreadsheet.
const CONTENT_TYPES = [
  { label: "Article highlight",        bg: "#fca5a5", ink: "#7f1d1d" },
  { label: "Interview Reel",           bg: "#fecdd3", ink: "#9f1239" },
  { label: "Infographic carousel",     bg: "#fbcfe8", ink: "#9d174d" },
  { label: "LinkedIn Discussion Post", bg: "#c7d2fe", ink: "#3730a3" },
  { label: "Wacky Word Wednesday",     bg: "#bfdbfe", ink: "#1e40af" },
  { label: "Fellow spotlight",         bg: "#ddd6fe", ink: "#5b21b6" },
  { label: "Science in One Number",    bg: "#bbf7d0", ink: "#166534" },
  { label: "Book Review",              bg: "#e5e7eb", ink: "#374151" },
  { label: "Other",                    bg: "#f1f5f9", ink: "#334155" },
];

function typeChip(label) {
  if (!label) return "";
  const t = CONTENT_TYPES.find((c) => c.label === label) || CONTENT_TYPES[CONTENT_TYPES.length - 1];
  return `<span class="ct-chip" style="background:${t.bg};color:${t.ink};">${esc(label)}</span>`;
}

// One-time stylesheet for the tracker — spreadsheet bones, Apple manners:
// quiet hairlines, a dark masthead, soft hover, tabular numerals.
function ensureTrackerStyles() {
  if (document.getElementById("ct-styles")) return;
  const s = document.createElement("style");
  s.id = "ct-styles";
  s.textContent = `
    .ct-wrap { border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; background:#fff;
               box-shadow:0 1px 2px rgba(15,23,42,.05), 0 8px 24px -20px rgba(15,23,42,.25); }
    .ct-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
    table.ct { width:100%; border-collapse:separate; border-spacing:0; font-size:13px;
               table-layout:fixed; }
    .ct thead th { background:#0f172a; color:#e2e8f0; text-align:left; padding:10px 10px;
                   font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
                   white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ct thead th svg { width:12px; height:12px; vertical-align:-2px; margin-right:6px; opacity:.55; }
    .ct tbody td { padding:9px 10px; border-bottom:1px solid #f1f5f9; vertical-align:middle;
                   color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ct tbody tr:last-child td { border-bottom:0; }
    .ct tbody tr { transition:background .15s ease; }
    .ct tbody tr.ct-row { cursor:pointer; }
    .ct tbody tr:hover { background:#f8fafc; }
    .ct tbody tr.ct-mine { background:#f0f6ff; }
    .ct tbody tr.ct-mine:hover { background:#e8f1ff; }
    .ct tbody tr.ct-pub td { color:#94a3b8; }
    .ct-chip { display:inline-block; max-width:100%; padding:3px 10px; border-radius:999px;
               font-size:10.5px; font-weight:700; white-space:nowrap; overflow:hidden;
               text-overflow:ellipsis; vertical-align:middle; letter-spacing:.01em; }
    .ct-topic { font-weight:600; color:#0f172a; letter-spacing:-.01em; }
    .ct-owner { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; max-width:100%; }
    .ct-owner i { width:19px; height:19px; border-radius:50%; flex-shrink:0; font-style:normal;
                  display:inline-flex; align-items:center; justify-content:center;
                  font-size:9px; font-weight:700; color:#fff; }
    .ct-owner span { overflow:hidden; text-overflow:ellipsis; }
    .ct-date { font-variant-numeric:tabular-nums; font-size:12px; color:#64748b; }
    .ct-date.urgent { color:#b91c1c; font-weight:700; }
    .ct-status { appearance:none; -webkit-appearance:none; border-radius:999px; font-size:10.5px;
                 font-weight:700; padding:4px 18px 4px 9px; cursor:pointer; line-height:1.2;
                 max-width:100%; overflow:hidden; text-overflow:ellipsis;
                 background-image:url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%2364748b'/%3E%3C/svg%3E");
                 background-repeat:no-repeat; background-position:right 7px center; }
    .ct-notes { font-size:11.5px; color:#94a3b8; }
    .ct-icon-btn { border:0; background:transparent; padding:4px; cursor:pointer; color:#94a3b8;
                   border-radius:6px; line-height:0; vertical-align:middle; }
    .ct-icon-btn:hover { background:#e2e8f0; color:#0f172a; }
    .ct-icon-btn.danger:hover { background:#fee2e2; color:#b91c1c; }
    .ct-icon-btn svg { width:14px; height:14px; }
    .ct-icon-btn:focus-visible { outline:2px solid #0f172a; outline-offset:1px; }
    /* New-row ghost — click to start typing, just like a fresh Sheets row. */
    .ct-new td { color:#94a3b8; cursor:pointer; font-size:12.5px; font-weight:500; }
    .ct-new:hover td { background:#f8fafc; color:#334155; }
    /* Inline editor row */
    tr.ct-editing td { background:#fbfdff; padding:7px 6px; overflow:visible; white-space:normal; }
    .ct-in { width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid #cbd5e1;
             border-radius:7px; font:inherit; font-size:12px; background:#fff; color:#0f172a; }
    .ct-in:focus-visible { outline:2px solid #0f172a; outline-offset:0; border-color:#0f172a; }
    select.ct-in { padding-right:4px; }
    /* Multi-owner picker: a details-popover of checkboxes, Sheets-chip style */
    .ct-owners { position:relative; }
    .ct-owners > summary { list-style:none; cursor:pointer; padding:6px 8px; border:1px solid #cbd5e1;
                           border-radius:7px; font-size:12px; background:#fff; color:#0f172a;
                           white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ct-owners > summary::-webkit-details-marker { display:none; }
    .ct-owners[open] > summary { border-color:#0f172a; }
    /* position:fixed (set on open) escapes the table's scroll clipping —
       the panel always floats on top, never cropped by the card edge. */
    .ct-owners-panel { position:fixed; z-index:9999; min-width:200px;
                       max-height:240px; overflow:auto; background:#fff; border:1px solid #e2e8f0;
                       border-radius:10px; box-shadow:0 8px 24px rgba(15,23,42,.2); padding:6px; }
    .ct-owners-panel label { display:flex; align-items:center; gap:8px; padding:6px 8px;
                             border-radius:7px; font-size:12.5px; color:#0f172a; cursor:pointer; }
    .ct-owners-panel label:hover { background:#f1f5f9; }
    .ct-owners-panel input { width:14px; height:14px; accent-color:#0f172a; }
    .ct-owner i + i { margin-left:-7px; box-shadow:0 0 0 2px #fff; }
    .ct-seg { display:inline-flex; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:999px;
              padding:3px; gap:2px; }
    .ct-seg button { border:0; background:transparent; color:#64748b; font:inherit; font-size:12px;
                     font-weight:600; padding:5px 14px; border-radius:999px; cursor:pointer;
                     transition:background .15s ease, color .15s ease; }
    .ct-seg button:focus-visible { outline:2px solid #0f172a; outline-offset:1px; }
    .ct-seg button.active { background:#fff; color:#0f172a; box-shadow:0 1px 3px rgba(15,23,42,.12); }
    @media (prefers-reduced-motion: reduce) {
      .ct tbody tr, .ct-seg button { transition:none; }
    }
    /* Desktop fits with no sideways scroll; small screens scroll the sheet. */
    @media (max-width: 860px) { table.ct { min-width:780px; } }
  `;
  document.head.appendChild(s);
}

// Tiny header glyphs (Tt / tag / person / calendar / doc), mirroring the
// spreadsheet the team is used to. Stroke icons, never emoji.
const CT_ICONS = {
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7V5h16v2M12 5v14M9 19h6"/></svg>`,
  tag:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4L12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  cal:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  globe:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z"/></svg>`,
  trash:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  check:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  x:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

// Tracker statuses. Legacy docs used open/done — normalize on read.
const STATUSES = [
  { id: "planned",   label: "Planned",   bg: "#f1f5f9", ink: "#475569" },
  { id: "drafting",  label: "Drafting",  bg: "#fef3c7", ink: "#92400e" },
  { id: "scheduled", label: "Scheduled", bg: "#dbeafe", ink: "#1d4ed8" },
  { id: "published", label: "Published", bg: "#dcfce7", ink: "#15803d" },
];

function normStatus(s) {
  if (s === "open" || !s) return "planned";
  if (s === "done") return "published";
  return STATUSES.some((x) => x.id === s) ? s : "planned";
}

function isDoneStatus(s) {
  return normStatus(s) === "published";
}

// Sort priority for the owner picker — social team first, then everyone
// else with Planner access.
const TEAM_ROLE_PRIORITY = { social_media: 0, marketing: 1, admin: 2 };

// Owner pool = people who can actually see the Planner: the roles that get
// it by default, plus anyone granted it via Extra access.
const PLANNER_ROLES = ["admin", "marketing", "social_media"];
function hasPlannerAccess(u) {
  if (PLANNER_ROLES.includes(u.role)) return true;
  const grants = Array.isArray(u.extraAccess) ? u.extraAccess : [];
  return grants.includes("#/planner") || grants.includes("#/planner/assign");
}

function canAssign(ctx) {
  if (ctx.role === "admin") return true;
  const grants = ctx.profile?.extraAccess;
  return Array.isArray(grants) && grants.includes("#/planner/assign");
}

export async function mount(ctx, container) {
  const assigner = canAssign(ctx);
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <div class="grid grid-4" id="pl-stats">
        <div class="stat"><div class="stat-label">Publishing — next 14 days</div><div class="stat-value" data-k="soon">…</div></div>
        <div class="stat"><div class="stat-label">Stories in the pipeline</div><div class="stat-value" data-k="pipeline">…</div></div>
        <div class="stat"><div class="stat-label">Published — last 30 days</div><div class="stat-value" data-k="pub30">…</div></div>
        <div class="stat"><div class="stat-label">Tasks due now</div><div class="stat-value" data-k="due">…</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Content tracker</div>
            <div class="card-subtitle">${assigner
              ? "Every planned post: platform, type, owner, status, post date. Assign content to anyone — they get an email with the deadline."
              : "Every planned post. Add your own content here; rows with your name are yours to ship."}</div>
          </div>
          <button class="btn btn-primary btn-sm" id="pl-assign-new">Add content</button>
        </div>
        <div class="card-body" id="pl-assignments"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Up next</div>
            <div class="card-subtitle">Stories headed to publication, soonest first — with the prep each one needs. Stories whose dates slipped by more than a week are parked under "Waiting on a new date" so this list stays current.</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="pl-refresh">Refresh</button>
        </div>
        <div class="card-body" id="pl-upcoming"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Just published</div>
            <div class="card-subtitle">Live on the site (book reviews excluded — we don't post for those). Once a story's posts are out, "Mark posted" clears it off the list.</div>
          </div>
          <a class="btn btn-secondary btn-sm" href="#/marketing/social">Open social board</a>
        </div>
        <div class="card-body" id="pl-published"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
      </div>

      <div class="grid grid-2" id="pl-channels">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Instagram — @thecatalystdc</div>
              <div class="card-subtitle">What's live on the feed right now.</div>
            </div>
            <a class="btn btn-secondary btn-sm" href="${INSTAGRAM_URL}" target="_blank" rel="noopener">Open Instagram</a>
          </div>
          <div class="card-body" style="padding:0;">
            <iframe src="https://www.instagram.com/thecatalystdc/embed" title="Catalyst Instagram feed"
                    loading="lazy" style="width:100%;height:460px;border:0;display:block;"></iframe>
            <div style="padding:10px 16px;font-size:12px;color:var(--muted);border-top:1px solid var(--hairline,#e5e7eb);">
              Feed not loading? Instagram sometimes blocks embedded previews —
              <a href="${INSTAGRAM_URL}" target="_blank" rel="noopener" style="color:var(--accent);">open the profile directly</a>.
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">LinkedIn — Catalyst DC</div>
              <div class="card-subtitle">Company page activity and post performance.</div>
            </div>
            <a class="btn btn-secondary btn-sm" href="${LINKEDIN_URL}" target="_blank" rel="noopener">Open LinkedIn</a>
          </div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:12px;">
            <p style="margin:0;font-size:13.5px;line-height:1.6;color:var(--ink-2);">
              LinkedIn doesn't allow company feeds to be embedded, so use these jump links:
            </p>
            <div style="display:flex;flex-direction:column;gap:8px;">
              <a href="${LINKEDIN_URL}posts/" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="justify-content:flex-start;">Recent posts — what's already been shared</a>
              <a href="https://www.linkedin.com/company/catalystdc/admin/analytics/updates/" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="justify-content:flex-start;">Post analytics (admins of the page)</a>
              <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent("https://www.catalyst-magazine.com")}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="justify-content:flex-start;">Share a Catalyst link to LinkedIn</a>
            </div>
            <p style="margin:0;font-size:12px;color:var(--muted);">
              Tip: cross-check "Just published" above against the posts page so nothing ships without an announcement.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Shared page state, refreshed by load(). The assign modal and row actions
  // all re-run load() so every section stays consistent.
  const state = { projects: [], stories: [], posts: [], assignments: [], team: [], cleared: [] };
  const load = () => loadData(ctx, container, state, load);
  container.querySelector("#pl-refresh").addEventListener("click", load);
  container.querySelector("#pl-assign-new")?.addEventListener("click", () =>
    openAssignModal(ctx, state, load, {}));
  await load();
}

async function loadData(ctx, container, state, reload) {
  const upcomingEl = container.querySelector("#pl-upcoming");
  const publishedEl = container.querySelector("#pl-published");
  const assignmentsEl = container.querySelector("#pl-assignments");

  // The sources are independent — fetch in parallel, fail independently.
  const [projectsRes, storiesRes, postsRes, assignRes, teamRes, clearedRes] = await Promise.allSettled([
    getDocs(collection(db, "projects")),
    fetchPublishedStories(),
    getDocs(collection(db, "social_posts")),
    getDocs(collection(db, "social_assignments")),
    getDocs(collection(db, "users")),
    getDocs(collection(db, "planner_cleared")),
  ]);

  state.projects = projectsRes.status === "fulfilled"
    ? projectsRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : null;
  state.stories = storiesRes.status === "fulfilled" ? storiesRes.value : null;
  state.posts = postsRes.status === "fulfilled"
    ? postsRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  state.assignments = assignRes.status === "fulfilled"
    ? assignRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : null;
  // Owner pool: every staff member. Doc id is spread LAST so a stray `id`
  // field inside a user doc can never shadow the real uid (which silently
  // dropped people — including the signed-in admin — from the picker).
  state.team = teamRes.status === "fulfilled"
    ? teamRes.value.docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .filter((u) => u.role && u.role !== "reader")
    : [];
  state.cleared = clearedRes.status === "fulfilled"
    ? clearedRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : [];

  // ── Assignments ──
  if (!state.assignments) {
    assignmentsEl.innerHTML = `<div class="error-state">Could not load assignments: ${esc(assignRes.reason?.message || "unknown error")}</div>`;
  } else {
    renderAssignments(ctx, assignmentsEl, state, reload);
  }

  // ── Up next ──
  if (!state.projects) {
    upcomingEl.innerHTML = `<div class="error-state">Could not load the pipeline: ${esc(projectsRes.reason?.message || "unknown error")}</div>`;
  } else {
    renderUpcoming(ctx, upcomingEl, state, reload);
  }

  // ── Just published ──
  if (!state.stories) {
    publishedEl.innerHTML = `<div class="error-state">Could not load published stories: ${esc(storiesRes.reason?.message || "unknown error")}</div>`;
  } else {
    renderPublished(ctx, publishedEl, state, reload);
  }

  // ── Stats ──
  const set = (k, v) => { const n = container.querySelector(`[data-k="${k}"]`); if (n) n.textContent = v; };
  const clearedIds = new Set((state.cleared || []).map((c) => c.id));
  const active = (state.projects || [])
    .filter(isActiveProject)
    .filter((p) => !clearedIds.has(p.id));
  const now = startOfToday();
  const in14 = active.filter((p) => {
    const d = parseDay(pubDateOf(p));
    return d && d >= now && d - now <= 14 * 86400000;
  });
  // "Tasks due now" = assigned posts due today/overdue + prep steps that are
  // due for stories whose publication date is still ahead (stale dates are
  // excluded — they get a "confirm the date" note instead of fake tasks).
  const cadenceDue = active.reduce((sum, p) => {
    const pubDate = parseDay(pubDateOf(p));
    if (!pubDate || pubDate < now) return sum;
    return sum + buildCadence(pubDate).filter((c) => c.state === "today" || c.state === "overdue").length;
  }, 0);
  const assignmentsDue = (state.assignments || []).filter((a) => {
    if (isDoneStatus(a.status)) return false;
    const d = parseDay(a.deadline);
    return d && d <= now;
  }).length;
  const pub30 = (state.stories || []).filter((s) => {
    const d = Date.parse(s.publishedAt || "");
    return d && Date.now() - d <= 30 * 86400000;
  }).length;
  set("soon", state.projects ? String(in14.length) : "—");
  set("pipeline", state.projects ? String(active.length) : "—");
  set("pub30", state.stories ? String(pub30) : "—");
  set("due", state.projects || state.assignments ? String(cadenceDue + assignmentsDue) : "—");
}

// ─── Post assignments ─────────────────────────────────────────────────────────

function renderAssignments(ctx, mountEl, state, reload) {
  const lead = canAssign(ctx);
  const myUid = ctx.user.uid;
  const showPublished = state.trackerShowPublished === true;
  const rerender = () => renderAssignments(ctx, mountEl, state, reload);

  const rows = state.assignments
    .map((a) => ({ ...a, _status: normStatus(a.status) }))
    .filter((a) => showPublished || a._status !== "published")
    .sort((a, b) => {
      const pa = a._status === "published" ? 1 : 0;
      const pb = b._status === "published" ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return String(a.deadline || "9999").localeCompare(String(b.deadline || "9999"));
    });

  ensureTrackerStyles();
  mountEl.innerHTML = "";

  // Active / All — a quiet segmented control, not two shouting buttons.
  const publishedCount = state.assignments.filter((a) => normStatus(a.status) === "published").length;
  const filterBar = el("div", { style: "display:flex;gap:10px;margin-bottom:12px;align-items:center;flex-wrap:wrap;" });
  const seg = el("div", { class: "ct-seg", role: "group", "aria-label": "Filter tracker" });
  const mkSeg = (label, all) => el("button", {
    class: showPublished === all ? "active" : "",
    onclick: () => { state.trackerShowPublished = all; rerender(); },
  }, label);
  seg.appendChild(mkSeg("Active", false));
  seg.appendChild(mkSeg(`All · ${publishedCount} published`, true));
  filterBar.appendChild(seg);
  filterBar.appendChild(el("span", { style: "font-size:12px;color:var(--muted);" },
    "Click any row to edit it. Click the bottom row to add new content."));
  mountEl.appendChild(filterBar);

  const wrap = el("div", { class: "ct-wrap" });
  const scroll = el("div", { class: "ct-scroll" });
  const table = el("table", { class: "ct" });
  const th = (icon, label) => `<th>${icon || ""}${label}</th>`;
  table.innerHTML = `
  <colgroup>
    <col style="width:9%"><col style="width:15%"><col style="width:25%"><col style="width:13%">
    <col style="width:11%"><col style="width:10%"><col style="width:10%"><col style="width:7%">
  </colgroup>
  <thead><tr>
    ${th(CT_ICONS.globe, "Platform")}
    ${th(CT_ICONS.tag, "Type")}
    ${th(CT_ICONS.text, "Topic")}
    ${th(CT_ICONS.user, "Owner")}
    ${th(CT_ICONS.tag, "Status")}
    ${th(CT_ICONS.cal, "Post date")}
    ${th(CT_ICONS.text, "Notes")}
    <th></th>
  </tr></thead>`;
  const tbody = el("tbody", {});

  for (const a of rows) {
    tbody.appendChild(trackerDisplayRow(ctx, state, reload, rerender, a));
  }

  // The forever-empty bottom row — click it and start typing, Sheets-style.
  const ghost = el("tr", { class: "ct-new", tabindex: "0", role: "button", "aria-label": "Add new content" });
  ghost.innerHTML = `<td colspan="8">+ Add new content&hellip;</td>`;
  const startNew = () => {
    const editor = trackerEditorRow(ctx, state, reload, rerender, null, {});
    ghost.replaceWith(editor);
    editor.querySelector("[data-in='topic']").focus();
  };
  ghost.addEventListener("click", startNew);
  ghost.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startNew(); } });
  tbody.appendChild(ghost);

  table.appendChild(tbody);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  mountEl.appendChild(wrap);
}

// A read row. Click anywhere on it (except a control) to edit in place.
function trackerDisplayRow(ctx, state, reload, rerender, a) {
  const lead = canAssign(ctx);
  const myUid = ctx.user.uid;
  const owners = ownersOf(a);
  const mine = isOwner(a, myUid);
  const canTouch = lead || mine || a.createdById === myUid;
  const isPub = a._status === "published";
  const due = parseDay(a.deadline);
  const dueFull = dueLabel(due, isPub);
  const ownerNames = owners.map((o) => o.name || o.email).filter(Boolean).join(", ") || "—";
  const ownerAvatars = owners.slice(0, 3)
    .map((o) => `<i style="background:${avatarColor(o.name || o.email)};">${esc((o.name || o.email || "?")[0].toUpperCase())}</i>`)
    .join("");

  const tr = el("tr", {
    class: `${canTouch ? "ct-row " : ""}${mine && !isPub ? "ct-mine" : ""}${isPub ? " ct-pub" : ""}`.trim(),
    title: canTouch ? "Click to edit" : "",
  });
  tr.innerHTML = `
    <td>${esc(platformLabel(a.platform))}</td>
    <td>${typeChip(a.type) || `<span style="color:#cbd5e1;">—</span>`}</td>
    <td>
      <span class="ct-topic" style="${isPub ? "opacity:.55;" : ""}" title="${esc(a.articleTitle || "")}">${esc(a.articleTitle || "(untitled)")}</span>
      ${a.link ? ` <a href="${esc(a.link)}" target="_blank" rel="noopener" style="font-size:11px;color:#2563eb;text-decoration:none;">&#8599;</a>` : ""}
    </td>
    <td><span class="ct-owner" title="${esc(ownerNames)}">${ownerAvatars || `<i style="background:#cbd5e1;">?</i>`}<span>${esc(ownerSummary(a))}</span></span></td>
    <td style="overflow:visible;"></td>
    <td class="ct-date${dueFull.urgent && !isPub ? " urgent" : ""}" title="${esc(dueFull.text)}">${esc(fmtShortDay(a.deadline))}</td>
    <td><span class="ct-notes" title="${esc(a.notes || "")}">${esc(a.notes || "")}</span></td>
    <td style="text-align:right;overflow:visible;">
      ${(lead || a.createdById === myUid) ? `<button class="ct-icon-btn danger" data-act="remove" title="Remove row" aria-label="Remove row">${CT_ICONS.trash}</button>` : ""}
    </td>`;

  // Inline status select — the fastest path from "drafting" to "published".
  const statusCell = tr.children[4];
  const meta = STATUSES.find((s) => s.id === a._status) || STATUSES[0];
  if (canTouch) {
    const sel = el("select", {
      class: "ct-status",
      "aria-label": "Status",
      style: `border:1px solid ${meta.ink}26;background-color:${meta.bg};color:${meta.ink};`,
    });
    sel.innerHTML = STATUSES.map((s) => `<option value="${s.id}" ${s.id === a._status ? "selected" : ""}>${s.label}</option>`).join("");
    sel.addEventListener("change", async () => {
      try {
        await updateDoc(doc(db, "social_assignments", a.id), {
          status: sel.value,
          doneAt: sel.value === "published" ? new Date().toISOString() : null,
        });
        reload();
      } catch (err) {
        toast("Could not update status: " + err.message, "error");
        sel.value = a._status;
      }
    });
    statusCell.appendChild(sel);
  } else {
    statusCell.innerHTML = `<span class="ct-chip" style="background:${meta.bg};color:${meta.ink};">${esc(meta.label)}</span>`;
  }

  tr.querySelector('[data-act="remove"]')?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog(`Remove "${a.articleTitle || "this content"}" from the tracker?`, { confirmText: "Remove", danger: true });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "social_assignments", a.id));
      reload();
    } catch (err) { toast("Could not remove: " + err.message, "error"); }
  });

  if (canTouch) {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("select, a, button, input")) return;
      const editor = trackerEditorRow(ctx, state, reload, rerender, a, {});
      tr.replaceWith(editor);
      editor.querySelector("[data-in='topic']").focus();
    });
  }
  return tr;
}

// An in-place edit row: every cell becomes its matching input. Enter saves,
// Escape cancels — the spreadsheet muscle memory.
function trackerEditorRow(ctx, state, reload, rerender, existing, prefill) {
  const lead = canAssign(ctx);
  const myUid = ctx.user.uid;
  const team = trackerTeam(ctx, state);
  const initialOwnerIds = existing
    ? ownersOf(existing).map((o) => o.id)
    : (prefill.assigneeId ? [prefill.assigneeId] : [myUid]);
  const initialStatus = existing ? normStatus(existing.status) : "planned";

  const ownerChecks = team.map((u) => {
    const checked = initialOwnerIds.includes(u.id);
    // Non-leads can always tick teammates in as co-owners, but can't hand a
    // row off entirely: their own membership is locked on rows they create.
    const locked = !lead && u.id === myUid && !existing;
    return `<label><input type="checkbox" data-owner="${esc(u.id)}" ${checked ? "checked" : ""} ${locked ? "disabled checked" : ""}>
      ${esc(u.name || u.email)}${u.isSelf ? " (you)" : ""}</label>`;
  }).join("");

  const tr = el("tr", { class: "ct-editing" });
  tr.innerHTML = `
    <td><select class="ct-in" data-in="platform" aria-label="Platform">
      ${PLATFORMS.map((p) => `<option value="${p}" ${(existing?.platform || prefill.platform || "any") === p ? "selected" : ""}>${p === "any" ? "Any" : platformLabel(p)}</option>`).join("")}
    </select></td>
    <td><select class="ct-in" data-in="type" aria-label="Type">
      <option value="">Type…</option>
      ${CONTENT_TYPES.map((t) => `<option value="${esc(t.label)}" ${t.label === (existing?.type || prefill.type || "") ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
    </select></td>
    <td>
      <input class="ct-in" data-in="topic" aria-label="Topic" placeholder="What's the post about?" value="${esc(existing?.articleTitle || prefill.articleTitle || "")}">
    </td>
    <td style="overflow:visible;">
      <details class="ct-owners">
        <summary data-in="owner-summary">Owners&hellip;</summary>
        <div class="ct-owners-panel">${ownerChecks}</div>
      </details>
    </td>
    <td><select class="ct-in" data-in="status" aria-label="Status">
      ${STATUSES.map((s) => `<option value="${s.id}" ${s.id === initialStatus ? "selected" : ""}>${s.label}</option>`).join("")}
    </select></td>
    <td><input type="date" class="ct-in" data-in="deadline" aria-label="Post date" value="${esc(existing?.deadline || prefill.deadline || isoDay(new Date(Date.now() + 3 * 86400000)))}"></td>
    <td style="display:grid;gap:4px;">
      <input class="ct-in" data-in="notes" aria-label="Notes" placeholder="Notes…" value="${esc(existing?.notes || "")}">
      <input class="ct-in" data-in="link" aria-label="Asset link" placeholder="Asset URL…" value="${esc(existing?.link || "")}">
    </td>
    <td style="text-align:right;white-space:nowrap;">
      <button class="ct-icon-btn" data-act="save" title="Save (Enter)" aria-label="Save" style="color:#15803d;">${CT_ICONS.check}</button>
      <button class="ct-icon-btn danger" data-act="cancel" title="Cancel (Esc)" aria-label="Cancel">${CT_ICONS.x}</button>
    </td>`;

  const get = (k) => tr.querySelector(`[data-in="${k}"]`);

  // Anchor the owners panel just under its chip with fixed positioning, so
  // the table's overflow container can't clip it. Flips above the chip when
  // there's no room below; closes if the page scrolls underneath it.
  const ownersDetails = tr.querySelector(".ct-owners");
  const ownersPanel = ownersDetails.querySelector(".ct-owners-panel");
  const placePanel = () => {
    const r = ownersDetails.querySelector("summary").getBoundingClientRect();
    const panelH = Math.min(240, ownersPanel.scrollHeight || 240);
    const below = window.innerHeight - r.bottom;
    ownersPanel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 216))}px`;
    ownersPanel.style.minWidth = `${Math.max(200, r.width)}px`;
    ownersPanel.style.top = below >= panelH + 12 || below >= r.top
      ? `${r.bottom + 4}px`
      : `${Math.max(8, r.top - panelH - 4)}px`;
  };
  ownersDetails.addEventListener("toggle", () => { if (ownersDetails.open) placePanel(); });
  const closeOnScroll = (e) => {
    // Self-cleanup once this editor row has been re-rendered away.
    if (!document.contains(ownersDetails)) {
      window.removeEventListener("scroll", closeOnScroll, true);
      return;
    }
    // Scrolling the checkbox list itself shouldn't dismiss it.
    if (e.target instanceof Node && ownersPanel.contains(e.target)) return;
    if (ownersDetails.open) ownersDetails.open = false;
  };
  window.addEventListener("scroll", closeOnScroll, { capture: true, passive: true });
  const closeOnOutsideClick = (e) => {
    if (!document.contains(ownersDetails)) {
      document.removeEventListener("click", closeOnOutsideClick);
      return;
    }
    if (ownersDetails.open && !e.target.closest(".ct-owners")) ownersDetails.open = false;
  };
  document.addEventListener("click", closeOnOutsideClick);

  // Keep the owners summary chip in sync with the checkboxes.
  const checkedOwners = () => [...tr.querySelectorAll("[data-owner]:checked")]
    .map((cb) => team.find((u) => u.id === cb.dataset.owner))
    .filter(Boolean);
  const syncOwnerSummary = () => {
    const owners = checkedOwners();
    get("owner-summary").textContent = owners.length
      ? owners.map((o) => String(o.name || o.email).trim().split(/\s+/)[0]).join(", ")
      : "Owners…";
  };
  tr.querySelectorAll("[data-owner]").forEach((cb) => cb.addEventListener("change", syncOwnerSummary));
  syncOwnerSummary();

  const save = async () => {
    const topic = get("topic").value.trim();
    const deadline = get("deadline").value;
    const owners = checkedOwners();
    if (!topic) { toast("Give the post a topic.", "error"); get("topic").focus(); return; }
    if (!deadline) { toast("Set a post date.", "error"); get("deadline").focus(); return; }
    if (!owners.length) { toast("Pick at least one owner.", "error"); return; }

    // Primary owner: the viewer when they're in the set (matches the rules'
    // self-create check for non-leads), otherwise the first one ticked.
    const primary = owners.find((o) => o.id === myUid) || owners[0];
    const status = get("status").value;
    const payload = {
      articleTitle: topic,
      projectId: existing?.projectId || prefill.projectId || null,
      storyId: existing?.storyId || prefill.storyId || null,
      type: get("type").value || "",
      platform: get("platform").value,
      deadline,
      link: get("link").value.trim(),
      notes: get("notes").value.trim(),
      assigneeId: primary.id,
      assigneeName: primary.name || primary.email || "",
      assigneeEmail: primary.email || "",
      assignees: owners.map((o) => ({ id: o.id, name: o.name || "", email: o.email || "" })),
      assigneeIds: owners.map((o) => o.id),
      status,
      doneAt: status === "published" ? (existing?.doneAt || new Date().toISOString()) : null,
    };
    const saveBtn = tr.querySelector('[data-act="save"]');
    saveBtn.disabled = true;
    try {
      const others = owners.filter((o) => o.id !== myUid);
      await persistTrackerRow(ctx, payload, existing);
      toast(existing ? "Saved." : `Added${others.length ? ` — emailing ${others.map((o) => String(o.name || o.email).split(/\s+/)[0]).join(", ")}` : ""}.`, "success");
      reload();
    } catch (err) {
      toast("Could not save: " + err.message, "error");
      saveBtn.disabled = false;
    }
  };

  tr.querySelector('[data-act="save"]').addEventListener("click", save);
  tr.querySelector('[data-act="cancel"]').addEventListener("click", rerender);
  tr.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.target.matches("select")) { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.preventDefault(); rerender(); }
  });
  return tr;
}

// Create or update a tracker row and email the owners when the post changed
// hands — a new row owned by someone else, or the owner set gaining people.
async function persistTrackerRow(ctx, payload, existing) {
  const myUid = ctx.user.uid;
  const newIds = payload.assigneeIds || (payload.assigneeId ? [payload.assigneeId] : []);
  let id;
  let notifyNeeded;
  if (existing) {
    id = existing.id;
    await updateDoc(doc(db, "social_assignments", id), payload);
    const oldIds = ownersOf(existing).map((o) => o.id);
    const added = newIds.filter((x) => !oldIds.includes(x));
    notifyNeeded = added.some((x) => x !== myUid);
  } else {
    const ref = await addDoc(collection(db, "social_assignments"), {
      ...payload,
      createdById: myUid,
      createdByName: ctx.profile.name || ctx.user.email,
      createdAt: new Date().toISOString(),
    });
    id = ref.id;
    notifyNeeded = newIds.some((x) => x !== myUid);
  }
  if (notifyNeeded) {
    // Best-effort email; the tracker row exists either way.
    ctx.authedFetch("/api/notify/assignment", {
      method: "POST",
      body: JSON.stringify({ assignmentId: id }),
    }).catch((err) => console.warn("assignment email failed (non-blocking):", err));
  }
  return id;
}

// Assignable people: everyone with Planner access, with the viewer pinned
// first ("you") so putting your own name on a row is always one click.
function trackerTeam(ctx, state) {
  const myUid = ctx.user.uid;
  let team = (state.team || []).filter((u) => u.id !== undefined && u.id !== myUid && hasPlannerAccess(u));
  team.sort((a, b) => {
    const pa = TEAM_ROLE_PRIORITY[a.role] ?? 9;
    const pb = TEAM_ROLE_PRIORITY[b.role] ?? 9;
    if (pa !== pb) return pa - pb;
    return String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""));
  });
  const meDoc = (state.team || []).find((u) => u.id === myUid);
  const me = {
    id: myUid,
    name: meDoc?.name || ctx.profile.name || ctx.user.email,
    email: meDoc?.email || ctx.profile.email || ctx.user.email || "",
    role: ctx.role,
    isSelf: true,
  };
  return [me, ...team];
}

// Owners of a tracker row — the multi-owner array when present, else the
// legacy single-assignee fields.
function ownersOf(a) {
  if (Array.isArray(a.assignees) && a.assignees.length) return a.assignees;
  if (a.assigneeId) return [{ id: a.assigneeId, name: a.assigneeName || "", email: a.assigneeEmail || "" }];
  return [];
}

function isOwner(a, uid) {
  return ownersOf(a).some((o) => o.id === uid);
}

function ownerSummary(a) {
  const owners = ownersOf(a);
  if (!owners.length) return "—";
  const first = String(owners[0].name || owners[0].email || "—").trim().split(/\s+/)[0];
  return owners.length === 1 ? first : `${first} +${owners.length - 1}`;
}

function platformLabel(p) {
  if (!p || p === "any") return "Any";
  if (p === "instagram") return "Instagram";
  if (p === "linkedin") return "LinkedIn";
  if (p === "twitter") return "Twitter / X";
  return p[0].toUpperCase() + p.slice(1);
}

// Compact date for the sheet ("Jun 16"); year added only when it differs.
function fmtShortDay(s) {
  const d = parseDay(s);
  if (!d) return "—";
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

function dueLabel(due, isDone) {
  if (!due) return { text: "no deadline", urgent: false };
  if (isDone) return { text: `was due ${fmtDate(due)}`, urgent: false };
  const days = Math.round((due - startOfToday()) / 86400000);
  if (days < 0) return { text: `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`, urgent: true };
  if (days === 0) return { text: "due today", urgent: true };
  if (days === 1) return { text: "due tomorrow", urgent: false };
  return { text: `due ${fmtDate(due)} (${days} days)`, urgent: false };
}

// Add/edit-content modal. `prefill` can carry { articleTitle, projectId,
// storyId, type, deadline } when launched from a story row; `existing` is a
// tracker row being edited. Leads can assign anyone; everyone else can add
// and edit content they own (the owner picker is locked to themselves).
function openAssignModal(ctx, state, reload, prefill = {}, existing = null) {
  const lead = canAssign(ctx);
  const myUid = ctx.user.uid;

  const team = trackerTeam(ctx, state);

  // Article options: upcoming pipeline stories (not hidden/cleared) +
  // recently published.
  const clearedIds = new Set((state.cleared || []).map((c) => c.id));
  const upcoming = (state.projects || [])
    .filter(isActiveProject)
    .filter((p) => !clearedIds.has(p.id))
    .sort(byPubDate);
  const published = state.stories || [];

  const initialTopic = existing?.articleTitle || prefill.articleTitle || "";
  const initialOwnerIds = existing
    ? ownersOf(existing).map((o) => o.id)
    : (prefill.assigneeId ? [prefill.assigneeId] : [myUid]);
  const initialDeadline = existing?.deadline || prefill.deadline || isoDay(new Date(Date.now() + 3 * 86400000));
  const initialType = existing?.type || prefill.type || "";
  const initialStatus = existing ? normStatus(existing.status) : "planned";

  const body = el("div", { style: "display:flex;flex-direction:column;gap:12px;min-width:min(500px,82vw);" });
  body.innerHTML = `
    <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Topic — what's the post about?
      <input id="as-topic" value="${esc(initialTopic)}" placeholder="e.g. Misfolded proteins, Fellow spotlight: Le Nguyen…" style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;">
    </label>
    <label style="display:grid;gap:4px;font-size:12.5px;font-weight:600;color:var(--muted);">Or pick an article (fills the topic for you)
      <select class="select" id="as-article" style="font-weight:400;">
        <option value="">— choose an article —</option>
        ${upcoming.length ? `<optgroup label="Coming up">${upcoming.map((p) => `<option value="p:${esc(p.id)}">${esc(p.title || "(untitled)")}${pubDateOf(p) ? ` — publishes ${esc(fmtDay(pubDateOf(p)))}` : ""}</option>`).join("")}</optgroup>` : ""}
        ${published.length ? `<optgroup label="Just published">${published.map((s) => `<option value="s:${esc(s.id)}">${esc(s.title || "(untitled)")}</option>`).join("")}</optgroup>` : ""}
      </select>
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Type
        <select class="select" id="as-type" style="font-weight:400;">
          <option value="">— pick a format —</option>
          ${CONTENT_TYPES.map((t) => `<option value="${esc(t.label)}" ${t.label === initialType ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
        </select>
      </label>
      <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Platform
        <select class="select" id="as-platform" style="font-weight:400;">
          ${PLATFORMS.map((p) => `<option value="${p}" ${(existing?.platform || prefill.platform) === p ? "selected" : ""}>${p === "any" ? "Any" : platformLabel(p)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div style="display:grid;gap:4px;">
      <span style="font-size:13px;font-weight:600;color:var(--ink);">Owners — pick one or several (shared task)</span>
      <div id="as-owners" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:2px;max-height:160px;overflow:auto;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;padding:6px;">
        ${team.map((u) => {
          const checked = initialOwnerIds.includes(u.id);
          const locked = !lead && u.id === myUid && !existing;
          return `<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;font-size:12.5px;cursor:pointer;">
            <input type="checkbox" data-owner="${esc(u.id)}" ${checked ? "checked" : ""} ${locked ? "disabled checked" : ""} style="width:14px;height:14px;accent-color:#0f172a;">
            ${esc(u.name || u.email)}${u.isSelf ? " (you)" : ""}</label>`;
        }).join("")}
      </div>
    </div>
    <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Post date
      <input type="date" id="as-deadline" value="${esc(initialDeadline)}" style="padding:8px 10px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;">
    </label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Status
        <select class="select" id="as-status" style="font-weight:400;">
          ${STATUSES.map((s) => `<option value="${s.id}" ${s.id === initialStatus ? "selected" : ""}>${s.label}</option>`).join("")}
        </select>
      </label>
      <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Asset link (optional)
        <input id="as-link" value="${esc(existing?.link || "")}" placeholder="Canva / Drive / draft URL" style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;">
      </label>
    </div>
    <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Notes (optional)
      <textarea id="as-notes" rows="3" placeholder="Angle, must-include links, tone…" style="padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;">${esc(existing?.notes || "")}</textarea>
    </label>
    <div style="font-size:12px;color:var(--muted);">Every owner gets an email with the topic, deadline, and your notes — plus a reminder email on the due date. It also lands on each owner's Overview calendar.</div>
  `;

  // Picking an article copies its title into the topic and remembers the link.
  let pickedProjectId = existing?.projectId || prefill.projectId || null;
  let pickedStoryId = existing?.storyId || prefill.storyId || null;
  const topicInput = body.querySelector("#as-topic");
  body.querySelector("#as-article").addEventListener("change", (e) => {
    const v = e.target.value;
    pickedProjectId = null; pickedStoryId = null;
    if (v.startsWith("p:")) {
      const p = upcoming.find((x) => x.id === v.slice(2));
      if (p) { topicInput.value = p.title || ""; pickedProjectId = p.id; }
    } else if (v.startsWith("s:")) {
      const s = published.find((x) => x.id === v.slice(2));
      if (s) { topicInput.value = s.title || ""; pickedStoryId = s.id; }
    }
  });

  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const saveBtn = el("button", { class: "btn btn-primary" }, existing ? "Save changes" : "Add to tracker");
  const modal = openModal({ title: existing ? "Edit content" : "Add content", body, footer: [cancelBtn, saveBtn] });
  if (!modal) return;
  cancelBtn.addEventListener("click", () => modal.close());
  setTimeout(() => topicInput.focus(), 0);

  saveBtn.addEventListener("click", async () => {
    const articleTitle = topicInput.value.trim();
    const owners = [...body.querySelectorAll("#as-owners [data-owner]:checked")]
      .map((cb) => team.find((u) => u.id === cb.dataset.owner))
      .filter(Boolean);
    const deadline = body.querySelector("#as-deadline").value;
    const status = body.querySelector("#as-status").value;
    if (!articleTitle) { toast("Give the post a topic.", "error"); return; }
    if (!owners.length) { toast("Pick at least one owner.", "error"); return; }
    if (!deadline) { toast("Set a post date.", "error"); return; }

    const primary = owners.find((o) => o.id === myUid) || owners[0];
    const payload = {
      articleTitle,
      projectId: pickedProjectId,
      storyId: pickedStoryId,
      type: body.querySelector("#as-type").value || "",
      platform: body.querySelector("#as-platform").value,
      deadline,
      link: body.querySelector("#as-link").value.trim(),
      notes: body.querySelector("#as-notes").value.trim(),
      assigneeId: primary.id,
      assigneeName: primary.name || primary.email || "",
      assigneeEmail: primary.email || "",
      assignees: owners.map((o) => ({ id: o.id, name: o.name || "", email: o.email || "" })),
      assigneeIds: owners.map((o) => o.id),
      status,
      doneAt: status === "published" ? (existing?.doneAt || new Date().toISOString()) : null,
    };

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await persistTrackerRow(ctx, payload, existing);
      modal.close();
      const others = owners.filter((o) => o.id !== myUid);
      toast(existing ? "Tracker updated." : `Added${others.length ? ` — emailing ${others.map((o) => String(o.name || o.email).split(/\s+/)[0]).join(", ")}` : " — it's on your calendar"}.`, "success");
      reload();
    } catch (err) {
      toast("Could not save: " + err.message, "error");
      saveBtn.disabled = false;
      saveBtn.textContent = existing ? "Save changes" : "Add to tracker";
    }
  });
}

// ─── Up next ──────────────────────────────────────────────────────────────────

function isActiveProject(p) {
  if (p.proposalStatus === "rejected") return false;
  if (p.timeline?.["Published"] === true) return false;
  return true;
}

function pubDateOf(p) {
  return p.deadlines?.publication || p.deadline || null;
}

// Stories whose publication date slipped by more than this many days are
// "stale": probably mis-scheduled, definitely not what the social team should
// be staring at. They move to a collapsed "Waiting on a new date" section.
const STALE_GRACE_DAYS = 7;

function byPubDate(a, b) {
  const da = parseDay(pubDateOf(a));
  const db_ = parseDay(pubDateOf(b));
  if (da && db_) return da - db_;
  if (da) return -1;
  if (db_) return 1;
  return String(a.title || "").localeCompare(String(b.title || ""));
}

function isStaleProject(p) {
  const d = parseDay(pubDateOf(p));
  return !!d && d.getTime() < startOfToday().getTime() - STALE_GRACE_DAYS * 86400000;
}

function renderUpcoming(ctx, mountEl, state, reload) {
  const assigner = canAssign(ctx);
  const clearedById = new Map(state.cleared.map((c) => [c.id, c]));
  const active = state.projects.filter(isActiveProject);
  const visible = active.filter((p) => !clearedById.has(p.id));
  const hidden = active.filter((p) => clearedById.has(p.id));
  const current = visible.filter((p) => !isStaleProject(p)).sort(byPubDate);
  const stale = visible.filter(isStaleProject).sort(byPubDate);

  mountEl.innerHTML = "";

  if (!current.length) {
    mountEl.appendChild(el("div", { class: "empty-state" },
      stale.length || hidden.length
        ? "Nothing scheduled right now — check the parked sections below."
        : "No stories in the pipeline right now. New proposals will show up here automatically."));
  }
  for (const p of current) {
    mountEl.appendChild(renderUpcomingRow(ctx, p, state, reload));
  }

  // Parked: dates that slipped over a week ago. Compact rows — the job here
  // is to chase a real date (or hide the story), not to plan posts.
  if (stale.length) {
    const { toggle, list } = collapsedSection(`Waiting on a new date (${stale.length})`);
    list.appendChild(el("div", {
      style: "font-size:12px;color:var(--muted);padding:6px 4px 10px;line-height:1.55;",
    }, "These publication dates passed over a week ago without the story going live. Message the writer to get a real date — they return to the main list automatically once the date is updated."));
    for (const p of stale) {
      const row = el("div", {
        style: "display:flex;align-items:center;gap:12px;padding:8px 4px;border-bottom:1px solid var(--hairline,#f1f5f9);flex-wrap:wrap;",
      });
      const first = String(p.authorName || "the writer").trim().split(/\s+/)[0];
      row.innerHTML = `
        <div style="flex:1;min-width:220px;">
          <span style="font-weight:600;font-size:13px;color:var(--ink);">${esc(p.title || "(untitled story)")}</span>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
            ${esc(p.authorName || "Unassigned")} · was planned for ${esc(fmtDay(pubDateOf(p)))} · ${esc(stageLabel(p))}
          </div>
        </div>
        <button class="btn btn-secondary btn-xs" data-act="chat">Message ${esc(first)}</button>
        ${assigner ? `<button class="btn btn-ghost btn-xs" data-act="clear" title="Hide this story from the Planner — no social post needed">No post needed</button>` : ""}
      `;
      row.querySelector('[data-act="chat"]').addEventListener("click", () => openChatModal(ctx, p));
      row.querySelector('[data-act="clear"]')?.addEventListener("click", () =>
        clearProjectFromPlanner(ctx, p, reload));
      list.appendChild(row);
    }
    mountEl.appendChild(toggle);
    mountEl.appendChild(list);
  }

  // Hidden: stories a social lead cleared ("no post needed"). Restorable.
  if (hidden.length) {
    const { toggle, list } = collapsedSection(`Hidden — no post needed (${hidden.length})`);
    for (const p of hidden) {
      const meta = clearedById.get(p.id) || {};
      const row = el("div", {
        style: "display:flex;align-items:center;gap:12px;padding:8px 4px;border-bottom:1px solid var(--hairline,#f1f5f9);flex-wrap:wrap;opacity:.7;",
      });
      row.innerHTML = `
        <div style="flex:1;min-width:220px;">
          <span style="font-weight:600;font-size:13px;color:var(--ink);">${esc(p.title || "(untitled story)")}</span>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
            hidden by ${esc(meta.clearedByName || "—")}${meta.clearedAt ? ` · ${esc(fmtRelative(meta.clearedAt))}` : ""}
          </div>
        </div>
        ${assigner ? `<button class="btn btn-ghost btn-xs" data-act="restore">Restore</button>` : ""}
      `;
      row.querySelector('[data-act="restore"]')?.addEventListener("click", async () => {
        try {
          await deleteDoc(doc(db, "planner_cleared", p.id));
          toast("Restored to the Planner.", "info");
          reload();
        } catch (err) { toast("Could not restore: " + err.message, "error"); }
      });
      list.appendChild(row);
    }
    mountEl.appendChild(toggle);
    mountEl.appendChild(list);
  }
}

// Shared collapsed-section chrome: a ghost toggle button + a hidden list.
function collapsedSection(label) {
  const toggle = el("button", {
    class: "btn btn-ghost btn-xs",
    style: "margin-top:10px;color:var(--muted);",
  }, `${label} — show`);
  const list = el("div", { style: "display:none;margin-top:6px;" });
  toggle.addEventListener("click", () => {
    const open = list.style.display !== "none";
    list.style.display = open ? "none" : "block";
    toggle.textContent = `${label} — ${open ? "show" : "hide"}`;
  });
  return { toggle, list };
}

async function clearProjectFromPlanner(ctx, p, reload) {
  try {
    await setDoc(doc(db, "planner_cleared", p.id), {
      projectId: p.id,
      title: p.title || "",
      reason: "no-post-needed",
      clearedById: ctx.user.uid,
      clearedByName: ctx.profile.name || ctx.user.email,
      clearedAt: new Date().toISOString(),
    });
    toast(`"${p.title || "Story"}" hidden from the Planner.`, "success");
    reload();
  } catch (err) { toast("Could not hide: " + err.message, "error"); }
}

function renderUpcomingRow(ctx, p, state, reload) {
  const pubDateStr = pubDateOf(p);
  const pubDate = parseDay(pubDateStr);
  const stale = pubDate && pubDate < startOfToday();
  const countdown = countdownPill(pubDate);
  const stage = stageLabel(p);
  const authorFirst = String(p.authorName || "the writer").trim().split(/\s+/)[0];

  const row = el("div", {
    style: "border:1px solid var(--hairline,#e5e7eb);border-radius:12px;padding:16px 18px;margin-bottom:12px;display:flex;flex-direction:column;gap:12px;",
  });
  row.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div style="min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:15px;color:var(--ink);letter-spacing:-.01em;">${esc(p.title || "(untitled story)")}</span>
          <span class="pill pill-draft" style="font-size:11px;">${esc(p.type || "Article")}</span>
          ${countdown}
        </div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <span style="width:20px;height:20px;border-radius:50%;background:${avatarColor(p.authorName)};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">${esc((p.authorName || "?")[0].toUpperCase())}</span>
            ${esc(p.authorName || "Unassigned")}
          </span>
          <span>Stage: <strong style="color:var(--ink-2);">${esc(stage)}</strong></span>
          <span>Publication: <strong style="color:var(--ink-2);">${pubDateStr ? esc(fmtDay(pubDateStr)) : "no date set"}</strong></span>
          ${p.editorName ? `<span>Editor: <strong style="color:var(--ink-2);">${esc(p.editorName)}</strong></span>` : ""}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-xs" data-act="proposal">View proposal</button>
        <button class="btn btn-secondary btn-xs" data-act="chat">Message ${esc(authorFirst)}</button>
        <button class="btn btn-secondary btn-xs" data-act="assign">${canAssign(ctx) ? "Assign post" : "Plan post"}</button>
        ${canAssign(ctx) ? `<button class="btn btn-ghost btn-xs" data-act="clear" title="Hide this story from the Planner — no social post needed">No post needed</button>` : ""}
      </div>
    </div>
    ${renderPrepPlan(p, pubDate, stale, authorFirst)}
  `;

  row.querySelector('[data-act="proposal"]').addEventListener("click", () => openProposalModal(p));
  row.querySelector('[data-act="chat"]').addEventListener("click", () => openChatModal(ctx, p));
  row.querySelector('[data-act="assign"]')?.addEventListener("click", () =>
    openAssignModal(ctx, state, reload, {
      articleTitle: p.title || "",
      projectId: p.id,
      type: "Article highlight",
      deadline: pubDate && !stale ? isoDay(new Date(pubDate.getTime() - 86400000)) : undefined,
    }));
  row.querySelector('[data-act="clear"]')?.addEventListener("click", () =>
    clearProjectFromPlanner(ctx, p, reload));
  return row;
}

// The per-story prep section under each "Up next" row. Three shapes:
//   - no publication date  → short note, no fake checklist
//   - date already passed  → "this date looks stale, confirm with the writer"
//   - date ahead           → plain-language plan with relative phrasing
function renderPrepPlan(p, pubDate, stale, authorFirst) {
  if (!pubDate) {
    return `<div style="font-size:12.5px;color:var(--muted);">No publication date yet — a prep plan appears here once an admin sets one. If you need a date, message ${esc(authorFirst)}.</div>`;
  }
  if (stale) {
    return `
      <div style="font-size:12.5px;line-height:1.6;background:var(--surface-2,#fffbeb);border:1px solid var(--hairline,#fde68a);border-radius:8px;padding:10px 12px;color:var(--ink-2);">
        <strong>Check this date:</strong> the planned publication date
        (${esc(fmtDate(pubDate))}) has passed but the story isn't live yet, so
        the schedule is probably out of date. Message ${esc(authorFirst)} to
        confirm the new date before planning posts — the prep plan will update
        automatically once it changes.
      </div>`;
  }
  const cadence = buildCadence(pubDate);
  return `
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">Suggested prep — based on the ${esc(fmtDate(pubDate))} publication date</div>
      <div style="display:flex;flex-direction:column;gap:5px;">
        ${cadence.map((c) => `
          <div style="display:flex;align-items:center;gap:10px;font-size:12.5px;">
            ${cadenceDot(c.state)}
            <span style="color:${c.state === "overdue" ? "var(--danger,#b91c1c)" : c.state === "today" ? "var(--ink)" : "var(--ink-2)"};${c.state === "today" || c.state === "overdue" ? "font-weight:700;" : ""}">${esc(c.label)}</span>
            <span style="margin-left:auto;color:var(--muted);white-space:nowrap;">${esc(c.when)} · ${esc(fmtDay(c.dateStr))}</span>
            ${c.state === "today" ? `<span class="pill pill-pending" style="font-size:10.5px;">do today</span>` : ""}
            ${c.state === "overdue" ? `<span class="pill pill-rejected" style="font-size:10.5px;">catch up</span>` : ""}
          </div>`).join("")}
      </div>
    </div>`;
}

// Coarse stage from the timeline checkboxes — enough for the social team to
// judge how "real" a story is without learning the whole pipeline.
function stageLabel(p) {
  const tl = p.timeline || {};
  if (p.proposalStatus !== "approved") return `Proposal ${p.proposalStatus || "pending"}`;
  if (tl["Edits Addressed"]) return "Final checks";
  if (tl["Review Complete"]) return "Author addressing edits";
  if (tl["Article Writing Complete"]) return "In editing";
  if (p.type === "Interview" && !p.noInterview && !tl["Interview Complete"]) {
    return tl["Interview Scheduled"] ? "Interview scheduled" : "Scheduling interview";
  }
  return "Writing";
}

function buildCadence(pubDate) {
  const today = startOfToday();
  return CADENCE.map((c) => {
    const d = new Date(pubDate.getTime() + c.offset * 86400000);
    const diff = Math.round((d - today) / 86400000);
    let state = "upcoming";
    if (diff === 0) state = "today";
    else if (diff < 0) state = c.offset >= 0 ? "past" : "overdue";
    // Pre-publish steps that slipped are "overdue" (still worth doing);
    // post-publish steps in the past are simply behind us.
    return { ...c, dateStr: isoDay(d), state };
  });
}

function cadenceDot(state) {
  const color = {
    overdue: "var(--danger,#b91c1c)",
    today: "var(--accent,#0f172a)",
    upcoming: "var(--hairline,#cbd5e1)",
    past: "var(--hairline,#e2e8f0)",
  }[state] || "var(--hairline)";
  return `<span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>`;
}

function countdownPill(pubDate) {
  if (!pubDate) return "";
  const days = Math.round((pubDate - startOfToday()) / 86400000);
  if (days < 0) return `<span class="pill pill-rejected" style="font-size:11px;">date passed — confirm</span>`;
  if (days === 0) return `<span class="pill pill-published" style="font-size:11px;">publishes today</span>`;
  if (days <= 7) return `<span class="pill pill-pending" style="font-size:11px;">in ${days} day${days === 1 ? "" : "s"}</span>`;
  return `<span class="pill pill-draft" style="font-size:11px;">in ${days} days</span>`;
}

// ─── Proposal modal ───────────────────────────────────────────────────────────

function openProposalModal(p) {
  const deadlines = p.deadlines || {};
  const rows = [
    ["Author", p.authorName || "—"],
    ["Editor", p.editorName || "Not assigned"],
    ["Type", p.type || "Article"],
    ["Proposal status", p.proposalStatus || "pending"],
    p.interviewDate ? ["Interview", fmtDay(p.interviewDate)] : null,
    deadlines.draft ? ["Draft due", fmtDay(deadlines.draft)] : null,
    deadlines.review ? ["Review due", fmtDay(deadlines.review)] : null,
    pubDateOf(p) ? ["Publication", fmtDay(pubDateOf(p))] : null,
  ].filter(Boolean);

  const body = el("div", { style: "display:flex;flex-direction:column;gap:14px;" });
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:130px 1fr;gap:6px 12px;font-size:13px;">
      ${rows.map(([k, v]) => `
        <div style="color:var(--muted);">${esc(k)}</div>
        <div style="color:var(--ink);font-weight:600;">${esc(v)}</div>`).join("")}
    </div>
    <div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">Pitch / proposal</div>
      <div style="font-size:13.5px;line-height:1.65;color:var(--ink-2);white-space:pre-wrap;background:var(--surface-2,#f8fafc);border:1px solid var(--hairline,#e5e7eb);border-radius:8px;padding:14px 16px;max-height:320px;overflow:auto;">${esc(p.proposal || "No written proposal on file yet — message the writer if you need the angle.")}</div>
    </div>
  `;
  openModal({ title: p.title || "(untitled story)", body });
}

// ─── Chat modal (comment thread + email) ──────────────────────────────────────

function openChatModal(ctx, p) {
  const authorFirst = String(p.authorName || "the writer").trim().split(/\s+/)[0];
  const myUid = ctx.user.uid;

  const body = el("div", { style: "display:flex;flex-direction:column;gap:12px;min-width:min(520px,80vw);" });
  body.innerHTML = `
    <div style="font-size:12.5px;color:var(--muted);">
      Messages land in the story's comment feed <strong>and</strong> ${esc(authorFirst)} gets an email copy, so nothing waits on them being logged in.
    </div>
    <div id="pl-chat-feed" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow:auto;padding:4px 2px;"></div>
    <div style="display:flex;gap:8px;">
      <input id="pl-chat-input" placeholder="Ask ${esc(authorFirst)} a question…" style="flex:1;padding:9px 12px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;color:var(--ink);background:var(--surface,#fff);outline:none;">
      <button class="btn btn-primary btn-sm" id="pl-chat-send">Send</button>
    </div>
  `;

  const feed = body.querySelector("#pl-chat-feed");
  const renderFeed = (activity) => {
    const items = (Array.isArray(activity) ? activity : [])
      .slice()
      .sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")))
      .slice(-40);
    feed.innerHTML = items.length ? "" :
      `<div style="font-size:12.5px;color:var(--muted);text-align:center;padding:16px 0;">No activity yet — say hi!</div>`;
    for (const a of items) {
      const mine = a.authorId === myUid;
      const text = String(a.text || "");
      const m = text.match(/^commented: "([\s\S]*)"$/);
      const display = m ? m[1] : text;
      const bubble = el("div", {
        style: `max-width:85%;align-self:${mine ? "flex-end" : "flex-start"};background:${mine ? "var(--accent,#0f172a)" : "var(--surface-2,#f1f5f9)"};color:${mine ? "#fff" : "var(--ink)"};border-radius:12px;padding:8px 12px;font-size:13px;line-height:1.5;${m ? "" : "opacity:.75;font-style:italic;"}`,
      });
      bubble.innerHTML = `
        <div style="font-size:10.5px;font-weight:700;opacity:.75;margin-bottom:2px;">${esc(a.authorName || "Someone")} · ${esc(fmtRelative(a.timestamp))}</div>
        <div style="white-space:pre-wrap;">${esc(display)}</div>`;
      feed.appendChild(bubble);
    }
    feed.scrollTop = feed.scrollHeight;
  };
  renderFeed(p.activity);

  const modal = openModal({ title: `Message ${p.authorName || "the writer"} — ${p.title || "(untitled)"}`, body });
  if (!modal) return;

  const input = body.querySelector("#pl-chat-input");
  const sendBtn = body.querySelector("#pl-chat-send");
  setTimeout(() => input.focus(), 0);

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    const entry = {
      text: `commented: "${text}"`,
      authorName: ctx.profile.name || ctx.user.email,
      authorId: myUid,
      timestamp: new Date().toISOString(),
    };
    try {
      // Only chat fields — matches the staff comment rule in firestore.rules.
      await updateDoc(doc(db, "projects", p.id), {
        activity: arrayUnion(entry),
        lastActivity: serverTimestamp(),
        updatedAt: new Date().toISOString(),
      });
      p.activity = [...(p.activity || []), entry];
      renderFeed(p.activity);
      input.value = "";
      toast(`Sent — ${authorFirst} will also get an email.`, "success");

      // Best-effort email copy to the author. The comment is already saved;
      // a mail failure shouldn't look like a failed send.
      ctx.authedFetch("/api/notify/comment", {
        method: "POST",
        body: JSON.stringify({ projectId: p.id, message: text, toUserId: p.authorId || "" }),
      }).catch((err) => console.warn("comment email failed (non-blocking):", err));
    } catch (err) {
      toast("Could not send: " + err.message, "error");
    }
    sendBtn.disabled = false;
  };
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

// ─── Just published ───────────────────────────────────────────────────────────

async function fetchPublishedStories() {
  const endpoint = "https://firestore.googleapis.com/v1/projects/catalystwriters-5ce43/databases/(default)/documents:runQuery";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "stories" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "published" },
          },
        },
        orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
        select: {
          fields: [
            { fieldPath: "title" },
            { fieldPath: "authorName" },
            { fieldPath: "author" },
            { fieldPath: "publishedAt" },
            { fieldPath: "category" },
            { fieldPath: "slug" },
          ],
        },
        limit: 20,
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r.document)
    .map((r) => {
      const f = r.document.fields || {};
      const str = (k) => f[k]?.stringValue || "";
      return {
        id: r.document.name.split("/").pop(),
        title: str("title"),
        authorName: str("authorName") || str("author"),
        publishedAt: str("publishedAt") || f.publishedAt?.timestampValue || "",
        category: str("category"),
        slug: str("slug"),
      };
    })
    // We don't make social posts for book reviews — keep them off the Planner.
    .filter((s) => s.category !== "book-review")
    .slice(0, 12);
}

function renderPublished(ctx, mountEl, state, reload) {
  const assigner = canAssign(ctx);
  const clearedById = new Map(state.cleared.map((c) => [c.id, c]));
  const active = state.stories.filter((s) => !clearedById.has(s.id));
  const cleared = state.stories.filter((s) => clearedById.has(s.id));

  mountEl.innerHTML = "";

  if (!active.length) {
    mountEl.appendChild(el("div", { class: "empty-state" },
      cleared.length
        ? "All caught up — every recent story has been posted for."
        : "Nothing published recently."));
  }

  for (const s of active) {
    const covered = hasSocialPost(s, state.posts);
    const url = `/article/${encodeURIComponent(s.slug || slugify(s.title))}`;
    const row = el("div", {
      style: "display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid var(--hairline,#f1f5f9);flex-wrap:wrap;",
    });
    row.innerHTML = `
      <div style="flex:1;min-width:220px;">
        <a href="${esc(url)}" target="_blank" rel="noopener" style="font-weight:600;font-size:14px;color:var(--ink);text-decoration:none;">${esc(s.title || "(untitled)")}</a>
        <div style="font-size:12px;color:var(--muted);margin-top:2px;">
          ${esc(s.authorName || "The Catalyst")}${s.category ? ` · ${esc(s.category)}` : ""} · published ${esc(fmtRelative(s.publishedAt))}
        </div>
      </div>
      ${covered
        ? `<span class="pill pill-published" style="font-size:11px;">social: covered</span>`
        : `<span class="pill pill-pending" style="font-size:11px;">needs a post</span>
           <button class="btn btn-secondary btn-xs" data-act="assign">${assigner ? "Assign post" : "Plan post"}</button>
           <a class="btn btn-secondary btn-xs" href="#/marketing/social">Create post</a>`}
      ${assigner ? `<button class="btn btn-ghost btn-xs" data-act="clear" title="Posts are done — remove this story from the Planner">Mark posted</button>` : ""}
    `;
    row.querySelector('[data-act="assign"]')?.addEventListener("click", () =>
      openAssignModal(ctx, state, reload, { articleTitle: s.title || "", storyId: s.id, type: "Article highlight" }));
    row.querySelector('[data-act="clear"]')?.addEventListener("click", async () => {
      try {
        await setDoc(doc(db, "planner_cleared", s.id), {
          storyId: s.id,
          title: s.title || "",
          clearedById: ctx.user.uid,
          clearedByName: ctx.profile.name || ctx.user.email,
          clearedAt: new Date().toISOString(),
        });
        toast(`"${s.title || "Story"}" marked as posted — cleared from the Planner.`, "success");
        reload();
      } catch (err) { toast("Could not mark as posted: " + err.message, "error"); }
    });
    mountEl.appendChild(row);
  }

  // Cleared stories live in a collapsed section so the working list stays
  // clean but nothing is lost — the social lead can restore a story if a
  // post still needs doing.
  if (cleared.length) {
    const toggle = el("button", {
      class: "btn btn-ghost btn-xs",
      style: "margin-top:10px;color:var(--muted);",
    }, `Already posted (${cleared.length}) — show`);
    const list = el("div", { style: "display:none;margin-top:6px;" });
    toggle.addEventListener("click", () => {
      const open = list.style.display !== "none";
      list.style.display = open ? "none" : "block";
      toggle.textContent = `Already posted (${cleared.length}) — ${open ? "show" : "hide"}`;
    });
    for (const s of cleared) {
      const meta = clearedById.get(s.id) || {};
      const row = el("div", {
        style: "display:flex;align-items:center;gap:12px;padding:8px 4px;border-bottom:1px solid var(--hairline,#f1f5f9);flex-wrap:wrap;opacity:.7;",
      });
      row.innerHTML = `
        <div style="flex:1;min-width:220px;">
          <span style="font-weight:600;font-size:13px;color:var(--ink);">${esc(s.title || "(untitled)")}</span>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
            marked posted by ${esc(meta.clearedByName || "—")}${meta.clearedAt ? ` · ${esc(fmtRelative(meta.clearedAt))}` : ""}
          </div>
        </div>
        <span class="pill pill-published" style="font-size:10.5px;">posted</span>
        ${assigner ? `<button class="btn btn-ghost btn-xs" data-act="restore">Restore</button>` : ""}
      `;
      row.querySelector('[data-act="restore"]')?.addEventListener("click", async () => {
        try {
          await deleteDoc(doc(db, "planner_cleared", s.id));
          toast("Restored to the Planner.", "info");
          reload();
        } catch (err) { toast("Could not restore: " + err.message, "error"); }
      });
      list.appendChild(row);
    }
    mountEl.appendChild(toggle);
    mountEl.appendChild(list);
  }
}

// A published story counts as "covered" when any social post references it —
// by articleId when available, by title substring for legacy posts. Mirrors
// the matching used by the social board's "Needs a post" suggestions.
function hasSocialPost(story, posts) {
  const titleLc = String(story.title || "").toLowerCase();
  return (posts || []).some((post) => {
    if (post.articleId && post.articleId === story.id) return true;
    if (!titleLc) return false;
    const haystack = `${post.title || ""} ${post.articleTitle || ""}`.toLowerCase();
    return haystack.includes(titleLc);
  });
}

// ─── Small utils ──────────────────────────────────────────────────────────────

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Format a YYYY-MM-DD string for display without the UTC-parse off-by-one
// that `new Date("2025-11-08")` causes in US timezones (it would render as
// Nov 7). Always route date *strings* through here, not fmtDate directly.
function fmtDay(s) {
  const d = parseDay(s);
  return d ? fmtDate(d) : fmtDate(s);
}

// Parse a YYYY-MM-DD (or ISO) date string to a local-midnight Date, or null.
function parseDay(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) ? d : null;
}

function avatarColor(name) {
  const palette = ["#0f766e", "#7c3aed", "#b45309", "#1d4ed8", "#be185d", "#15803d", "#475569"];
  let h = 0;
  for (const ch of String(name || "?")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
