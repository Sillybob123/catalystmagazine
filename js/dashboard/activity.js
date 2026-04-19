// Admin-only Activity page.
//
// This is the admin's "command center." It shows three layers of intelligence:
//   1. Per-person status — what every staff member is working on, when they
//      last touched it, how long they've been idle, and whether they're
//      overdue or near-deadline. Sorted by "attention needed" so the admin
//      can see at a glance who needs a nudge.
//   2. At-risk projects — stories that are overdue, due soon, or stalled
//      (no activity in 7+ days). Click through to open the detail modal.
//   3. Live activity feed — every proposal, comment, approval, and stage
//      change across the whole pipeline, filterable by type / person.
//
// The per-person and at-risk sections are also written to `window.__activitySnapshot`
// as structured JSON so a future email-reminder script can read the same signals
// this page surfaces.

// pipeline.js reads projects/users from the primary db (aliased as workflowDb
// inside that module). We follow the same convention so this page and the
// kanban always see the same data.
import { db as workflowDb } from "../firebase-dual-config.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc } from "./ui.js";

const IDLE_WARNING_DAYS = 7;   // "idle" starts here
const IDLE_STALE_DAYS   = 14;  // "stalled" — escalate
const DEADLINE_SOON_DAYS = 3;  // "due soon" window

// Timeline step that marks a project truly finished.
const FINAL_STEP = "Suggestions Reviewed";

export async function mount(ctx, container) {
  container.innerHTML = "";
  ensureStyles();

  // ── Header / summary strip ────────────────────────────────────────────────
  const summary = el("div", { class: "card" });
  summary.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Activity &amp; Accountability</div>
        <div class="card-subtitle">Everything every teammate is working on — last touched, idle days, overdue flags, upcoming deadlines.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-ghost btn-sm" id="act-copy-json" title="Copy the data powering this page as JSON (useful for the reminder-email script)">Copy JSON</button>
      </div>
    </div>
    <div class="card-body">
      <div class="act-kpis" id="act-kpis"></div>
    </div>`;
  container.appendChild(summary);

  // ── People (primary focus) ────────────────────────────────────────────────
  const peopleCard = el("div", { class: "card", style: { marginTop: "20px" } });
  peopleCard.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Who's working on what</div>
        <div class="card-subtitle">Sorted by attention needed — people at the top are overdue, stalled, or approaching a deadline.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="input" id="act-people-search" placeholder="Search name or email…" style="min-width:220px;">
        <select class="select" id="act-people-filter" style="min-width:160px;">
          <option value="needs">Needs attention</option>
          <option value="all">Everyone</option>
          <option value="overdue">Overdue only</option>
          <option value="idle">Idle (7+ days)</option>
          <option value="soon">Due in ≤ 3 days</option>
          <option value="idle_only">Inactive staff (no projects)</option>
        </select>
      </div>
    </div>
    <div class="card-body" id="act-people-body">
      <div class="loading-state"><div class="spinner"></div>Loading&hellip;</div>
    </div>`;
  container.appendChild(peopleCard);

  // ── At-risk projects ──────────────────────────────────────────────────────
  const risksCard = el("div", { class: "card", style: { marginTop: "20px" } });
  risksCard.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">At-risk projects</div>
        <div class="card-subtitle">Overdue, due soon, or stalled — ordered by how urgent they are.</div>
      </div>
    </div>
    <div class="card-body" id="act-risks-body">
      <div class="loading-state"><div class="spinner"></div>Loading&hellip;</div>
    </div>`;
  container.appendChild(risksCard);

  // ── Live event feed ───────────────────────────────────────────────────────
  const feedCard = el("div", { class: "card", style: { marginTop: "20px" } });
  feedCard.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Live activity feed</div>
        <div class="card-subtitle">Every proposal, comment, approval, and stage change, newest first.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="input" id="act-feed-search" placeholder="Filter by name or project…" style="min-width:220px;">
        <select class="select" id="act-type-filter" style="min-width:160px;">
          <option value="all">All activity</option>
          <option value="proposal">Proposals</option>
          <option value="comment">Comments</option>
          <option value="approved">Approvals</option>
          <option value="rejected">Rejections</option>
          <option value="step">Stage changes</option>
        </select>
      </div>
    </div>
    <div class="card-body" id="act-feed-body">
      <div class="loading-state"><div class="spinner"></div>Loading activity…</div>
    </div>`;
  container.appendChild(feedCard);

  // ── State ─────────────────────────────────────────────────────────────────
  const state = {
    projects: [],           // raw project docs
    users: [],              // raw user docs
    events: [],             // flattened activity events
    peopleView: "needs",
    peopleSearch: "",
    feedType: "all",
    feedSearch: "",
  };

  // ── Refs ──────────────────────────────────────────────────────────────────
  const kpisEl   = summary.querySelector("#act-kpis");
  const peopleBody = peopleCard.querySelector("#act-people-body");
  const risksBody  = risksCard.querySelector("#act-risks-body");
  const feedBody   = feedCard.querySelector("#act-feed-body");
  const peopleSearchEl = peopleCard.querySelector("#act-people-search");
  const peopleFilterEl = peopleCard.querySelector("#act-people-filter");
  const feedSearchEl = feedCard.querySelector("#act-feed-search");
  const feedTypeEl = feedCard.querySelector("#act-type-filter");

  peopleSearchEl.addEventListener("input", () => { state.peopleSearch = peopleSearchEl.value.trim().toLowerCase(); renderPeople(); });
  peopleFilterEl.addEventListener("change", () => { state.peopleView = peopleFilterEl.value; renderPeople(); });
  feedSearchEl.addEventListener("input", () => { state.feedSearch = feedSearchEl.value.trim().toLowerCase(); renderFeed(); });
  feedTypeEl.addEventListener("change", () => { state.feedType = feedTypeEl.value; renderFeed(); });

  summary.querySelector("#act-copy-json").addEventListener("click", () => {
    const snapshot = window.__activitySnapshot;
    if (!snapshot) { ctx.toast("Still loading — try again in a second.", "info"); return; }
    navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
      .then(() => ctx.toast("Snapshot JSON copied to clipboard.", "success"))
      .catch((e) => ctx.toast("Copy failed: " + e.message, "error"));
  });

  // ── Subscriptions ─────────────────────────────────────────────────────────
  const unsubProjects = onSnapshot(collection(workflowDb, "projects"),
    (snap) => {
      state.projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.events = buildEvents(state.projects);
      renderAll();
    },
    (err) => {
      console.error("[activity] projects snapshot error", err);
      peopleBody.innerHTML = `<div class="error-state">Failed to load projects: ${esc(err.message)}</div>`;
      risksBody.innerHTML  = `<div class="error-state">Failed to load projects: ${esc(err.message)}</div>`;
      feedBody.innerHTML   = `<div class="error-state">Failed to load projects: ${esc(err.message)}</div>`;
    },
  );

  const unsubUsers = onSnapshot(collection(workflowDb, "users"),
    (snap) => {
      state.users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    },
    (err) => {
      console.warn("[activity] users snapshot error", err);
      state.users = [];
      renderAll();
    },
  );

  function renderAll() {
    const analysis = analyzePeople(state.projects, state.users);
    const atRisk   = findAtRiskProjects(state.projects);

    // Publish snapshot so a future cron/email script can consume the same signals.
    window.__activitySnapshot = {
      generatedAt: new Date().toISOString(),
      thresholds: { IDLE_WARNING_DAYS, IDLE_STALE_DAYS, DEADLINE_SOON_DAYS },
      people: analysis.map(personToJson),
      atRiskProjects: atRisk.map(projectToJson),
    };

    renderKpis(analysis, atRisk);
    renderPeople();
    renderRisks();
    renderFeed();
  }

  function renderKpis(analysis, atRisk) {
    const overdueProjects = atRisk.filter((r) => r.reason === "overdue").length;
    const soonProjects    = atRisk.filter((r) => r.reason === "due_soon").length;
    const stalledProjects = atRisk.filter((r) => r.reason === "stalled").length;
    const needAttention   = analysis.filter((p) => p.attention > 0).length;
    const totalActive     = analysis.filter((p) => p.activeProjects.length > 0).length;

    kpisEl.innerHTML = `
      <div class="act-kpi act-kpi-danger">
        <div class="act-kpi-num">${overdueProjects}</div>
        <div class="act-kpi-label">Overdue projects</div>
      </div>
      <div class="act-kpi act-kpi-warn">
        <div class="act-kpi-num">${soonProjects}</div>
        <div class="act-kpi-label">Due in ≤ ${DEADLINE_SOON_DAYS} days</div>
      </div>
      <div class="act-kpi act-kpi-warn">
        <div class="act-kpi-num">${stalledProjects}</div>
        <div class="act-kpi-label">Stalled (${IDLE_STALE_DAYS}+ idle days)</div>
      </div>
      <div class="act-kpi">
        <div class="act-kpi-num">${needAttention}</div>
        <div class="act-kpi-label">Staff needing a nudge</div>
      </div>
      <div class="act-kpi">
        <div class="act-kpi-num">${totalActive}</div>
        <div class="act-kpi-label">Staff actively assigned</div>
      </div>`;
  }

  function renderPeople() {
    const analysis = analyzePeople(state.projects, state.users);

    let rows = analysis.slice();
    const q = state.peopleSearch;
    if (q) rows = rows.filter((p) => (p.name + " " + p.email).toLowerCase().includes(q));

    switch (state.peopleView) {
      case "needs":     rows = rows.filter((p) => p.attention > 0); break;
      case "overdue":   rows = rows.filter((p) => p.overdueCount > 0); break;
      case "idle":      rows = rows.filter((p) => p.activeProjects.length > 0 && p.maxIdleDays >= IDLE_WARNING_DAYS); break;
      case "soon":      rows = rows.filter((p) => p.dueSoonCount > 0); break;
      case "idle_only": rows = rows.filter((p) => p.activeProjects.length === 0); break;
      case "all":
      default: break;
    }

    if (!rows.length) {
      peopleBody.innerHTML = `<div class="empty-state">Nobody matches this filter — the team looks healthy.</div>`;
      return;
    }

    const wrap = el("div", { class: "act-people" });
    for (const person of rows) wrap.appendChild(renderPersonCard(person));
    peopleBody.innerHTML = "";
    peopleBody.appendChild(wrap);
  }

  function renderRisks() {
    const risks = findAtRiskProjects(state.projects);
    if (!risks.length) {
      risksBody.innerHTML = `<div class="empty-state">No at-risk projects right now — nice.</div>`;
      return;
    }
    const list = el("div", { class: "act-risks" });
    for (const r of risks) list.appendChild(renderRiskRow(r));
    risksBody.innerHTML = "";
    risksBody.appendChild(list);
  }

  function renderFeed() {
    let events = state.events.slice();
    if (state.feedType !== "all") {
      events = events.filter((e) => classifyEvent(e.text) === state.feedType);
    }
    if (state.feedSearch) {
      const q = state.feedSearch;
      events = events.filter((e) => {
        const hay = `${e.authorName || ""} ${e.projectTitle || ""} ${e.text || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if (!events.length) {
      feedBody.innerHTML = `<div class="empty-state">No activity matches your filter.</div>`;
      return;
    }

    const groups = new Map();
    for (const e of events) {
      const label = dayOf(e.timestamp);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(e);
    }

    feedBody.innerHTML = "";
    for (const [day, items] of groups) {
      const section = el("div", { class: "activity-section" });
      section.innerHTML = `<div class="activity-date-header">${esc(day)}</div>`;
      const feed = el("div", { class: "activity-feed activity-feed-full" });

      for (const item of items) {
        const type = classifyEvent(item.text);
        const phrase = humanizeEventText(item.text);
        const row = el("div", { class: "act-feed-row" });
        row.innerHTML = `
          <div class="act-feed-icon" style="color:${eventColor(type)};">${eventIcon(type)}</div>
          <div class="act-feed-body">
            <div class="act-feed-sentence">
              <span class="act-feed-author">${esc(item.authorName || "Someone")}</span>
              <span class="act-feed-text">${esc(phrase)}</span>
            </div>
            <div class="act-feed-meta">
              <span class="act-feed-project" title="${esc(item.projectTitle || "")}">${esc(item.projectTitle || "Unknown project")}</span>
              ${item.projectType ? `<span class="pill-tag">${esc(item.projectType)}</span>` : ""}
              <span class="act-feed-dot">·</span>
              <span class="act-feed-when">${esc(fmtRelative(item.timestamp))}</span>
            </div>
          </div>`;
        feed.appendChild(row);
      }
      section.appendChild(feed);
      feedBody.appendChild(section);
    }
  }

  return () => { unsubProjects(); unsubUsers(); };
}

// ─── Per-person analysis ─────────────────────────────────────────────────────

/**
 * For every user (plus any author/editor id referenced on a project), build a
 * structured summary of their active work, idle time, overdue count, and the
 * single most urgent deadline. Each person also gets an `attention` score so
 * we can sort the list by "who needs a nudge first."
 */
function analyzePeople(projects, users) {
  const byId = new Map();

  function ensure(id, fallbackName, fallbackEmail, role) {
    if (!id) return null;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: fallbackName || "Unknown",
        email: fallbackEmail || "",
        role: role || "",
        activeProjects: [],   // [{ project, role: "author"|"editor", status, lastTouched, idleDays, due, daysUntilDue }]
        completedCount: 0,
        overdueCount: 0,
        dueSoonCount: 0,
        maxIdleDays: 0,
        mostRecentActivity: 0, // ms
        lastActivityText: "",
      });
    }
    const p = byId.get(id);
    if (fallbackName && p.name === "Unknown") p.name = fallbackName;
    if (fallbackEmail && !p.email) p.email = fallbackEmail;
    if (role && !p.role) p.role = role;
    return p;
  }

  // Seed from users collection so staff with zero projects still show up.
  for (const u of users) {
    if (!u || (u.status && u.status !== "active")) continue;
    if (u.role === "reader") continue;
    ensure(u.id, u.name, u.email, u.role);
  }

  // Walk projects, attributing work to authors and editors.
  for (const project of projects) {
    const isComplete = !!project.timeline?.[FINAL_STEP];
    const lastTouched = projectLastTouched(project);
    const idleDays = lastTouched ? Math.floor((Date.now() - lastTouched) / 86400000) : null;
    const due = pubDeadline(project);
    const daysUntilDue = due ? daysUntil(due) : null;
    const isOverdue = !isComplete && daysUntilDue !== null && daysUntilDue < 0;
    const isDueSoon = !isComplete && daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= DEADLINE_SOON_DAYS;
    const status = humanStatus(project);

    // Author
    if (project.authorId) {
      const person = ensure(project.authorId, project.authorName, "", "writer");
      attributeProject(person, { project, role: "author", status, lastTouched, idleDays, due, daysUntilDue, isOverdue, isDueSoon, isComplete });
    }
    // Editor
    if (project.editorId) {
      const person = ensure(project.editorId, project.editorName, "", "editor");
      attributeProject(person, { project, role: "editor", status, lastTouched, idleDays, due, daysUntilDue, isOverdue, isDueSoon, isComplete });
    }

    // Walk per-user activity timestamps to refine "most recent activity" for each participant.
    for (const act of project.activity || []) {
      if (!act.authorId) continue;
      const person = byId.get(act.authorId);
      if (!person) continue;
      const ms = toMs(act.timestamp);
      if (ms > person.mostRecentActivity) {
        person.mostRecentActivity = ms;
        person.lastActivityText = act.text || "";
        person.lastActivityProject = project.title || "";
      }
    }
  }

  // Score "attention needed" for sorting.
  // Overdue projects are the loudest signal; stalled active projects are next;
  // due-soon is a smaller bump. Completed-only contributors score 0.
  const scored = [...byId.values()].map((p) => {
    let attention = 0;
    attention += p.overdueCount * 100;
    if (p.activeProjects.length > 0) {
      if (p.maxIdleDays >= IDLE_STALE_DAYS) attention += 50;
      else if (p.maxIdleDays >= IDLE_WARNING_DAYS) attention += 20;
    }
    attention += p.dueSoonCount * 15;
    p.attention = attention;
    return p;
  });

  // Sort: attention desc, then active-project count desc, then name.
  scored.sort((a, b) => {
    if (b.attention !== a.attention) return b.attention - a.attention;
    if (b.activeProjects.length !== a.activeProjects.length) return b.activeProjects.length - a.activeProjects.length;
    return (a.name || "").localeCompare(b.name || "");
  });

  return scored;
}

function attributeProject(person, info) {
  if (info.isComplete) {
    person.completedCount += 1;
    return;
  }
  person.activeProjects.push({
    projectId: info.project.id,
    title: info.project.title || "Untitled",
    type: info.project.type || "",
    role: info.role,
    status: info.status,
    lastTouched: info.lastTouched,
    idleDays: info.idleDays,
    due: info.due,
    daysUntilDue: info.daysUntilDue,
    isOverdue: info.isOverdue,
    isDueSoon: info.isDueSoon,
  });
  if (info.isOverdue) person.overdueCount += 1;
  if (info.isDueSoon) person.dueSoonCount += 1;
  if (info.idleDays !== null && info.idleDays > person.maxIdleDays) person.maxIdleDays = info.idleDays;
}

// ─── Per-person rendering ────────────────────────────────────────────────────

function renderPersonCard(person) {
  const card = el("div", { class: "act-person" });

  const attentionLabel = personAttentionLabel(person);
  const attentionClass = personAttentionClass(person);

  const headerRight = attentionLabel
    ? `<span class="act-pill ${attentionClass}">${esc(attentionLabel)}</span>`
    : person.activeProjects.length === 0
      ? `<span class="act-pill act-pill-muted">No active projects</span>`
      : `<span class="act-pill act-pill-ok">On track</span>`;

  const lastSeen = person.mostRecentActivity
    ? `<span class="act-person-sub">Last touched ${esc(fmtRelative(person.mostRecentActivity))}${person.lastActivityProject ? ` — <em>${esc(person.lastActivityProject)}</em>` : ""}</span>`
    : `<span class="act-person-sub act-muted">No recorded activity</span>`;

  card.innerHTML = `
    <div class="act-person-head">
      <div class="act-avatar" style="background:${stringToColor(person.name || person.email)}">${(person.name || person.email || "?")[0].toUpperCase()}</div>
      <div class="act-person-id">
        <div class="act-person-name">${esc(person.name || "Unknown")} <span class="act-role-chip">${esc(roleLabel(person.role))}</span></div>
        ${lastSeen}
      </div>
      <div class="act-person-right">${headerRight}</div>
    </div>
    <div class="act-person-stats">
      <div><span class="act-stat-num">${person.activeProjects.length}</span><span class="act-stat-label">active</span></div>
      <div><span class="act-stat-num ${person.overdueCount ? "act-danger" : ""}">${person.overdueCount}</span><span class="act-stat-label">overdue</span></div>
      <div><span class="act-stat-num ${person.dueSoonCount ? "act-warn" : ""}">${person.dueSoonCount}</span><span class="act-stat-label">due soon</span></div>
      <div><span class="act-stat-num">${person.completedCount}</span><span class="act-stat-label">done</span></div>
    </div>`;

  if (person.activeProjects.length) {
    const list = el("div", { class: "act-person-projects" });
    const sorted = [...person.activeProjects].sort((a, b) => projectUrgency(b) - projectUrgency(a));
    for (const proj of sorted) list.appendChild(renderPersonProjectRow(proj));
    card.appendChild(list);
  }

  return card;
}

function renderPersonProjectRow(proj) {
  const row = el("div", { class: "act-proj" });

  const dueLabel = proj.due
    ? (proj.isOverdue
        ? `<span class="act-proj-due act-danger">Overdue by ${Math.abs(proj.daysUntilDue)}d</span>`
        : proj.isDueSoon
          ? `<span class="act-proj-due act-warn">Due in ${proj.daysUntilDue}d</span>`
          : `<span class="act-proj-due">Due in ${proj.daysUntilDue}d</span>`)
    : `<span class="act-proj-due act-muted">No deadline</span>`;

  const idleLabel = proj.idleDays === null
    ? `<span class="act-muted">No activity yet</span>`
    : proj.idleDays >= IDLE_STALE_DAYS
      ? `<span class="act-danger">Idle ${proj.idleDays}d</span>`
      : proj.idleDays >= IDLE_WARNING_DAYS
        ? `<span class="act-warn">Idle ${proj.idleDays}d</span>`
        : `<span class="act-muted">Active ${proj.idleDays}d ago</span>`;

  row.innerHTML = `
    <div class="act-proj-title">
      <span class="act-proj-role">${esc(proj.role)}</span>
      <a href="#/pipeline/${proj.type === "Op-Ed" ? "opeds" : "interviews"}" class="act-proj-link">${esc(proj.title)}</a>
    </div>
    <div class="act-proj-meta">
      <span>${esc(proj.status)}</span>
      <span>·</span>
      ${idleLabel}
      <span>·</span>
      ${dueLabel}
    </div>`;
  return row;
}

// ─── At-risk projects ────────────────────────────────────────────────────────

function findAtRiskProjects(projects) {
  const risks = [];
  for (const project of projects) {
    if (project.timeline?.[FINAL_STEP]) continue; // done, ignore
    const lastTouched = projectLastTouched(project);
    const idleDays = lastTouched ? Math.floor((Date.now() - lastTouched) / 86400000) : null;
    const due = pubDeadline(project);
    const daysUntilDue = due ? daysUntil(due) : null;

    let reason = null, urgency = 0;
    if (daysUntilDue !== null && daysUntilDue < 0) {
      reason = "overdue"; urgency = 1000 + Math.abs(daysUntilDue);
    } else if (daysUntilDue !== null && daysUntilDue <= DEADLINE_SOON_DAYS) {
      reason = "due_soon"; urgency = 500 - daysUntilDue;
    } else if (idleDays !== null && idleDays >= IDLE_STALE_DAYS) {
      reason = "stalled"; urgency = 200 + idleDays;
    }
    if (!reason) continue;

    risks.push({
      project,
      reason,
      urgency,
      idleDays,
      daysUntilDue,
      due,
      status: humanStatus(project),
      lastTouched,
    });
  }
  risks.sort((a, b) => b.urgency - a.urgency);
  return risks;
}

function renderRiskRow(r) {
  const row = el("div", { class: "act-risk-row" });

  const reasonClass = {
    overdue: "act-pill-danger",
    due_soon: "act-pill-warn",
    stalled: "act-pill-warn",
  }[r.reason] || "act-pill-muted";

  const reasonText = {
    overdue: `Overdue ${Math.abs(r.daysUntilDue)}d`,
    due_soon: `Due in ${r.daysUntilDue}d`,
    stalled: `Stalled ${r.idleDays}d`,
  }[r.reason] || "At risk";

  const p = r.project;
  const author = p.authorName || "No author";
  const editor = p.editorName || "No editor";

  row.innerHTML = `
    <div class="act-risk-main">
      <div class="act-risk-title">${esc(p.title || "Untitled")}</div>
      <div class="act-risk-meta">
        <span class="pill-tag">${esc(p.type || "")}</span>
        <span>${esc(r.status)}</span>
        <span>·</span>
        <span>Author: <strong>${esc(author)}</strong></span>
        <span>·</span>
        <span>Editor: <strong>${esc(editor)}</strong></span>
      </div>
    </div>
    <div class="act-risk-right">
      <span class="act-pill ${reasonClass}">${esc(reasonText)}</span>
      <span class="act-risk-when">${r.lastTouched ? "Last touch " + fmtRelative(r.lastTouched) : "No activity"}</span>
    </div>`;
  return row;
}

// ─── JSON shape (for future email script) ────────────────────────────────────

function personToJson(p) {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role,
    attentionScore: p.attention,
    overdueCount: p.overdueCount,
    dueSoonCount: p.dueSoonCount,
    activeCount: p.activeProjects.length,
    completedCount: p.completedCount,
    maxIdleDays: p.maxIdleDays,
    mostRecentActivityAt: p.mostRecentActivity ? new Date(p.mostRecentActivity).toISOString() : null,
    lastActivityText: p.lastActivityText || null,
    activeProjects: p.activeProjects.map((ap) => ({
      projectId: ap.projectId,
      title: ap.title,
      type: ap.type,
      role: ap.role,
      status: ap.status,
      idleDays: ap.idleDays,
      due: ap.due,
      daysUntilDue: ap.daysUntilDue,
      isOverdue: ap.isOverdue,
      isDueSoon: ap.isDueSoon,
      lastTouchedAt: ap.lastTouched ? new Date(ap.lastTouched).toISOString() : null,
    })),
  };
}

function projectToJson(r) {
  const p = r.project;
  return {
    projectId: p.id,
    title: p.title,
    type: p.type,
    status: r.status,
    reason: r.reason,
    urgency: r.urgency,
    due: r.due,
    daysUntilDue: r.daysUntilDue,
    idleDays: r.idleDays,
    authorId: p.authorId || null,
    authorName: p.authorName || null,
    editorId: p.editorId || null,
    editorName: p.editorName || null,
    lastTouchedAt: r.lastTouched ? new Date(r.lastTouched).toISOString() : null,
  };
}

// ─── Event feed helpers (unchanged classification) ───────────────────────────

function buildEvents(projects) {
  const events = [];
  for (const project of projects) {
    const acts = Array.isArray(project.activity) ? project.activity : [];
    for (const a of acts) {
      events.push({
        projectId: project.id,
        projectTitle: project.title || "Untitled",
        projectType: project.type || "",
        authorName: a.authorName || "",
        authorId: a.authorId || "",
        text: a.text || "",
        timestamp: a.timestamp || project.updatedAt || project.createdAt || null,
      });
    }
  }
  events.sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
  return events;
}

// Rewrites raw DB activity strings into readable sentences.
// The DB stores things like `uncompleted: Article Writing Complete` or
// `commented: "nice work"`; those read awkwardly in a feed. This function
// turns them into natural phrases that start after the author's name, e.g.
// "unchecked 'Article Writing Complete'" or "left a comment: nice work".
function humanizeEventText(raw) {
  const text = String(raw || "").trim();
  if (!text) return "did something";

  // "completed: Step Name"  →  checked off "Step Name"
  let m = text.match(/^completed:\s*(.+)$/i);
  if (m) return `checked off "${m[1]}"`;

  // "uncompleted: Step Name"  →  unchecked "Step Name"
  m = text.match(/^uncompleted:\s*(.+)$/i);
  if (m) return `unchecked "${m[1]}"`;

  // "marked ... complete/incomplete" — leave mostly as-is but trim prefix
  m = text.match(/^marked\s+(.+)$/i);
  if (m) return `marked ${m[1]}`;

  // "commented: "hello""  →  left a comment: "hello"
  m = text.match(/^commented:\s*"?(.*?)"?\s*$/i);
  if (m && m[1]) return `left a comment: "${m[1]}"`;

  // Generic "submitted this proposal", "approved the proposal", etc. read fine.
  return text;
}

function classifyEvent(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("submitted this proposal")) return "proposal";
  if (t.includes("commented")) return "comment";
  if (t.includes("approved")) return "approved";
  if (t.includes("rejected")) return "rejected";
  if (t.includes("marked") || t.includes("complete") || t.includes("incomplete") || t.includes("uncompleted")) return "step";
  if (t.includes("edited")) return "proposal";
  return "other";
}

function eventIcon(type) {
  const icons = {
    proposal: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    comment:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    approved: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    rejected: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    step:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
    other:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };
  return icons[type] || icons.other;
}

function eventColor(type) {
  return ({
    proposal: "var(--accent)",
    comment:  "var(--ink-3)",
    approved: "var(--success)",
    rejected: "var(--danger)",
    step:     "var(--info, #3b82f6)",
    other:    "var(--muted)",
  })[type] || "var(--muted)";
}

// ─── Project interpreters ────────────────────────────────────────────────────

function projectLastTouched(project) {
  const candidates = [project.lastActivity, project.updatedAt, project.createdAt];
  for (const a of project.activity || []) candidates.push(a.timestamp);
  let latest = 0;
  for (const c of candidates) { const ms = toMs(c); if (ms > latest) latest = ms; }
  return latest || null;
}

function pubDeadline(project) {
  return (project.deadlines?.publication) || project.deadline || null;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return Math.ceil((d - Date.now()) / 86400000);
}

// Summarize what stage a project is in, in plain English.
// (Mirrors pipeline.js's getProjectState but boiled down — we don't need
// the kanban column name here.)
function humanStatus(project) {
  const tl = project.timeline || {};
  if (tl[FINAL_STEP]) return "Completed";
  if (project.proposalStatus === "rejected") return "Proposal rejected";
  if (project.proposalStatus !== "approved") return "Awaiting proposal approval";
  if (project.type === "Interview" && !tl["Interview Complete"]) {
    return tl["Interview Scheduled"] ? "Interview scheduled" : "Needs interview scheduled";
  }
  if (!tl["Article Writing Complete"]) return "Writing in progress";
  if (!project.editorId) return "Awaiting editor assignment";
  if (!tl["Review Complete"]) return "Under editorial review";
  if (!tl["Suggestions Reviewed"]) return "Author reviewing feedback";
  return "In progress";
}

// ─── Sort helpers ────────────────────────────────────────────────────────────

function projectUrgency(proj) {
  if (proj.isOverdue) return 1000 + Math.abs(proj.daysUntilDue || 0);
  if (proj.isDueSoon) return 500 - (proj.daysUntilDue || 0);
  if (proj.idleDays !== null && proj.idleDays >= IDLE_STALE_DAYS) return 200 + proj.idleDays;
  if (proj.idleDays !== null && proj.idleDays >= IDLE_WARNING_DAYS) return 100 + proj.idleDays;
  return 0;
}

function personAttentionLabel(p) {
  if (p.overdueCount > 0) return `${p.overdueCount} overdue`;
  if (p.activeProjects.length && p.maxIdleDays >= IDLE_STALE_DAYS) return `Stalled ${p.maxIdleDays}d`;
  if (p.activeProjects.length && p.maxIdleDays >= IDLE_WARNING_DAYS) return `Idle ${p.maxIdleDays}d`;
  if (p.dueSoonCount > 0) return `${p.dueSoonCount} due soon`;
  return "";
}

function personAttentionClass(p) {
  if (p.overdueCount > 0) return "act-pill-danger";
  if (p.activeProjects.length && p.maxIdleDays >= IDLE_STALE_DAYS) return "act-pill-danger";
  if (p.activeProjects.length && p.maxIdleDays >= IDLE_WARNING_DAYS) return "act-pill-warn";
  if (p.dueSoonCount > 0) return "act-pill-warn";
  return "act-pill-muted";
}

// ─── Misc helpers ────────────────────────────────────────────────────────────

function roleLabel(role) {
  return ({
    admin: "Admin",
    editor: "Editor",
    writer: "Writer",
    newsletter_builder: "Newsletter",
    marketing: "Marketing",
  })[role] || role || "";
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v === "object" && v.seconds) return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function dayOf(v) {
  const ms = toMs(v);
  if (!ms) return "Unknown date";
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function fmtRelative(v) {
  const ms = toMs(v);
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function stringToColor(str) {
  if (!str) return "#64748b";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 60%, 48%)`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function ensureStyles() {
  if (document.getElementById("activity-styles")) return;
  const s = document.createElement("style");
  s.id = "activity-styles";
  s.textContent = `
    .act-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px; }
    .act-kpi { background:#f8fafc; border:1px solid #e5e7eb; border-radius:10px; padding:14px 16px; }
    .act-kpi-num { font-size:24px; font-weight:800; color:#0b1220; line-height:1; }
    .act-kpi-label { font-size:11px; font-weight:600; color:#64748b; margin-top:6px; letter-spacing:.03em; }
    .act-kpi-danger { border-color:#fecaca; background:#fef2f2; }
    .act-kpi-danger .act-kpi-num { color:#b91c1c; }
    .act-kpi-warn { border-color:#fde68a; background:#fffbeb; }
    .act-kpi-warn .act-kpi-num { color:#b45309; }

    .act-people { display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:14px; }
    .act-person { border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.04); display:flex; flex-direction:column; gap:12px; }
    .act-person-head { display:flex; align-items:flex-start; gap:12px; }
    .act-avatar { width:38px; height:38px; border-radius:50%; color:#fff; font-size:14px; font-weight:700;
      display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .act-person-id { flex:1; min-width:0; }
    .act-person-name { font-size:14px; font-weight:700; color:#0b1220; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .act-role-chip { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em;
      padding:2px 6px; border-radius:4px; background:#f1f5f9; color:#475569; }
    .act-person-sub { font-size:12px; color:#64748b; display:block; margin-top:2px; }
    .act-person-right { flex-shrink:0; }
    .act-pill { display:inline-block; font-size:11px; font-weight:700; padding:3px 9px; border-radius:999px;
      text-transform:uppercase; letter-spacing:.04em; }
    .act-pill-danger { background:#fee2e2; color:#b91c1c; }
    .act-pill-warn { background:#fef3c7; color:#92400e; }
    .act-pill-muted { background:#f1f5f9; color:#64748b; }
    .act-pill-ok { background:#dcfce7; color:#15803d; }

    .act-person-stats { display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; padding:10px 0; border-top:1px solid #f1f5f9; border-bottom:1px solid #f1f5f9; }
    .act-person-stats > div { text-align:center; }
    .act-stat-num { display:block; font-size:18px; font-weight:800; color:#0b1220; line-height:1; }
    .act-stat-label { display:block; font-size:10px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; margin-top:4px; }
    .act-stat-num.act-danger { color:#b91c1c; }
    .act-stat-num.act-warn { color:#b45309; }

    .act-person-projects { display:flex; flex-direction:column; gap:8px; }
    .act-proj { padding:8px 10px; background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px; }
    .act-proj-title { font-size:13px; font-weight:600; color:#0b1220; display:flex; align-items:center; gap:8px; }
    .act-proj-role { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em;
      color:#0f766e; background:#ccfbf1; padding:2px 6px; border-radius:4px; }
    .act-proj-link { color:inherit; text-decoration:none; }
    .act-proj-link:hover { text-decoration:underline; }
    .act-proj-meta { font-size:11px; color:#64748b; margin-top:4px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
    .act-proj-due { font-weight:600; }
    .act-muted { color:#94a3b8; }
    .act-danger { color:#b91c1c; }
    .act-warn { color:#b45309; }

    .act-risks { display:flex; flex-direction:column; gap:8px; }
    .act-risk-row { display:flex; align-items:center; justify-content:space-between; gap:16px;
      padding:12px 14px; background:#fff; border:1px solid #e5e7eb; border-radius:10px; }
    .act-risk-main { min-width:0; flex:1; }
    .act-risk-title { font-size:13.5px; font-weight:700; color:#0b1220; }
    .act-risk-meta { font-size:12px; color:#64748b; margin-top:4px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
    .act-risk-right { display:flex; align-items:flex-end; flex-direction:column; gap:4px; flex-shrink:0; }
    .act-risk-when { font-size:11px; color:#94a3b8; }

    /* Live feed rows — overrides the generic .activity-row-full for this page. */
    .act-feed-row {
      display:flex; align-items:flex-start; gap:12px;
      padding:12px 14px; background:#fff;
      border:1px solid #e5e7eb; border-radius:10px;
      transition:border-color .12s, box-shadow .12s;
    }
    .act-feed-row:hover { border-color:#cbd5e1; box-shadow:0 1px 3px rgba(15,23,42,.06); }
    .act-feed-icon {
      flex-shrink:0; width:28px; height:28px; border-radius:50%;
      background:#f8fafc; border:1px solid currentColor;
      display:flex; align-items:center; justify-content:center;
    }
    .act-feed-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
    .act-feed-sentence { font-size:13.5px; line-height:1.45; color:#1f2937; }
    .act-feed-author { font-weight:700; color:#0b1220; }
    .act-feed-text { color:#374151; margin-left:4px; }
    .act-feed-meta {
      display:flex; align-items:center; gap:8px; flex-wrap:wrap;
      font-size:11.5px; color:#64748b;
    }
    .act-feed-project {
      font-weight:600; color:#0f766e; max-width:340px;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .act-feed-dot { color:#cbd5e1; }
    .act-feed-when { color:#94a3b8; white-space:nowrap; }
  `;
  document.head.appendChild(s);
}
