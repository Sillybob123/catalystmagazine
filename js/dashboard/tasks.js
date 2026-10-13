/**
 * Team tasks (#/tasks): the team's to-do board.
 *
 *   Waiting for approval → To do → In progress → Done
 *
 * - Editorial roles (writer, editor, admin) can propose tasks for anyone.
 *   An admin's own tasks skip approval; everyone else's wait for an admin.
 * - Approving sends the assignment email and starts the reminder emails
 *   (/api/tasks/notify keeps the task_reminders/<id> mirror for the bot).
 * - The people assigned press "Start" (logged in the activity, which is
 *   what moves the card to In progress) and "Mark done".
 *
 * Data model is unchanged from the old board: tasks/{id} with status
 * pending | approved | rejected | completed and an activity[] log; comments
 * are activity rows whose text starts with `commented: "`.
 * Styles: css/tasks.css (all classes are .tk-*).
 */

// Tasks and the user directory both live in the primary Firestore.
import { db } from "../firebase-dual-config.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  arrayUnion,
  query,
  orderBy,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, openModal, toast, fmtDate, confirmDialog } from "./ui.js";

// ─── Columns ─────────────────────────────────────────────────────────────────

const COLUMNS = [
  { id: "pending",     title: "Waiting for approval", color: "#c58a1b", hint: "Proposed by the team. Once an admin approves, the people assigned get an email." },
  { id: "approved",    title: "To do",                color: "#2e5a87", hint: "Approved and assigned, not started yet." },
  { id: "in_progress", title: "In progress",          color: "#6d4bb3", hint: "Someone has started on it." },
  { id: "completed",   title: "Done",                 color: "#2f6b4f", hint: "Finished in the last 30 days." },
];
const COL_BY_ID = Object.fromEntries(COLUMNS.map((c) => [c.id, c]));

const PRIORITY = {
  urgent: { label: "Urgent", rank: 4 },
  high:   { label: "High",   rank: 3 },
  medium: { label: "Medium", rank: 2 },
  low:    { label: "Low",    rank: 1 },
};
const prioOf = (t) => (PRIORITY[t.priority] ? t.priority : "medium");

const isComment = (a) => /^commented: "/.test(a?.text || "");
const commentText = (a) => String(a.text || "").replace(/^commented: "/, "").replace(/"$/, "");

function assigneeIdsOf(t) {
  if (Array.isArray(t.assigneeIds) && t.assigneeIds.length) return t.assigneeIds;
  return t.assigneeId ? [t.assigneeId] : [];
}
function assigneeNamesOf(t) {
  if (Array.isArray(t.assigneeNames) && t.assigneeNames.length) return t.assigneeNames;
  return t.assigneeName ? [t.assigneeName] : [];
}

// Started = someone pressed Start (or, on older tasks, one of the people
// assigned left a comment, which is how the old board read it).
function getTaskColumn(t) {
  if (t.status === "completed") return "completed";
  if (t.status === "approved") {
    const ids = assigneeIdsOf(t);
    const started = (t.activity || []).some((a) => {
      const text = a.text || "";
      return text.includes("started working") || text.includes("in progress")
        || (isComment(a) && ids.includes(a.authorId));
    });
    return started ? "in_progress" : "approved";
  }
  return "pending";   // pending + rejected (declined ones show folded)
}

// ─── State ───────────────────────────────────────────────────────────────────

let _allTasks = [];
let _allUsers = [];
let _uid, _role, _profile, _ctx;
let _focus = "mine";      // mine | all | approval
let _query = "";
let _showOlderDone = false;
let _showDeclined = false;
const FOCUS_KEY = "catalyst.tasks.focus";

const canCreate = () => ["admin", "editor", "writer"].includes(_role);   // firestore.rules: isWriter()
const canDelete = () => ["admin", "editor"].includes(_role);             // firestore.rules: isEditor()
const isAdmin = () => _role === "admin";
const me = () => _profile?.name || _ctx?.user?.email || "Someone";
const mineFilter = (t) => assigneeIdsOf(t).includes(_uid) || t.creatorId === _uid;

// ─── Mount ───────────────────────────────────────────────────────────────────

export async function mount(ctx, container) {
  _ctx = ctx; _uid = ctx.user.uid; _role = ctx.role; _profile = ctx.profile;
  _query = ""; _showOlderDone = false; _showDeclined = false;
  try { _focus = localStorage.getItem(FOCUS_KEY) || ""; } catch { _focus = ""; }
  // The old board injected global .kb-* styles; drop them if a stale copy is around.
  document.getElementById("kanban-styles")?.remove();

  container.innerHTML = "";
  container.classList.add("tk-page");
  container.innerHTML = `
    <div class="tk-toolbar">
      <div class="tk-focus" role="group" aria-label="Show" id="tk-focus"></div>
      <div class="tk-tools">
        <label class="tk-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="tk-q" placeholder="Search tasks" aria-label="Search tasks">
        </label>
        ${canCreate() ? `<button type="button" class="btn btn-primary btn-sm tk-new" id="tk-new">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>New task</button>` : ""}
      </div>
    </div>
    <p class="tk-glance" id="tk-glance" aria-live="polite"></p>
    <div class="tk-board" id="tk-board"><div class="loading-state"><div class="spinner"></div> Loading tasks&hellip;</div></div>`;

  container.querySelector("#tk-new")?.addEventListener("click", () => openTaskCreateModal());
  const q = container.querySelector("#tk-q");
  q.addEventListener("input", () => { _query = q.value.trim().toLowerCase(); renderBoard(); });

  await loadUsers();

  const unsub = onSnapshot(collection(db, "tasks"), (snap) => {
    _allTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!["mine", "all", "approval"].includes(_focus)) _focus = _allTasks.some((t) => mineFilter(t) && t.status !== "completed") ? "mine" : "all";
    renderBoard();
  }, (err) => {
    const board = document.getElementById("tk-board");
    if (board) board.innerHTML = `<div class="error-state">Couldn't load tasks: ${esc(err.message)}</div>`;
  });

  return () => unsub();
}

// Staff from the same users collection Users & roles shows: no readers, no
// inactive accounts, no one without an email (they couldn't be notified),
// one row per email.
async function loadUsers() {
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("name")));
    const seenEmails = new Set();
    const cleaned = [];
    snap.forEach((d) => {
      const u = { id: d.id, ...d.data() };
      const role = (u.role || "").toLowerCase();
      const status = (u.status || "active").toLowerCase();
      const primaryEmail = (u.email || "").trim().toLowerCase();
      if (!primaryEmail || !role || role === "reader") return;
      if (status === "inactive" || status === "suspended") return;
      if (seenEmails.has(primaryEmail)) return;
      seenEmails.add(primaryEmail);
      cleaned.push({
        id: u.id,
        name: u.name || u.email,
        email: u.email,
        // Some people have more than one address; every one gets the email.
        extraEmails: Array.isArray(u.extraEmails) ? u.extraEmails.filter(Boolean) : [],
        role: u.role || "",
      });
    });
    cleaned.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    _allUsers = cleaned;
  } catch (err) {
    console.warn("[tasks] loadUsers failed:", err);
    _allUsers = [];
  }
}

// ─── Dates ───────────────────────────────────────────────────────────────────

function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
function fmtShort(iso) {
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function dueLabel(t) {
  const d = daysUntil(t.deadline);
  if (d === null) return null;
  if (t.status === "completed") return { text: `Due ${fmtShort(t.deadline)}`, tone: "" };
  if (d < -1) return { text: `${-d} days late`, tone: "late" };
  if (d === -1) return { text: "Due yesterday", tone: "late" };
  if (d === 0) return { text: "Due today", tone: "soon" };
  if (d === 1) return { text: "Due tomorrow", tone: "soon" };
  if (d <= 6) return { text: `Due ${new Date(String(t.deadline).slice(0, 10) + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })}`, tone: d <= 3 ? "soon" : "" };
  return { text: `Due ${fmtShort(t.deadline)}`, tone: "" };
}
const isLate = (t) => t.status !== "completed" && t.status !== "rejected" && (daysUntil(t.deadline) ?? 1) < 0;
const tsMs = (v) => (v && typeof v === "object" && v.seconds ? v.seconds * 1000 : new Date(v || 0).getTime() || 0);
const completedMs = (t) => tsMs(t.completedAt || t.updatedAt);

// ─── People ──────────────────────────────────────────────────────────────────

function stringToColor(str) {
  if (!str) return "#64748b";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 42%, 42%)`;
}
const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const firstName = (name) => String(name || "").split(/\s+/)[0];
const avatar = (name, cls = "") => `<span class="tk-av ${cls}" style="--av:${stringToColor(name)}" title="${esc(name)}" aria-hidden="true">${esc(initials(name))}</span>`;

function peopleHtml(names, max = 3) {
  if (!names.length) return `<span class="tk-people tk-people--none">No one assigned</span>`;
  const shown = names.slice(0, max);
  const label = names.length === 1 ? names[0] : names.length === 2 ? names.map(firstName).join(" & ") : `${firstName(names[0])} +${names.length - 1}`;
  return `<span class="tk-people"><span class="tk-stack">${shown.map((n) => avatar(n)).join("")}</span><span class="tk-people-names">${esc(label)}</span></span>`;
}

// ─── Board ───────────────────────────────────────────────────────────────────

function matchesQuery(t) {
  if (!_query) return true;
  return [t.title, t.description, t.creatorName, ...assigneeNamesOf(t)].some((s) => String(s || "").toLowerCase().includes(_query));
}

function sortOpen(a, b) {
  const da = daysUntil(a.deadline), dbb = daysUntil(b.deadline);
  return (dbb !== null) - (da !== null) || (da ?? 0) - (dbb ?? 0)
    || PRIORITY[prioOf(b)].rank - PRIORITY[prioOf(a)].rank
    || tsMs(b.createdAt) - tsMs(a.createdAt);
}

function renderFocus() {
  const host = document.getElementById("tk-focus");
  if (!host) return;
  const open = _allTasks.filter((t) => t.status !== "completed" && t.status !== "rejected");
  const counts = {
    mine: open.filter(mineFilter).length,
    all: open.length,
    approval: _allTasks.filter((t) => t.status === "pending").length,
  };
  const opts = [["mine", "My tasks"], ["all", "Everyone"]];
  if (isAdmin()) opts.push(["approval", "Needs approval"]);
  host.innerHTML = opts.map(([k, label]) => `
    <button type="button" data-focus="${k}" aria-pressed="${_focus === k}" class="${k === "approval" && counts.approval ? "has-alert" : ""}">
      ${label}<span>${counts[k]}</span>
    </button>`).join("");
  host.querySelectorAll("[data-focus]").forEach((b) => b.addEventListener("click", () => {
    _focus = b.dataset.focus;
    try { localStorage.setItem(FOCUS_KEY, _focus); } catch {}
    renderBoard();
  }));
}

function renderGlance(visible) {
  const g = document.getElementById("tk-glance");
  if (!g) return;
  const open = visible.filter((t) => t.status !== "completed" && t.status !== "rejected");
  const late = open.filter(isLate).length;
  const week = open.filter((t) => { const d = daysUntil(t.deadline); return d !== null && d >= 0 && d <= 7; }).length;
  const waiting = open.filter((t) => t.status === "pending").length;
  const bits = [];
  if (late) bits.push(`<b class="is-late">${late} overdue</b>`);
  if (week) bits.push(`${week} due this week`);
  if (waiting && _focus !== "approval") bits.push(`${waiting} waiting for approval`);
  const lead = _focus === "mine"
    ? (open.length ? `You have <b>${open.length}</b> open ${open.length === 1 ? "task" : "tasks"}` : "Nothing on your plate right now")
    : _focus === "approval"
      ? (open.length ? `<b>${open.length}</b> ${open.length === 1 ? "task needs" : "tasks need"} your decision` : "Nothing is waiting for approval")
      : `<b>${open.length}</b> open ${open.length === 1 ? "task" : "tasks"} across the team`;
  g.innerHTML = `<span>${lead}${bits.length ? "" : "."}</span>` + (bits.length ? `<span class="tk-glance-sep" aria-hidden="true"></span><span>${bits.join(" · ")}</span>` : "");
}

function renderBoard() {
  const board = document.getElementById("tk-board");
  if (!board) return;
  renderFocus();

  let visible = _allTasks.filter(matchesQuery);
  if (_focus === "mine") visible = visible.filter(mineFilter);
  if (_focus === "approval") visible = visible.filter((t) => t.status === "pending");
  // Declined proposals: only their author and admins see them.
  visible = visible.filter((t) => t.status !== "rejected" || isAdmin() || t.creatorId === _uid);
  renderGlance(visible);

  const cols = _focus === "approval" ? [COL_BY_ID.pending] : COLUMNS;
  board.dataset.cols = String(cols.length);
  board.innerHTML = "";
  for (const col of cols) board.appendChild(renderColumn(col, visible.filter((t) => getTaskColumn(t) === col.id)));
}

function renderColumn(col, tasks) {
  const colEl = el("section", { class: "tk-col", style: `--col:${col.color}`, "aria-label": col.title });
  let list = tasks;
  let extra = "";
  if (col.id === "completed") {
    list = [...tasks].sort((a, b) => completedMs(b) - completedMs(a));
    const cutoff = Date.now() - 30 * 86400000;
    const recent = list.filter((t) => completedMs(t) >= cutoff);
    const older = list.length - recent.length;
    if (!_showOlderDone && older) { list = recent; extra = `<button type="button" class="tk-more" data-more="done">Show ${older} older</button>`; }
  } else if (col.id === "pending") {
    const declined = tasks.filter((t) => t.status === "rejected");
    list = tasks.filter((t) => t.status !== "rejected").sort(sortOpen);
    if (declined.length) {
      extra = `<button type="button" class="tk-more" data-more="declined" aria-expanded="${_showDeclined}">${_showDeclined ? "Hide" : "Show"} ${declined.length} declined</button>`;
      if (_showDeclined) list = [...list, ...declined];
    }
  } else {
    list = [...tasks].sort(sortOpen);
  }
  const count = col.id === "pending" ? tasks.filter((t) => t.status !== "rejected").length : tasks.length;

  colEl.innerHTML = `
    <header class="tk-col-head">
      <span class="tk-col-dot" aria-hidden="true"></span>
      <h3 class="tk-col-title">${esc(col.title)}</h3>
      <span class="tk-col-count">${count}</span>
      <p class="tk-col-hint">${esc(col.hint)}</p>
    </header>
    <div class="tk-col-body"></div>`;
  colEl.classList.toggle("is-empty", !list.length);
  const body = colEl.querySelector(".tk-col-body");
  if (!list.length) body.innerHTML = `<div class="tk-empty">${esc(emptyText(col.id))}</div>`;
  list.forEach((t) => body.appendChild(renderTaskCard(t)));
  if (extra) {
    body.insertAdjacentHTML("beforeend", extra);
    body.querySelector("[data-more]")?.addEventListener("click", (e) => {
      if (e.currentTarget.dataset.more === "done") _showOlderDone = true; else _showDeclined = !_showDeclined;
      renderBoard();
    });
  }
  return colEl;
}

function emptyText(colId) {
  const mine = _focus === "mine";
  return {
    pending: mine ? "Nothing you've proposed is waiting." : "Nothing waiting for approval.",
    approved: mine ? "Nothing waiting on you." : "Nothing to start.",
    in_progress: mine ? "You haven't started anything." : "No one is mid-task.",
    completed: "Nothing finished lately.",
  }[colId];
}

// The one next step for this person on this card, if there is one.
function quickAction(t) {
  const col = getTaskColumn(t);
  const assigned = assigneeIdsOf(t).includes(_uid);
  if (t.status === "pending" && isAdmin()) return { key: "approve", label: "Approve" };
  if (col === "approved" && assigned) return { key: "start", label: "Start" };
  if (col === "in_progress" && (assigned || isAdmin())) return { key: "done", label: "Mark done" };
  return null;
}

function renderTaskCard(t) {
  const col = getTaskColumn(t);
  const prio = prioOf(t);
  const due = dueLabel(t);
  const names = assigneeNamesOf(t);
  const comments = (t.activity || []).filter(isComment).length;
  const action = quickAction(t);
  const declined = t.status === "rejected";
  const card = el("article", {
    class: `tk-card${isLate(t) ? " is-late" : ""}${declined ? " is-declined" : ""}${col === "completed" ? " is-done" : ""}`,
    tabindex: "0", role: "button", "aria-label": `${t.title || "Untitled task"}. Open details`,
  });
  card.innerHTML = `
    <div class="tk-card-top">
      ${declined ? `<span class="tk-tag tk-tag--declined">Declined</span>` : (prio === "urgent" || prio === "high") ? `<span class="tk-prio tk-prio--${prio}">${PRIORITY[prio].label}</span>` : ""}
      ${due ? `<span class="tk-due${due.tone ? " is-" + due.tone : ""}">${col === "completed" ? `Done ${esc(fmtShort(new Date(completedMs(t)).toISOString()))}` : esc(due.text)}</span>` : col === "completed" && completedMs(t) ? `<span class="tk-due">Done ${esc(fmtShort(new Date(completedMs(t)).toISOString()))}</span>` : ""}
    </div>
    <h4 class="tk-card-title">${esc(t.title || "Untitled task")}</h4>
    ${t.description ? `<p class="tk-card-desc">${esc(t.description)}</p>` : ""}
    <div class="tk-card-foot">
      ${peopleHtml(names)}
      ${comments ? `<span class="tk-comments" title="${comments} ${comments === 1 ? "comment" : "comments"}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>${comments}</span>` : ""}
    </div>
    ${action ? `<button type="button" class="tk-quick" data-quick="${action.key}">${action.label}</button>` : ""}`;
  const open = () => openTaskDetailModal(t.id);
  card.addEventListener("click", (e) => { if (!e.target.closest("[data-quick]")) open(); });
  card.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === card) { e.preventDefault(); open(); } });
  card.querySelector("[data-quick]")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const b = e.currentTarget; b.disabled = true;
    const ok = await runAction(action.key, t);
    if (!ok) b.disabled = false;
  });
  return card;
}

// ─── Actions (shared by the cards and the detail pop-up) ─────────────────────

const actRow = (text) => ({ text, authorName: me(), authorId: _uid, timestamp: new Date().toISOString() });

async function runAction(key, task) {
  try {
    if (key === "approve") {
      await updateDoc(doc(db, "tasks", task.id), { status: "approved", updatedAt: new Date().toISOString(), activity: arrayUnion(actRow("approved this task")) });
      // Approval is when the task becomes real for the people assigned: the
      // assignment email goes out and the reminder mirror is created.
      const notifySummary = await notifyAssigned({
        taskId: task.id,
        title: task.title,
        description: task.description || "",
        priority: task.priority || "medium",
        deadline: task.deadline || null,
        creatorName: task.creatorName || me(),
        assignees: zipNotifyList(task.notifyEmails || task.assigneeEmails || [], task.notifyNames || task.assigneeNames || []),
      });
      const s = summarizeNotify(notifySummary, "approved");
      toast(s.message, s.kind, 5500);
      return true;
    }
    if (key === "decline") {
      const ok = await confirmDialog("Decline this task? Its author will still see it, marked declined.", { confirmText: "Decline", danger: true });
      if (!ok) return false;
      await updateDoc(doc(db, "tasks", task.id), { status: "rejected", updatedAt: new Date().toISOString(), activity: arrayUnion(actRow("declined this task")) });
      toast("Task declined.", "info");
      return true;
    }
    if (key === "start") {
      await updateDoc(doc(db, "tasks", task.id), { updatedAt: new Date().toISOString(), activity: arrayUnion(actRow("started working on this")) });
      toast("Moved to In progress.", "success");
      return true;
    }
    if (key === "done") {
      await updateDoc(doc(db, "tasks", task.id), {
        status: "completed", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        activity: arrayUnion(actRow("marked this task as complete")),
      });
      await notifyTaskClosed(task.id, "completed");   // stops its reminder emails
      toast("Done. Nice work.", "success");
      return true;
    }
    if (key === "delete") {
      const ok = await confirmDialog(`Delete "${task.title}"? This can't be undone.`, { confirmText: "Delete", danger: true });
      if (!ok) return false;
      await deleteDoc(doc(db, "tasks", task.id));
      await notifyTaskClosed(task.id, "deleted");
      toast("Task deleted.", "success");
      return true;
    }
  } catch (e) {
    toast(e.message || "Something went wrong.", "error");
  }
  return false;
}

// ─── Task detail ─────────────────────────────────────────────────────────────

function fmtActTimeFull(v) {
  const ms = tsMs(v);
  if (!ms) return "";
  return fmtActTime(v);
}

function openTaskDetailModal(taskId) {
  const task = _allTasks.find((t) => t.id === taskId);
  if (!task) return toast("That task no longer exists.", "error");

  const col = getTaskColumn(task);
  const colMeta = COL_BY_ID[col];
  const prio = prioOf(task);
  const assigned = assigneeIdsOf(task).includes(_uid);
  const names = assigneeNamesOf(task);
  const due = dueLabel(task);
  const acts = task.activity || [];
  const comments = acts.filter(isComment);
  const history = acts.filter((a) => !isComment(a)).slice().reverse();

  // What this person can do next, said plainly.
  let next = null;
  if (task.status === "rejected") next = { text: "An admin declined this task.", actions: [] };
  else if (task.status === "pending") next = isAdmin()
    ? { text: "Waiting for your approval. Approving emails the people assigned and starts their reminders.", actions: [["approve", "Approve and send", "primary"], ["decline", "Decline", "danger"]] }
    : { text: "Waiting for an admin to approve it. The people assigned get an email once it's approved.", actions: [] };
  else if (col === "approved") next = assigned
    ? { text: "This one is yours. Press Start when you begin so the team can see it's moving.", actions: [["start", "Start working", "primary"], ["done", "Mark done", "secondary"]] }
    : { text: `Assigned to ${names.join(", ") || "no one"}, not started yet.`, actions: isAdmin() ? [["done", "Mark done", "secondary"]] : [] };
  else if (col === "in_progress") next = (assigned || isAdmin())
    ? { text: "In progress. Mark it done when it's finished; that stops the reminder emails.", actions: [["done", "Mark done", "primary"]] }
    : { text: "In progress.", actions: [] };
  else if (col === "completed") next = { text: `Completed${task.completedAt ? ` on ${fmtDate(task.completedAt)}` : ""}.`, actions: [] };

  const body = el("div", { class: "tk-detail" });
  body.innerHTML = `
    <div class="tk-detail-status">
      <span class="tk-state" style="--col:${colMeta.color}"><span aria-hidden="true"></span>${esc(task.status === "rejected" ? "Declined" : colMeta.title)}</span>
      <span class="tk-prio tk-prio--${prio}">${PRIORITY[prio].label} priority</span>
      ${due ? `<span class="tk-due${due.tone ? " is-" + due.tone : ""}">${esc(due.text)}</span>` : ""}
    </div>

    <dl class="tk-meta">
      <div><dt>Assigned to</dt><dd>${names.length ? names.map((n) => `<span class="tk-person">${avatar(n, "tk-av--sm")}${esc(n)}</span>`).join("") : "No one"}</dd></div>
      <div><dt>Due</dt><dd>${task.deadline ? esc(fmtDate(task.deadline + "T00:00:00")) : "No due date"}</dd></div>
      <div><dt>Proposed by</dt><dd><span class="tk-person">${avatar(task.creatorName || "?", "tk-av--sm")}${esc(task.creatorName || "Unknown")}</span></dd></div>
      <div><dt>Created</dt><dd>${task.createdAt ? esc(fmtDate(task.createdAt)) : "—"}</dd></div>
    </dl>

    ${task.description ? `<section class="tk-sec"><h4>Details</h4><p class="tk-desc-full">${esc(task.description)}</p></section>` : ""}

    ${next ? `<section class="tk-next${next.actions.length ? " has-actions" : ""}">
      <p>${esc(next.text)}</p>
      ${next.actions.length ? `<div class="tk-next-actions">${next.actions.map(([k, label, kind]) => `<button type="button" class="btn btn-sm ${kind === "primary" ? "btn-primary" : "btn-secondary"}${kind === "danger" ? " tk-btn-danger" : ""}" data-act="${k}">${label}</button>`).join("")}</div>` : ""}
    </section>` : ""}

    <section class="tk-sec">
      <h4>Comments${comments.length ? ` <span>${comments.length}</span>` : ""}</h4>
      <ol class="tk-thread" id="tk-thread">
        ${comments.map((a) => `<li>${avatar(a.authorName || "?")}<div><p class="tk-thread-who"><b>${esc(a.authorName || "Someone")}</b><time>${esc(fmtActTimeFull(a.timestamp))}</time></p><p class="tk-thread-text">${esc(commentText(a))}</p></div></li>`).join("") || `<li class="tk-thread-empty">No comments yet. Ask a question or leave an update.</li>`}
      </ol>
      ${canCreate() ? `<div class="tk-compose">
        <textarea class="textarea" id="tk-comment" rows="2" maxlength="2000" placeholder="Write a comment…" aria-label="Write a comment"></textarea>
        <div class="tk-compose-row"><span>⌘ + Enter to post</span><button type="button" class="btn btn-secondary btn-sm" id="tk-post">Post comment</button></div>
      </div>` : ""}
    </section>

    ${history.length ? `<details class="tk-history"><summary>History <span>${history.length}</span></summary>
      <ol>${history.map((a) => `<li><b>${esc(a.authorName || "Someone")}</b> ${esc(a.text || "")}<time>${esc(fmtActTimeFull(a.timestamp))}</time></li>`).join("")}</ol>
    </details>` : ""}`;

  const footer = [];
  if (canDelete()) {
    const del = el("button", { class: "btn btn-ghost btn-sm tk-btn-danger", type: "button", style: { marginRight: "auto" } }, "Delete task");
    del.addEventListener("click", async () => { if (await runAction("delete", task)) m.close(); });
    footer.push(del);
  }
  const closeBtn = el("button", { class: "btn btn-secondary btn-sm", type: "button" }, "Close");
  footer.push(closeBtn);
  const m = openModal({ title: task.title || "Untitled task", body, footer });
  closeBtn.addEventListener("click", () => m.close());

  body.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    if (await runAction(b.dataset.act, task)) m.close(); else b.disabled = false;
  }));

  const input = body.querySelector("#tk-comment");
  const post = async () => {
    const text = input?.value.trim();
    if (!text) return;
    const btn = body.querySelector("#tk-post");
    btn.disabled = true;
    try {
      await updateDoc(doc(db, "tasks", task.id), { activity: arrayUnion(actRow(`commented: "${text}"`)), updatedAt: new Date().toISOString() });
      const thread = body.querySelector("#tk-thread");
      thread.querySelector(".tk-thread-empty")?.remove();
      thread.insertAdjacentHTML("beforeend", `<li>${avatar(me())}<div><p class="tk-thread-who"><b>${esc(me())}</b><time>just now</time></p><p class="tk-thread-text">${esc(text)}</p></div></li>`);
      input.value = "";
    } catch (e) { toast(e.message, "error"); }
    btn.disabled = false;
  };
  body.querySelector("#tk-post")?.addEventListener("click", post);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } });
}

// ─── New task ────────────────────────────────────────────────────────────────

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function quickDates() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const add = (n) => { const d = new Date(t); d.setDate(d.getDate() + n); return isoDay(d); };
  const toFri = (5 - t.getDay() + 7) % 7 || 7;
  return [["Today", add(0)], ["Tomorrow", add(1)], ["Friday", add(toFri)], ["In a week", add(7)], ["In 2 weeks", add(14)]];
}

function openTaskCreateModal() {
  const selected = new Set();
  let prio = "medium";
  const body = el("div", { class: "tk-new-form" });
  body.innerHTML = `
    ${isAdmin() ? "" : `<p class="tk-new-lede">An admin approves new tasks before they're sent. The people you assign get an email once it's approved, plus reminders before it's due.</p>`}
    <div class="field">
      <label class="label" for="tc-title">Task</label>
      <input class="input" id="tc-title" maxlength="200" placeholder="What needs to happen? Start with a verb." autocomplete="off">
    </div>
    <div class="field">
      <label class="label" for="tc-desc">Details <span class="tk-opt">(optional)</span></label>
      <textarea class="textarea" id="tc-desc" rows="3" maxlength="4000" placeholder="Links, context, what done looks like."></textarea>
    </div>
    <div class="field">
      <span class="label" id="tc-prio-l">Priority</span>
      <div class="tk-seg" role="radiogroup" aria-labelledby="tc-prio-l" id="tc-prio">
        ${Object.entries(PRIORITY).reverse().map(([k, p]) => `<button type="button" role="radio" data-prio="${k}" aria-checked="${k === prio}" class="tk-seg-${k}">${p.label}</button>`).join("")}
      </div>
    </div>
    <div class="field">
      <label class="label" for="tc-deadline">Due date <span class="tk-opt">(optional)</span></label>
      <div class="tk-dates">
        <input class="input" id="tc-deadline" type="date">
        <div class="tk-chips" id="tc-quick">${quickDates().map(([l, d]) => `<button type="button" class="tk-chip" data-date="${d}" aria-pressed="false">${l}</button>`).join("")}</div>
      </div>
    </div>
    <div class="field">
      <div class="tk-assign-head">
        <span class="label" id="tc-assign-l">Assign to</span>
        <button type="button" class="tk-link" id="tc-me">Assign to me</button>
      </div>
      <div class="tk-picked" id="tc-picked" aria-live="polite"></div>
      <label class="tk-search tk-search--block">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="tc-find" placeholder="Find someone" aria-label="Find someone to assign" autocomplete="off">
      </label>
      <div class="tk-pick-list" id="tc-list" role="group" aria-labelledby="tc-assign-l"></div>
    </div>
    <p class="tk-error" id="tc-err" role="alert" hidden></p>`;

  const $ = (id) => body.querySelector("#" + id);
  const ROLE_LABEL = { admin: "Admin", editor: "Editor", writer: "Writer", social_media: "Social media", marketing: "Marketing", newsletter_builder: "Newsletter" };

  const renderPicked = () => {
    const picked = _allUsers.filter((u) => selected.has(u.id));
    $("tc-picked").innerHTML = picked.length
      ? picked.map((u) => `<span class="tk-pill">${avatar(u.name, "tk-av--xs")}${esc(u.name)}<button type="button" data-unpick="${esc(u.id)}" aria-label="Remove ${esc(u.name)}">&times;</button></span>`).join("")
      : `<span class="tk-picked-none">No one yet. Pick at least one person.</span>`;
    $("tc-picked").querySelectorAll("[data-unpick]").forEach((b) => b.addEventListener("click", () => { selected.delete(b.dataset.unpick); renderPicked(); renderList(); }));
    $("tc-me").hidden = selected.has(_uid) || !_allUsers.some((u) => u.id === _uid);
  };
  const renderList = () => {
    const q = $("tc-find").value.trim().toLowerCase();
    const list = _allUsers.filter((u) => !q || u.name.toLowerCase().includes(q) || String(ROLE_LABEL[u.role] || u.role).toLowerCase().includes(q));
    $("tc-list").innerHTML = list.map((u) => `
      <label class="tk-pick${selected.has(u.id) ? " is-on" : ""}">
        <input type="checkbox" value="${esc(u.id)}" ${selected.has(u.id) ? "checked" : ""}>
        ${avatar(u.name)}
        <span class="tk-pick-name">${esc(u.name)}${u.id === _uid ? " <i>(you)</i>" : ""}</span>
        <span class="tk-pick-role">${esc(ROLE_LABEL[u.role] || u.role)}</span>
        <span class="tk-pick-check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></span>
      </label>`).join("") || `<p class="tk-pick-none">No one matches “${esc(q)}”.</p>`;
    $("tc-list").querySelectorAll("input").forEach((c) => c.addEventListener("change", () => {
      c.checked ? selected.add(c.value) : selected.delete(c.value);
      c.closest(".tk-pick").classList.toggle("is-on", c.checked);
      renderPicked();
    }));
  };
  $("tc-find").addEventListener("input", renderList);
  $("tc-me").addEventListener("click", () => { selected.add(_uid); renderPicked(); renderList(); });
  $("tc-prio").querySelectorAll("[data-prio]").forEach((b) => b.addEventListener("click", () => {
    prio = b.dataset.prio;
    $("tc-prio").querySelectorAll("[data-prio]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  }));
  const syncChips = () => $("tc-quick").querySelectorAll("[data-date]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.date === $("tc-deadline").value)));
  $("tc-quick").querySelectorAll("[data-date]").forEach((c) => c.addEventListener("click", () => {
    $("tc-deadline").value = $("tc-deadline").value === c.dataset.date ? "" : c.dataset.date;
    syncChips();
  }));
  $("tc-deadline").addEventListener("change", syncChips);
  renderPicked(); renderList();

  const saveBtn = el("button", { class: "btn btn-primary", type: "button" }, isAdmin() ? "Create and send" : "Propose task");
  const cancelBtn = el("button", { class: "btn btn-secondary", type: "button" }, "Cancel");
  const m = openModal({ title: "New task", body, footer: [cancelBtn, saveBtn] });
  cancelBtn.addEventListener("click", () => m.close());
  setTimeout(() => $("tc-title")?.focus(), 30);

  saveBtn.addEventListener("click", async () => {
    const err = $("tc-err");
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    err.hidden = true;
    const title = $("tc-title").value.trim();
    const desc = $("tc-desc").value.trim();
    const deadline = $("tc-deadline").value;
    if (title.length < 2) return fail("Give the task a name.");
    const people = _allUsers.filter((u) => selected.has(u.id));
    if (!people.length) return fail("Pick at least one person to assign.");

    const assigneeIds = people.map((u) => u.id);
    const assigneeNames = people.map((u) => u.name);
    const assigneeEmails = people.map((u) => u.email || "");
    // Every address on file gets the email. Two parallel flat arrays,
    // because Firestore rejects nested arrays.
    const notifyEmails = [];
    const notifyNames = [];
    people.forEach((u) => [u.email, ...(u.extraEmails || [])].filter(Boolean).forEach((e) => { notifyEmails.push(e.trim()); notifyNames.push(u.name); }));

    // An admin's own tasks skip approval and go out right away.
    const initialStatus = isAdmin() ? "approved" : "pending";
    const creatorName = me();
    const nowIso = new Date().toISOString();

    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      const taskRef = await addDoc(collection(db, "tasks"), {
        title, description: desc, priority: prio,
        deadline: deadline || null,
        status: initialStatus,
        creatorId: _uid,
        creatorName,
        assigneeId: assigneeIds[0] || null,
        assigneeIds,
        assigneeName: assigneeNames[0] || null,
        assigneeNames,
        assigneeEmails,
        notifyEmails,
        notifyNames,
        createdAt: nowIso,
        updatedAt: nowIso,
        activity: [{ text: isAdmin() ? "created and approved this task" : "created this task", authorName: creatorName, authorId: _uid, timestamp: nowIso }],
      });
      let notifySummary = null;
      if (initialStatus === "approved") {
        notifySummary = await notifyAssigned({
          taskId: taskRef.id, title, description: desc, priority: prio,
          deadline: deadline || null, creatorName,
          assignees: zipNotifyList(notifyEmails, notifyNames),
        });
      }
      const s = summarizeNotify(notifySummary, initialStatus);
      toast(s.message, s.kind, 5500);
      m.close();
    } catch (e) {
      fail(e.message || "Couldn't save the task.");
      saveBtn.disabled = false; saveBtn.textContent = isAdmin() ? "Create and send" : "Propose task";
    }
  });
}

// ─── /api/tasks/notify wrapper ───────────────────────────────────────────────
//
// Three actions: assigned (send the welcome email + write the mirror
// doc), completed (silence reminders), deleted (silence reminders).
// We return a structured summary {ok, notified, failed, error} so the
// caller can render an honest toast — the previous version swallowed
// errors silently and toasted "notified by email" even when the email
// had failed, which left admins thinking emails went out when they hadn't.

async function notifyAssigned({ taskId, title, description, priority, deadline, creatorName, assignees }) {
  return _notify({ action: "assigned", taskId, title, description, priority, deadline, creatorName, assignees });
}

async function notifyTaskClosed(taskId, action /* "completed" | "deleted" */) {
  return _notify({ action, taskId });
}

async function _notify(payload) {
  try {
    const res = await _ctx.authedFetch("/api/tasks/notify", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    // Read as text first so a non-JSON response (HTML 5xx page,
    // redirect) surfaces with a useful snippet instead of a generic
    // SyntaxError.
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); }
    catch {
      const snippet = raw.slice(0, 160).replace(/\s+/g, " ").trim();
      console.warn("[tasks/notify] non-JSON response:", res.status, snippet);
      return { ok: false, transportError: `HTTP ${res.status}: ${snippet || "(empty body)"}` };
    }
    if (!res.ok || !data.ok) {
      console.warn("[tasks/notify]", payload.action, "non-OK response:", data);
      return { ok: false, transportError: data.error || data.message || `HTTP ${res.status}`, ...data };
    }
    return data;
  } catch (err) {
    console.warn("[tasks/notify]", payload.action, "request failed:", err);
    return { ok: false, transportError: err?.message || String(err) };
  }
}

// Turn the notify response into a user-facing toast message. Three cases:
//   • Network / server error           → red error toast with the cause
//   • Some emails failed (Resend etc.) → orange warning toast with count
//   • All emails went out              → green success toast
function summarizeNotify(summary, initialStatus) {
  if (initialStatus !== "approved") {
    return { kind: "success", message: "Task proposed. It goes out once an admin approves it." };
  }
  if (!summary) {
    return { kind: "success", message: "Task created." };
  }
  if (summary.transportError) {
    return {
      kind: "error",
      message: `Task saved, but the assignment email did NOT go out. ${summary.transportError}`,
    };
  }
  const notified = Number(summary.notified || 0);
  const failed = Array.isArray(summary.failed) ? summary.failed : [];
  if (notified === 0 && failed.length === 0) {
    return {
      kind: "info",
      message: "Task saved. No assignees had a valid email — no notifications sent.",
    };
  }
  if (failed.length) {
    const detail = failed.map((f) => `${f.email}: ${f.error || "unknown"}`).join("; ");
    return {
      kind: "error",
      message: `Task saved. ${notified} email${notified === 1 ? "" : "s"} sent, ${failed.length} FAILED — ${detail}`,
    };
  }
  return {
    kind: "success",
    message: `Task sent. ${notified} email${notified === 1 ? "" : "s"} went to the people assigned.`,
  };
}

// Zip two parallel flat arrays into the [{email, name}] shape the API
// expects. The arrays are assumed to already be expanded — i.e. each
// row is one email, with the user's name repeated for every extra
// address they have on file. (We can't store nested arrays in
// Firestore, so the expansion happens at create-time and the result
// is what gets persisted.)
function zipNotifyList(emails, names) {
  const out = [];
  emails.forEach((email, i) => {
    const trimmed = (email || "").trim();
    if (!trimmed) return;
    out.push({ email: trimmed, name: (names[i] || "").trim() });
  });
  return out;
}

function fmtActTime(v) {
  let ms = 0;
  if (!v) return "";
  if (typeof v === "object" && v.seconds) ms = v.seconds * 1000;
  else { ms = new Date(v).getTime(); if (isNaN(ms)) return ""; }
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
