// Shared workflow-pipeline view powered by the scheduler database
// (catalystmonday). Visible to every signed-in role.
//
// mount() renders a full page; renderPipeline() can be called directly to
// embed a compact version inside the overview.

import { workflowDb } from "../firebase-dual-config.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc } from "./ui.js";

const VIEWS = [
  { id: "all",      label: "Full scheduler",  filter: () => true },
  { id: "interviews", label: "Interviews",    filter: (p) => (p.type || "").toLowerCase() === "interview" },
  { id: "opeds",    label: "Op-Eds",          filter: (p) => (p.type || "").toLowerCase() === "op-ed" },
  { id: "mine",     label: "My assignments",  filter: (p, uid) => p.authorId === uid || p.editorId === uid },
];

// Workflow columns — must match scheduler/projectState.js so cards land
// in the same column the scheduler would show them in.
const WORKFLOW_COLUMNS = {
  TOPIC_PROPOSAL:        "Topic Proposal",
  INTERVIEW_STAGE:       "Interview Stage",
  WRITING_STAGE:         "Writing Stage",
  IN_REVIEW:             "In Review",
  REVIEWING_SUGGESTIONS: "Reviewing Suggestions",
  COMPLETED:             "Completed",
};

// Fixed column order so the pipeline always reads left-to-right through
// the editorial lifecycle, regardless of which columns have cards.
const COLUMN_ORDER = [
  WORKFLOW_COLUMNS.TOPIC_PROPOSAL,
  WORKFLOW_COLUMNS.INTERVIEW_STAGE,
  WORKFLOW_COLUMNS.WRITING_STAGE,
  WORKFLOW_COLUMNS.IN_REVIEW,
  WORKFLOW_COLUMNS.REVIEWING_SUGGESTIONS,
  WORKFLOW_COLUMNS.COMPLETED,
];

// Port of scheduler/projectState.js::getProjectState — keeps the dashboard
// pipeline in sync with the scheduler without a shared import.
function computeColumn(project) {
  const timeline = project.timeline || {};
  const type = (project.type || "").toLowerCase();
  const approved = project.proposalStatus === "approved";

  if (timeline["Suggestions Reviewed"]) return WORKFLOW_COLUMNS.COMPLETED;
  if (timeline["Review Complete"])       return WORKFLOW_COLUMNS.REVIEWING_SUGGESTIONS;
  if (project.editorId && timeline["Article Writing Complete"] && !timeline["Review Complete"]) {
    return WORKFLOW_COLUMNS.IN_REVIEW;
  }
  if (timeline["Interview Complete"] || (type === "op-ed" && approved)) {
    return WORKFLOW_COLUMNS.WRITING_STAGE;
  }
  if (type === "interview" && approved && !timeline["Interview Complete"]) {
    return WORKFLOW_COLUMNS.INTERVIEW_STAGE;
  }
  return WORKFLOW_COLUMNS.TOPIC_PROPOSAL;
}

export async function mount(ctx, container) {
  container.innerHTML = "";
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Catalyst in the Capital — Editorial workflow</div>
        <div class="card-subtitle">Every story moves left-to-right: Topic Proposal → Interview → Writing → In Review → Reviewing Suggestions → Completed.</div>
      </div>
      <a class="btn btn-secondary btn-sm" href="scheduler/dashboard.html">Open full scheduler &rarr;</a>
    </div>
    <div id="pipeline-here"></div>`;
  container.appendChild(card);
  return renderPipeline(card.querySelector("#pipeline-here"), ctx, { compact: false });
}

/**
 * Mount the shared pipeline UI into a DOM node.
 * Returns a cleanup function that unsubscribes the Firestore listener.
 */
export function renderPipeline(mountEl, ctx, { compact = false } = {}) {
  let allProjects = [];
  let currentView = "all";

  const tabsEl = el("div", { class: "pipeline-tabs" });
  const bodyEl = el("div", {}, [el("div", { class: "loading-state" }, ["Loading projects…"])]);
  mountEl.appendChild(tabsEl);
  mountEl.appendChild(bodyEl);

  function renderTabs() {
    tabsEl.innerHTML = "";
    for (const v of VIEWS) {
      const items = allProjects.filter((p) => v.filter(p, ctx.user?.uid));
      const btn = el("button", {
        class: `pipeline-tab ${v.id === currentView ? "active" : ""}`,
        onclick: () => { currentView = v.id; renderTabs(); renderBody(); },
      });
      btn.innerHTML = `<span>${esc(v.label)}</span><span class="count">${items.length}</span>`;
      tabsEl.appendChild(btn);
    }
  }

  function renderBody() {
    const view = VIEWS.find((v) => v.id === currentView);
    const rows = allProjects.filter((p) => view.filter(p, ctx.user?.uid));
    if (!rows.length) {
      bodyEl.innerHTML = `<div class="empty-state">Nothing here yet.</div>`;
      return;
    }
    const byCol = groupByColumn(rows);
    // Op-Eds skip the interview stage, so hide that column when the op-eds
    // tab is active (matches scheduler behavior).
    const visibleCols = COLUMN_ORDER.filter((name) => {
      if (currentView === "opeds" && name === WORKFLOW_COLUMNS.INTERVIEW_STAGE) return false;
      return true;
    });
    const grid = el("div", { class: "pipeline-grid" });
    for (const name of visibleCols) {
      const col = byCol[name] || [];
      // In compact mode (embedded on overview), skip empty columns so the
      // grid stays dense. Full view always renders every stage.
      if (compact && !col.length) continue;
      const colEl = el("div", { class: "pipeline-col" });
      colEl.innerHTML = `
        <div class="pipeline-col-head">
          <span class="pipeline-col-title">${esc(name)}</span>
          <span class="pipeline-col-count">${col.length}</span>
        </div>
        <div class="pipeline-col-body"></div>`;
      const bodyCol = colEl.querySelector(".pipeline-col-body");
      const max = compact ? 3 : 10;
      col.slice(0, max).forEach((p) => {
        const parts = [p.type || "Article"];
        const author = p.authorName || p.author || p.writerName;
        if (author) parts.push(`by ${author}`);
        const due = p.dueDate || p.deadline;
        if (due) parts.push(`due ${fmtDueDate(due)}`);
        bodyCol.appendChild(el("div", { class: "pipeline-item" }, [
          el("div", { class: "pipeline-item-title" }, truncate(p.title || "Untitled", 60)),
          el("div", { class: "pipeline-item-meta" }, parts.join(" · ")),
        ]));
      });
      if (col.length > max) {
        bodyCol.appendChild(el("div", { class: "pipeline-item-meta", style: { padding: "6px 8px", color: "var(--muted)" } }, `+${col.length - max} more…`));
      }
      grid.appendChild(colEl);
    }
    bodyEl.innerHTML = "";
    bodyEl.appendChild(grid);
  }

  let unsub = null;
  try {
    unsub = onSnapshot(
      collection(workflowDb, "projects"),
      (snap) => {
        allProjects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderTabs();
        renderBody();
      },
      (err) => {
        console.error("[pipeline] subscription error", err);
        bodyEl.innerHTML = `<div class="error-state">Failed to load workflow data. Please check your connection.</div>`;
      }
    );
  } catch (err) {
    bodyEl.innerHTML = `<div class="error-state">Failed to initialize pipeline: ${esc(err.message)}</div>`;
  }

  return () => { if (unsub) unsub(); };
}

// Build a lookup of every known column name (plus lowercase + legacy aliases
// from earlier scheduler revisions) pointing at the current canonical label.
// Anything stored on a project that doesn't match the canonical set gets
// normalized (e.g. "in review" -> "In Review") or recomputed from the
// timeline, so we never end up with an "unsorted" bucket of cards that the
// pipeline can't render.
const COLUMN_ALIASES = (() => {
  const map = new Map();
  for (const name of COLUMN_ORDER) {
    map.set(name, name);
    map.set(name.toLowerCase(), name);
  }
  const legacy = {
    "topic":        WORKFLOW_COLUMNS.TOPIC_PROPOSAL,
    "proposal":     WORKFLOW_COLUMNS.TOPIC_PROPOSAL,
    "pitch":        WORKFLOW_COLUMNS.TOPIC_PROPOSAL,
    "pending":      WORKFLOW_COLUMNS.TOPIC_PROPOSAL,
    "approved":     WORKFLOW_COLUMNS.WRITING_STAGE,
    "interview":    WORKFLOW_COLUMNS.INTERVIEW_STAGE,
    "writing":      WORKFLOW_COLUMNS.WRITING_STAGE,
    "in progress":  WORKFLOW_COLUMNS.WRITING_STAGE,
    "draft":        WORKFLOW_COLUMNS.WRITING_STAGE,
    "review":       WORKFLOW_COLUMNS.IN_REVIEW,
    "in-review":    WORKFLOW_COLUMNS.IN_REVIEW,
    "editing":      WORKFLOW_COLUMNS.IN_REVIEW,
    "suggestions":  WORKFLOW_COLUMNS.REVIEWING_SUGGESTIONS,
    "done":         WORKFLOW_COLUMNS.COMPLETED,
    "published":    WORKFLOW_COLUMNS.COMPLETED,
  };
  for (const [k, v] of Object.entries(legacy)) map.set(k, v);
  return map;
})();

function normalizeColumn(raw, project) {
  if (raw) {
    const hit = COLUMN_ALIASES.get(String(raw).trim())
      || COLUMN_ALIASES.get(String(raw).trim().toLowerCase());
    if (hit) return hit;
  }
  // Always fall back to a timeline-derived column so a project never floats
  // outside the six known stages.
  return computeColumn(project);
}

function groupByColumn(projects) {
  const out = {};
  for (const name of COLUMN_ORDER) out[name] = []; // guarantee order + no "unsorted"
  for (const p of projects) {
    const raw = p.columnTitle || p.column || p.state?.label || null;
    const col = normalizeColumn(raw, p);
    if (!out[col]) out[col] = [];
    out[col].push(p);
  }
  // Sort each column by due date (soonest first), then by updatedAt so the
  // pipeline reads the way an editor would scan it: what's urgent on top.
  for (const name of Object.keys(out)) {
    out[name].sort((a, b) => {
      const ad = dueTime(a), bd = dueTime(b);
      if (ad !== bd) return ad - bd;
      return updatedTime(b) - updatedTime(a);
    });
  }
  return out;
}

function dueTime(p) {
  const d = p.dueDate || p.deadline || p.timeline?.["Article Writing Complete"] || null;
  const t = d ? new Date(d).getTime() : NaN;
  return isNaN(t) ? Infinity : t;
}
function updatedTime(p) {
  const v = p.updatedAt || p.createdAt || null;
  if (!v) return 0;
  if (typeof v === "object" && v.seconds) return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function fmtDueDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
