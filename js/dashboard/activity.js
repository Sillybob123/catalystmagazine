// Admin-only Activity page.
// Shows a real-time feed of every activity entry across all projects in the
// catalystmonday workflow database, newest first.

import { workflowDb } from "../firebase-dual-config.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc } from "./ui.js";

export async function mount(ctx, container) {
  container.innerHTML = "";

  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Activity</div>
        <div class="card-subtitle">Everything happening across the editorial pipeline — proposals, comments, approvals, and stage changes — in real time.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="input" id="act-search" placeholder="Filter by name or project…" style="min-width:220px;">
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
    <div class="card-body" id="act-body">
      <div class="loading-state"><div class="spinner"></div>Loading activity…</div>
    </div>`;

  container.appendChild(card);

  const bodyEl = card.querySelector("#act-body");
  const searchEl = card.querySelector("#act-search");
  const typeEl = card.querySelector("#act-type-filter");

  // allEvents is a flat array of {projectId, projectTitle, projectType, authorName, text, timestamp}
  let allEvents = [];

  function classifyEvent(text) {
    const t = (text || "").toLowerCase();
    if (t.includes("submitted this proposal")) return "proposal";
    if (t.includes("commented")) return "comment";
    if (t.includes("approved")) return "approved";
    if (t.includes("rejected")) return "rejected";
    if (t.includes("marked") || t.includes("complete") || t.includes("incomplete")) return "step";
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
    return {
      proposal: "var(--accent)",
      comment:  "var(--ink-3)",
      approved: "var(--success)",
      rejected: "var(--danger)",
      step:     "var(--info, #3b82f6)",
      other:    "var(--muted)",
    }[type] || "var(--muted)";
  }

  function render() {
    const q = searchEl.value.trim().toLowerCase();
    const typeFilter = typeEl.value;

    let events = allEvents.filter((e) => {
      if (typeFilter !== "all" && classifyEvent(e.text) !== typeFilter) return false;
      if (q) {
        const haystack = `${e.authorName || ""} ${e.projectTitle || ""} ${e.text || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    bodyEl.innerHTML = "";

    if (!events.length) {
      bodyEl.innerHTML = `<div class="empty-state">No activity matches your filter.</div>`;
      return;
    }

    // Group by date
    const groups = new Map();
    for (const e of events) {
      const dayLabel = dayOf(e.timestamp);
      if (!groups.has(dayLabel)) groups.set(dayLabel, []);
      groups.get(dayLabel).push(e);
    }

    for (const [day, items] of groups) {
      const section = el("div", { class: "activity-section" });
      section.innerHTML = `<div class="activity-date-header">${esc(day)}</div>`;
      const feed = el("div", { class: "activity-feed activity-feed-full" });

      for (const item of items) {
        const type = classifyEvent(item.text);
        const row = el("div", { class: "activity-row-full" });
        row.innerHTML = `
          <div class="activity-icon" style="color:${eventColor(type)};">${eventIcon(type)}</div>
          <div class="activity-content">
            <div>
              <span class="activity-author">${esc(item.authorName || "Someone")}</span>
              <span class="activity-text"> ${esc(item.text || "")}</span>
            </div>
            <div class="activity-meta">
              <span class="activity-project">${esc(item.projectTitle || "Unknown project")}</span>
              ${item.projectType ? `<span class="pill-tag">${esc(item.projectType)}</span>` : ""}
              <span class="activity-when">${fmtActivityTime(item.timestamp)}</span>
            </div>
          </div>`;
        feed.appendChild(row);
      }

      section.appendChild(feed);
      bodyEl.appendChild(section);
    }
  }

  // Subscribe to all projects and flatten their activity arrays
  const unsub = onSnapshot(
    collection(workflowDb, "projects"),
    (snap) => {
      const events = [];
      snap.forEach((d) => {
        const project = d.data();
        const acts = Array.isArray(project.activity) ? project.activity : [];
        for (const a of acts) {
          events.push({
            projectId: d.id,
            projectTitle: project.title || "Untitled",
            projectType: project.type || "",
            authorName: a.authorName || "",
            authorId: a.authorId || "",
            text: a.text || "",
            timestamp: a.timestamp || project.updatedAt || project.createdAt || null,
          });
        }
      });
      // Sort newest first
      events.sort((a, b) => {
        const at = toMs(a.timestamp), bt = toMs(b.timestamp);
        return bt - at;
      });
      allEvents = events;
      render();
    },
    (err) => {
      console.error("[activity] snapshot error", err);
      bodyEl.innerHTML = `<div class="error-state">Failed to load activity: ${esc(err.message)}</div>`;
    }
  );

  searchEl.addEventListener("input", render);
  typeEl.addEventListener("change", render);

  return () => unsub();
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

function fmtActivityTime(v) {
  const ms = toMs(v);
  if (!ms) return "";
  const d = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
