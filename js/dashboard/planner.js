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
  query,
  where,
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
  return `<span style="background:${t.bg};color:${t.ink};padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;">${esc(label)}</span>`;
}

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

// Roles that can be assigned a post.
const ASSIGNABLE_ROLES = ["social_media", "marketing", "admin"];

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
    getDocs(query(collection(db, "users"), where("role", "in", ASSIGNABLE_ROLES))),
    getDocs(collection(db, "planner_cleared")),
  ]);

  state.projects = projectsRes.status === "fulfilled"
    ? projectsRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : null;
  state.stories = storiesRes.status === "fulfilled" ? storiesRes.value : null;
  state.posts = postsRes.status === "fulfilled"
    ? postsRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  state.assignments = assignRes.status === "fulfilled"
    ? assignRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : null;
  state.team = teamRes.status === "fulfilled"
    ? teamRes.value.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
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

  const rows = state.assignments
    .map((a) => ({ ...a, _status: normStatus(a.status) }))
    .filter((a) => showPublished || a._status !== "published")
    .sort((a, b) => {
      const pa = a._status === "published" ? 1 : 0;
      const pb = b._status === "published" ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return String(a.deadline || "9999").localeCompare(String(b.deadline || "9999"));
    });

  mountEl.innerHTML = "";

  // Active / All filter pills.
  const publishedCount = state.assignments.filter((a) => normStatus(a.status) === "published").length;
  const filterBar = el("div", { style: "display:flex;gap:6px;margin-bottom:10px;align-items:center;" });
  const mkPill = (label, all) => el("button", {
    class: `btn btn-xs ${showPublished === all ? "btn-primary" : "btn-secondary"}`,
    onclick: () => { state.trackerShowPublished = all; renderAssignments(ctx, mountEl, state, reload); },
  }, label);
  filterBar.appendChild(mkPill("Active", false));
  filterBar.appendChild(mkPill(`All (incl. ${publishedCount} published)`, true));
  mountEl.appendChild(filterBar);

  if (!rows.length) {
    mountEl.appendChild(el("div", { class: "empty-state" },
      showPublished
        ? "Nothing in the tracker yet. Use \"Add content\" to plan the first post."
        : "No active content — everything's published. Use \"Add content\" to plan the next post."));
    return;
  }

  const scroll = el("div", { style: "overflow-x:auto;" });
  const table = el("table", { style: "width:100%;border-collapse:collapse;font-size:13px;min-width:820px;" });
  const th = (label) => `<th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--hairline,#e5e7eb);white-space:nowrap;">${label}</th>`;
  table.innerHTML = `<thead><tr>${th("Platform")}${th("Type")}${th("Topic")}${th("Owner")}${th("Status")}${th("Post date")}${th("Notes")}${th("")}</tr></thead>`;
  const tbody = el("tbody", {});

  for (const a of rows) {
    const mine = a.assigneeId === myUid;
    const canTouch = lead || mine || a.createdById === myUid;
    const isPub = a._status === "published";
    const due = parseDay(a.deadline);
    const dueText = dueLabel(due, isPub);
    const td = "padding:9px 10px;border-bottom:1px solid var(--hairline,#f1f5f9);vertical-align:middle;";

    const tr = el("tr", { style: mine && !isPub ? "background:var(--surface-2,#f8fafc);" : "" });
    tr.innerHTML = `
      <td style="${td}white-space:nowrap;color:var(--ink-2);">${esc(platformLabel(a.platform))}</td>
      <td style="${td}">${typeChip(a.type) || `<span style="color:var(--muted);">—</span>`}</td>
      <td style="${td}min-width:200px;">
        <span style="font-weight:600;color:var(--ink);${isPub ? "opacity:.6;" : ""}">${esc(a.articleTitle || "(untitled)")}</span>
        ${a.link ? ` <a href="${esc(a.link)}" target="_blank" rel="noopener" style="font-size:11.5px;color:var(--accent);">open&nbsp;asset</a>` : ""}
        ${mine && !isPub ? ` <span class="pill pill-pending" style="font-size:10px;">yours</span>` : ""}
      </td>
      <td style="${td}white-space:nowrap;color:var(--ink-2);">${esc(a.assigneeName || "—")}</td>
      <td style="${td}"></td>
      <td style="${td}white-space:nowrap;font-size:12px;${dueText.urgent && !isPub ? "color:var(--danger,#b91c1c);font-weight:700;" : "color:var(--muted);"}">${esc(dueText.text)}</td>
      <td style="${td}max-width:180px;"><span title="${esc(a.notes || "")}" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--muted);">${esc(a.notes || "")}</span></td>
      <td style="${td}white-space:nowrap;text-align:right;">
        ${canTouch ? `<button class="btn btn-ghost btn-xs" data-act="edit">Edit</button>` : ""}
        ${(lead || a.createdById === myUid) ? `<button class="btn btn-ghost btn-xs" data-act="remove" style="color:var(--danger,#b91c1c);">Remove</button>` : ""}
      </td>`;

    // Inline status select — the fastest path from "drafting" to "published".
    const statusCell = tr.children[4];
    const meta = STATUSES.find((s) => s.id === a._status) || STATUSES[0];
    if (canTouch) {
      const sel = el("select", {
        class: "select",
        style: `font-size:11.5px;font-weight:700;padding:3px 6px;border-radius:999px;border:1px solid ${meta.ink}33;background:${meta.bg};color:${meta.ink};max-width:120px;`,
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
      statusCell.innerHTML = `<span style="background:${meta.bg};color:${meta.ink};padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;">${esc(meta.label)}</span>`;
    }

    tr.querySelector('[data-act="edit"]')?.addEventListener("click", () =>
      openAssignModal(ctx, state, reload, {}, a));
    tr.querySelector('[data-act="remove"]')?.addEventListener("click", async () => {
      const ok = await confirmDialog(`Remove "${a.articleTitle || "this content"}" from the tracker?`, { confirmText: "Remove", danger: true });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "social_assignments", a.id));
        reload();
      } catch (err) { toast("Could not remove: " + err.message, "error"); }
    });
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  scroll.appendChild(table);
  mountEl.appendChild(scroll);
}

function platformLabel(p) {
  if (!p || p === "any") return "Any";
  return p[0].toUpperCase() + p.slice(1);
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

  let team = (state.team || [])
    .filter((u) => u.id !== undefined)
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));
  // Make sure the viewer can always pick themselves, whatever their role.
  if (!team.some((u) => u.id === myUid)) {
    team = [{ id: myUid, name: ctx.profile.name || ctx.user.email, email: ctx.profile.email || ctx.user.email || "", role: ctx.role }, ...team];
  }

  // Article options: upcoming pipeline stories (not hidden/cleared) +
  // recently published.
  const clearedIds = new Set((state.cleared || []).map((c) => c.id));
  const upcoming = (state.projects || [])
    .filter(isActiveProject)
    .filter((p) => !clearedIds.has(p.id))
    .sort(byPubDate);
  const published = state.stories || [];

  const initialTopic = existing?.articleTitle || prefill.articleTitle || "";
  const initialOwner = existing?.assigneeId || (lead ? (team[0]?.id || myUid) : myUid);
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
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Owner
        <select class="select" id="as-assignee" style="font-weight:400;" ${lead ? "" : "disabled"}>
          ${team.map((u) => `<option value="${esc(u.id)}" ${u.id === initialOwner ? "selected" : ""}>${esc(u.name || u.email)}</option>`).join("")}
        </select>
      </label>
      <label style="display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--ink);">Post date
        <input type="date" id="as-deadline" value="${esc(initialDeadline)}" style="padding:8px 10px;border:1px solid var(--hairline,#e5e7eb);border-radius:8px;font-size:13px;font-family:inherit;">
      </label>
    </div>
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
    <div style="font-size:12px;color:var(--muted);">${lead
      ? "The owner gets an email with the topic, deadline, and your notes — replies come back to you."
      : "This goes on the shared tracker (and your Overview calendar) under your name."}</div>
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
    const assigneeId = body.querySelector("#as-assignee").value;
    const assignee = team.find((u) => u.id === assigneeId);
    const deadline = body.querySelector("#as-deadline").value;
    const status = body.querySelector("#as-status").value;
    if (!articleTitle) { toast("Give the post a topic.", "error"); return; }
    if (!assignee) { toast("Pick an owner.", "error"); return; }
    if (!deadline) { toast("Set a post date.", "error"); return; }

    const payload = {
      articleTitle,
      projectId: pickedProjectId,
      storyId: pickedStoryId,
      type: body.querySelector("#as-type").value || "",
      platform: body.querySelector("#as-platform").value,
      deadline,
      link: body.querySelector("#as-link").value.trim(),
      notes: body.querySelector("#as-notes").value.trim(),
      assigneeId: assignee.id,
      assigneeName: assignee.name || assignee.email || "",
      assigneeEmail: assignee.email || "",
      status,
      doneAt: status === "published" ? (existing?.doneAt || new Date().toISOString()) : null,
    };

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      let id;
      let notifyNeeded;
      if (existing) {
        id = existing.id;
        await updateDoc(doc(db, "social_assignments", id), payload);
        // Re-email only when the post changed hands to someone else.
        notifyNeeded = assignee.id !== existing.assigneeId && assignee.id !== myUid;
      } else {
        const ref = await addDoc(collection(db, "social_assignments"), {
          ...payload,
          createdById: myUid,
          createdByName: ctx.profile.name || ctx.user.email,
          createdAt: new Date().toISOString(),
        });
        id = ref.id;
        notifyNeeded = assignee.id !== myUid;
      }
      modal.close();
      toast(existing ? "Tracker updated." : `Added — it's on ${assignee.id === myUid ? "your" : `${assignee.name || assignee.email}'s`} calendar.`, "success");
      reload();
      if (notifyNeeded) {
        // Best-effort email; the tracker row exists either way.
        ctx.authedFetch("/api/notify/assignment", {
          method: "POST",
          body: JSON.stringify({ assignmentId: id }),
        }).catch((err) => console.warn("assignment email failed (non-blocking):", err));
      }
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
  if (p.type === "Interview" && !tl["Interview Complete"]) {
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
