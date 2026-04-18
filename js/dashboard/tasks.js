/**
 * Tasks module — mirrors the CatalystMonday Tasks board.
 *
 * Columns: Pending Approval | Approved | In Progress | Completed
 * - Any role can create tasks and assign multiple people.
 * - Admins approve/reject tasks.
 * - Assignees mark tasks complete.
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

// ─── Task column logic (mirrors dashboard.js getTaskColumn) ──────────────────

function getTaskColumn(task) {
  if (task.status === "completed") return "completed";
  if (task.status === "rejected")  return "pending";
  if (task.status === "approved") {
    const acts = task.activity || [];
    const inProgress = acts.some(a =>
      (a.text || "").includes("started working") ||
      (a.text || "").includes("in progress") ||
      (a.text || "").includes("commented:")
    );
    return inProgress ? "in_progress" : "approved";
  }
  return "pending";
}

const TASK_COLUMNS = [
  { id: "pending",     title: "Pending Approval", color: "#f59e0b" },
  { id: "approved",    title: "Approved",          color: "#10b981" },
  { id: "in_progress", title: "In Progress",       color: "#3b82f6" },
  { id: "completed",   title: "Completed",          color: "#2563eb" },
];

const PRIORITY_COLORS = {
  urgent: "#dc2626",
  high:   "#ea580c",
  medium: "#f59e0b",
  low:    "#059669",
};

// ─── Module state ─────────────────────────────────────────────────────────────

let _allTasks = [];
let _allUsers = [];
let _uid, _role, _profile, _ctx;

// ─── Mount ────────────────────────────────────────────────────────────────────

export async function mount(ctx, container) {
  _ctx = ctx; _uid = ctx.user.uid; _role = ctx.role; _profile = ctx.profile;

  container.innerHTML = "";

  const header = el("div", { class: "pipeline-page-header" });
  header.innerHTML = `
    <div>
      <div class="card-title">Tasks</div>
      <div class="card-subtitle">Team tasks — assign, approve, track completion.</div>
    </div>
    <button class="btn btn-accent btn-sm" id="new-task-btn">+ New task</button>`;
  container.appendChild(header);

  const board = el("div", { class: "kanban-board", id: "tasks-board" });
  container.appendChild(board);

  await loadUsers();

  header.querySelector("#new-task-btn").addEventListener("click", () => openTaskCreateModal());

  const unsub = onSnapshot(collection(workflowDb, "tasks"), snap => {
    _allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBoard();
  }, err => {
    board.innerHTML = `<div class="error-state">Failed to load tasks: ${esc(err.message)}</div>`;
  });

  return () => unsub();
}

async function loadUsers() {
  try {
    // Try workflowDb first
    const snap = await getDocs(collection(workflowDb, "users"));
    _allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { /* ignore */ }
  // Supplement from primary db
  try {
    const { db } = await import("../firebase-config.js");
    const { getDocs: gd, collection: col } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const snap = await gd(col(db, "users"));
    const ids = new Set(_allUsers.map(u => u.id));
    snap.forEach(d => { if (!ids.has(d.id)) _allUsers.push({ id: d.id, ...d.data() }); });
  } catch { /* ignore */ }
}

// ─── Board ────────────────────────────────────────────────────────────────────

function renderBoard() {
  const board = document.getElementById("tasks-board");
  if (!board) return;
  board.innerHTML = "";

  for (const col of TASK_COLUMNS) {
    const tasks = _allTasks.filter(t => getTaskColumn(t) === col.id);
    board.appendChild(renderColumn(col, tasks));
  }
}

function renderColumn(col, tasks) {
  const colEl = el("div", { class: "kanban-col" });
  colEl.style.setProperty("--col-accent", col.color);
  colEl.innerHTML = `
    <div class="kanban-col-header" style="border-top:3px solid ${col.color}">
      <span class="kanban-col-title">${esc(col.title)}</span>
      <span class="kanban-col-count">${tasks.length}</span>
    </div>
    <div class="kanban-col-body"></div>`;
  const body = colEl.querySelector(".kanban-col-body");
  if (!tasks.length) {
    body.innerHTML = `<div class="kanban-empty">No tasks here</div>`;
  } else {
    tasks
      .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))
      .forEach(t => body.appendChild(renderTaskCard(t)));
  }
  return colEl;
}

function priorityRank(p) {
  return { urgent: 4, high: 3, medium: 2, low: 1 }[p] || 2;
}

function renderTaskCard(task) {
  const due = task.deadline ? new Date(task.deadline + "T00:00:00") : null;
  const days = due ? Math.ceil((due - Date.now()) / 86400000) : null;
  const isOverdue = days !== null && days < 0 && task.status !== "completed";
  const isDueSoon = !isOverdue && days !== null && days <= 3;
  const pColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;
  const assigneeNames = getAssigneeNames(task);
  const displayNames = assigneeNames.length > 2
    ? assigneeNames.slice(0, 2).join(", ") + ` +${assigneeNames.length - 2}`
    : assigneeNames.join(", ") || "Not assigned";

  const card = el("div", {
    class: `kanban-card priority-${task.priority || "medium"}${isOverdue ? " kc-overdue-card" : ""}`,
    onclick: () => openTaskDetailModal(task.id),
  });
  card.innerHTML = `
    <div class="kanban-card-title">${esc(task.title)}</div>
    <div class="kanban-card-meta">
      <span class="kc-priority-badge" style="background:${pColor}">${(task.priority || "medium").toUpperCase()}</span>
      <span class="kc-status">${(task.status || "pending").replace("_", " ")}</span>
    </div>
    ${task.description ? `<div class="kc-desc-preview">${esc(task.description.slice(0, 90))}${task.description.length > 90 ? "…" : ""}</div>` : ""}
    <div class="kanban-card-footer">
      <div class="kc-author">
        <div class="kc-avatar" style="background:${stringToColor(task.creatorName)}">${(task.creatorName || "?")[0].toUpperCase()}</div>
        <span>→ ${esc(displayNames)}</span>
      </div>
      <div class="kc-deadline ${isOverdue ? "kc-overdue" : isDueSoon ? "kc-due-soon" : ""}">
        ${due ? due.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No deadline"}
      </div>
    </div>`;
  return card;
}

function getAssigneeNames(task) {
  if (Array.isArray(task.assigneeNames) && task.assigneeNames.length) return task.assigneeNames;
  if (task.assigneeName) return [task.assigneeName];
  return [];
}

function stringToColor(str) {
  if (!str) return "#64748b";
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 65%, 50%)`;
}

// ─── Task detail modal ────────────────────────────────────────────────────────

function openTaskDetailModal(taskId) {
  const task = _allTasks.find(t => t.id === taskId);
  if (!task) return toast("Task not found.", "error");

  const isAdmin    = _role === "admin";
  const isCreator  = task.creatorId === _uid;
  const isAssignee = (task.assigneeIds || []).includes(_uid) || task.assigneeId === _uid;
  const pColor     = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;
  const assigneeNames = getAssigneeNames(task);
  const acts = [...(task.activity || [])].reverse();
  const actHtml = acts.length
    ? acts.map(a => `
        <div class="act-row">
          <span class="act-author">${esc(a.authorName || "Someone")}</span>
          <span class="act-text"> ${esc(a.text || "")}</span>
          <span class="act-when"> · ${a.timestamp ? fmtActTime(a.timestamp) : ""}</span>
        </div>`).join("")
    : `<div class="act-row" style="color:var(--muted)">No activity yet.</div>`;

  const due = task.deadline ? fmtDate(task.deadline + "T00:00:00") : "Not set";

  const body = el("div", { class: "detail-modal-body" });
  body.innerHTML = `
    <div class="detail-top-row" style="margin-bottom:10px;">
      <span class="kc-priority-badge" style="background:${pColor}">${(task.priority || "medium").toUpperCase()}</span>
      <span class="pill pill-draft">${(task.status || "pending").replace("_", " ")}</span>
    </div>
    <div class="detail-meta-row">
      <span>Created by: <strong>${esc(task.creatorName || "—")}</strong></span>
      <span>Assigned to: <strong>${esc(assigneeNames.join(", ") || "No one")}</strong></span>
      <span>Due: <strong>${esc(due)}</strong></span>
    </div>
    ${task.description ? `
    <div class="detail-section">
      <div class="detail-section-title">Description</div>
      <div class="detail-proposal-text">${esc(task.description)}</div>
    </div>` : ""}
    <div class="detail-section">
      <div class="detail-section-title">Comments</div>
      <div style="display:flex;gap:8px;">
        <input class="input" id="task-comment-input" placeholder="Leave a note…" style="flex:1;">
        <button class="btn btn-secondary btn-sm" id="task-post-comment-btn">Post</button>
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Activity</div>
      <div class="act-feed" id="task-act-feed">${actHtml}</div>
    </div>`;

  const footerBtns = [];

  // Admin: approve / reject
  if (isAdmin && task.status === "pending") {
    const approveBtn = el("button", { class: "btn btn-accent btn-sm" }, "Approve task");
    approveBtn.onclick = async () => {
      approveBtn.disabled = true;
      try {
        await updateDoc(doc(workflowDb, "tasks", task.id), {
          status: "approved",
          updatedAt: new Date().toISOString(),
          activity: arrayUnion({ text: "approved this task", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
        });
        toast("Task approved!", "success"); m.close();
      } catch (e) { toast(e.message, "error"); approveBtn.disabled = false; }
    };
    footerBtns.push(approveBtn);

    const rejectBtn = el("button", { class: "btn btn-secondary btn-sm", style: { color: "var(--danger)" } }, "Reject");
    rejectBtn.onclick = async () => {
      const ok = await confirmDialog("Reject this task?", { confirmText: "Reject", danger: true });
      if (!ok) return;
      rejectBtn.disabled = true;
      try {
        await updateDoc(doc(workflowDb, "tasks", task.id), {
          status: "rejected",
          updatedAt: new Date().toISOString(),
          activity: arrayUnion({ text: "rejected this task", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
        });
        toast("Task rejected.", "info"); m.close();
      } catch (e) { toast(e.message, "error"); rejectBtn.disabled = false; }
    };
    footerBtns.push(rejectBtn);
  }

  // Assignee or admin: mark complete
  if ((isAssignee || isAdmin) && task.status === "approved") {
    const completeBtn = el("button", { class: "btn btn-accent btn-sm" }, "Mark complete");
    completeBtn.onclick = async () => {
      completeBtn.disabled = true;
      try {
        await updateDoc(doc(workflowDb, "tasks", task.id), {
          status: "completed",
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          activity: arrayUnion({ text: "marked this task as complete", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
        });
        toast("Task completed!", "success"); m.close();
      } catch (e) { toast(e.message, "error"); completeBtn.disabled = false; }
    };
    footerBtns.push(completeBtn);
  }

  // Creator or admin: delete
  if (isAdmin || isCreator) {
    const delBtn = el("button", { class: "btn btn-ghost btn-xs", style: { color: "var(--danger)", marginRight: "auto" } }, "Delete task");
    delBtn.onclick = async () => {
      const ok = await confirmDialog(`Delete "${task.title}"?`, { confirmText: "Delete", danger: true });
      if (!ok) return;
      try {
        await deleteDoc(doc(workflowDb, "tasks", task.id));
        toast("Task deleted.", "success"); m.close();
      } catch (e) { toast(e.message, "error"); }
    };
    footerBtns.unshift(delBtn);
  }

  const closeBtn = el("button", { class: "btn btn-secondary btn-sm" }, "Close");
  footerBtns.push(closeBtn);

  const m = openModal({ title: esc(task.title), body, footer: footerBtns });
  closeBtn.onclick = m.close;

  // Post comment
  const commentInput = body.querySelector("#task-comment-input");
  const postComment = async () => {
    const text = commentInput?.value.trim();
    if (!text) return;
    const btn = body.querySelector("#task-post-comment-btn");
    btn.disabled = true;
    try {
      await updateDoc(doc(workflowDb, "tasks", task.id), {
        activity: arrayUnion({ text: `commented: "${text}"`, authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }),
        updatedAt: new Date().toISOString(),
      });
      const feed = body.querySelector("#task-act-feed");
      const row = el("div", { class: "act-row" });
      row.innerHTML = `<span class="act-author">${esc(_profile.name || _ctx.user.email)}</span> <span class="act-text">commented: "${esc(text)}"</span>`;
      feed.insertBefore(row, feed.firstChild);
      commentInput.value = "";
      toast("Comment posted.", "success");
    } catch (e) { toast(e.message, "error"); }
    btn.disabled = false;
  };
  body.querySelector("#task-post-comment-btn")?.addEventListener("click", postComment);
  commentInput?.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postComment(); } });
}

// ─── Task creation modal ──────────────────────────────────────────────────────

function openTaskCreateModal() {
  // Build user list for multi-select
  let selectedIds = new Set();

  const body = el("div", {});
  body.innerHTML = `
    <div class="field">
      <label class="label">Title <span style="color:var(--danger)">*</span></label>
      <input class="input" id="tc-title" placeholder="What needs to be done?">
    </div>
    <div class="field">
      <label class="label">Description</label>
      <textarea class="textarea" id="tc-desc" rows="3" placeholder="Optional details…"></textarea>
    </div>
    <div class="grid grid-2">
      <div class="field">
        <label class="label">Priority</label>
        <select class="select" id="tc-priority">
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>
      <div class="field">
        <label class="label">Due date</label>
        <input class="input" id="tc-deadline" type="date">
      </div>
    </div>
    <div class="field">
      <label class="label">Assign to (select all that apply)</label>
      <div class="multi-assignee-list" id="tc-assignees"></div>
    </div>
    <div id="tc-err" style="color:var(--danger);font-size:12px;margin-top:4px;"></div>`;

  // Render assignee checkboxes
  const assigneeList = body.querySelector("#tc-assignees");
  for (const u of _allUsers) {
    const row = el("label", { class: "assignee-check-row" });
    row.innerHTML = `
      <input type="checkbox" value="${esc(u.id)}" data-name="${esc(u.name || u.email)}">
      <div class="kc-avatar" style="background:${stringToColor(u.name || u.email)};width:24px;height:24px;font-size:11px;">${(u.name || u.email || "?")[0].toUpperCase()}</div>
      <span>${esc(u.name || u.email)}</span>
      <span class="assignee-role">${esc(u.role || "")}</span>`;
    assigneeList.appendChild(row);
  }

  const saveBtn = el("button", { class: "btn btn-accent" }, "Create task");
  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const m = openModal({ title: "New task", body, footer: [cancelBtn, saveBtn] });
  cancelBtn.onclick = m.close;

  saveBtn.onclick = async () => {
    const errEl = body.querySelector("#tc-err");
    errEl.textContent = "";
    const title    = body.querySelector("#tc-title").value.trim();
    const desc     = body.querySelector("#tc-desc").value.trim();
    const priority = body.querySelector("#tc-priority").value;
    const deadline = body.querySelector("#tc-deadline").value;

    if (title.length < 2) { errEl.textContent = "Title is required."; return; }

    const checked = [...body.querySelectorAll("#tc-assignees input:checked")];
    const assigneeIds   = checked.map(c => c.value);
    const assigneeNames = checked.map(c => c.dataset.name);

    saveBtn.disabled = true; saveBtn.textContent = "Creating…";
    try {
      await addDoc(collection(workflowDb, "tasks"), {
        title, description: desc, priority,
        deadline: deadline || null,
        status: "pending",
        creatorId: _uid,
        creatorName: _profile.name || _ctx.user.email,
        assigneeId: assigneeIds[0] || null,
        assigneeIds,
        assigneeName: assigneeNames[0] || null,
        assigneeNames,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        activity: [{ text: "created this task", authorName: _profile.name || _ctx.user.email, authorId: _uid, timestamp: new Date().toISOString() }],
      });
      toast("Task created — pending admin approval.", "success", 4000);
      m.close();
    } catch (e) { errEl.textContent = e.message; saveBtn.disabled = false; saveBtn.textContent = "Create task"; }
  };
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
