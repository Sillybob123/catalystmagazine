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

export async function mount(ctx, container) {
  container.innerHTML = "";
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Catalyst in the Capital</div>
        <div class="card-subtitle">Editorial workflow pipeline — powered by the scheduler database</div>
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
    const colNames = Object.keys(byCol);
    const grid = el("div", { class: "pipeline-grid" });
    for (const name of colNames) {
      const col = byCol[name];
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
        bodyCol.appendChild(el("div", { class: "pipeline-item" }, [
          el("div", { class: "pipeline-item-title" }, truncate(p.title || "Untitled", 60)),
          el("div", { class: "pipeline-item-meta" }, `${p.type || "Article"}${p.dueDate ? " · due " + p.dueDate : ""}`),
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

function groupByColumn(projects) {
  const out = {};
  for (const p of projects) {
    const col = p.columnTitle || p.column || p.state?.label || p.status || "Unsorted";
    if (!out[col]) out[col] = [];
    out[col].push(p);
  }
  return out;
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
