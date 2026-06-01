// Admin-only "Tasks" page — a dedicated home for everything the admin needs to
// do, review, or approve. It's the full-page sibling of the compact "Your tasks"
// panel on the Activity page; both share the same engine (task-engine.js) so
// they never drift.
//
// What surfaces here (in priority order):
//   • Deadline-change requests   — a writer asked to push a date; approve/decline.
//   • Proposals awaiting approval — gatekeeping new pitches.
//   • Editor assignments         — finished drafts with no editor yet.
//   • Nudges                     — overdue / stalled writers and editors (with a
//                                  one-tap "Copy text" message to send them).
//   • Ready to publish           — fully-edited pieces waiting to go live.
//   • Reader book reviews        — pending submissions in The Catalyzers queue.
//
// Each task can be snoozed (comes back in N days) or cleared, persisted per
// admin in Firestore (taskPrefs/{uid}).

import { db as workflowDb } from "../firebase-dual-config.js";
import { db as primaryDb } from "../firebase-config.js";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteField,
  getDocs,
  query,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc } from "./ui.js";
import {
  buildAdminTasks,
  createTaskRowRenderer,
  ensureTaskStyles,
} from "./task-engine.js";

export async function mount(ctx, container) {
  container.innerHTML = "";
  ensureTaskStyles();
  ensureTasksPageStyles();

  // ── Header ─────────────────────────────────────────────────────────────────
  const head = el("div", { class: "card tasks-page-head" });
  head.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">
          <span class="admin-tasks-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </span>
          Tasks
        </div>
        <div class="card-subtitle">Everything that needs you — to do, review, or approve. Sorted by what's most urgent. Updates live.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="admin-tasks-count" id="tasks-count"></span>
      </div>
    </div>
    <div class="card-body" id="tasks-summary"></div>`;
  container.appendChild(head);

  // ── Task list ────────────────────────────────────────────────────────────────
  const listCard = el("div", { class: "card", style: { marginTop: "16px" } });
  listCard.innerHTML = `
    <div class="card-body" id="tasks-body">
      <div class="loading-state"><div class="spinner"></div>Working out what you need to do&hellip;</div>
    </div>`;
  container.appendChild(listCard);

  const tasksBody    = listCard.querySelector("#tasks-body");
  const tasksCountEl = head.querySelector("#tasks-count");
  const summaryEl    = head.querySelector("#tasks-summary");

  // ── State ────────────────────────────────────────────────────────────────────
  const state = {
    projects: [],
    users: [],
    taskOverrides: {},
    showSnoozed: false,
    bookReviewsPending: 0,
  };

  const prefsRef = ctx.user?.uid ? doc(workflowDb, "taskPrefs", ctx.user.uid) : null;

  async function setTaskOverride(taskKey, override) {
    if (override === null) delete state.taskOverrides[taskKey];
    else state.taskOverrides[taskKey] = override;
    renderTasks(); // optimistic
    if (!prefsRef) return;
    try {
      await setDoc(prefsRef, { overrides: { [taskKey]: override === null ? deleteField() : override } }, { merge: true });
    } catch (e) {
      console.warn("[tasks] failed to save task override", e);
      ctx.toast("Couldn't save that — it may reappear on reload.", "error");
    }
  }

  const renderTaskRow = createTaskRowRenderer({
    toast: ctx.toast,
    setTaskOverride,
    getMenuRoot: () => tasksBody,
  });

  // ── Subscriptions ────────────────────────────────────────────────────────────
  const unsubProjects = onSnapshot(collection(workflowDb, "projects"),
    (snap) => {
      state.projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderTasks();
    },
    (err) => {
      console.error("[tasks] projects snapshot error", err);
      tasksBody.innerHTML = `<div class="error-state">Failed to load projects: ${esc(err.message)}</div>`;
    },
  );

  const unsubUsers = onSnapshot(collection(workflowDb, "users"),
    (snap) => {
      state.users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderTasks();
    },
    (err) => { console.warn("[tasks] users snapshot error", err); state.users = []; renderTasks(); },
  );

  const unsubPrefs = prefsRef
    ? onSnapshot(prefsRef,
        (snap) => { state.taskOverrides = (snap.exists() && snap.data().overrides) || {}; renderTasks(); },
        (err) => { console.warn("[tasks] task prefs snapshot error", err); },
      )
    : () => {};

  // One-time read of the reader book-review queue (admin-readable). A count of
  // pending submissions becomes a "review N book reviews" task.
  (async () => {
    try {
      const snap = await getDocs(query(collection(primaryDb, "bookReviewSubmissions")));
      state.bookReviewsPending = snap.docs.filter((d) => ((d.data().status) || "pending") === "pending").length;
      renderTasks();
    } catch (e) {
      console.warn("[tasks] book review count failed", e);
    }
  })();

  // ── Render ─────────────────────────────────────────────────────────────────
  function renderTasks() {
    const { active, hidden } = buildAdminTasks(state.projects, state.users, state.taskOverrides, {
      bookReviewsPending: state.bookReviewsPending,
    });

    // Summary chips.
    const urgent = active.filter((t) => t.priority === "urgent").length;
    const high   = active.filter((t) => t.priority === "high").length;
    const normal = active.filter((t) => t.priority === "normal").length;

    tasksCountEl.innerHTML = active.length
      ? `<strong>${active.length}</strong> open${urgent ? ` · <span class="admin-tasks-count-urgent">${urgent} urgent</span>` : ""}`
      : "All clear";

    summaryEl.innerHTML = `
      <div class="tasks-kpis">
        <div class="tasks-kpi ${urgent ? "tasks-kpi-danger" : ""}"><div class="tasks-kpi-num">${urgent}</div><div class="tasks-kpi-label">Urgent</div></div>
        <div class="tasks-kpi ${high ? "tasks-kpi-warn" : ""}"><div class="tasks-kpi-num">${high}</div><div class="tasks-kpi-label">Do soon</div></div>
        <div class="tasks-kpi"><div class="tasks-kpi-num">${normal}</div><div class="tasks-kpi-label">When you can</div></div>
        <div class="tasks-kpi"><div class="tasks-kpi-num">${hidden.length}</div><div class="tasks-kpi-label">Snoozed / cleared</div></div>
      </div>`;

    tasksBody.innerHTML = "";

    if (!active.length) {
      tasksBody.appendChild(el("div", { class: "admin-tasks-clear", html: `
          <div class="admin-tasks-clear-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div>
            <div class="admin-tasks-clear-title">You're all caught up.</div>
            <div class="admin-tasks-clear-sub">No proposals to review, no deadline requests, nobody overdue, nothing waiting to publish.${hidden.length ? ` ${hidden.length} task${hidden.length === 1 ? " is" : "s are"} cleared or snoozed.` : " Nicely done."}</div>
          </div>` }));
    } else {
      // Group by priority bucket with section headers for scannability.
      const groups = [
        { key: "urgent", label: "Urgent — needs you now", items: active.filter((t) => t.priority === "urgent") },
        { key: "high",   label: "Do soon",                items: active.filter((t) => t.priority === "high") },
        { key: "normal", label: "When you can",           items: active.filter((t) => t.priority === "normal") },
      ];
      for (const g of groups) {
        if (!g.items.length) continue;
        tasksBody.appendChild(el("div", { class: `tasks-group-head tasks-group-${g.key}`, html: `${esc(g.label)} <span class="tasks-group-count">${g.items.length}</span>` }));
        const list = el("div", { class: "admin-tasks-list", style: { marginBottom: "18px" } });
        for (const t of g.items) list.appendChild(renderTaskRow(t, false));
        tasksBody.appendChild(list);
      }
    }

    // Cleared / snoozed reveal.
    if (hidden.length) {
      const footer = el("div", { class: "admin-tasks-hidden-bar" });
      const toggle = el("button", {
        type: "button",
        class: "admin-tasks-toggle",
        html: `${state.showSnoozed ? "Hide" : "Show"} ${hidden.length} cleared &amp; snoozed`,
      });
      toggle.addEventListener("click", () => { state.showSnoozed = !state.showSnoozed; renderTasks(); });
      footer.appendChild(toggle);
      tasksBody.appendChild(footer);

      if (state.showSnoozed) {
        const hlist = el("div", { class: "admin-tasks-list admin-tasks-hidden-list" });
        for (const t of hidden) hlist.appendChild(renderTaskRow(t, true));
        tasksBody.appendChild(hlist);
      }
    }
  }

  return () => { unsubProjects(); unsubUsers(); unsubPrefs(); };
}

function ensureTasksPageStyles() {
  if (document.getElementById("tasks-page-styles")) return;
  const s = document.createElement("style");
  s.id = "tasks-page-styles";
  s.textContent = `
    .tasks-page-head .card-title { display:flex; align-items:center; gap:8px; }
    .tasks-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
    .tasks-kpi {
      background:#f8fafc; border:1px solid #e5e7eb; border-radius:10px;
      padding:14px 16px; text-align:left;
    }
    .tasks-kpi-num { font-size:26px; font-weight:800; color:#0b1220; line-height:1; }
    .tasks-kpi-label { font-size:11.5px; font-weight:600; color:#64748b; margin-top:6px; text-transform:uppercase; letter-spacing:.04em; }
    .tasks-kpi-danger { background:#fff5f5; border-color:#fecaca; }
    .tasks-kpi-danger .tasks-kpi-num { color:#b91c1c; }
    .tasks-kpi-warn { background:#fffbeb; border-color:#fde68a; }
    .tasks-kpi-warn .tasks-kpi-num { color:#b45309; }

    .tasks-group-head {
      display:flex; align-items:center; gap:8px;
      font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.06em;
      color:#64748b; margin:4px 0 11px;
    }
    .tasks-group-head .tasks-group-count {
      font-size:11px; font-weight:800; color:#475569;
      background:#eef2f6; border-radius:999px; padding:2px 8px;
    }
    .tasks-group-urgent { color:#b91c1c; }
    .tasks-group-urgent .tasks-group-count { background:#fee2e2; color:#b91c1c; }
    .tasks-group-high { color:#b45309; }
    .tasks-group-high .tasks-group-count { background:#fef3c7; color:#92400e; }

    @media (max-width:680px) {
      .tasks-kpis { grid-template-columns:repeat(2,1fr); }
    }
  `;
  document.head.appendChild(s);
}
