/**
 * Workflow Pipeline — full recreation of the CatalystMonday scheduler.
 *
 * Views:
 *   mount(ctx, container)  →  renders the full pipeline page
 *     ctx.mountKey: "all" | "mine" | undefined (defaults "all")
 *
 * "all" is the Story Tracker: every story (interviews and op-eds alike) on one
 * board, filtered by edition. Each project carries an optional `edition`
 * string; the edition list and the current edition live in
 * settings/editions ({ names: string[], current: string }), admin-managed.
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
  setDoc,
  onSnapshot,
  arrayUnion,
  serverTimestamp,
  getDocs,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, openModal, toast, fmtDate, confirmDialog } from "./ui.js";
import { showCalendarExportPrompt } from "./calendar-export.js";
import { isProjectPublished, isProjectCompleted, fetchPublishedTitleSet, setStoryEdition } from "./publish-sync.js";
import {
  deadlinePatchOnApproval,
  deadlinePatchOnInterviewScheduled,
  deadlinePatchOnEditorAssigned,
  deadlinePatchOnReviewComplete,
} from "./auto-deadlines.js";

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

// Op-Eds and no-interview stories never land in Interview Stage — they go
// straight from Topic Proposal to Writing Stage on the same board.
const VIEW_COLUMNS = {
  all:  [COL.TOPIC_PROPOSAL, COL.INTERVIEW_STAGE, COL.WRITING_STAGE, COL.IN_REVIEW, COL.REVIEWING_SUGGESTIONS, COL.COMPLETED],
  mine: [COL.TODO, COL.IN_PROGRESS, COL.MY_REVIEW, COL.DONE],
};

// Edition filter sentinels (real edition names are free text, so these use a
// prefix no admin would type).
const ED_ALL  = "__all__";
const ED_NONE = "__none__";

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

// Gated-step checklists. Before a user can flip "Article Writing Complete"
// (writer) or "Review Complete" (editor) to true, they must confirm every
// item below. This mirrors the editorial standards doc.
const WRITER_CHECKLIST = [
  "Is my lead surprising, specific, and impossible to skip?",
  "Have I found a concrete angle, not just a topic?",
  "Is my headline active, specific, and does it stress the stakes?",
  "Have I avoided prescriptive opinion language in the piece?",
  "Is every technical claim verified against primary sources?",
  "Did I flag any uncertain science with a comment for my editor?",
  "Does the piece read like a story, not a literature review?",
  "Does my ending land — quote, callback, or implication?",
];

const EDITOR_CHECKLIST = [
  "Does the lead earn the reader's attention — surprising, specific, not a summary?",
  "Does the piece have a clear, concrete angle — not just a broad topic?",
  "Is the headline active, specific, and honest about the stakes?",
  "Has the writer avoided prescriptive or editorial opinion language?",
  "Are all technical claims accurate and verified against primary sources?",
  "Has every flagged uncertainty been addressed or resolved?",
  "Does the piece read like a story, not a literature review?",
  "Is the writer's voice consistent and credible throughout?",
  "Are all quotes properly attributed and placed in context?",
  "Is all scientific terminology defined for a college-level audience?",
  "Does the ending resonate — quote, callback, or forward-looking implication?",
  "Has the piece been reviewed for grammar, clarity, and overall flow?",
];

// Maps gated timeline step → checklist config.
const STEP_CHECKLISTS = {
  "Article Writing Complete": {
    modalTitle: "Writer Self-Review Checklist",
    intro: "Before marking your draft as complete, confirm you have completed every item below. Use this checklist to ensure your draft meets all Catalyst writing standards before your editor reviews it.",
    items: WRITER_CHECKLIST,
    storageKey: "writerChecklist",
    confirmLabel: "Mark draft complete",
  },
  "Review Complete": {
    modalTitle: "Editor Review Checklist",
    intro: "Before marking this article as reviewed, confirm you have completed every item below. Use this checklist to ensure the article meets Catalyst editorial standards before it moves forward in the workflow.",
    items: EDITOR_CHECKLIST,
    storageKey: "editorChecklist",
    confirmLabel: "Mark review complete",
  },
};

/**
 * Opens a modal showing a required checklist. The returned promise resolves
 * with the signed confirmation payload on confirm, or null on cancel.
 * Every item must be ticked before the confirm button unlocks.
 */
function openChecklistModal(cfg) {
  return new Promise((resolve) => {
    const body = el("div", { style: { fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif" } });
    const itemsHtml = cfg.items.map((text, i) => `
      <label class="checklist-item" data-idx="${i}">
        <input type="checkbox" class="cl-cb">
        <span>${esc(text)}</span>
      </label>`).join("");

    body.innerHTML = `
      <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.5;">${esc(cfg.intro)}</p>
      <div class="checklist-progress" id="cl-progress">
        <span id="cl-progress-label">0 of ${cfg.items.length} confirmed</span>
      </div>
      <div class="checklist-items" id="cl-items">${itemsHtml}</div>`;

    ensureChecklistStyles();

    const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
    const confirmBtn = el("button", { class: "btn btn-accent" }, cfg.confirmLabel);
    confirmBtn.disabled = true;

    const m = openModal({ title: cfg.modalTitle, body, footer: [cancelBtn, confirmBtn], stack: true, onClose: () => resolve(null) });

    const progressLabel = body.querySelector("#cl-progress-label");
    const allBoxes = () => [...body.querySelectorAll(".cl-cb")];
    const updateProgress = () => {
      const boxes = allBoxes();
      const checked = boxes.filter(b => b.checked).length;
      progressLabel.textContent = `${checked} of ${boxes.length} confirmed`;
      confirmBtn.disabled = checked !== boxes.length;
      body.querySelectorAll(".checklist-item").forEach((row, i) => {
        row.classList.toggle("checked", boxes[i].checked);
      });
    };
    body.querySelector("#cl-items").addEventListener("change", updateProgress);

    cancelBtn.onclick = () => { m.close(); resolve(null); };
    confirmBtn.onclick = () => {
      const payload = {
        storageKey: cfg.storageKey,
        items: cfg.items,
        checkedAt: new Date().toISOString(),
      };
      resolve(payload);
      m.close();
    };
  });
}

function ensureChecklistStyles() {
  if (document.getElementById("checklist-styles")) return;
  const s = document.createElement("style");
  s.id = "checklist-styles";
  s.textContent = `
    .checklist-progress {
      font-size:12px; font-weight:600; color:#64748b;
      padding:8px 12px; background:#f8fafc; border:1px solid #e5e7eb;
      border-radius:8px; margin-bottom:14px;
    }
    .checklist-items { display:flex; flex-direction:column; gap:8px; }
    .checklist-item {
      display:flex; align-items:flex-start; gap:10px;
      padding:11px 14px; background:#f8fafc; border:1px solid #e5e7eb;
      border-radius:8px; cursor:pointer; user-select:none;
      font-size:13px; line-height:1.45; color:#1f2937;
      transition:background .12s, border-color .12s;
    }
    .checklist-item:hover { background:#f1f5f9; }
    .checklist-item.checked { background:#f0fdf4; border-color:#86efac; color:#15803d; }
    .checklist-item input[type=checkbox] {
      margin-top:2px; width:16px; height:16px; flex-shrink:0; accent-color:var(--ink,#0f172a); cursor:pointer;
    }
  `;
  document.head.appendChild(s);
}

/**
 * Asks the user to pick the interview date before "Interview Scheduled" flips on.
 * Resolves with { interviewDate: "YYYY-MM-DD" } on save, or null on cancel.
 * Pre-fills with the existing interviewDate if one was already saved.
 */
function openInterviewDateModal({ existingDate } = {}) {
  return new Promise((resolve) => {
    const today = new Date().toISOString().slice(0, 10);
    const body = el("div", { style: { fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif" } });
    body.innerHTML = `
      <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.5;">
        When is the interview taking place? We'll save the date to the story so your editors can plan around it.
      </p>
      <label style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:6px;">Interview date</label>
      <input id="iv-date" type="date" min="${today}" value="${esc(existingDate || "")}"
        style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;font-family:inherit;color:#0b1220;background:#fff;outline:none;">
      <div id="iv-date-err" style="display:none;color:#b91c1c;font-size:12px;margin-top:8px;"></div>
    `;

    const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
    const saveBtn = el("button", { class: "btn btn-accent" }, "Save interview date");

    const m = openModal({ title: "Schedule the interview", body, footer: [cancelBtn, saveBtn], stack: true, onClose: () => resolve(null) });

    cancelBtn.onclick = () => { m.close(); resolve(null); };
    saveBtn.onclick = () => {
      const input = body.querySelector("#iv-date");
      const err = body.querySelector("#iv-date-err");
      const value = (input.value || "").trim();
      if (!value) {
        err.textContent = "Please pick a date for the interview.";
        err.style.display = "block";
        return;
      }
      if (value < today) {
        err.textContent = "Interview date can't be in the past.";
        err.style.display = "block";
        return;
      }
      resolve({ interviewDate: value });
      m.close();
    };
  });
}

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
        if (project.type === "Interview" && !project.noInterview && !tl["Interview Complete"]) {
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
  if (project.type === "Interview" && !project.noInterview && !tl["Interview Complete"]) {
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
// Normalized titles of published stories — lets completed cards distinguish
// "fully edited, waiting on the admin to publish" (purple) from "live on the
// site" (regular white card). Loaded once per mount; projects stamped with
// publishedAt by publish-sync.js don't need the title match at all.
let _publishedTitles = new Set();
let _publishedTitlesLoaded = false;
// settings/editions — the admin-managed edition list + which one is current.
let _editions = { names: [], current: "" };
let _editionsLoaded = false;
// Selected tab on the Story Tracker: ED_ALL, ED_NONE, or an edition name.
// null until the first settings snapshot picks a default.
let _editionFilter = null;
let _focus = "all";        // "all" | "attention" | "mine" (Story Tracker quick filter)
let _query = "";           // Story Tracker search (title, writer, editor)
const _expandedCols = new Set();
let _view        = "all"; // "all" | "mine"
let _uid         = null;
let _role        = null;
let _profile     = null;
let _ctx         = null;

// ─── Inject guaranteed styles (once) ─────────────────────────────────────────

function ensureKanbanStyles() {
  // The board and story pop-up are styled in css/suite.css (loaded by the
  // dashboard shell), so the Overview snapshot gets the same look.
}

// ─── Mount ────────────────────────────────────────────────────────────────────

export async function mount(ctx, container) {
  _ctx     = ctx;
  _uid     = ctx.user.uid;
  _role    = ctx.role;
  _profile = ctx.profile;
  if (ctx.mountKey === "works") { _view = "all"; return mountWorks(ctx, container); }
  // Any legacy mount key ("interviews" / "opeds") lands on the merged board.
  _view    = ctx.mountKey === "mine" ? "mine" : "all";
  _editionFilter = null;
  _editionsLoaded = false;

  ensureKanbanStyles();
  container.innerHTML = "";
  container.className = (container.className || "") + " kb-page";


  _focus = "all";
  _query = "";
  // One toolbar: what to show (all / needs attention / mine), which edition,
  // a search, and the actions. The board below always fits the page.
  const header = el("div", { class: "tr-toolbar" });
  header.innerHTML = `
    <div class="tr-filters">
      <div class="kb-focus" id="pl-focus" role="group" aria-label="Show"></div>
      ${_view === "all" ? `<label class="tr-select" id="pl-editions"><span>Edition</span><select id="pl-ed-select" aria-label="Edition"></select></label>` : ""}
      <label class="tr-search"><span class="sr-only">Search stories</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="pl-q" placeholder="Search stories" autocomplete="off">
      </label>
    </div>
    <div class="kb-header-actions">
      ${_view === "all" && _role === "admin" ? `<button class="btn btn-ghost btn-sm" id="pl-ed-manage" type="button">Editions</button>` : ""}
      ${_role === "admin" ? `<button class="btn btn-secondary btn-sm" id="pl-report-btn" type="button">Status report</button>` : ""}
      ${_view !== "mine" && canPropose() ? `<button class="btn btn-primary btn-sm" id="pl-new-btn" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Propose a story</button>` : ""}
    </div>`;
  header.addEventListener("click", (e) => {
    if (e.target.closest("#pl-ed-manage")) { openEditionsModal(); return; }
    const b = e.target.closest("[data-focus]");
    if (!b) return;
    _focus = b.dataset.focus;
    renderBoard();
  });
  header.querySelector("#pl-ed-select")?.addEventListener("change", (e) => { _editionFilter = e.target.value; renderEditionBar(); renderBoard(); });
  header.querySelector("#pl-q").addEventListener("input", (e) => { _query = e.target.value.trim().toLowerCase(); renderBoard(); });
  container.appendChild(header);

  const boardEl = el("div", { class: "tr-board", id: "pl-board" });
  container.appendChild(boardEl);
  container.appendChild(el("div", { id: "pl-below" }));

  // Load editors/users once
  await Promise.all([loadEditors(), loadUsers()]);

  // Published-story titles (async, non-blocking): once loaded, re-render so
  // completed-but-unpublished cards pick up their purple "publish me" state.
  fetchPublishedTitleSet()
    .then((set) => { _publishedTitles = set; _publishedTitlesLoaded = true; renderBoard(); })
    .catch((e) => console.warn("[pipeline] published-title fetch failed", e));

  // Wire header buttons
  if (canPropose() && _view !== "mine") {
    container.querySelector("#pl-new-btn")?.addEventListener("click", () => openProposalModal());
  }
  if (_role === "admin") {
    container.querySelector("#pl-report-btn")?.addEventListener("click", () => openStatusReport());
  }

  // Live subscriptions: projects + the edition list (the detail and proposal
  // modals need editions on My Assignments too, not just the tracker).
  const unsubProjects = onSnapshot(collection(workflowDb, "projects"), snap => {
    _allProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEditionBar();
    renderBoard();
  }, err => {
    boardEl.innerHTML = `<div class="error-state">Failed to load projects: ${esc(err.message)}</div>`;
  });
  const onEditions = (data) => {
    _editions = {
      names: Array.isArray(data?.names) ? data.names.filter(n => typeof n === "string" && n.trim()).map(n => n.trim()) : [],
      current: typeof data?.current === "string" ? data.current.trim() : "",
    };
    _editionsLoaded = true;
    renderEditionBar();
    renderBoard();
  };
  const unsubEditions = onSnapshot(doc(workflowDb, "settings", "editions"),
    snap => onEditions(snap.exists() ? snap.data() : null),
    err => { console.warn("[pipeline] editions load failed", err); onEditions(null); });

  return () => { unsubProjects(); unsubEditions(); };
}

// ─── Editions ─────────────────────────────────────────────────────────────────

function projectEdition(p) {
  return typeof p?.edition === "string" ? p.edition.trim() : "";
}

// Managed editions in admin order, then any edition a project carries that
// isn't in the managed list (so no story ever becomes unreachable).
function allEditionNames() {
  const names = [..._editions.names];
  const seen = new Set(names);
  const extra = [];
  for (const p of _allProjects) {
    const e = projectEdition(p);
    if (e && !seen.has(e)) { seen.add(e); extra.push(e); }
  }
  return names.concat(extra.sort((a, b) => a.localeCompare(b)));
}

// Opens on the current edition (or everything, if none is set); a tab whose
// edition has since been removed falls back the same way.
function activeEditionFilter() {
  const names = allEditionNames();
  // Open on the current edition only when it has stories; an empty current
  // edition used to make the whole tracker look empty.
  const currentHasStories = _editions.current && _allProjects.some(p => projectEdition(p) === _editions.current);
  const fallback = currentHasStories && names.includes(_editions.current) ? _editions.current : ED_ALL;
  const f = _editionFilter ?? fallback;
  if (f === ED_ALL || f === ED_NONE || names.includes(f)) return f;
  return fallback;
}

function renderEditionBar() {
  const bar = document.getElementById("pl-editions");
  if (!bar || !_editionsLoaded) return;
  const f = activeEditionFilter();
  const names = allEditionNames();
  const unassigned = _allProjects.filter(p => !projectEdition(p)).length;
  const tabs = [
    { key: ED_ALL, label: "All editions", n: _allProjects.length },
    ...names.map(n => ({ key: n, label: n, n: _allProjects.filter(p => projectEdition(p) === n).length, now: n === _editions.current })),
  ];
  if (unassigned || f === ED_NONE) tabs.push({ key: ED_NONE, label: "No edition", n: unassigned });

  const select = bar.querySelector("#pl-ed-select");
  if (!select) return;
  select.innerHTML = tabs.map(t => `<option value="${esc(t.key)}"${t.key === f ? " selected" : ""}>${esc(t.label)}${t.now ? " (current)" : ""} · ${t.n}</option>`).join("");
}

function openEditionsModal() {
  const counts = new Map();
  for (const p of _allProjects) {
    const e = projectEdition(p);
    if (e) counts.set(e, (counts.get(e) || 0) + 1);
  }
  let names = allEditionNames();
  let current = _editions.current && names.includes(_editions.current) ? _editions.current : "";

  const body = el("div", {});
  body.innerHTML = `
    <p style="margin:0 0 14px;font-size:13.5px;color:#475569;line-height:1.5;">
      The Story Tracker is organized by edition. The <strong>current</strong> edition is the one the tracker opens on and the default for new pitches.
    </p>
    <div id="ed-list"></div>
    <div class="field" style="margin-top:16px;">
      <label class="label" for="ed-new">Add an edition</label>
      <div style="display:flex;gap:8px;">
        <input class="input" id="ed-new" maxlength="60" placeholder="e.g. Fall 2026" style="flex:1;">
        <button type="button" class="btn btn-secondary" id="ed-add">Add</button>
      </div>
    </div>
    <div id="ed-err" style="color:var(--danger);font-size:12px;margin-top:6px;"></div>`;

  const listEl = body.querySelector("#ed-list");
  const errEl  = body.querySelector("#ed-err");
  const renderList = () => {
    if (!names.length) {
      listEl.innerHTML = `<div class="kb-empty" style="padding:14px 8px;">No editions yet. Add the first one below.</div>`;
      return;
    }
    listEl.innerHTML = names.map((n, i) => {
      const used = counts.get(n) || 0;
      return `
        <div class="kb-ed-row">
          <span class="kb-ed-row-name" title="${esc(n)}">${esc(n)}</span>
          <span class="kb-ed-row-meta">${used} ${used === 1 ? "story" : "stories"}</span>
          <label><input type="radio" name="ed-current" value="${i}" ${n === current ? "checked" : ""}> Current</label>
          <button type="button" class="btn btn-ghost btn-xs" data-remove="${i}" ${used ? `disabled title="Move its ${used} ${used === 1 ? "story" : "stories"} to another edition first"` : ""} style="color:var(--danger);">Remove</button>
        </div>`;
    }).join("");
  };
  renderList();

  listEl.addEventListener("change", (e) => {
    if (e.target.name === "ed-current") current = names[Number(e.target.value)] || "";
  });
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn || btn.disabled) return;
    const [removed] = names.splice(Number(btn.dataset.remove), 1);
    if (removed === current) current = "";
    renderList();
  });

  const input = body.querySelector("#ed-new");
  const add = () => {
    errEl.textContent = "";
    const name = input.value.trim().replace(/\s+/g, " ");
    if (!name) { errEl.textContent = "Type a name for the edition."; return; }
    if (name.startsWith("__")) { errEl.textContent = "Edition names can't start with underscores."; return; }
    if (names.some(n => n.toLowerCase() === name.toLowerCase())) { errEl.textContent = `"${name}" already exists.`; return; }
    names.push(name);
    if (!current) current = name;
    input.value = "";
    renderList();
    input.focus();
  };
  body.querySelector("#ed-add").addEventListener("click", add);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });

  const saveBtn = el("button", { class: "btn btn-accent" }, "Save editions");
  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const m = openModal({ title: "Editions", body, footer: [cancelBtn, saveBtn] });
  cancelBtn.onclick = m.close;
  setTimeout(() => input.focus(), 50);

  saveBtn.onclick = async () => {
    // An edition typed but not yet added shouldn't be silently dropped.
    if (input.value.trim()) { add(); if (errEl.textContent) return; }
    saveBtn.disabled = true;
    // Changing the current edition jumps the board to it. Reset before the
    // write: Firestore fires the local snapshot (which re-renders) before
    // setDoc resolves.
    if (current !== _editions.current) _editionFilter = null;
    try {
      await setDoc(doc(workflowDb, "settings", "editions"), {
        names,
        current,
        updatedAt: new Date().toISOString(),
        updatedBy: _uid,
      });
      toast("Editions saved.", "success");
      m.close();
    } catch (e) {
      errEl.textContent = e.message;
      saveBtn.disabled = false;
    }
  };
}

// <option> list for an edition <select>. `includeNone` adds a blank choice.
function editionOptionsHtml(selected, { includeNone = false, noneLabel = "Not assigned yet" } = {}) {
  const names = allEditionNames();
  if (selected && !names.includes(selected)) names.push(selected);
  return (includeNone ? `<option value="" ${!selected ? "selected" : ""}>${esc(noneLabel)}</option>` : "")
    + names.map(n => `<option value="${esc(n)}" ${n === selected ? "selected" : ""}>${esc(n)}${n === _editions.current ? " (current)" : ""}</option>`).join("");
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

function filterProjectsMineBase() {
  const saved = _focus; _focus = "all";
  const list = filterProjects();
  _focus = saved;
  return list;
}

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
      return _focus === "attention" ? [...map.values()].filter(p => attentionFor(p)) : [...map.values()];
    }
    return _focus === "attention" ? mine.filter(p => attentionFor(p)) : mine;
  }
  return applyFocus(editionProjects());
}

function editionProjects() {
  const f = activeEditionFilter();
  if (f === ED_ALL) return _allProjects;
  if (f === ED_NONE) return _allProjects.filter(p => !projectEdition(p));
  return _allProjects.filter(p => projectEdition(p) === f);
}

function applyFocus(list) {
  if (_focus === "attention") return list.filter(p => attentionFor(p));
  if (_focus === "mine") return list.filter(p => p.authorId === _uid || p.editorId === _uid);
  return list;
}

function matchesQuery(p) {
  if (!_query) return true;
  return [p.title, p.authorName, p.editorName, p.type, projectEdition(p)].some(v => String(v || "").toLowerCase().includes(_query));
}

// Why a story needs someone to act, if it does (most pressing first).
function attentionFor(p) {
  const completed = isProjectCompleted(p);
  if (completed) {
    const published = isProjectPublished(p, _publishedTitles);
    return (!published && _publishedTitlesLoaded) ? { text: "Ready to publish", tone: "purple" } : null;
  }
  if (p.proposalStatus === "rejected") return null;
  if (p.deadlineRequest?.status === "pending" || p.deadlineChangeRequest?.status === "pending") return { text: "Deadline change asked", tone: "warn" };
  if (p.proposalStatus !== "approved") return { text: "Pitch to approve", tone: "warn" };
  const tl = p.timeline || {};
  if (tl["Article Writing Complete"] && !p.editorId) return { text: "Needs an editor", tone: "warn" };
  const d = daysUntil(pubDeadline(p));
  if (d !== null && d < 0) return { text: `${-d}d past publication`, tone: "red" };
  const idle = daysInactive(p);
  if (idle > 9) return { text: `Quiet for ${idle}d`, tone: "red" };
  if (d !== null && d <= 3) return { text: d === 0 ? "Publishes today" : `Publishes in ${d}d`, tone: "warn" };
  return null;
}

function renderFocusBar() {
  const bar = document.getElementById("pl-focus");
  if (!bar) return;
  const base = _view === "mine" ? filterProjectsMineBase() : editionProjects();
  const live = base.filter(p => p.proposalStatus !== "rejected");
  const counts = {
    all: live.length,
    attention: live.filter(p => attentionFor(p)).length,
    mine: live.filter(p => p.authorId === _uid || p.editorId === _uid).length,
  };
  const opts = _view === "mine"
    ? [["all", "Everything"], ["attention", "Needs attention"]]
    : [["all", "All stories"], ["attention", "Needs attention"], ["mine", "Mine"]];
  bar.innerHTML = opts.map(([k, label]) =>
    `<button type="button" data-focus="${k}" aria-pressed="${_focus === k}"${k === "attention" && counts.attention ? ' class="has-alert"' : ""}>${label}<span>${counts[k]}</span></button>`
  ).join("");
}

function renderBoard() {
  const board = document.getElementById("pl-board");
  if (!board) return;
  // Hold the tracker until the edition list arrives so it doesn't paint every
  // story and then snap to the current edition a moment later.
  if (_view === "all" && !_editionsLoaded) return;
  board.innerHTML = "";
  renderFocusBar();

  const projects = filterProjects().filter(matchesQuery);
  const below = document.getElementById("pl-below");
  if (below) below.innerHTML = "";

  if (_view === "mine") {
    const columns = VIEW_COLUMNS.mine;
    board.dataset.cols = String(columns.length);
    for (const colName of columns) {
      board.appendChild(renderColumn(colName, projects.filter(p => getProjectState(p, _view, _uid).column === colName)));
    }
    return;
  }

  // The tracker: the five working stages plus "Ready to publish", side by
  // side and always inside the page. Published stories and the team list
  // sit underneath instead of as extra columns.
  const live = (p) => isProjectCompleted(p) && (p.publishedAt || p.publishedStoryId || isProjectPublished(p, _publishedTitles));
  const working = [COL.TOPIC_PROPOSAL, COL.INTERVIEW_STAGE, COL.WRITING_STAGE, COL.IN_REVIEW, COL.REVIEWING_SUGGESTIONS];
  board.dataset.cols = "6";
  for (const colName of working) {
    board.appendChild(renderColumn(colName, projects.filter(p => !isProjectCompleted(p) && getProjectState(p, _view, _uid).column === colName)));
  }
  board.appendChild(renderColumn(COL_READY, projects.filter(p => isProjectCompleted(p) && !live(p))));

  if (below) {
    below.appendChild(renderTeamSection());
    below.appendChild(renderPublishedLink(projects.filter(live)));
  }
}

const COL_READY = "Ready to publish";

// Under the board: a clear way to see who is working on what (for everyone
// on staff), and a quiet link to what's already published (it's on the site).
const STAGE_SHORT = {
  [COL.TOPIC_PROPOSAL]: "Pitch", [COL.INTERVIEW_STAGE]: "Interviewing", [COL.WRITING_STAGE]: "Writing",
  [COL.IN_REVIEW]: "In review", [COL.REVIEWING_SUGGESTIONS]: "Making edits",
};
const avatarHtml = (name) => `<span class="kb-avatar" title="${esc(name)}" style="background:${stringToColor(name)}">${esc(String(name || "?")[0].toUpperCase())}</span>`;

function activeProjectsFor(u) {
  const name = (u.name || "").trim().toLowerCase();
  return _allProjects.filter((p) => !isProjectCompleted(p) && p.proposalStatus !== "rejected" && (
    p.authorId === u.id || p.editorId === u.id ||
    (name && ((p.authorName || "").trim().toLowerCase() === name || (p.editorName || "").trim().toLowerCase() === name))));
}

function teamMembers() {
  // Staff only, one card per person (some people have an old duplicate account).
  const byName = new Map();
  for (const u of _allUsers) {
    if (!u.role || u.role === "reader") continue;
    const key = (u.name || u.email || u.id).trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, u);
  }
  return [...byName.values()].map((u) => ({ u, projects: activeProjectsFor(u) }))
    .sort((a, b) => b.projects.length - a.projects.length || String(a.u.name || "").localeCompare(String(b.u.name || "")));
}

// Who's working on what: open on the page for everyone on staff, one card per
// active team member. People without a story get a card that says so, so the
// whole team can see who has room (and the person can pitch something).
function renderTeamSection() {
  const team = teamMembers();
  const busy = team.filter((t) => t.projects.length);
  const sec = el("section", { class: "tr-team-sec", "aria-labelledby": "tr-team-h" });
  sec.innerHTML = `
    <header class="tr-team-head">
      <div>
        <h3 id="tr-team-h">Who&rsquo;s working on what</h3>
        <p>Everyone on the team and the stories they&rsquo;re on right now. ${busy.length} of ${team.length} ${team.length === 1 ? "person is" : "people are"} on a story.</p>
      </div>
    </header>
    <div class="tr-people">
      ${team.map(({ u, projects }) => {
        const me = u.id === _uid;
        const name = u.name || u.email;
        if (!projects.length) {
          return `
            <article class="tr-card-person is-free">
              <header>${avatarHtml(name)}<span class="tr-person-name">${esc(name)}${me ? ` <i>(you)</i>` : ""}</span></header>
              <p class="tr-free-note">Not on a story right now.</p>
              ${me && canPropose() ? `<button type="button" class="btn btn-secondary btn-xs" data-propose>Propose a story</button>` : ""}
            </article>`;
        }
        return `
          <article class="tr-card-person">
            <header>${avatarHtml(name)}<span class="tr-person-name">${esc(name)}${me ? ` <i>(you)</i>` : ""}</span><span class="tr-person-load">${projects.length} ${projects.length === 1 ? "story" : "stories"}</span></header>
            <ul>${projects.map((p) => {
              const editing = p.editorId === u.id || (p.editorName || "").trim().toLowerCase() === (u.name || "").trim().toLowerCase();
              const stage = STAGE_SHORT[getProjectState(p, "all", _uid).column] || "In progress";
              const d = daysUntil(pubDeadline(p));
              return `<li><button type="button" data-open="${esc(p.id)}">
                <span class="tr-person-story">${esc(p.title || "Untitled")}</span>
                <span class="tr-person-meta"><span class="tr-role">${editing ? "Editor" : "Writer"}</span>${esc(stage)}${d !== null ? ` · <span class="${d < 0 ? "is-late" : ""}">${d < 0 ? `${-d} days late` : `due ${esc(fmtShort(pubDeadline(p)))}`}</span>` : ""}</span>
              </button></li>`;
            }).join("")}</ul>
          </article>`;
      }).join("") || `<div class="kb-empty">No team members loaded.</div>`}
    </div>`;
  sec.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (b) { openDetailModal(b.dataset.open); return; }
    if (e.target.closest("[data-propose]")) openProposalModal();
  });
  return sec;
}

function renderPublishedLink(published) {
  const row = el("div", { class: "tr-foot" });
  row.innerHTML = `<button type="button" class="tr-pub-link">See what&rsquo;s published <span>${published.length}</span></button>`;
  row.querySelector("button").addEventListener("click", () => openPublishedModal(published));
  return row;
}

function openPublishedModal(list) {
  const sorted = [...list].sort((a, b) => toMs(b.publishedAt || b.lastActivity || b.updatedAt) - toMs(a.publishedAt || a.lastActivity || a.updatedAt));
  const body = el("div", { class: "tr-pub-list" });
  body.innerHTML = sorted.length ? sorted.map((p) => `
    <button type="button" class="tr-pub-row" data-open="${esc(p.id)}">
      <span class="tr-pub-title">${esc(p.title || "Untitled")}</span>
      <span class="tr-pub-meta">${esc([p.authorName, projectEdition(p)].filter(Boolean).join(" · "))}</span>
      <span class="tr-pub-date">${p.publishedAt ? esc(fmtDate(p.publishedAt)) : "Live"}</span>
    </button>`).join("") : `<div class="kb-empty">Nothing published${_query || _focus !== "all" ? " matches these filters" : " yet"}.</div>`;
  const m = openModal({ title: `Published · ${sorted.length}`, body, size: "wide" });
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]"); if (!b) return;
    m?.close?.();
    openDetailModal(b.dataset.open);
  });
}

const COL_COLORS = {
  [COL.TOPIC_PROPOSAL]:        "#f59e0b",
  [COL.INTERVIEW_STAGE]:       "#3b82f6",
  [COL.WRITING_STAGE]:         "#8b5cf6",
  [COL.IN_REVIEW]:             "#0891b2",
  [COL.REVIEWING_SUGGESTIONS]: "#f97316",
  [COL.COMPLETED]:             "#10b981",
  "Ready to publish":          "#6d4bb3",
  [COL.TODO]:                  "#94a3b8",
  [COL.IN_PROGRESS]:           "#8b5cf6",
  [COL.MY_REVIEW]:             "#0891b2",
  [COL.DONE]:                  "#10b981",
};

const COL_HINTS = {
  [COL.TOPIC_PROPOSAL]:        "Pitches waiting for approval",
  [COL.INTERVIEW_STAGE]:       "Setting up and doing interviews",
  [COL.WRITING_STAGE]:         "Drafts being written",
  [COL.IN_REVIEW]:             "With an editor",
  [COL.REVIEWING_SUGGESTIONS]: "Writer making the edits",
  [COL.COMPLETED]:             "Edited and ready, or live",
  "Ready to publish":          "Fully edited; an admin publishes it",
  [COL.TODO]:                  "Not started yet",
  [COL.IN_PROGRESS]:           "You're working on it",
  [COL.MY_REVIEW]:             "Waiting on someone else",
  [COL.DONE]:                  "Finished",
};
const COL_LABELS = { [COL.REVIEWING_SUGGESTIONS]: "Making edits", [COL.TOPIC_PROPOSAL]: "Pitches", [COL.INTERVIEW_STAGE]: "Interviewing", [COL.WRITING_STAGE]: "Writing" };
const FOLD_AT = 6;

function renderColumn(name, projects) {
  // "In Review" is also a My-assignments column name ("waiting on someone
  // else"), so the tracker spells out its own meaning here.
  const trackerReview = _view === "all" && name === COL.IN_REVIEW;
  const label = trackerReview ? "In review" : (COL_LABELS[name] || name);
  const hint = trackerReview ? "With an editor" : (COL_HINTS[name] || "");
  const colEl = el("section", { class: `tr-col${projects.length ? "" : " is-empty"}`, "aria-label": `${label}: ${projects.length}`, style: `--col:${COL_COLORS[name] || "#94a3b8"}` });
  colEl.innerHTML = `
    <header class="tr-col-head" title="${esc(hint)}">
      <span class="tr-col-dot" aria-hidden="true"></span>
      <span class="tr-col-title">${esc(label)}</span>
      <span class="kb-col-count">${projects.length}</span>
      <span class="tr-col-hint">${esc(hint)}</span>
    </header>
    <div class="tr-col-body"></div>`;
  const body = colEl.querySelector(".tr-col-body");
  if (!projects.length) {
    body.innerHTML = `<div class="tr-empty">${_query ? "No matches" : _focus === "attention" ? "Nothing needs attention" : "None right now"}</div>`;
    return colEl;
  }
  const isDone = name === COL.COMPLETED || name === COL.DONE;
  // Live work: soonest deadline first. Finished work: most recent first.
  const sorted = isDone
    ? projects.sort((a, b) => toMs(b.publishedAt || b.lastActivity || b.updatedAt) - toMs(a.publishedAt || a.lastActivity || a.updatedAt))
    : projects.sort((a, b) => (attentionFor(b) ? 1 : 0) - (attentionFor(a) ? 1 : 0) || dueTime(a) - dueTime(b));
  const fold = isDone && sorted.length > FOLD_AT && !_expandedCols.has(name);
  (fold ? sorted.slice(0, FOLD_AT) : sorted).forEach(p => body.appendChild(renderCard(p)));
  if (fold) {
    const more = el("button", { type: "button", class: "kb-more" }, `Show all ${sorted.length}`);
    more.addEventListener("click", () => { _expandedCols.add(name); renderBoard(); });
    body.appendChild(more);
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
  const due = pubDeadline(project);
  const days = daysUntil(due);
  const completed = isProjectCompleted(project);
  const published = completed && isProjectPublished(project, _publishedTitles);
  const awaitingPublish = completed && !published && _publishedTitlesLoaded;
  const attention = attentionFor(project);
  const hasDeadlineRequest = (project.deadlineRequest?.status === "pending") || (project.deadlineChangeRequest?.status === "pending");

  const skipInterview = project.type === "Op-Ed" || !!project.noInterview;
  const steps = TIMELINE_STEPS.filter(st => !(skipInterview && (st === "Interview Scheduled" || st === "Interview Complete")));
  const tl = project.timeline || {};
  const doneCount = steps.filter(st => tl[st]).length;

  const card = el("article", {
    class: `kb-card${attention ? " is-" + attention.tone : ""}${published ? " is-live" : ""}${project.proposalStatus === "rejected" ? " is-declined" : ""}`,
    tabindex: "0",
    role: "button",
    "aria-label": `${project.title}. ${state.status}. Open details`,
  });
  card.addEventListener("click", () => openDetailModal(project.id));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetailModal(project.id); } });

  const edition = projectEdition(project);
  const showEdition = edition && !(_view === "all" && activeEditionFilter() === edition);
  const statusLabel = awaitingPublish ? "Ready to publish" : published ? "Live on the site" : project.proposalStatus === "rejected" ? "Pitch declined" : state.status;
  const dueLabel = !due ? "" : completed ? fmtShort(due)
    : days < 0 ? `${fmtShort(due)} · ${-days}d late` : days === 0 ? "Today" : days <= 14 ? `${fmtShort(due)} · ${days}d` : fmtShort(due);
  const people = [project.authorName, project.editorName].filter(Boolean);

  card.innerHTML = `
    <div class="kb-card-top">
      <span class="kb-type">${esc(project.type || "Story")}</span>
      ${showEdition ? `<span class="kb-type is-edition">${esc(edition)}</span>` : ""}
      ${due ? `<span class="kb-due${!completed && days < 0 ? " is-late" : !completed && days <= 3 ? " is-soon" : ""}">${esc(dueLabel)}</span>` : ""}
    </div>
    <h4 class="kb-card-title">${esc(project.title || "Untitled")}</h4>
    <p class="kb-card-status">${attention ? `<span class="kb-flag is-${attention.tone}">${esc(attention.text)}</span>` : ""}<span>${esc(statusLabel)}</span>${hasDeadlineRequest && attention?.text !== "Deadline change asked" ? ` <span class="kb-flag is-warn">Deadline change asked</span>` : ""}</p>
    <div class="kb-card-foot">
      <span class="kb-people">${people.map(n => `<span class="kb-avatar" title="${esc(n)}" style="background:${stringToColor(n)}">${esc(n[0].toUpperCase())}</span>`).join("")}<span class="kb-people-names">${esc(project.authorName || "No writer")}${project.editorName ? ` <i>&amp; ${esc(project.editorName.split(" ")[0])}</i>` : ""}</span></span>
      <span class="kb-steps" title="${doneCount} of ${steps.length} steps done" aria-label="${doneCount} of ${steps.length} steps done">${steps.map(st => `<i${tl[st] ? ' class="is-done"' : ""}></i>`).join("")}</span>
    </div>`;
  return card;
}

// Plain-language steps: who owns each one and which deadline it answers to.
const STEP_META = {
  "Topic Proposal Complete":  { label: "Pitch approved",         owner: "Admin" },
  "Interview Scheduled":      { label: "Interview scheduled",    owner: "Writer", deadline: "contact" },
  "Interview Complete":       { label: "Interview done",         owner: "Writer", deadline: "interview" },
  "Article Writing Complete": { label: "Draft finished",         owner: "Writer", deadline: "draft" },
  "Review Complete":          { label: "Editor's review done",   owner: "Editor", deadline: "review" },
  "Suggestions Reviewed":     { label: "Edits made",             owner: "Writer", deadline: "edits" },
};

// One sentence: what has to happen next, and who has to do it.
function nextStepFor(p, state, { awaitingPublish, published } = {}) {
  const w = esc(p.authorName || "The writer");
  const e = esc(p.editorName || "the editor");
  const tl = p.timeline || {};
  if (published) return { html: `Live on the site${p.publishedAt ? ` since ${esc(fmtDate(p.publishedAt))}` : ""}.`, tone: "good" };
  if (awaitingPublish) return { html: "Fully edited. An admin publishes it.", owner: "Admin", tone: "purple" };
  if (p.proposalStatus === "rejected") return { html: "The pitch was declined. Edit it and an admin can look again.", owner: p.authorName || "Writer", tone: "red" };
  if (p.proposalStatus !== "approved") return { html: "An admin reads the pitch and approves or declines it.", owner: "Admin" };
  if (p.type === "Interview" && !p.noInterview && !tl["Interview Complete"]) {
    return tl["Interview Scheduled"]
      ? { html: `${w} interviews the source${p.interviewDate ? ` on <strong>${esc(fmtShort(p.interviewDate))}</strong>` : ""}, then ticks &ldquo;Interview done&rdquo;.`, owner: p.authorName || "Writer" }
      : { html: `${w} contacts the source and schedules the interview.`, owner: p.authorName || "Writer" };
  }
  if (!tl["Article Writing Complete"]) return { html: `${w} writes the draft, then ticks &ldquo;Draft finished&rdquo;.`, owner: p.authorName || "Writer" };
  if (!p.editorId) return { html: "The draft is done. An admin assigns an editor.", owner: "Admin", tone: "warn" };
  if (!tl["Review Complete"]) return { html: `${e} reviews the draft and leaves suggestions.`, owner: p.editorName || "Editor" };
  if (!tl["Suggestions Reviewed"]) return { html: `${w} works through ${e}'s suggestions.`, owner: p.authorName || "Writer" };
  return { html: "All steps are done.", tone: "good" };
}

// ─── Project Detail Modal ─────────────────────────────────────────────────────

function openDetailModal(projectId) {
  const project = _allProjects.find(p => p.id === projectId);
  if (!project) return toast("Project not found.", "error");

  const isAdmin  = _role === "admin";
  // Primary match is authorId == uid. Fall back to name/email match so legacy or
  // seeded projects whose authorId drifted from the current Firebase UID still
  // unlock for their true author. Firestore rules mirror this fallback.
  const myName  = (_profile?.name || "").trim().toLowerCase();
  const myEmail = (_ctx?.user?.email || "").trim().toLowerCase();
  const projAuthorName = (project.authorName || "").trim().toLowerCase();
  const isAuthor = project.authorId === _uid
    || (!!myName  && projAuthorName === myName)
    || (!!myEmail && projAuthorName === myEmail);
  const isEditor = project.editorId === _uid || _role === "editor";
  const canEdit  = isAdmin || isAuthor || isEditor;

  // Which timeline steps each role can toggle
  // Admins can toggle all. Authors toggle their own work steps. Editors toggle review steps.
  const AUTHOR_STEPS = new Set([
    "Topic Proposal Complete", "Interview Scheduled", "Interview Complete",
    "Article Writing Complete", "Suggestions Reviewed",
  ]);
  const EDITOR_STEPS = new Set(["Review In Progress", "Review Complete"]);
  function canToggleStep(step) {
    if (isAdmin) return true;
    if (isAuthor && AUTHOR_STEPS.has(step)) return true;
    if (isEditor && EDITOR_STEPS.has(step)) return true;
    return false;
  }
  const state    = getProjectState(project, _view, _uid);
  const tl       = project.timeline || {};
  const completed = isProjectCompleted(project);
  const published = completed && isProjectPublished(project, _publishedTitles);
  const awaitingPublish = completed && !published && _publishedTitlesLoaded;
  const deadlines = project.deadlines || {};
  const due       = pubDeadline(project);
  const inactive  = daysInactive(project);
  const isInactive = inactive > 9 && state.column !== COL.COMPLETED && state.column !== COL.DONE;

  const me = _profile.name || _ctx.user.email;
  const next = nextStepFor(project, state, { awaitingPublish, published });
  const skipInterviewSteps = project.type === "Op-Ed" || !!project.noInterview;
  const relevantSteps = TIMELINE_STEPS.filter(step =>
    !(skipInterviewSteps && (step === "Interview Scheduled" || step === "Interview Complete"))
  );
  const currentStep = relevantSteps.find(st => !tl[st]) || null;

  // When was each step ticked, and by whom? (latest "completed: <step>").
  const doneInfo = {};
  for (const a of (project.activity || [])) {
    const m = /^completed: (.+)$/.exec(a.text || "");
    if (m) doneInfo[m[1]] = { who: a.authorName, when: a.timestamp };
  }

  // Steps: plain-language label, who owns it, its deadline, and when it was done.
  const stepsHtml = relevantSteps.map((step, i) => {
    const meta = STEP_META[step] || { label: step, owner: "" };
    const checked  = !!tl[step];
    const editable = canToggleStep(step);
    const isCurrent = step === currentStep;
    const dl = meta.deadline ? (meta.deadline === "interview" ? (deadlines.interview || project.interviewDate) : deadlines[meta.deadline]) : null;
    const dDays = dl ? daysUntil(dl) : null;
    const late = !checked && dDays !== null && dDays < 0;
    const done = doneInfo[step];
    const ownerName = meta.owner === "Writer" ? (project.authorName || "Writer")
      : meta.owner === "Editor" ? (project.editorName || "Editor (not assigned)") : meta.owner;
    const sub = checked
      ? (done?.when ? `Done ${fmtActivityTime(done.when)}${done.who ? ` · ${esc(done.who)}` : ""}` : "Done")
      : `${esc(ownerName)}${dl ? ` · due ${fmtShort(dl)}${late ? ` <b class="pm-late">${-dDays}d late</b>` : dDays === 0 ? " (today)" : ""}` : ""}`;
    return `<li class="pm-step${checked ? " is-done" : ""}${isCurrent ? " is-current" : ""}">
      <label class="pm-step-row${editable ? "" : " is-locked"}" title="${editable ? (checked ? "Untick if this isn't done" : "Tick when this is done") : `Only the ${meta.owner.toLowerCase() || "owner"} or an admin can tick this`}">
        <input type="checkbox" data-step="${esc(step)}" ${checked ? "checked" : ""} ${editable ? "" : "disabled"}>
        <span class="pm-step-mark" aria-hidden="true">${checked ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : i + 1}</span>
        <span class="pm-step-text">
          <span class="pm-step-label">${esc(meta.label)}${isCurrent ? ` <span class="pm-now">Now</span>` : ""}</span>
          <span class="pm-step-sub">${sub}</span>
        </span>
      </label>
    </li>`;
  }).join("");

  // Deadlines (admins edit; everyone else reads, and can ask for a change)
  const hasRequest = project.deadlineRequest?.status === "pending" || project.deadlineChangeRequest?.status === "pending";
  const req = project.deadlineRequest || project.deadlineChangeRequest;
  const dlRow = (key, label, value, strong) => {
    const d = value ? daysUntil(value) : null;
    return `<div class="pm-dl${strong ? " is-strong" : ""}">
      <label for="dl-${key}">${esc(label)}${value && d !== null && d < 0 && !(key === "publication" && completed) ? ` <span class="pm-dl-flag">late</span>` : ""}</label>
      <input type="date" id="dl-${key}" class="dl-input" data-dlkey="${esc(key)}" value="${esc(value || "")}" ${isAdmin ? "" : "disabled"}>
    </div>`;
  };
  const deadlineRows = DEADLINE_FIELDS
    .filter(f => !(skipInterviewSteps && (f.key === "contact" || f.key === "interview")))
    .map(f => dlRow(f.key, f.label, deadlines[f.key] || (f.key === "interview" ? (project.interviewDate || "") : ""), false))
    .join("");
  const reqDatesHtml = req?.requestedDeadlines && Object.keys(req.requestedDeadlines).length
    ? `<p>Asked for: ${Object.entries(req.requestedDeadlines).map(([k, v]) => `<strong>${esc((DEADLINE_FIELDS.find(f => f.key === k) || { label: k }).label)}</strong> ${esc(fmtShort(v))}`).join(" · ")}</p>`
    : (req?.requestedDate ? `<p>Asked for publication on <strong>${esc(fmtShort(req.requestedDate))}</strong></p>` : "");
  const deadlineRequestHtml = hasRequest ? `
    <div class="pm-note is-warn">
      <p class="pm-note-title">Deadline change requested</p>
      <p>${esc(req.requestedBy || "Someone")}: ${esc(req.reason || "no reason given")}</p>
      ${reqDatesHtml}
      ${isAdmin ? `<div class="pm-note-actions"><button class="btn btn-primary btn-xs" id="dl-approve-req">Approve</button><button class="btn btn-secondary btn-xs" id="dl-reject-req">Decline</button></div>`
                : `<p class="pm-muted">Waiting for an admin.</p>`}
    </div>` : "";

  // Comments + history in one feed; comments read as messages.
  const acts = [...(project.activity || [])].reverse();
  const actHtml = acts.length ? acts.map(a => {
    const t = a.text || "";
    const cm = /^commented: "([\s\S]*)"$/.exec(t);
    return cm
      ? `<li class="pm-act is-comment"><span class="pm-act-who">${esc(a.authorName || "Someone")}</span><span class="pm-act-when">${a.timestamp ? fmtActivityTime(a.timestamp) : ""}</span><p class="pm-act-msg">${esc(cm[1])}</p></li>`
      : `<li class="pm-act"><span class="pm-act-who">${esc(a.authorName || "Someone")}</span> <span class="pm-act-text">${esc(t)}</span><span class="pm-act-when">${a.timestamp ? fmtActivityTime(a.timestamp) : ""}</span></li>`;
  }).join("") : `<li class="pm-empty">Nothing yet. Comments and every change to this story show up here.</li>`;

  const editorOptions = _allEditors.map(e =>
    `<option value="${esc(e.id)}" ${e.id === project.editorId ? "selected" : ""}>${esc(e.name || e.email)}</option>`
  ).join("");

  const person = (role, name, extra = "") => `
    <div class="pm-person">
      <span class="pm-avatar" style="background:${name ? stringToColor(name) : "#cbd5e1"}">${esc((name || "?")[0].toUpperCase())}</span>
      <span class="pm-person-text"><span class="pm-person-role">${role}</span><span class="pm-person-name">${name ? esc(name) : `<i>Not assigned</i>`}</span></span>
      ${extra}
    </div>`;

  const body = el("div", { class: "pm" });
  body.innerHTML = `
    <div class="pm-chips">
      <span class="pm-chip is-${state.color}">${esc(awaitingPublish ? "Ready to publish" : published ? "Published" : state.status)}</span>
      <span class="pm-chip">${esc(project.type || "Article")}</span>
      ${projectEdition(project) ? `<span class="pm-chip">${esc(projectEdition(project))}</span>` : ""}
      ${due ? `<span class="pm-chip${!completed && daysUntil(due) < 0 ? " is-red" : ""}">Publishes ${esc(fmtShort(due))}</span>` : ""}
      ${isInactive ? `<span class="pm-chip is-red">No activity for ${inactive} days</span>` : ""}
    </div>

    <div class="pm-next${next.tone ? " is-" + next.tone : ""}">
      <span class="pm-next-label">${published ? "Status" : "What happens next"}</span>
      <p class="pm-next-text">${next.html}</p>
      ${next.owner ? `<span class="pm-next-owner">${esc(next.owner)}</span>` : ""}
    </div>

    <div class="pm-grid">
      <div class="pm-main">
        <section class="pm-sec">
          <div class="pm-sec-head"><h3>Pitch</h3>${canEdit ? `<button class="btn btn-ghost btn-xs" id="edit-proposal-btn">${project.proposal ? "Edit" : "Add pitch"}</button>` : ""}</div>
          ${project.proposal ? `<p id="proposal-display" class="pm-pitch">${esc(project.proposal)}</p>` : `<p class="pm-muted">No pitch written yet.</p>`}
        </section>

        <section class="pm-sec">
          <div class="pm-sec-head"><h3>Steps</h3><span class="pm-muted">${relevantSteps.filter(st => tl[st]).length} of ${relevantSteps.length} done</span></div>
          ${project.interviewDate && project.type === "Interview" && !project.noInterview && !tl["Interview Complete"] ? `<p class="pm-note">Interview on <strong>${esc(fmtDate(project.interviewDate + "T00:00:00"))}</strong></p>` : ""}
          <ol id="tl-steps" class="pm-steps">${stepsHtml}</ol>
          <p class="pm-hint">Tick a step when it's done. Finishing the draft and the review each ask for a short checklist first.</p>
        </section>

        <section class="pm-sec">
          <div class="pm-sec-head"><h3>Comments &amp; history</h3></div>
          <div class="pm-compose">
            <input id="comment-input" placeholder="Write a comment for the team…" aria-label="Comment">
            <button class="btn btn-primary btn-sm" id="post-comment-btn">Post</button>
          </div>
          <p class="pm-hint">${project.authorId && project.authorId !== _uid ? `${esc(project.authorName || "The writer")} gets an email copy.` : "Admins see every comment."}</p>
          <ul id="act-feed" class="pm-feed">${actHtml}</ul>
        </section>
      </div>

      <aside class="pm-side">
        <section class="pm-card">
          <h3>People</h3>
          ${person("Writer", project.authorName)}
          ${isAdmin ? `
            <div class="pm-field">
              <label for="editor-select">Editor</label>
              <div class="pm-inline">
                <select id="editor-select"><option value="">Choose an editor…</option>${editorOptions}</select>
                <button class="btn btn-primary btn-sm" id="assign-editor-btn">${project.editorId ? "Change" : "Assign"}</button>
              </div>
              <p class="pm-hint">They get an email with the draft deadline.</p>
            </div>` : person("Editor", project.editorName)}
        </section>

        ${isAdmin ? `
        <section class="pm-card">
          <h3>Edition</h3>
          <div class="pm-inline">
            <select id="edition-select" aria-label="Edition">${editionOptionsHtml(projectEdition(project), { includeNone: true, noneLabel: "No edition yet" })}</select>
            <button class="btn btn-secondary btn-sm" id="set-edition-btn">Move</button>
          </div>
        </section>` : ""}

        <section class="pm-card">
          <div class="pm-sec-head"><h3>Deadlines</h3>
            ${(isAuthor || isEditor) && !isAdmin && !hasRequest ? `<button class="btn btn-ghost btn-xs" id="req-deadline-btn">Ask to change</button>` : ""}
          </div>
          ${dlRow("publication", "Publication", deadlines.publication || project.deadline || "", true)}
          ${deadlineRows}
          ${isAdmin ? `<button class="btn btn-secondary btn-sm pm-block" id="save-deadlines-btn">Save deadlines</button>` : ""}
          ${deadlineRequestHtml}
          ${(deadlines.publication || project.deadline || deadlines.interview) ? `<button class="btn btn-ghost btn-xs pm-block" id="cal-export-btn" type="button">Add to my calendar</button>` : ""}
        </section>
        ${awaitingPublish && isAdmin ? `<p class="pm-note is-purple">Editing is done. Publish it from <a href="#/admin/articles">Articles &amp; approvals</a>, or use &ldquo;Mark as published&rdquo; if it's already live.</p>` : ""}
      </aside>
    </div>
  `;

  // Footer buttons
  const footerBtns = [];
  if (isAdmin && project.proposalStatus === "pending") {
    const approveBtn = el("button", { class: "btn btn-primary btn-sm" }, "Approve pitch");
    approveBtn.onclick = async () => {
      approveBtn.disabled = true;
      try {
        const approvedAtDate = new Date();
        const approvedAt = approvedAtDate.toISOString();
        // Auto-set the contact-professor deadline two days from now for
        // Interview-type stories, unless an admin already filled it in.
        const autoDeadlines = deadlinePatchOnApproval(project, approvedAtDate);
        await updateDoc(doc(workflowDb, "projects", project.id), {
          proposalStatus: "approved",
          proposalApprovedAt: approvedAt,
          "timeline.Topic Proposal Complete": true,
          lastActivity: serverTimestamp(),
          activity: arrayUnion({ text: "approved the proposal", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
          updatedAt: approvedAt,
          ...autoDeadlines,
        });
        // Fire the approval email to the writer (best-effort — don't fail the approve if this errors).
        try {
          await _ctx.authedFetch("/api/notify/event", {
            method: "POST",
            body: JSON.stringify({ type: "proposal-approved", projectId: project.id }),
          });
        } catch (notifyErr) {
          console.warn("proposal-approved notify failed (non-blocking):", notifyErr);
        }
        toast("Proposal approved!", "success");
        m.close();
      } catch (e) { toast(e.message, "error"); approveBtn.disabled = false; }
    };
    footerBtns.push(approveBtn);
  }
  if (isAdmin && project.proposalStatus !== "rejected") {
    const rejectBtn = el("button", { class: "btn btn-secondary btn-sm", style: { color: "var(--danger)" } }, project.proposalStatus === "pending" ? "Decline pitch" : "Drop story");
    rejectBtn.onclick = async () => {
      const ok = await confirmDialog(project.proposalStatus === "pending"
        ? "Decline this pitch? The writer can edit it and ask again."
        : "Drop this story? It goes back to the pitch column marked as declined.", { confirmText: project.proposalStatus === "pending" ? "Decline" : "Drop story", danger: true });
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
  if (isAdmin && awaitingPublish) {
    // Manual override for the purple state: if the story is already live (or
    // was published under a different title, so the auto-match missed it),
    // the admin can clear the "needs publishing" flag right here.
    const pubBtn = el("button", { class: "btn btn-primary btn-sm" }, "Mark as published");
    pubBtn.onclick = async () => {
      const ok = await confirmDialog(
        "Mark this project as published? Do this once the article is live on the site — the card will turn back to a normal completed card.",
        { confirmText: "Mark as published" }
      );
      if (!ok) return;
      pubBtn.disabled = true;
      try {
        await updateDoc(doc(workflowDb, "projects", project.id), {
          publishedAt: new Date().toISOString(),
          lastActivity: serverTimestamp(),
          updatedAt: new Date().toISOString(),
          activity: arrayUnion({ text: "marked the story as published 🎉", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
        });
        toast("Marked as published.", "success");
        m.close();
      } catch (e) { toast(e.message, "error"); pubBtn.disabled = false; }
    };
    footerBtns.push(pubBtn);
  }
  const closeBtn = el("button", { class: "btn btn-secondary btn-sm" }, "Done");
  footerBtns.push(closeBtn);

  const m = openModal({ title: esc(project.title), body, footer: footerBtns, size: "wide" });
  closeBtn.onclick = m.close;

  // The "needs publishing" banner links into All articles & approvals — close
  // the modal on click so it doesn't linger over the next page.
  body.querySelector('a[href="#/admin/articles"]')?.addEventListener("click", () => m.close());

  // ── Wire interactions ──────────────────────────────────────────────────────

  // Timeline checkboxes — wired for any user who can toggle at least one step
  if (canEdit) {
    body.querySelector("#tl-steps")?.addEventListener("change", async e => {
      const cb = e.target.closest("input[type=checkbox][data-step]");
      if (!cb) return;
      const step = cb.dataset.step;
      if (!canToggleStep(step)) { cb.checked = !cb.checked; return; } // safety guard
      const checked = cb.checked;

      // Gate: when *completing* a step that has a required checklist,
      // open the checklist modal first. Unchecking bypasses the gate so
      // users can always reverse a premature click.
      let checklistPayload = null;
      const gate = checked ? STEP_CHECKLISTS[step] : null;
      if (gate) {
        cb.checked = false; // keep UI honest until the user actually confirms
        checklistPayload = await openChecklistModal(gate);
        if (!checklistPayload) {
          toast("Checklist not completed — step left unchecked.", "info");
          return;
        }
        cb.checked = true;
      }

      // Interview Scheduled: capture the date when checking, clear it when unchecking.
      // The bot uses this date to email prep tips two days before the interview.
      let interviewDatePayload = null;
      if (step === "Interview Scheduled" && checked) {
        cb.checked = false;
        interviewDatePayload = await openInterviewDateModal({ existingDate: project.interviewDate });
        if (!interviewDatePayload) {
          toast("No date set — interview not marked as scheduled.", "info");
          return;
        }
        cb.checked = true;
      }

      const updates = {
        [`timeline.${step}`]: checked,
        lastActivity: serverTimestamp(),
        updatedAt: new Date().toISOString(),
        activity: arrayUnion({ text: `${checked ? "completed" : "uncompleted"}: ${step}`, authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
      };
      if (interviewDatePayload) {
        updates.interviewDate = interviewDatePayload.interviewDate;
        updates.interviewReminderSent = false;
        // Mirror the date onto the deadline grid so the "Conduct Interview"
        // row reflects the scheduled date without the writer having to
        // re-enter it. Stays editable by admin like any other deadline.
        updates["deadlines.interview"] = interviewDatePayload.interviewDate;
        updates.activity = arrayUnion(
          { text: `${checked ? "completed" : "uncompleted"}: ${step}`, authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() },
          { text: `scheduled the interview for ${interviewDatePayload.interviewDate}`, authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() },
        );
      }
      if (step === "Interview Scheduled" && !checked) {
        updates.interviewDate = deleteField();
        updates.interviewReminderSent = deleteField();
        // Clear the mirrored deadline too so the row resets cleanly.
        updates["deadlines.interview"] = deleteField();
      }
      if (checklistPayload) {
        // Stamp who/when confirmed the checklist so admins can audit it later.
        updates[`checklists.${checklistPayload.storageKey}`] = {
          confirmedBy: _profile.name || _ctx.user.email,
          confirmedById: _uid,
          confirmedAt: checklistPayload.checkedAt,
          items: checklistPayload.items,
        };
        updates.activity = arrayUnion(
          { text: `${checked ? "completed" : "uncompleted"}: ${step}`, authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() },
          { text: `confirmed the ${gate.modalTitle.toLowerCase()}`, authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() },
        );
      }
      // Heal drifted authorId on the first successful write by the true author.
      if (isAuthor && project.authorId !== _uid) updates.authorId = _uid;
      // Auto-approve proposal when admin checks "Topic Proposal Complete".
      // Same auto-deadline patches the dedicated Approve button applies, so
      // both code paths leave the project in identical shape.
      if (step === "Topic Proposal Complete" && checked && isAdmin) {
        updates.proposalStatus = "approved";
        const approvedAtDate = new Date();
        if (!project.proposalApprovedAt) {
          updates.proposalApprovedAt = approvedAtDate.toISOString();
        }
        Object.assign(updates, deadlinePatchOnApproval(project, approvedAtDate));
      }
      if (step === "Topic Proposal Complete" && !checked && isAdmin) updates.proposalStatus = "pending";

      // Interview Scheduled: set the writer's draft deadline a week after the
      // interview, unless an admin already filled it in.
      if (step === "Interview Scheduled" && checked && interviewDatePayload) {
        Object.assign(updates, deadlinePatchOnInterviewScheduled(project, interviewDatePayload.interviewDate));
      }

      // Review Complete: give the writer a week to address edits.
      if (step === "Review Complete" && checked) {
        Object.assign(updates, deadlinePatchOnReviewComplete(project, new Date()));
      }
      try {
        await updateDoc(doc(workflowDb, "projects", project.id), updates);
        toast(checked ? "Step marked complete." : "Step unchecked.", "success");
        // Ping admins on every timeline toggle (server coalesces bursts).
        try {
          await _ctx.authedFetch("/api/notify/event", {
            method: "POST",
            body: JSON.stringify({
              type: "activity-update",
              projectId: project.id,
              activity: {
                text: `${checked ? "completed" : "uncompleted"}: ${step}`,
                kind: "timeline-toggle",
                actorName: _profile.name || _ctx.user.email,
              },
            }),
          });
        } catch (notifyErr) {
          console.warn("activity-update notify failed (non-blocking):", notifyErr);
        }
        // Editor just finished reviewing → email the writer that their
        // edits are ready and they have a week to work through them.
        // Best-effort: never block the user flow on a flaky email send.
        if (step === "Review Complete" && checked) {
          try {
            await _ctx.authedFetch("/api/notify/event", {
              method: "POST",
              body: JSON.stringify({ type: "review-complete", projectId: project.id }),
            });
          } catch (notifyErr) {
            console.warn("review-complete notify failed (non-blocking):", notifyErr);
          }
        }
        // After scheduling an interview, offer to save the date (with prep
        // tips embedded in the description) to the user's calendar.
        if (interviewDatePayload && step === "Interview Scheduled" && checked) {
          try {
            await showCalendarExportPrompt({
              id: project.id,
              title: project.title,
              interviewDate: interviewDatePayload.interviewDate,
              deadlines: { ...(project.deadlines || {}), interview: interviewDatePayload.interviewDate },
            }, {
              only: "interview",
              title: "Save the interview to your calendar",
              subtitle: `We'll attach a 5-day reminder and a prep checklist to the event so you can review it the morning of.`,
            });
          } catch (calErr) {
            console.warn("Calendar export prompt failed:", calErr);
          }
        }
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
      const assignedAt = new Date();
      // Stamp editorAssignedAt + auto-set the editor-review deadline (7 days
      // out) unless an admin already set one. Reassigning to a different
      // editor refreshes the timestamp so the review-overdue reminder
      // restarts its 7-day clock.
      const autoDeadlines = deadlinePatchOnEditorAssigned(project, assignedAt);
      await updateDoc(doc(workflowDb, "projects", project.id), {
        editorId,
        editorName: editor?.name || editor?.email || "Editor",
        updatedAt: assignedAt.toISOString(),
        lastActivity: serverTimestamp(),
        activity: arrayUnion({
          text: prevName ? `reassigned editor from ${prevName} to ${editor?.name}` : `assigned ${editor?.name} as editor`,
          authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString(),
        }),
        ...autoDeadlines,
      });
      // Fire the editor-assigned email (best-effort, non-blocking). The server
      // reads the project doc after our write, so it'll see the freshly stamped
      // deadlines.review and surface it in the email.
      try {
        await _ctx.authedFetch("/api/notify/event", {
          method: "POST",
          body: JSON.stringify({ type: "editor-assigned", projectId: project.id }),
        });
      } catch (notifyErr) {
        console.warn("editor-assigned notify failed (non-blocking):", notifyErr);
      }
      toast("Editor assigned!", "success"); m.close();
    } catch (e) { toast(e.message, "error"); btn.disabled = false; }
  });

  // Move to another edition (admin)
  body.querySelector("#set-edition-btn")?.addEventListener("click", async () => {
    const next = body.querySelector("#edition-select")?.value || "";
    const prev = projectEdition(project);
    if (next === prev) return toast("The story is already in that edition.", "info");
    const btn = body.querySelector("#set-edition-btn");
    btn.disabled = true;
    try {
      await updateDoc(doc(workflowDb, "projects", project.id), {
        edition: next || deleteField(),
        updatedAt: new Date().toISOString(),
        lastActivity: serverTimestamp(),
        activity: arrayUnion({
          text: next ? `moved the story to ${next}` : `removed the story from ${prev}`,
          authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString(),
        }),
      });
      // Already live? Move the public story too, so it appears on (or
      // leaves) that edition's page right away.
      if (project.publishedStoryId) await setStoryEdition(project.publishedStoryId, next);
      toast(next ? `Moved to ${next}.` : "Removed from its edition.", "success"); m.close();
    } catch (e) { toast(e.message, "error"); btn.disabled = false; }
  });

  // Save deadlines
  body.querySelector("#save-deadlines-btn")?.addEventListener("click", async () => {
    const inputs = body.querySelectorAll(".dl-input");
    const patch = {};
    const newDeadlines = { ...(project.deadlines || {}) };
    inputs.forEach(inp => {
      if (!inp.dataset.dlkey) return;
      const v = inp.value || null;
      patch[`deadlines.${inp.dataset.dlkey}`] = v;
      newDeadlines[inp.dataset.dlkey] = v || "";
    });
    patch.updatedAt = new Date().toISOString();
    patch.lastActivity = serverTimestamp();
    patch.activity = arrayUnion({ text: "updated deadlines", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() });
    const btn = body.querySelector("#save-deadlines-btn");
    btn.disabled = true;
    try {
      await updateDoc(doc(workflowDb, "projects", project.id), patch);
      toast("Deadlines saved.", "success");
      m.close();
      // Prompt to add the new publication / interview date(s) to the user's
      // calendar. Skipped silently if no relevant date was actually changed.
      const changedKey = (k) => (project.deadlines || {})[k] !== newDeadlines[k];
      const datesChanged = changedKey("publication") || changedKey("interview");
      if (datesChanged) {
        try {
          await showCalendarExportPrompt({
            id: project.id,
            title: project.title,
            deadlines: newDeadlines,
            deadline: newDeadlines.publication || project.deadline,
          });
        } catch (calErr) {
          console.warn("Calendar export prompt failed:", calErr);
        }
      }
    } catch (e) { toast(e.message, "error"); btn.disabled = false; }
  });

  // Save to calendar (.ics + Google Calendar) for the current deadlines.
  body.querySelector("#cal-export-btn")?.addEventListener("click", () => {
    showCalendarExportPrompt({
      id: project.id,
      title: project.title,
      deadlines: project.deadlines || {},
      deadline: project.deadline,
    }).catch((calErr) => console.warn("Calendar export prompt failed:", calErr));
  });

  // Request deadline change
  body.querySelector("#req-deadline-btn")?.addEventListener("click", () => openDeadlineRequestModal(project, m));

  // Deadline request approve/reject
  body.querySelector("#dl-approve-req")?.addEventListener("click", async () => {
    const updates = { updatedAt: new Date().toISOString() };
    // Apply the requested deadlines
    if (req?.requestedDate) updates["deadlines.publication"] = req.requestedDate;
    if (req?.requestedDeadlines) Object.entries(req.requestedDeadlines).forEach(([k, v]) => { updates[`deadlines.${k}`] = v; });
    // Clear whichever request field is set
    if (project.deadlineChangeRequest) updates.deadlineChangeRequest = deleteField();
    if (project.deadlineRequest) updates.deadlineRequest = deleteField();
    updates.lastActivity = serverTimestamp();
    updates.activity = arrayUnion({ text: "approved the deadline change request", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() });
    try { await updateDoc(doc(workflowDb, "projects", project.id), updates); toast("Request approved.", "success"); m.close(); }
    catch (e) { toast(e.message, "error"); }
  });

  body.querySelector("#dl-reject-req")?.addEventListener("click", async () => {
    const updates = { updatedAt: new Date().toISOString() };
    // Clear whichever request field is set
    if (project.deadlineChangeRequest) updates.deadlineChangeRequest = deleteField();
    if (project.deadlineRequest) updates.deadlineRequest = deleteField();
    updates.lastActivity = serverTimestamp();
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
      const row = el("li", { class: "pm-act is-comment" });
      row.innerHTML = `<span class="pm-act-who">${esc(_profile.name || _ctx.user.email)}</span><span class="pm-act-when">just now</span><p class="pm-act-msg">${esc(text)}</p>`;
      feed.querySelector(".pm-empty")?.remove();
      feed.insertBefore(row, feed.firstChild);
      commentInput.value = "";
      toast("Comment posted.", "success");
      // Email the story's author a copy when someone else comments — the chat
      // keeps the thread, the email makes sure they actually see it.
      if (project.authorId && project.authorId !== _uid) {
        _ctx.authedFetch("/api/notify/comment", {
          method: "POST",
          body: JSON.stringify({ projectId: project.id, message: text, toUserId: project.authorId }),
        }).catch((err) => console.warn("comment email failed (non-blocking):", err));
      }
      try {
        await _ctx.authedFetch("/api/notify/event", {
          method: "POST",
          body: JSON.stringify({
            type: "activity-update",
            projectId: project.id,
            activity: {
              text: `commented: "${text.slice(0, 200)}"`,
              kind: "comment",
              actorName: _profile.name || _ctx.user.email,
            },
          }),
        });
      } catch (notifyErr) {
        console.warn("activity-update notify failed (non-blocking):", notifyErr);
      }
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

  // Edition picker — shown once any edition exists. New pitches must pick one
  // (defaulting to the tab they're on, else the current edition); authors can
  // move their story but only admins can take it out of an edition entirely.
  const filterEd = _view === "all" ? activeEditionFilter() : ED_ALL;
  const defaultEdition = isEdit
    ? projectEdition(p)
    : (filterEd !== ED_ALL && filterEd !== ED_NONE ? filterEd : _editions.current || "");
  const editionField = allEditionNames().length ? `
    <div class="field">
      <label class="label" for="pm-edition">Edition${isEdit ? "" : ` <span style="color:var(--danger)">*</span>`}</label>
      <select class="select" id="pm-edition">
        ${!defaultEdition ? `<option value="" selected ${isEdit ? "" : "disabled"}>${isEdit ? "Not assigned yet" : "Choose an edition"}</option>` : ""}
        ${editionOptionsHtml(defaultEdition)}
      </select>
    </div>` : "";

  const body = el("div", {});
  body.innerHTML = `
    <div class="field">
      <label class="label">Title <span style="color:var(--danger)">*</span></label>
      <input class="input" id="pm-title" placeholder="Article or project title" value="${esc(p.title || "")}">
    </div>
    ${editionField}
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
    <div class="field" id="pm-nointerview-wrap" style="${(p.type || "Interview") === "Interview" ? "" : "display:none;"}">
      <label style="display:flex;align-items:flex-start;gap:10px;padding:11px 14px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;user-select:none;font-size:13px;line-height:1.5;color:#1f2937;">
        <input type="checkbox" id="pm-nointerview" ${p.noInterview ? "checked" : ""} style="margin-top:2px;width:15px;height:15px;flex-shrink:0;accent-color:var(--ink,#0f172a);cursor:pointer;">
        <span><strong>No interview for this story</strong> — there's no one to interview, so skip the interview steps and deadlines. The story goes straight to the writing stage once approved.</span>
      </label>
    </div>
    <div class="field">
      <label class="label">Pitch / proposal <span style="color:var(--danger)">*</span></label>
      <textarea class="textarea" id="pm-proposal" rows="5" placeholder="Describe the story idea, angle, and why it matters…">${esc(p.proposal || "")}</textarea>
    </div>
    <div id="pm-err" style="color:var(--danger);font-size:12px;margin-top:4px;"></div>`;

  // The no-interview option only makes sense for Interview-type stories
  // (Op-Eds never have interview steps to begin with).
  body.querySelector("#pm-type").addEventListener("change", (e) => {
    body.querySelector("#pm-nointerview-wrap").style.display =
      e.target.value === "Interview" ? "" : "none";
  });

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
    const noInterview = type === "Interview" && body.querySelector("#pm-nointerview").checked;
    const edition = body.querySelector("#pm-edition")?.value || "";

    if (title.length < 3)  { err.textContent = "Title must be at least 3 characters."; return; }
    if (!isEdit && body.querySelector("#pm-edition") && !edition) { err.textContent = "Choose which edition this story is for."; return; }
    if (!deadline)          { err.textContent = "Publication deadline is required."; return; }
    if (!proposal)          { err.textContent = "A pitch description is required."; return; }
    const dlDate = new Date(deadline);
    if (dlDate < new Date(new Date().toDateString())) { err.textContent = "Deadline must be in the future."; return; }

    saveBtn.disabled = true; saveBtn.textContent = isEdit ? "Saving…" : "Submitting…";

    const patch = {
      title, type, noInterview,
      "deadlines.publication": deadline,
      deadline,
      proposal,
      updatedAt: new Date().toISOString(),
    };
    if (edition) patch.edition = edition;

    try {
      if (isEdit) {
        await updateDoc(doc(workflowDb, "projects", p.id), {
          ...patch,
          lastActivity: serverTimestamp(),
          activity: arrayUnion({ text: "edited the proposal", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
        });
        toast("Proposal updated.", "success");
      } else {
        const newDoc = await addDoc(collection(workflowDb, "projects"), {
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
        m.close();
        // Offer .ics + Google Calendar export with a 5-day reminder so the
        // writer doesn't forget the deadline.
        try {
          await showCalendarExportPrompt({
            id: newDoc.id,
            title,
            deadlines: { publication: deadline },
          });
        } catch (calErr) {
          console.warn("Calendar export prompt failed:", calErr);
        }
        return;
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
  const deadlines = project.deadlines || {};

  const fields = DEADLINE_FIELDS
    .filter(f => !((project.type === "Op-Ed" || project.noInterview) && (f.key === "contact" || f.key === "interview")))
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
  const m = openModal({ title: "Request deadline change", body, footer: [cancelBtn, submitBtn], stack: true });
  cancelBtn.onclick = m.close;

  submitBtn.onclick = async () => {
    const reason = body.querySelector("#dlreq-reason").value.trim();
    const errEl  = body.querySelector("#dlreq-err");
    errEl.textContent = "";
    if (!reason) { errEl.textContent = "Please explain the reason for the request."; return; }
    const requested = {};
    body.querySelectorAll("input[data-dlkey]").forEach(inp => { if (inp.value) requested[inp.dataset.dlkey] = inp.value; });
    if (!Object.keys(requested).length) { errEl.textContent = "Please select at least one new deadline date."; return; }
    submitBtn.disabled = true;
    try {
      await updateDoc(doc(workflowDb, "projects", project.id), {
        deadlineChangeRequest: { requestedBy: _profile.name || _ctx.user.email, reason, requestedDeadlines: requested, status: "pending", requestedAt: new Date().toISOString() },
        deadlineRequest: deleteField(),
        lastActivity: serverTimestamp(),
        updatedAt: new Date().toISOString(),
        activity: arrayUnion({ text: "requested a deadline change", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
      });
      toast("Request submitted — awaiting admin approval.", "success", 4000);
      m.close();
      parentModal?.close();
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
      <td data-label="Name"><strong>${esc(p.name)}</strong></td>
      <td data-label="Authored">${p.authored}</td>
      <td data-label="Editing">${p.editing}</td>
      <td data-label="Overdue">${p.overdue > 0 ? `<span style="color:var(--danger)">${p.overdue} overdue</span>` : "0"}</td>
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
  _view    = "all";

  const bodyEl = el("div", { class: "pipeline-embed" });
  mountEl.appendChild(bodyEl);

  const unsub = onSnapshot(
    collection(workflowDb, "projects"),
    snap => {
      _allProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const byCol = {};
      for (const name of VIEW_COLUMNS.all) byCol[name] = [];
      for (const p of _allProjects) {
        const { column } = getProjectState(p, "all", _uid);
        if (byCol[column]) byCol[column].push(p);
      }
      bodyEl.innerHTML = "";
      const grid = el("div", { class: "pipeline-embed-grid" });
      for (const name of VIEW_COLUMNS.all) {
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
            <div class="pipeline-item-meta">${esc([projectEdition(p), p.type, author && `by ${author}`, due && `due ${fmtShort(due)}`].filter(Boolean).join(" · "))}</div>`;
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
    err => { bodyEl.innerHTML = `<div class="error-state">Story Tracker error: ${esc(err.message)}</div>`; }
  );

  return () => unsub();
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}


// ─── Articles in the works ────────────────────────────────────────────────────
// #/writer/feed: a read-only roundup of every story in progress, for the whole
// team. Same data and stage logic as the Story Tracker, laid out as a list
// grouped by how close each story is to publication. A row opens the same
// detail panel as a tracker card (which applies its own role permissions).

const WORKS_STAGES = [
  { key: "ready",     label: "Ready to publish", hint: "Fully edited. An admin publishes it." },
  { key: "edits",     label: "Making edits",     hint: "The writer is working through the editor's notes." },
  { key: "review",    label: "Editing",          hint: "Finished drafts: getting an editor, or with one now." },
  { key: "writing",   label: "Writing",          hint: "Drafts being written." },
  { key: "interview", label: "Interviewing",     hint: "Scheduling and doing interviews." },
  { key: "pitch",     label: "Pitches",          hint: "Waiting for an admin to approve." },
];

function worksStageOf(p) {
  if (p.proposalStatus === "rejected") return null;
  if (isProjectCompleted(p)) {
    const live = p.publishedAt || p.publishedStoryId || (_publishedTitlesLoaded && isProjectPublished(p, _publishedTitles));
    return live ? "published" : "ready";
  }
  // A finished draft waiting for an editor belongs with editing, not writing.
  if ((p.timeline || {})["Article Writing Complete"]) return "review";
  const { column } = getProjectState(p, "all", _uid);
  return {
    [COL.TOPIC_PROPOSAL]: "pitch",
    [COL.INTERVIEW_STAGE]: "interview",
    [COL.WRITING_STAGE]: "writing",
    [COL.IN_REVIEW]: "review",
    [COL.REVIEWING_SUGGESTIONS]: "edits",
  }[column] || "pitch";
}

// Share of this story's own steps that are done (no interview steps for a
// story that doesn't need one).
function worksProgress(p) {
  const tl = p.timeline || {};
  const steps = TIMELINE_STEPS.filter((s) => p.type === "Interview" && !p.noInterview ? true : !s.startsWith("Interview"));
  const done = steps.filter((s) => tl[s]).length;
  return { done, total: steps.length, pct: Math.round((done / steps.length) * 100) };
}

function worksDue(p) {
  const due = pubDeadline(p);
  if (!due) return { text: "No date yet", tone: "muted" };
  const d = daysUntil(due);
  if (d < 0) return { text: `${-d} day${d === -1 ? "" : "s"} late`, tone: "late", title: `Publication date was ${fmtShort(due)}` };
  if (d === 0) return { text: "Due today", tone: "soon" };
  if (d <= 7) return { text: `Due in ${d} day${d === 1 ? "" : "s"}`, tone: "soon", title: fmtShort(due) };
  return { text: `Due ${fmtShort(due)}`, tone: "muted" };
}

function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function ensureWorksStyles() {
  if (document.getElementById("iw-styles")) return;
  const st = document.createElement("style");
  st.id = "iw-styles";
  st.textContent = `
  .iw { display: grid; gap: 22px; max-width: 1180px; }
  .iw-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 14px 24px; }
  .iw-head h2 { margin: 0; font: 600 22px/1.2 var(--font); letter-spacing: -0.02em; color: var(--ink); }
  .iw-head p { margin: 6px 0 0; max-width: 560px; font-size: 14px; line-height: 1.55; color: var(--muted); }
  .iw-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .iw-search { position: relative; }
  .iw-search svg { position: absolute; left: 12px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); color: var(--muted-2); pointer-events: none; }
  .iw-search input { width: 240px; max-width: 100%; min-height: 40px; padding: 0 12px 0 36px; border: 1px solid var(--hairline); border-radius: 999px; background: var(--surface); font: 400 13.5px var(--font); color: var(--ink); }
  .iw-search input:focus-visible { outline: none; box-shadow: var(--focus); border-color: var(--ink-2); }
  .iw-seg { display: inline-flex; padding: 3px; border: 1px solid var(--hairline); border-radius: 999px; background: var(--surface); }
  .iw-seg button { min-height: 34px; padding: 0 14px; border: 0; border-radius: 999px; background: none; font: 500 13px var(--font); color: var(--muted); cursor: pointer; }
  .iw-seg button[aria-pressed="true"] { background: var(--ink); color: var(--surface); }
  .iw-seg button:focus-visible { outline: none; box-shadow: var(--focus); }

  /* the pipeline at a glance: one segment per stage, closest to publication first */
  .iw-strip { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
  .iw-strip a { display: grid; gap: 4px; padding: 14px 16px; border-left: 1px solid var(--hairline-2); color: inherit; text-decoration: none; transition: background-color .2s; }
  .iw-strip a:first-child { border-left: 0; }
  .iw-strip a:hover { background: var(--surface-3); }
  .iw-strip a:focus-visible { outline: none; box-shadow: inset var(--focus); }
  .iw-strip b { font: 600 24px/1 var(--font); letter-spacing: -0.02em; color: var(--ink); }
  .iw-strip span { font: 500 12px/1.3 var(--font); color: var(--muted); }
  .iw-strip a.is-empty b { color: var(--muted-2); }

  .iw-group { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface); overflow: hidden; scroll-margin-top: 90px; }
  .iw-group-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; padding: 16px 20px 12px; border-bottom: 1px solid var(--hairline-2); }
  .iw-group-head h3 { margin: 0; font: 600 15px/1.3 var(--font); color: var(--ink); }
  .iw-group-head .n { font: 600 12px/1 var(--font); color: var(--muted); padding: 3px 8px; border-radius: 999px; background: var(--surface-3); }
  .iw-group-head p { flex: 1 1 260px; margin: 0; font-size: 12.5px; color: var(--muted); }
  .iw-group[data-stage="ready"] .iw-group-head { box-shadow: inset 3px 0 0 var(--good); }

  .iw-row { display: grid; grid-template-columns: minmax(0, 1fr) 190px 128px; align-items: center; gap: 8px 24px; padding: 14px 20px; border-top: 1px solid var(--hairline-2); cursor: pointer; transition: background-color .15s; }
  .iw-row:first-of-type { border-top: 0; }
  .iw-row:hover { background: var(--surface-2); }
  .iw-row:focus-visible { outline: none; box-shadow: inset var(--focus); }
  .iw-title { margin: 0; font: 600 15px/1.35 var(--font); color: var(--ink); overflow-wrap: anywhere; }
  .iw-tags { display: inline-flex; flex-wrap: wrap; gap: 6px; margin-left: 8px; vertical-align: 2px; }
  .iw-tag { padding: 2px 8px; border-radius: 999px; background: var(--surface-3); font: 500 11px/1.5 var(--font); color: var(--ink-2); white-space: nowrap; }
  .iw-next { margin: 5px 0 0; font-size: 13px; line-height: 1.5; color: var(--muted); }
  .iw-next strong { color: var(--ink-2); font-weight: 600; }
  .iw-people { display: grid; gap: 6px; min-width: 0; }
  .iw-person { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12.5px; color: var(--ink-2); }
  .iw-person i { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--ink); color: var(--surface); font: 600 10px/1 var(--font); font-style: normal; }
  .iw-person.is-editor i { background: var(--surface-3); color: var(--ink-2); }
  .iw-person.is-none { color: var(--muted-2); }
  .iw-person.is-none i { background: none; border: 1px dashed var(--muted-2); color: var(--muted-2); }
  .iw-person span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .iw-when { display: grid; gap: 7px; justify-items: end; text-align: right; }
  .iw-due { font: 500 12.5px/1.3 var(--font); color: var(--muted); white-space: nowrap; }
  .iw-due.is-late { color: var(--danger); font-weight: 600; }
  .iw-due.is-soon { color: var(--warn); }
  .iw-bar { width: 100%; height: 4px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
  .iw-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--ink); }
  .iw-steps { font-size: 11px; color: var(--muted-2); }

  .iw-pub .iw-row { grid-template-columns: minmax(0, 1fr) auto; padding: 11px 20px; }
  .iw-pub .iw-title { font-weight: 500; font-size: 14px; }
  .iw-pub .iw-due { color: var(--good); }
  .iw-empty { padding: 48px 20px; text-align: center; color: var(--muted); font-size: 14px; border: 1px dashed var(--hairline); border-radius: var(--radius); }

  @media (max-width: 900px) {
    .iw-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .iw-strip a:nth-child(4) { border-left: 0; }
    .iw-strip a:nth-child(n+4) { border-top: 1px solid var(--hairline-2); }
    .iw-row { grid-template-columns: minmax(0, 1fr) 128px; }
    .iw-people { grid-column: 1 / -1; grid-row: 2; display: flex; flex-wrap: wrap; gap: 6px 16px; }
  }
  @media (max-width: 560px) {
    .iw-search input { width: 100%; }
    .iw-search, .iw-tools { width: 100%; }
    .iw-row { grid-template-columns: minmax(0, 1fr); padding: 14px 16px; }
    .iw-when { grid-row: 3; justify-items: start; text-align: left; grid-template-columns: auto 1fr; align-items: center; gap: 12px; }
    .iw-group-head { padding: 14px 16px 10px; }
  }
  @media (prefers-reduced-motion: reduce) { .iw-row, .iw-strip a { transition: none; } }`;
  document.head.appendChild(st);
}

async function mountWorks(ctx, container) {
  ensureWorksStyles();
  container.innerHTML = "";
  const page = el("div", { class: "iw" });
  page.innerHTML = `
    <div class="iw-head">
      <div>
        <h2>Articles in the works</h2>
        <p>Every story the newsroom is working on, from pitch to publication. Open one to see its checklist, dates and people.</p>
      </div>
      <div class="iw-tools">
        <label class="iw-search"><span class="sr-only">Search stories</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="iw-q" placeholder="Search title or name" autocomplete="off">
        </label>
        <div class="iw-seg" role="group" aria-label="Show">
          <button type="button" data-who="all" aria-pressed="true">Everyone</button>
          <button type="button" data-who="mine" aria-pressed="false">Just mine</button>
        </div>
      </div>
    </div>
    <nav class="iw-strip" id="iw-strip" aria-label="Stories by stage"></nav>
    <div id="iw-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(page);

  let who = "all", q = "";
  const render = () => renderWorks(page, who, q);
  page.querySelector("#iw-q").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); render(); });
  page.querySelector(".iw-seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-who]"); if (!b) return;
    who = b.dataset.who;
    page.querySelectorAll(".iw-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });
  const open = (e) => {
    const row = e.target.closest("[data-project]"); if (!row) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openDetailModal(row.dataset.project);
  };
  page.querySelector("#iw-body").addEventListener("click", open);
  page.querySelector("#iw-body").addEventListener("keydown", open);

  await loadEditors();   // the detail panel's editor picker
  fetchPublishedTitleSet()
    .then((set) => { _publishedTitles = set; _publishedTitlesLoaded = true; render(); })
    .catch((err) => console.warn("[works] published titles", err));
  const unsubProjects = onSnapshot(collection(workflowDb, "projects"),
    (snap) => { _allProjects = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); },
    (err) => { page.querySelector("#iw-body").innerHTML = `<div class="error-state">Could not load stories: ${esc(err.message)}</div>`; });
  const unsubEditions = onSnapshot(doc(workflowDb, "settings", "editions"), (snap) => {
    const data = snap.exists() ? snap.data() : null;
    _editions = {
      names: Array.isArray(data?.names) ? data.names.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim()) : [],
      current: typeof data?.current === "string" ? data.current.trim() : "",
    };
    _editionsLoaded = true;
  }, () => {});
  return () => { unsubProjects(); unsubEditions(); };
}

function renderWorks(page, who, q) {
  const body = page.querySelector("#iw-body");
  const strip = page.querySelector("#iw-strip");
  const myName = (_profile?.name || "").trim().toLowerCase();
  const isMine = (p) => p.authorId === _uid || p.editorId === _uid || (!!myName && (p.authorName || "").trim().toLowerCase() === myName);
  const matches = (p) => !q || [p.title, p.authorName, p.editorName, projectEdition(p), p.type].some((v) => String(v || "").toLowerCase().includes(q));

  const groups = Object.fromEntries([...WORKS_STAGES.map((s) => [s.key, []]), ["published", []]]);
  for (const p of _allProjects) {
    const stage = worksStageOf(p);
    if (!stage || (who === "mine" && !isMine(p)) || !matches(p)) continue;
    groups[stage].push(p);
  }
  // Soonest deadline first; stories with no date go last.
  const dueKey = (p) => { const d = pubDeadline(p); return d ? new Date(d + "T00:00:00").getTime() : Infinity; };
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => dueKey(a) - dueKey(b));

  strip.innerHTML = WORKS_STAGES.map((s) => `
    <a href="#/writer/feed" data-jump="${s.key}" class="${groups[s.key].length ? "" : "is-empty"}">
      <b>${groups[s.key].length}</b><span>${esc(s.label)}</span>
    </a>`).join("");
  strip.onclick = (e) => {
    const a = e.target.closest("[data-jump]"); if (!a) return;
    e.preventDefault();
    page.querySelector(`[data-stage="${a.dataset.jump}"]`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  const inProgress = WORKS_STAGES.reduce((n, s) => n + groups[s.key].length, 0);
  const row = (p) => {
    const tl = p.timeline || {};
    const next = nextStepFor(p, null, { awaitingPublish: worksStageOf(p) === "ready" });
    const prog = worksProgress(p);
    const due = worksDue(p);
    const tags = [p.type, projectEdition(p)].filter(Boolean).map((t) => `<span class="iw-tag">${esc(t)}</span>`).join("");
    const editor = p.editorName
      ? `<div class="iw-person is-editor" title="Editor"><i aria-hidden="true">${esc(initials(p.editorName))}</i><span>${esc(p.editorName)}</span></div>`
      : (tl["Article Writing Complete"] || p.proposalStatus === "approved")
        ? `<div class="iw-person is-none"><i aria-hidden="true">?</i><span>No editor yet</span></div>` : "";
    return `
      <div class="iw-row" role="button" tabindex="0" data-project="${esc(p.id)}" aria-label="${esc(p.title || "Untitled")}: open details">
        <div>
          <p class="iw-title">${esc(p.title || "Untitled")}${tags ? `<span class="iw-tags">${tags}</span>` : ""}</p>
          <p class="iw-next">${next.html}</p>
        </div>
        <div class="iw-people">
          <div class="iw-person" title="Writer"><i aria-hidden="true">${esc(initials(p.authorName))}</i><span>${esc(p.authorName || "No writer")}</span></div>
          ${editor}
        </div>
        <div class="iw-when">
          <span class="iw-due ${due.tone === "late" ? "is-late" : due.tone === "soon" ? "is-soon" : ""}"${due.title ? ` title="${esc(due.title)}"` : ""}>${esc(due.text)}</span>
          <div style="display:grid;gap:4px;width:100%;">
            <div class="iw-bar" role="img" aria-label="${prog.done} of ${prog.total} steps done"><span style="width:${prog.pct}%"></span></div>
            <span class="iw-steps">${prog.done} of ${prog.total} steps</span>
          </div>
        </div>
      </div>`;
  };

  const sections = WORKS_STAGES.filter((s) => groups[s.key].length).map((s) => `
    <section class="iw-group" data-stage="${s.key}" aria-labelledby="iw-h-${s.key}">
      <header class="iw-group-head"><h3 id="iw-h-${s.key}">${esc(s.label)}</h3><span class="n">${groups[s.key].length}</span><p>${esc(s.hint)}</p></header>
      ${groups[s.key].map(row).join("")}
    </section>`).join("");

  // Published in the last 30 days, newest first.
  const month = Date.now() - 30 * 86400000;
  const recent = groups.published
    .map((p) => ({ p, at: toMs(p.publishedAt) || toMs(p.updatedAt) }))
    .filter((x) => x.at >= month)
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
  const published = recent.length ? `
    <section class="iw-group iw-pub" data-stage="published" aria-labelledby="iw-h-pub">
      <header class="iw-group-head"><h3 id="iw-h-pub">Published this month</h3><span class="n">${recent.length}</span><p>Recently out of the pipeline and live on the site.</p></header>
      ${recent.map(({ p, at }) => `
        <div class="iw-row" role="button" tabindex="0" data-project="${esc(p.id)}">
          <p class="iw-title">${esc(p.title || "Untitled")} <span style="font-weight:400;color:var(--muted);">by ${esc(p.authorName || "")}</span></p>
          <span class="iw-due">Published ${esc(fmtDate(new Date(at).toISOString()))}</span>
        </div>`).join("")}
    </section>` : "";

  body.innerHTML = inProgress || published
    ? `<div style="display:grid;gap:18px;">${sections || `<div class="iw-empty">${who === "mine" ? "None of your stories are in progress right now." : "No stories in progress."}</div>`}${published}</div>`
    : `<div class="iw-empty">${q ? `No stories match “${esc(q)}”.` : who === "mine" ? "None of your stories are in progress right now." : "No stories in progress right now."}</div>`;
}
