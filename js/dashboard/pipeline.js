/**
 * Workflow Pipeline — full recreation of the CatalystMonday scheduler.
 *
 * Views:
 *   mount(ctx, container)  →  renders the full pipeline page
 *     ctx.mountKey: "interviews" | "opeds" | "mine" | undefined (defaults "interviews")
 *
 * Data lives in the catalystmonday Firestore project (workflowDb).
 * Collections: projects, users (editors), tasks
 */

import { workflowDb } from "../firebase-dual-config.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  arrayUnion,
  serverTimestamp,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, openModal, toast, fmtDate, confirmDialog } from "./ui.js";

// ─── Workflow state machine (mirrors CatalystSchedule stateManager.js) ────────

const COL = {
  TOPIC_PROPOSAL:        "Topic Proposal",
  INTERVIEW_STAGE:       "Interview Stage",
  WRITING_STAGE:         "Writing Stage",
  IN_REVIEW:             "In Review",
  REVIEWING_SUGGESTIONS: "Reviewing Suggestions",
  COMPLETED:             "Completed",
  // My-assignments columns
  TODO:        "To Do",
  IN_PROGRESS: "In Progress",
  MY_REVIEW:   "In Review",
  DONE:        "Done",
};

const VIEW_COLUMNS = {
  interviews: [COL.TOPIC_PROPOSAL, COL.INTERVIEW_STAGE, COL.WRITING_STAGE, COL.IN_REVIEW, COL.REVIEWING_SUGGESTIONS, COL.COMPLETED],
  opeds:      [COL.TOPIC_PROPOSAL, COL.WRITING_STAGE, COL.IN_REVIEW, COL.REVIEWING_SUGGESTIONS, COL.COMPLETED],
  mine:       [COL.TODO, COL.IN_PROGRESS, COL.MY_REVIEW, COL.DONE],
};

const TIMELINE_STEPS = [
  "Topic Proposal Complete",
  "Interview Scheduled",
  "Interview Complete",
  "Article Writing Complete",
  "Review Complete",
  "Suggestions Reviewed",
];

const DEADLINE_FIELDS = [
  { key: "contact",   label: "Contact Professor" },
  { key: "interview", label: "Conduct Interview" },
  { key: "draft",     label: "Write Draft" },
  { key: "review",    label: "Editor Review" },
  { key: "edits",     label: "Review Edits" },
];

function getProjectState(project, view, uid) {
  const tl = project.timeline || {};

  if (tl["Suggestions Reviewed"]) {
    return view === "mine"
      ? { column: COL.DONE,      color: "green",   status: "Article Completed" }
      : { column: COL.COMPLETED, color: "green",   status: "Article Completed" };
  }

  if (view === "mine") {
    const isAuthor = project.authorId === uid;
    const isEditor = project.editorId === uid;
    if (isEditor) {
      if (tl["Article Writing Complete"] && !tl["Review Complete"])
        return { column: COL.IN_PROGRESS, color: "yellow", status: "Reviewing Article" };
      if (tl["Review Complete"])
        return { column: COL.DONE, color: "default", status: "Review Complete" };
      return { column: COL.TODO, color: "default", status: "Waiting for Article" };
    }
    if (isAuthor) {
      if (tl["Review Complete"] && !tl["Suggestions Reviewed"])
        return { column: COL.MY_REVIEW, color: "blue", status: "Review Editor Feedback" };
      if (project.proposalStatus === "approved") {
        if (project.type === "Interview" && !tl["Interview Complete"]) {
          return tl["Interview Scheduled"]
            ? { column: COL.IN_PROGRESS, color: "yellow", status: "Conduct Interview" }
            : { column: COL.TODO,        color: "default", status: "Schedule Interview" };
        }
        if (!tl["Article Writing Complete"])
          return { column: COL.IN_PROGRESS, color: "yellow", status: "Writing Article" };
        if (!project.editorId)
          return { column: COL.IN_PROGRESS, color: "yellow", status: "Awaiting Editor Assignment" };
        if (!tl["Review Complete"])
          return { column: COL.MY_REVIEW, color: "default", status: "Under Review" };
      }
      return { column: COL.TODO, color: "default", status: `Proposal: ${project.proposalStatus || "pending"}` };
    }
    return { column: COL.TODO, color: "default", status: "Pending" };
  }

  // Main views
  if (project.proposalStatus !== "approved") {
    const color = project.proposalStatus === "rejected" ? "red" : "default";
    return { column: COL.TOPIC_PROPOSAL, color, status: `Proposal ${project.proposalStatus || "pending"}` };
  }
  if (project.type === "Interview" && !tl["Interview Complete"]) {
    return tl["Interview Scheduled"]
      ? { column: COL.INTERVIEW_STAGE, color: "yellow", status: "Interview Scheduled" }
      : { column: COL.INTERVIEW_STAGE, color: "default", status: "Schedule Interview" };
  }
  if (!tl["Article Writing Complete"])
    return { column: COL.WRITING_STAGE, color: "yellow", status: "Writing in Progress" };
  if (!project.editorId)
    return { column: COL.WRITING_STAGE, color: "yellow", status: "Awaiting Editor Assignment" };
  if (!tl["Review Complete"])
    return { column: COL.IN_REVIEW, color: "yellow", status: "Under Review" };
  if (!tl["Suggestions Reviewed"])
    return { column: COL.REVIEWING_SUGGESTIONS, color: "blue", status: "Author Reviewing Feedback" };

  return { column: COL.TOPIC_PROPOSAL, color: "default", status: "Pending" };
}

function calcProgress(timeline) {
  if (!timeline) return 0;
  const vals = Object.values(timeline);
  if (!vals.length) return 0;
  return Math.round((vals.filter(Boolean).length / vals.length) * 100);
}

function pubDeadline(project) {
  return (project.deadlines?.publication) || project.deadline || null;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return Math.ceil((d - Date.now()) / 86400000);
}

function fmtShort(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v === "object" && v.seconds) return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function daysInactive(project) {
  const candidates = [project.lastActivity, ...(project.activity || []).map(a => a.timestamp), project.updatedAt, project.createdAt];
  let latest = 0;
  for (const c of candidates) { const ms = toMs(c); if (ms > latest) latest = ms; }
  if (!latest) return 0;
  return Math.floor((Date.now() - latest) / 86400000);
}

function stringToColor(str) {
  if (!str) return "#64748b";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 65%, 50%)`;
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _allProjects = [];
let _allEditors  = [];
let _allUsers    = [];
let _view        = "interviews"; // "interviews" | "opeds" | "mine"
let _uid         = null;
let _role        = null;
let _profile     = null;
let _ctx         = null;

// ─── Mount ────────────────────────────────────────────────────────────────────

export async function mount(ctx, container) {
  _ctx     = ctx;
  _uid     = ctx.user.uid;
  _role    = ctx.role;
  _profile = ctx.profile;
  _view    = ctx.mountKey || "interviews";

  container.innerHTML = "";

  // Header bar
  const header = el("div", { class: "pipeline-page-header" });
  header.innerHTML = `
    <div>
      <div class="card-title">${_view === "mine" ? "My Assignments" : _view === "opeds" ? "Op-Eds" : "Catalyst in the Capital"}</div>
      <div class="card-subtitle">${_view === "mine" ? "All your active projects and tasks." : "Every story moves left-to-right through the editorial lifecycle."}</div>
    </div>
    <div class="pipeline-header-actions">
      ${_view !== "mine" && canPropose() ? `<button class="btn btn-accent btn-sm" id="pl-new-btn">+ New proposal</button>` : ""}
      ${_role === "admin" ? `<button class="btn btn-secondary btn-sm" id="pl-report-btn">Status report</button>` : ""}
    </div>`;
  container.appendChild(header);

  const scrollWrap = el("div", { class: "kanban-scroll-wrap", style: {
    width: "100%", overflowX: "auto", overflowY: "visible",
    WebkitOverflowScrolling: "touch", paddingBottom: "20px",
  }});
  const boardEl = el("div", { class: "kanban-board", id: "pl-board", style: {
    display: "flex", flexDirection: "row", flexWrap: "nowrap",
    gap: "14px", alignItems: "flex-start",
  }});
  scrollWrap.appendChild(boardEl);
  container.appendChild(scrollWrap);

  // Load editors/users once
  await Promise.all([loadEditors(), loadUsers()]);

  // Wire header buttons
  if (canPropose() && _view !== "mine") {
    container.querySelector("#pl-new-btn")?.addEventListener("click", () => openProposalModal());
  }
  if (_role === "admin") {
    container.querySelector("#pl-report-btn")?.addEventListener("click", () => openStatusReport());
  }

  // Live subscription
  const unsub = onSnapshot(collection(workflowDb, "projects"), snap => {
    _allProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBoard();
  }, err => {
    boardEl.innerHTML = `<div class="error-state">Failed to load projects: ${esc(err.message)}</div>`;
  });

  return () => unsub();
}

function canPropose() {
  return ["admin", "editor", "writer"].includes(_role);
}

async function loadEditors() {
  try {
    // editors from the catalystwriters-5ce43 db via ctx.authedFetch isn't reliable
    // so we also load from workflowDb users collection
    const snap = await getDocs(collection(workflowDb, "users"));
    _allEditors = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => ["admin", "editor"].includes(u.role));
    _allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("[pipeline] could not load editors", e);
  }
}

async function loadUsers() {
  // already done in loadEditors for workflowDb, but also pull from primary db
  try {
    const { db } = await import("../firebase-config.js");
    const { getDocs: gd, collection: col } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const snap = await gd(col(db, "users"));
    const primary = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Merge: prefer workflowDb entries but supplement with primary db
    const ids = new Set(_allUsers.map(u => u.id));
    for (const u of primary) if (!ids.has(u.id)) _allUsers.push(u);
    const editorIds = new Set(_allEditors.map(e => e.id));
    for (const u of primary) {
      if (!editorIds.has(u.id) && ["admin", "editor"].includes(u.role)) _allEditors.push(u);
    }
  } catch (e) { /* ignore */ }
}

// ─── Board rendering ──────────────────────────────────────────────────────────

function filterProjects() {
  if (_view === "mine") {
    const mine = _allProjects.filter(p => p.authorId === _uid || p.editorId === _uid);
    if (_role === "admin") {
      const needsEditor = _allProjects.filter(p =>
        p.proposalStatus === "approved" &&
        (p.timeline?.["Article Writing Complete"]) &&
        !p.editorId
      );
      const map = new Map();
      [...mine, ...needsEditor].forEach(p => map.set(p.id, p));
      return [...map.values()];
    }
    return mine;
  }
  const type = _view === "opeds" ? "Op-Ed" : "Interview";
  return _allProjects.filter(p => p.type === type);
}

function renderBoard() {
  const board = document.getElementById("pl-board");
  if (!board) return;
  board.innerHTML = "";

  const projects = filterProjects();
  const columns = VIEW_COLUMNS[_view] || VIEW_COLUMNS.interviews;

  for (const colName of columns) {
    const colProjects = projects.filter(p => getProjectState(p, _view, _uid).column === colName);
    board.appendChild(renderColumn(colName, colProjects));
  }

  // Availability column (interviews/opeds views, admin only)
  if (_view !== "mine" && _role === "admin") {
    board.appendChild(renderAvailabilityColumn());
  }
}

const COL_COLORS = {
  [COL.TOPIC_PROPOSAL]:        "#f59e0b",
  [COL.INTERVIEW_STAGE]:       "#3b82f6",
  [COL.WRITING_STAGE]:         "#8b5cf6",
  [COL.IN_REVIEW]:             "#0891b2",
  [COL.REVIEWING_SUGGESTIONS]: "#f97316",
  [COL.COMPLETED]:             "#10b981",
  [COL.TODO]:                  "#94a3b8",
  [COL.IN_PROGRESS]:           "#8b5cf6",
  [COL.MY_REVIEW]:             "#0891b2",
  [COL.DONE]:                  "#10b981",
};

function renderColumn(name, projects) {
  const color = COL_COLORS[name] || "#94a3b8";
  const colEl = el("div", { class: "kanban-col", style: {
    flex: "0 0 272px", width: "272px", minWidth: "0",
    background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px",
    overflow: "hidden", display: "flex", flexDirection: "column",
    boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
  }});
  colEl.innerHTML = `
    <div class="kanban-col-header" style="border-top:3px solid ${color};padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <span class="kanban-col-title" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1f2937;">${esc(name)}</span>
      <span class="kanban-col-count" style="background:#f1f5f9;color:#64748b;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;">${projects.length}</span>
    </div>
    <div class="kanban-col-body" style="padding:10px;display:flex;flex-direction:column;gap:8px;flex:1;min-height:200px;"></div>`;
  const body = colEl.querySelector(".kanban-col-body");
  if (!projects.length) {
    body.innerHTML = `<div class="kanban-empty">No projects here</div>`;
  } else {
    projects
      .sort((a, b) => dueTime(a) - dueTime(b))
      .forEach(p => body.appendChild(renderCard(p)));
  }
  return colEl;
}

function dueTime(p) {
  const d = pubDeadline(p);
  const t = d ? new Date(d + "T00:00:00").getTime() : NaN;
  return isNaN(t) ? Infinity : t;
}

function renderCard(project) {
  const state = getProjectState(project, _view, _uid);
  const progress = calcProgress(project.timeline);
  const due = pubDeadline(project);
  const days = daysUntil(due);
  const isOverdue = days !== null && days < 0;
  const isDueSoon = days !== null && days >= 0 && days <= 3;
  const inactive = daysInactive(project);
  const isInactive = inactive > 9 && state.column !== COL.COMPLETED && state.column !== COL.DONE;
  const hasDeadlineRequest = (project.deadlineRequest?.status === "pending") || (project.deadlineChangeRequest?.status === "pending");

  const card = el("div", {
    class: `kanban-card state-${state.color}${isInactive ? " card-inactive" : ""}`,
    onclick: () => openDetailModal(project.id),
  });

  const authorInitial = (project.authorName || "?")[0].toUpperCase();

  card.innerHTML = `
    <div class="kanban-card-title">${esc(project.title)}${hasDeadlineRequest ? ' <span class="deadline-req-dot" title="Pending deadline request">⏰</span>' : ""}</div>
    <div class="kanban-card-meta">
      <span class="kc-type">${esc(project.type || "")}</span>
      <span class="kc-status">${esc(state.status)}</span>
      ${isInactive ? `<span class="kc-idle">${inactive}d idle</span>` : ""}
    </div>
    <div class="kc-progress-wrap">
      <div class="kc-progress-bar" style="width:${progress}%"></div>
    </div>
    <div class="kanban-card-footer">
      <div class="kc-author">
        <div class="kc-avatar" style="background:${stringToColor(project.authorName)}">${authorInitial}</div>
        <span>${esc(project.authorName || "")}</span>
      </div>
      <div class="kc-deadline ${isOverdue ? "kc-overdue" : isDueSoon ? "kc-due-soon" : ""}">
        ${due ? fmtShort(due) : "No deadline"}
      </div>
    </div>`;

  return card;
}

function renderAvailabilityColumn() {
  const colEl = el("div", { class: "kanban-col kanban-col-availability", style: {
    flex: "0 0 220px", width: "220px", minWidth: "0",
    background: "#fff", border: "1px solid #e5e7eb", borderRadius: "12px",
    overflow: "hidden", display: "flex", flexDirection: "column",
    boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
  }});
  colEl.innerHTML = `
    <div class="kanban-col-header" style="border-top:3px solid #64748b;padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <span class="kanban-col-title" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1f2937;">Team</span>
      <span class="kanban-col-count" style="background:#f1f5f9;color:#64748b;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;">${_allUsers.length}</span>
    </div>
    <div class="kanban-col-body" style="padding:10px;display:flex;flex-direction:column;gap:8px;flex:1;min-height:200px;overflow-y:auto;"></div>`;
  const body = colEl.querySelector(".kanban-col-body");
  const writers = _allUsers.filter(u => ["writer", "editor", "admin"].includes(u.role));
  if (!writers.length) {
    body.innerHTML = `<div class="kanban-empty">No team members loaded</div>`;
  } else {
    for (const u of writers) {
      const activeCount = _allProjects.filter(p => p.authorId === u.id || p.editorId === u.id).length;
      const chip = el("div", { class: "avail-chip" });
      chip.innerHTML = `
        <div class="kc-avatar" style="background:${stringToColor(u.name || u.email)}">${(u.name || u.email || "?")[0].toUpperCase()}</div>
        <div class="avail-info">
          <div class="avail-name">${esc(u.name || u.email)}</div>
          <div class="avail-role">${esc(u.role || "")} · ${activeCount} active</div>
        </div>`;
      body.appendChild(chip);
    }
  }
  return colEl;
}

// ─── Project Detail Modal ─────────────────────────────────────────────────────

function openDetailModal(projectId) {
  const project = _allProjects.find(p => p.id === projectId);
  if (!project) return toast("Project not found.", "error");

  const isAdmin  = _role === "admin";
  const isAuthor = project.authorId === _uid;
  const isEditor = project.editorId === _uid;
  const canEdit  = isAdmin || isAuthor;
  const state    = getProjectState(project, _view, _uid);
  const tl       = project.timeline || {};
  const deadlines = project.deadlines || {};
  const due       = pubDeadline(project);
  const inactive  = daysInactive(project);
  const isInactive = inactive > 9 && state.column !== COL.COMPLETED && state.column !== COL.DONE;

  // Inactivity banner
  const inactivityBanner = isInactive && (isAdmin || isAuthor)
    ? `<div class="detail-inactive-banner">
        ⚠ Inactive for <strong>${inactive} days</strong> — no recent progress recorded.
       </div>`
    : "";

  // Status badge
  const statusColor = { green: "pill-published", yellow: "pill-reviewing", blue: "pill-pending", red: "pill-rejected", default: "pill-draft" }[state.color] || "pill-draft";

  // Timeline checklist
  const stepsHtml = TIMELINE_STEPS.map(step => {
    const checked = !!tl[step];
    return `<label class="tl-row ${isAdmin ? "tl-editable" : ""}">
      <input type="checkbox" data-step="${esc(step)}" ${checked ? "checked" : ""} ${isAdmin ? "" : "disabled"}>
      <span>${esc(step)}</span>
    </label>`;
  }).join("");

  // Deadlines section
  const deadlineRows = DEADLINE_FIELDS
    .filter(f => !(project.type === "Op-Ed" && (f.key === "contact" || f.key === "interview")))
    .map(f => `
      <div class="dl-row">
        <label class="dl-label">${esc(f.label)}</label>
        <input type="date" class="input dl-input" data-dlkey="${esc(f.key)}" value="${esc(deadlines[f.key] || "")}" ${isAdmin ? "" : "disabled"}>
      </div>`).join("");

  const pubDeadlineHtml = `
    <div class="dl-row">
      <label class="dl-label"><strong>Publication date</strong></label>
      <input type="date" class="input dl-input" data-dlkey="publication" value="${esc(deadlines.publication || project.deadline || "")}" ${isAdmin ? "" : "disabled"}>
    </div>`;

  // Deadline change request
  const hasRequest = project.deadlineRequest?.status === "pending" || project.deadlineChangeRequest?.status === "pending";
  const req = project.deadlineRequest || project.deadlineChangeRequest;
  const deadlineRequestHtml = hasRequest ? `
    <div class="dl-request-box">
      <strong>Pending deadline request</strong>
      <p>By: ${esc(req.requestedBy || "")}</p>
      <p>Reason: ${esc(req.reason || "")}</p>
      ${isAdmin ? `
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn btn-accent btn-xs" id="dl-approve-req">Approve</button>
          <button class="btn btn-secondary btn-xs" id="dl-reject-req" style="color:var(--danger)">Reject</button>
        </div>` : `<p style="color:var(--warn)">Awaiting admin approval…</p>`}
    </div>` : "";

  // Activity feed
  const acts = [...(project.activity || [])].reverse();
  const actHtml = acts.length
    ? acts.map(a => `
        <div class="act-row">
          <span class="act-author">${esc(a.authorName || "Someone")}</span>
          <span class="act-text"> ${esc(a.text || "")}</span>
          <span class="act-when"> · ${a.timestamp ? fmtActivityTime(a.timestamp) : ""}</span>
        </div>`).join("")
    : `<div class="act-row" style="color:var(--muted)">No activity yet.</div>`;

  // Editor assignment dropdown
  const editorOptions = _allEditors.map(e =>
    `<option value="${esc(e.id)}" ${e.id === project.editorId ? "selected" : ""}>${esc(e.name || e.email)}</option>`
  ).join("");

  const body = el("div", { class: "detail-modal-body" });
  body.innerHTML = `
    ${inactivityBanner}
    <div class="detail-top-row">
      <span class="pill ${statusColor}">${esc(state.status)}</span>
      <span class="pill pill-draft">${esc(project.type || "Article")}</span>
    </div>
    <div class="detail-meta-row">
      <span>Author: <strong>${esc(project.authorName || "—")}</strong></span>
      <span>Editor: <strong>${esc(project.editorName || "Not assigned")}</strong></span>
      ${due ? `<span>Due: <strong>${fmtDate(due + "T00:00:00")}</strong></span>` : ""}
    </div>

    ${project.proposal ? `
    <div class="detail-section">
      <div class="detail-section-title">Pitch / proposal
        ${canEdit ? `<button class="btn btn-ghost btn-xs" id="edit-proposal-btn">Edit</button>` : ""}
      </div>
      <div class="detail-proposal-text" id="proposal-display">${esc(project.proposal)}</div>
    </div>` : canEdit ? `
    <div class="detail-section">
      <div class="detail-section-title">Pitch / proposal
        <button class="btn btn-ghost btn-xs" id="edit-proposal-btn">Add</button>
      </div>
    </div>` : ""}

    <div class="detail-section">
      <div class="detail-section-title">Progress checklist</div>
      <div class="tl-steps" id="tl-steps">${stepsHtml}</div>
    </div>

    ${isAdmin ? `
    <div class="detail-section">
      <div class="detail-section-title">Assign editor</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <select class="select" id="editor-select" style="flex:1;">
          <option value="">— Choose editor —</option>
          ${editorOptions}
        </select>
        <button class="btn btn-accent btn-sm" id="assign-editor-btn">${project.editorId ? "Reassign" : "Assign"}</button>
      </div>
    </div>` : ""}

    <div class="detail-section">
      <div class="detail-section-title">
        Deadlines
        ${isAdmin ? `<button class="btn btn-accent btn-xs" id="save-deadlines-btn">Save deadlines</button>` : ""}
        ${(isAuthor || isEditor) && !hasRequest ? `<button class="btn btn-ghost btn-xs" id="req-deadline-btn">Request change</button>` : ""}
      </div>
      ${pubDeadlineHtml}
      ${deadlineRows}
      ${deadlineRequestHtml}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Comments</div>
      <div style="display:flex;gap:8px;">
        <input class="input" id="comment-input" placeholder="Leave a note…" style="flex:1;">
        <button class="btn btn-secondary btn-sm" id="post-comment-btn">Post</button>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Activity</div>
      <div class="act-feed" id="act-feed">${actHtml}</div>
    </div>`;

  // Footer buttons
  const footerBtns = [];
  if (isAdmin && project.proposalStatus === "pending") {
    const approveBtn = el("button", { class: "btn btn-accent btn-sm" }, "Approve proposal");
    approveBtn.onclick = async () => {
      approveBtn.disabled = true;
      try {
        await updateDoc(doc(workflowDb, "projects", project.id), {
          proposalStatus: "approved",
          "timeline.Topic Proposal Complete": true,
          lastActivity: serverTimestamp(),
          activity: arrayUnion({ text: "approved the proposal", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
          updatedAt: new Date().toISOString(),
        });
        toast("Proposal approved!", "success");
        m.close();
      } catch (e) { toast(e.message, "error"); approveBtn.disabled = false; }
    };
    footerBtns.push(approveBtn);
  }
  if (isAdmin && project.proposalStatus !== "rejected") {
    const rejectBtn = el("button", { class: "btn btn-secondary btn-sm", style: { color: "var(--danger)" } }, "Reject");
    rejectBtn.onclick = async () => {
      const ok = await confirmDialog("Reject this proposal?", { confirmText: "Reject", danger: true });
      if (!ok) return;
      rejectBtn.disabled = true;
      try {
        await updateDoc(doc(workflowDb, "projects", project.id), {
          proposalStatus: "rejected",
          lastActivity: serverTimestamp(),
          activity: arrayUnion({ text: "rejected the proposal", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
          updatedAt: new Date().toISOString(),
        });
        toast("Proposal rejected.", "info"); m.close();
      } catch (e) { toast(e.message, "error"); rejectBtn.disabled = false; }
    };
    footerBtns.push(rejectBtn);
  }
  if (isAdmin || isAuthor) {
    const delBtn = el("button", { class: "btn btn-ghost btn-xs", style: { color: "var(--danger)", marginRight: "auto" } }, "Delete project");
    delBtn.onclick = async () => {
      const ok = await confirmDialog(`Permanently delete "${project.title}"? This cannot be undone.`, { confirmText: "Delete", danger: true });
      if (!ok) return;
      try {
        await deleteDoc(doc(workflowDb, "projects", project.id));
        toast("Project deleted.", "success"); m.close();
      } catch (e) { toast(e.message, "error"); }
    };
    footerBtns.unshift(delBtn);
  }
  const closeBtn = el("button", { class: "btn btn-secondary btn-sm" }, "Close");
  footerBtns.push(closeBtn);

  const m = openModal({ title: esc(project.title), body, footer: footerBtns });
  closeBtn.onclick = m.close;

  // ── Wire interactions ──────────────────────────────────────────────────────

  // Timeline checkboxes
  if (isAdmin) {
    body.querySelector("#tl-steps")?.addEventListener("change", async e => {
      const cb = e.target.closest("input[type=checkbox][data-step]");
      if (!cb) return;
      const step = cb.dataset.step;
      const checked = cb.checked;
      const updates = {
        [`timeline.${step}`]: checked,
        lastActivity: serverTimestamp(),
        updatedAt: new Date().toISOString(),
        activity: arrayUnion({ text: `marked "${step}" as ${checked ? "complete" : "incomplete"}`, authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
      };
      // Auto-approve on "Topic Proposal Complete" check
      if (step === "Topic Proposal Complete" && checked) updates.proposalStatus = "approved";
      if (step === "Topic Proposal Complete" && !checked) updates.proposalStatus = "pending";
      try {
        await updateDoc(doc(workflowDb, "projects", project.id), updates);
        toast(checked ? "Step marked complete." : "Step unchecked.", "success");
      } catch (e) { toast(e.message, "error"); cb.checked = !checked; }
    });
  }

  // Assign editor
  body.querySelector("#assign-editor-btn")?.addEventListener("click", async () => {
    const sel = body.querySelector("#editor-select");
    const editorId = sel?.value;
    if (!editorId) return toast("Select an editor first.", "error");
    const editor = _allEditors.find(e => e.id === editorId);
    const prevName = project.editorName;
    const btn = body.querySelector("#assign-editor-btn");
    btn.disabled = true;
    try {
      await updateDoc(doc(workflowDb, "projects", project.id), {
        editorId,
        editorName: editor?.name || editor?.email || "Editor",
        updatedAt: new Date().toISOString(),
        lastActivity: serverTimestamp(),
        activity: arrayUnion({
          text: prevName ? `reassigned editor from ${prevName} to ${editor?.name}` : `assigned ${editor?.name} as editor`,
          authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString(),
        }),
      });
      toast("Editor assigned!", "success"); m.close();
    } catch (e) { toast(e.message, "error"); btn.disabled = false; }
  });

  // Save deadlines
  body.querySelector("#save-deadlines-btn")?.addEventListener("click", async () => {
    const inputs = body.querySelectorAll(".dl-input");
    const patch = {};
    inputs.forEach(inp => { if (inp.dataset.dlkey) patch[`deadlines.${inp.dataset.dlkey}`] = inp.value || null; });
    patch.updatedAt = new Date().toISOString();
    patch.lastActivity = serverTimestamp();
    patch.activity = arrayUnion({ text: "updated deadlines", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() });
    const btn = body.querySelector("#save-deadlines-btn");
    btn.disabled = true;
    try {
      await updateDoc(doc(workflowDb, "projects", project.id), patch);
      toast("Deadlines saved.", "success"); m.close();
    } catch (e) { toast(e.message, "error"); btn.disabled = false; }
  });

  // Request deadline change
  body.querySelector("#req-deadline-btn")?.addEventListener("click", () => openDeadlineRequestModal(project, m));

  // Deadline request approve/reject
  body.querySelector("#dl-approve-req")?.addEventListener("click", async () => {
    const updates = { "deadlineRequest.status": "approved", "deadlineChangeRequest.status": "approved", updatedAt: new Date().toISOString() };
    if (req?.requestedDate) updates["deadlines.publication"] = req.requestedDate;
    if (req?.requestedDeadlines) Object.entries(req.requestedDeadlines).forEach(([k, v]) => { updates[`deadlines.${k}`] = v; });
    updates.activity = arrayUnion({ text: "approved the deadline change request", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() });
    try { await updateDoc(doc(workflowDb, "projects", project.id), updates); toast("Request approved.", "success"); m.close(); }
    catch (e) { toast(e.message, "error"); }
  });

  body.querySelector("#dl-reject-req")?.addEventListener("click", async () => {
    const updates = { "deadlineRequest.status": "rejected", "deadlineChangeRequest.status": "rejected", updatedAt: new Date().toISOString() };
    updates.activity = arrayUnion({ text: "rejected the deadline change request", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() });
    try { await updateDoc(doc(workflowDb, "projects", project.id), updates); toast("Request rejected.", "info"); m.close(); }
    catch (e) { toast(e.message, "error"); }
  });

  // Edit proposal
  body.querySelector("#edit-proposal-btn")?.addEventListener("click", () => {
    m.close();
    openProposalModal(project);
  });

  // Post comment
  const commentInput = body.querySelector("#comment-input");
  const postComment = async () => {
    const text = commentInput?.value.trim();
    if (!text) return;
    const btn = body.querySelector("#post-comment-btn");
    btn.disabled = true;
    try {
      await updateDoc(doc(workflowDb, "projects", project.id), {
        lastActivity: serverTimestamp(),
        activity: arrayUnion({ text: `commented: "${text}"`, authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
        updatedAt: new Date().toISOString(),
      });
      // Optimistic feed update
      const feed = body.querySelector("#act-feed");
      const row = el("div", { class: "act-row" });
      row.innerHTML = `<span class="act-author">${esc(_profile.name || _ctx.user.email)}</span> <span class="act-text">commented: "${esc(text)}"</span> <span class="act-when"> · just now</span>`;
      feed.insertBefore(row, feed.firstChild);
      commentInput.value = "";
      toast("Comment posted.", "success");
    } catch (e) { toast(e.message, "error"); }
    btn.disabled = false;
  };
  body.querySelector("#post-comment-btn")?.addEventListener("click", postComment);
  commentInput?.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postComment(); } });
}

// ─── Proposal creation / edit modal ──────────────────────────────────────────

function openProposalModal(existing) {
  const isEdit = !!existing;
  const p = existing || {};

  const body = el("div", {});
  body.innerHTML = `
    <div class="field">
      <label class="label">Title <span style="color:var(--danger)">*</span></label>
      <input class="input" id="pm-title" placeholder="Article or project title" value="${esc(p.title || "")}">
    </div>
    <div class="grid grid-2">
      <div class="field">
        <label class="label">Type</label>
        <select class="select" id="pm-type">
          <option value="Interview" ${(p.type || "Interview") === "Interview" ? "selected" : ""}>Interview</option>
          <option value="Op-Ed" ${p.type === "Op-Ed" ? "selected" : ""}>Op-Ed</option>
        </select>
      </div>
      <div class="field">
        <label class="label">Publication deadline <span style="color:var(--danger)">*</span></label>
        <input class="input" id="pm-deadline" type="date" value="${esc(p.deadlines?.publication || p.deadline || "")}">
      </div>
    </div>
    <div class="field">
      <label class="label">Pitch / proposal <span style="color:var(--danger)">*</span></label>
      <textarea class="textarea" id="pm-proposal" rows="5" placeholder="Describe the story idea, angle, and why it matters…">${esc(p.proposal || "")}</textarea>
    </div>
    <div id="pm-err" style="color:var(--danger);font-size:12px;margin-top:4px;"></div>`;

  const saveBtn = el("button", { class: "btn btn-accent" }, isEdit ? "Save changes" : "Submit proposal");
  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const m = openModal({ title: isEdit ? "Edit proposal" : "New story proposal", body, footer: [cancelBtn, saveBtn] });
  cancelBtn.onclick = m.close;

  saveBtn.onclick = async () => {
    const err = body.querySelector("#pm-err");
    err.textContent = "";
    const title    = body.querySelector("#pm-title").value.trim();
    const type     = body.querySelector("#pm-type").value;
    const deadline = body.querySelector("#pm-deadline").value;
    const proposal = body.querySelector("#pm-proposal").value.trim();

    if (title.length < 3)  { err.textContent = "Title must be at least 3 characters."; return; }
    if (!deadline)          { err.textContent = "Publication deadline is required."; return; }
    if (!proposal)          { err.textContent = "A pitch description is required."; return; }
    const dlDate = new Date(deadline);
    if (dlDate < new Date(new Date().toDateString())) { err.textContent = "Deadline must be in the future."; return; }

    saveBtn.disabled = true; saveBtn.textContent = isEdit ? "Saving…" : "Submitting…";

    const patch = {
      title, type,
      "deadlines.publication": deadline,
      deadline,
      proposal,
      updatedAt: new Date().toISOString(),
    };

    try {
      if (isEdit) {
        await updateDoc(doc(workflowDb, "projects", p.id), {
          ...patch,
          lastActivity: serverTimestamp(),
          activity: arrayUnion({ text: "edited the proposal", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
        });
        toast("Proposal updated.", "success");
      } else {
        await addDoc(collection(workflowDb, "projects"), {
          ...patch,
          authorId: _uid,
          authorName: _profile.name || _ctx.user.email,
          proposalStatus: "pending",
          timeline: {},
          deadlines: { publication: deadline },
          activity: [{ text: "submitted this proposal", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }],
          createdAt: new Date().toISOString(),
          lastActivity: serverTimestamp(),
        });
        toast("Proposal submitted! An admin will review it.", "success", 4000);
      }
      m.close();
    } catch (e) {
      err.textContent = e.message;
      saveBtn.disabled = false; saveBtn.textContent = isEdit ? "Save changes" : "Submit proposal";
    }
  };
}

// ─── Deadline change request modal ───────────────────────────────────────────

function openDeadlineRequestModal(project, parentModal) {
  parentModal?.close();
  const deadlines = project.deadlines || {};

  const fields = DEADLINE_FIELDS
    .filter(f => !(project.type === "Op-Ed" && (f.key === "contact" || f.key === "interview")))
    .map(f => `
      <div class="field">
        <label class="label">${esc(f.label)}</label>
        <input class="input" type="date" data-dlkey="${esc(f.key)}" value="${esc(deadlines[f.key] || "")}">
      </div>`).join("");

  const body = el("div", {});
  body.innerHTML = `
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">Request new deadline dates. An admin must approve before they take effect.</p>
    <div class="field">
      <label class="label">Publication deadline</label>
      <input class="input" type="date" data-dlkey="publication" value="${esc(deadlines.publication || project.deadline || "")}">
    </div>
    ${fields}
    <div class="field">
      <label class="label">Reason <span style="color:var(--danger)">*</span></label>
      <textarea class="textarea" id="dlreq-reason" rows="3" placeholder="Explain why you need more time…"></textarea>
    </div>
    <div id="dlreq-err" style="color:var(--danger);font-size:12px;"></div>`;

  const submitBtn = el("button", { class: "btn btn-accent" }, "Submit request");
  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const m = openModal({ title: "Request deadline change", body, footer: [cancelBtn, submitBtn] });
  cancelBtn.onclick = m.close;

  submitBtn.onclick = async () => {
    const reason = body.querySelector("#dlreq-reason").value.trim();
    const errEl  = body.querySelector("#dlreq-err");
    errEl.textContent = "";
    if (!reason) { errEl.textContent = "Please explain the reason for the request."; return; }
    const requested = {};
    body.querySelectorAll("input[data-dlkey]").forEach(inp => { if (inp.value) requested[inp.dataset.dlkey] = inp.value; });
    submitBtn.disabled = true;
    try {
      await updateDoc(doc(workflowDb, "projects", project.id), {
        deadlineChangeRequest: { requestedBy: _profile.name || _ctx.user.email, reason, requestedDeadlines: requested, status: "pending", requestedAt: new Date().toISOString() },
        lastActivity: serverTimestamp(),
        updatedAt: new Date().toISOString(),
        activity: arrayUnion({ text: "requested a deadline change", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
      });
      toast("Request submitted — awaiting admin approval.", "success", 4000);
      m.close();
    } catch (e) { errEl.textContent = e.message; submitBtn.disabled = false; }
  };
}

// ─── Status report modal ──────────────────────────────────────────────────────

function openStatusReport() {
  const total     = _allProjects.length;
  const completed = _allProjects.filter(p => p.timeline?.["Suggestions Reviewed"]).length;
  const inProg    = _allProjects.filter(p => {
    const tl = p.timeline || {};
    return p.proposalStatus === "approved" && !tl["Suggestions Reviewed"];
  }).length;
  const overdue = _allProjects.filter(p => {
    const due = pubDeadline(p);
    return due && daysUntil(due) !== null && daysUntil(due) < 0 && !p.timeline?.["Suggestions Reviewed"];
  }).length;
  const pending = _allProjects.filter(p => p.proposalStatus === "pending").length;

  // Per-person workload
  const people = new Map();
  const track = (uid, name, kind) => {
    if (!uid || !name) return;
    if (!people.has(uid)) people.set(uid, { name, authored: 0, editing: 0, overdue: 0, upcoming: [] });
    const p = people.get(uid);
    if (kind === "authored") p.authored++;
    if (kind === "editing") p.editing++;
    if (kind === "overdue") p.overdue++;
  };
  _allProjects.forEach(p => {
    const due = pubDeadline(p);
    const days = daysUntil(due);
    const isComplete = !!p.timeline?.["Suggestions Reviewed"];
    if (p.authorId) track(p.authorId, p.authorName, "authored");
    if (p.editorId) track(p.editorId, p.editorName, "editing");
    if (!isComplete && days !== null && days < 0) {
      if (p.authorId) track(p.authorId, p.authorName, "overdue");
      if (p.editorId) track(p.editorId, p.editorName, "overdue");
    }
  });

  const personRows = [...people.values()].sort((a, b) => (b.authored + b.editing) - (a.authored + a.editing)).map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${p.authored}</td>
      <td>${p.editing}</td>
      <td>${p.overdue > 0 ? `<span style="color:var(--danger)">${p.overdue} overdue</span>` : "0"}</td>
    </tr>`).join("");

  const body = el("div", {});
  body.innerHTML = `
    <div class="report-stats-grid">
      <div class="report-stat"><div class="report-stat-num">${total}</div><div class="report-stat-label">Total projects</div></div>
      <div class="report-stat"><div class="report-stat-num" style="color:var(--good)">${completed}</div><div class="report-stat-label">Completed</div></div>
      <div class="report-stat"><div class="report-stat-num" style="color:var(--accent)">${inProg}</div><div class="report-stat-label">In progress</div></div>
      <div class="report-stat"><div class="report-stat-num" style="color:var(--danger)">${overdue}</div><div class="report-stat-label">Overdue</div></div>
      <div class="report-stat"><div class="report-stat-num" style="color:var(--warn)">${pending}</div><div class="report-stat-label">Pending approval</div></div>
    </div>
    <h4 style="margin:20px 0 10px;">Team workload</h4>
    <table class="table">
      <thead><tr><th>Name</th><th>Authored</th><th>Editing</th><th>Overdue</th></tr></thead>
      <tbody>${personRows || "<tr><td colspan=4 style='color:var(--muted)'>No data yet.</td></tr>"}</tbody>
    </table>`;

  const closeBtn = el("button", { class: "btn btn-secondary" }, "Close");
  const m = openModal({ title: "Status report", body, footer: [closeBtn] });
  closeBtn.onclick = m.close;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtActivityTime(v) {
  const ms = toMs(v);
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Compact embed for the overview page ─────────────────────────────────────

/**
 * Renders a compact read-only kanban preview into mountEl.
 * Used by overview.js. Returns a cleanup function.
 */
export function renderPipeline(mountEl, ctx, { compact = true } = {}) {
  // Use a minimal temporary context so we can reuse the board logic.
  _ctx     = ctx;
  _uid     = ctx.user?.uid;
  _role    = ctx.role;
  _profile = ctx.profile;
  _view    = "interviews";

  const bodyEl = el("div", { class: "pipeline-embed" });
  mountEl.appendChild(bodyEl);

  const unsub = onSnapshot(
    collection(workflowDb, "projects"),
    snap => {
      _allProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const interviews = _allProjects.filter(p => p.type === "Interview");
      const byCol = {};
      for (const name of VIEW_COLUMNS.interviews) byCol[name] = [];
      for (const p of interviews) {
        const { column } = getProjectState(p, "interviews", _uid);
        if (byCol[column]) byCol[column].push(p);
      }
      bodyEl.innerHTML = "";
      const grid = el("div", { class: "pipeline-embed-grid" });
      for (const name of VIEW_COLUMNS.interviews) {
        const col = byCol[name] || [];
        if (compact && !col.length) continue;
        const colEl = el("div", { class: "pipeline-col" });
        colEl.innerHTML = `
          <div class="pipeline-col-head">
            <span class="pipeline-col-title">${esc(name)}</span>
            <span class="pipeline-col-count">${col.length}</span>
          </div>
          <div class="pipeline-col-body"></div>`;
        const colBody = colEl.querySelector(".pipeline-col-body");
        col.slice(0, 4).forEach(p => {
          const item = el("div", { class: "pipeline-item pipeline-item-clickable" });
          const author = p.authorName || "";
          const due = pubDeadline(p);
          item.innerHTML = `
            <div class="pipeline-item-title">${esc(truncate(p.title || "Untitled", 55))}</div>
            <div class="pipeline-item-meta">${esc([p.type, author && `by ${author}`, due && `due ${fmtShort(due)}`].filter(Boolean).join(" · "))}</div>`;
          item.addEventListener("click", () => openDetailModal(p.id));
          colBody.appendChild(item);
        });
        if (col.length > 4) {
          colBody.appendChild(el("div", { class: "pipeline-item-meta", style: { padding: "4px 8px", color: "var(--muted)" } }, `+${col.length - 4} more…`));
        }
        grid.appendChild(colEl);
      }
      bodyEl.appendChild(grid);
    },
    err => { bodyEl.innerHTML = `<div class="error-state">Pipeline error: ${esc(err.message)}</div>`; }
  );

  return () => unsub();
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
