/**
 * Workflow Pipeline — full recreation of the CatalystMonday scheduler.
 *
 * Views:
 *   mount(ctx, container)  →  renders the full pipeline page
 *     ctx.mountKey: "interviews" | "opeds" | "mine" | undefined (defaults "interviews")
 *
 * Data lives in catalystwriters-5ce43 (primary Firebase project).
 * Collections: projects, users (editors), tasks, settings
 */

import { db as workflowDb } from "../firebase-dual-config.js";
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

// ─── Inject guaranteed styles (once) ─────────────────────────────────────────

function ensureKanbanStyles() {
  if (document.getElementById("kanban-styles")) return;
  const s = document.createElement("style");
  s.id = "kanban-styles";
  s.textContent = `
    .kb-page { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
    .kb-header { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;
      background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px 20px;
      margin-bottom:20px; box-shadow:0 1px 2px rgba(15,23,42,.05); }
    .kb-header-title { font-size:18px; font-weight:800; color:#0b1220; margin:0 0 2px; }
    .kb-header-sub { font-size:13px; color:#64748b; margin:0; }
    .kb-header-actions { display:flex; gap:8px; align-items:center; flex-shrink:0; }
    .kb-scroll { width:100%; overflow-x:auto; overflow-y:visible; -webkit-overflow-scrolling:touch; padding-bottom:20px; }
    .kb-board { display:flex; flex-direction:row; flex-wrap:nowrap; gap:14px; align-items:flex-start; }
    .kb-col { flex:0 0 272px; width:272px; background:#fff; border:1px solid #e5e7eb; border-radius:12px;
      overflow:hidden; display:flex; flex-direction:column; box-shadow:0 1px 3px rgba(15,23,42,.06); }
    .kb-col-head { padding:12px 14px; background:#f8fafc; border-bottom:1px solid #e5e7eb;
      display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .kb-col-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#374151; }
    .kb-col-count { background:#e5e7eb; color:#6b7280; font-size:11px; font-weight:700; padding:2px 8px; border-radius:999px; }
    .kb-col-body { padding:10px; display:flex; flex-direction:column; gap:8px; flex:1; min-height:200px; }
    .kb-empty { font-size:12px; color:#9ca3af; text-align:center; padding:24px 8px; }
    .kb-card { background:#fff; border:1px solid #e5e7eb; border-left:3px solid #94a3b8;
      border-radius:8px; padding:12px 14px; cursor:pointer;
      transition:box-shadow .15s, transform .12s; }
    .kb-card:hover { box-shadow:0 4px 14px rgba(15,118,110,.13); transform:translateY(-2px); }
    .kb-card.s-green  { border-left-color:#15803d; }
    .kb-card.s-yellow { border-left-color:#f59e0b; }
    .kb-card.s-blue   { border-left-color:#3b82f6; }
    .kb-card.s-red    { border-left-color:#b91c1c; }
    .kb-card.s-dim    { opacity:.75; }
    .kb-card-title { font-size:13px; font-weight:600; color:#0b1220; line-height:1.4; margin:0 0 5px; }
    .kb-card-meta { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin:0 0 6px; }
    .kb-badge { font-size:10px; font-weight:700; background:#f1f5f9; color:#64748b;
      padding:2px 6px; border-radius:4px; text-transform:uppercase; letter-spacing:.05em; }
    .kb-badge-idle { background:#fee2e2; color:#b91c1c; }
    .kb-status { font-size:11px; color:#6b7280; }
    .kb-progress { height:3px; background:#e5e7eb; border-radius:99px; margin:6px 0; overflow:hidden; }
    .kb-progress-fill { height:100%; background:linear-gradient(90deg,#14b8a6,#0f766e); border-radius:99px; }
    .kb-card-foot { display:flex; align-items:center; justify-content:space-between; margin-top:6px; gap:8px; }
    .kb-author { display:flex; align-items:center; gap:6px; font-size:12px; color:#6b7280; min-width:0; overflow:hidden; }
    .kb-author span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .kb-avatar { width:22px; height:22px; border-radius:50%; color:#fff; font-size:11px; font-weight:700;
      display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .kb-due { font-size:11px; font-weight:600; color:#94a3b8; white-space:nowrap; }
    .kb-due.overdue { color:#b91c1c; }
    .kb-due.soon { color:#f59e0b; }
    .kb-avail-chip { display:flex; align-items:center; gap:10px; padding:8px 10px;
      border-radius:8px; border:1px solid #e5e7eb; background:#f8fafc; }
    .kb-avail-name { font-size:12px; font-weight:600; color:#1f2937; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .kb-avail-role { font-size:11px; color:#6b7280; }
    .kb-priority { font-size:10px; font-weight:700; padding:2px 7px; border-radius:4px; color:#fff; letter-spacing:.05em; }
    .kb-desc { font-size:12px; color:#6b7280; margin:4px 0 6px; line-height:1.4; }
  `;
  document.head.appendChild(s);
}

// ─── Mount ────────────────────────────────────────────────────────────────────

export async function mount(ctx, container) {
  _ctx     = ctx;
  _uid     = ctx.user.uid;
  _role    = ctx.role;
  _profile = ctx.profile;
  _view    = ctx.mountKey || "interviews";

  ensureKanbanStyles();
  container.innerHTML = "";
  container.className = (container.className || "") + " kb-page";

  const viewTitle = _view === "mine" ? "My Assignments" : _view === "opeds" ? "Op-Eds" : "Catalyst in the Capital";
  const viewSub   = _view === "mine" ? "All your active projects and tasks." : "Every story moves left-to-right through the editorial lifecycle.";

  const header = el("div", { class: "kb-header" });
  header.innerHTML = `
    <div>
      <div class="kb-header-title">${esc(viewTitle)}</div>
      <div class="kb-header-sub">${esc(viewSub)}</div>
    </div>
    <div class="kb-header-actions">
      ${_view !== "mine" && canPropose() ? `<button class="btn btn-accent btn-sm" id="pl-new-btn">+ New proposal</button>` : ""}
      ${_role === "admin" ? `<button class="btn btn-secondary btn-sm" id="pl-report-btn">Status report</button>` : ""}
    </div>`;
  container.appendChild(header);

  const scrollWrap = el("div", { class: "kb-scroll" });
  const boardEl   = el("div", { class: "kb-board", id: "pl-board" });
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
  // No-op: workflowDb IS the primary db now — users already loaded in loadEditors
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
  const colEl = el("div", { class: "kb-col" });
  colEl.innerHTML = `
    <div class="kb-col-head" style="border-top:3px solid ${color}">
      <span class="kb-col-title">${esc(name)}</span>
      <span class="kb-col-count">${projects.length}</span>
    </div>
    <div class="kb-col-body"></div>`;
  const body = colEl.querySelector(".kb-col-body");
  if (!projects.length) {
    body.innerHTML = `<div class="kb-empty">No projects here</div>`;
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

  const stateClass = { green: "s-green", yellow: "s-yellow", blue: "s-blue", red: "s-red" }[state.color] || "";
  const card = el("div", {
    class: `kb-card ${stateClass}${isInactive ? " s-dim" : ""}`,
    onclick: () => openDetailModal(project.id),
  });

  const authorInitial = (project.authorName || "?")[0].toUpperCase();

  card.innerHTML = `
    <div class="kb-card-title">${esc(project.title)}${hasDeadlineRequest ? " ⏰" : ""}</div>
    <div class="kb-card-meta">
      <span class="kb-badge">${esc(project.type || "")}</span>
      <span class="kb-status">${esc(state.status)}</span>
      ${isInactive ? `<span class="kb-badge kb-badge-idle">${inactive}d idle</span>` : ""}
    </div>
    <div class="kb-progress"><div class="kb-progress-fill" style="width:${progress}%"></div></div>
    <div class="kb-card-foot">
      <div class="kb-author">
        <div class="kb-avatar" style="background:${stringToColor(project.authorName)}">${authorInitial}</div>
        <span>${esc(project.authorName || "")}</span>
      </div>
      <div class="kb-due${isOverdue ? " overdue" : isDueSoon ? " soon" : ""}">
        ${due ? fmtShort(due) : "—"}
      </div>
    </div>`;

  return card;
}

function renderAvailabilityColumn() {
  const colEl = el("div", { class: "kb-col", style: { flex: "0 0 220px", width: "220px" } });
  colEl.innerHTML = `
    <div class="kb-col-head" style="border-top:3px solid #64748b">
      <span class="kb-col-title">Team</span>
      <span class="kb-col-count">${_allUsers.filter(u => ["writer","editor","admin"].includes(u.role)).length}</span>
    </div>
    <div class="kb-col-body" style="overflow-y:auto; max-height:600px;"></div>`;
  const body = colEl.querySelector(".kb-col-body");
  const writers = _allUsers.filter(u => ["writer", "editor", "admin"].includes(u.role));
  if (!writers.length) {
    body.innerHTML = `<div class="kb-empty">No team members loaded</div>`;
  } else {
    for (const u of writers) {
      const activeCount = _allProjects.filter(p => p.authorId === u.id || p.editorId === u.id).length;
      const chip = el("div", { class: "kb-avail-chip" });
      chip.innerHTML = `
        <div class="kb-avatar" style="background:${stringToColor(u.name || u.email)}">${(u.name || u.email || "?")[0].toUpperCase()}</div>
        <div style="min-width:0;flex:1;">
          <div class="kb-avail-name">${esc(u.name || u.email)}</div>
          <div class="kb-avail-role">${esc(u.role || "")} · ${activeCount} active</div>
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

  // Status pill colors
  const pillBg = { green:"#dcfce7", yellow:"#fef3c7", blue:"#dbeafe", red:"#fee2e2", default:"#f1f5f9" }[state.color] || "#f1f5f9";
  const pillFg = { green:"#15803d", yellow:"#b45309", blue:"#1d4ed8", red:"#b91c1c", default:"#475569" }[state.color] || "#475569";

  // Timeline checklist
  const stepsHtml = TIMELINE_STEPS.map(step => {
    const checked = !!tl[step];
    return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;background:${checked?"#f0fdf4":"#f8fafc"};border:1px solid ${checked?"#86efac":"#e5e7eb"};cursor:${isAdmin?"pointer":"default"};user-select:none;transition:background .1s;">
      <input type="checkbox" data-step="${esc(step)}" ${checked?"checked":""} ${isAdmin?"":"disabled"} style="width:15px;height:15px;flex-shrink:0;accent-color:#0f766e;">
      <span style="font-size:13px;color:${checked?"#6b7280":"#1f2937"};${checked?"text-decoration:line-through;":""}">${esc(step)}</span>
    </label>`;
  }).join("");

  // Deadlines
  const hasRequest = project.deadlineRequest?.status === "pending" || project.deadlineChangeRequest?.status === "pending";
  const req = project.deadlineRequest || project.deadlineChangeRequest;
  const dlStyle = `display:flex;align-items:center;gap:12px;margin-bottom:10px;`;
  const dlLabelStyle = `font-size:12px;font-weight:600;color:#64748b;width:150px;flex-shrink:0;`;
  const dlInputStyle = `flex:1;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;font-family:inherit;color:#0b1220;background:#fff;`;

  const deadlineRows = DEADLINE_FIELDS
    .filter(f => !(project.type === "Op-Ed" && (f.key === "contact" || f.key === "interview")))
    .map(f => `<div style="${dlStyle}">
      <label style="${dlLabelStyle}">${esc(f.label)}</label>
      <input type="date" class="dl-input" data-dlkey="${esc(f.key)}" value="${esc(deadlines[f.key]||"")}" ${isAdmin?"":"disabled"} style="${dlInputStyle}${!isAdmin?"background:#f8fafc;color:#94a3b8;":""}">
    </div>`).join("");

  const pubDeadlineHtml = `<div style="${dlStyle}">
    <label style="${dlLabelStyle}font-weight:700;color:#374151;">Publication</label>
    <input type="date" class="dl-input" data-dlkey="publication" value="${esc(deadlines.publication||project.deadline||"")}" ${isAdmin?"":"disabled"} style="${dlInputStyle}font-weight:600;${!isAdmin?"background:#f8fafc;color:#94a3b8;":""}">
  </div>`;

  const deadlineRequestHtml = hasRequest ? `
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px 14px;margin-top:12px;font-size:13px;">
      <div style="font-weight:700;color:#92400e;margin-bottom:6px;">⏳ Pending deadline change request</div>
      <div style="color:#78350f;">Requested by: <strong>${esc(req.requestedBy||"")}</strong></div>
      <div style="color:#78350f;margin-top:2px;">Reason: ${esc(req.reason||"—")}</div>
      ${isAdmin?`<div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn btn-accent btn-xs" id="dl-approve-req">Approve</button>
        <button class="btn btn-secondary btn-xs" id="dl-reject-req" style="color:#b91c1c;">Reject</button>
      </div>`:`<div style="color:#b45309;margin-top:6px;font-size:12px;">Awaiting admin approval…</div>`}
    </div>` : "";

  // Activity feed
  const acts = [...(project.activity || [])].reverse();
  const actHtml = acts.length
    ? acts.map(a => `
        <div style="display:flex;align-items:baseline;gap:6px;padding:8px 10px;border-radius:8px;background:#f8fafc;border:1px solid #e5e7eb;font-size:12.5px;line-height:1.4;">
          <span style="font-weight:700;color:#1f2937;white-space:nowrap;">${esc(a.authorName||"Someone")}</span>
          <span style="color:#374151;flex:1;">${esc(a.text||"")}</span>
          <span style="color:#94a3b8;white-space:nowrap;font-size:11px;">${a.timestamp?fmtActivityTime(a.timestamp):""}</span>
        </div>`).join("")
    : `<div style="color:#9ca3af;font-size:13px;padding:12px 0;">No activity yet.</div>`;

  // Editor dropdown
  const editorOptions = _allEditors.map(e =>
    `<option value="${esc(e.id)}" ${e.id===project.editorId?"selected":""}>${esc(e.name||e.email)}</option>`
  ).join("");

  // Section heading helper
  const sec = (label, extra="") =>
    `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin:0 0 10px;display:flex;align-items:center;gap:8px;">${label}${extra}</div>`;
  const divider = `<div style="height:1px;background:#f1f5f9;margin:18px 0;"></div>`;

  const body = el("div", { style: { fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif", lineHeight:"1.5" }});

  body.innerHTML = `
    ${isInactive&&(isAdmin||isAuthor)?`<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;font-size:13px;color:#b91c1c;display:flex;align-items:center;gap:8px;margin-bottom:16px;">⚠ Inactive for <strong>${inactive} days</strong> — no recent progress.</div>`:""}

    <!-- Status + meta -->
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <span style="background:${pillBg};color:${pillFg};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;">${esc(state.status)}</span>
      <span style="background:#f1f5f9;color:#475569;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;">${esc(project.type||"Article")}</span>
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:13px;color:#6b7280;margin-bottom:0;padding:12px 14px;background:#f8fafc;border-radius:8px;border:1px solid #e5e7eb;">
      <span>Author: <strong style="color:#1f2937;">${esc(project.authorName||"—")}</strong></span>
      <span>Editor: <strong style="color:#1f2937;">${esc(project.editorName||"Not assigned")}</strong></span>
      ${due?`<span>Due: <strong style="color:#1f2937;">${fmtDate(due+"T00:00:00")}</strong></span>`:""}
    </div>

    ${project.proposal?`
    ${divider}
    ${sec("Pitch / Proposal", canEdit?`<button class="btn btn-ghost btn-xs" id="edit-proposal-btn" style="margin-left:auto;">Edit</button>`:"")}
    <div id="proposal-display" style="font-size:13.5px;line-height:1.65;color:#374151;white-space:pre-wrap;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;">${esc(project.proposal)}</div>
    `:(canEdit?`
    ${divider}
    ${sec("Pitch / Proposal", `<button class="btn btn-ghost btn-xs" id="edit-proposal-btn" style="margin-left:auto;">Add pitch</button>`)}
    `:``)
    }

    ${divider}
    ${sec("Progress")}
    <div id="tl-steps" style="display:flex;flex-direction:column;gap:6px;">${stepsHtml}</div>

    ${isAdmin?`
    ${divider}
    ${sec("Assign Editor")}
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="editor-select" style="flex:1;padding:9px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;font-family:inherit;color:#0b1220;background:#fff;">
        <option value="">— Choose editor —</option>
        ${editorOptions}
      </select>
      <button class="btn btn-accent btn-sm" id="assign-editor-btn">${project.editorId?"Reassign":"Assign"}</button>
    </div>`:""}

    ${divider}
    ${sec("Deadlines", `<div style="margin-left:auto;display:flex;gap:6px;">
      ${isAdmin?`<button class="btn btn-accent btn-xs" id="save-deadlines-btn">Save</button>`:""}
      ${(isAuthor||isEditor)&&!hasRequest?`<button class="btn btn-ghost btn-xs" id="req-deadline-btn">Request change</button>`:""}
    </div>`)}
    ${pubDeadlineHtml}
    ${deadlineRows}
    ${deadlineRequestHtml}

    ${divider}
    ${sec("Leave a comment")}
    <div style="display:flex;gap:8px;">
      <input id="comment-input" placeholder="Write a note…" style="flex:1;padding:9px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;font-family:inherit;color:#0b1220;background:#fff;outline:none;">
      <button class="btn btn-accent btn-sm" id="post-comment-btn">Post</button>
    </div>

    ${divider}
    ${sec("Activity")}
    <div id="act-feed" style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto;">${actHtml}</div>
  `;

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
