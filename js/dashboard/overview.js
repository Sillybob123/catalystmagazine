// Overview page — friendly landing for every role, with the shared pipeline
// widget at the bottom so everyone sees what's going on.

import { db } from "../firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, fmtRelative, statusPill } from "./ui.js";
import { renderPipeline } from "./pipeline.js";

const ROLE_GREETINGS = {
  admin: "You're running the show today. Here's what's active.",
  editor: "Your editing queue + the broader pipeline.",
  writer: "Your drafts and what the rest of the newsroom is working on.",
  newsletter_builder: "Compose a new issue or review past campaigns.",
  marketing: "Growth pulse and collaboration pipeline.",
};

export async function mount(ctx, container) {
  container.innerHTML = "";

  // Hero
  const hero = el("div", { class: "card" });
  const firstName = (ctx.profile.name || "").split(" ")[0] || ctx.profile.email;
  hero.innerHTML = `
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:20px;">
      <div>
        <div class="section-title" style="margin:0 0 6px 0;">Welcome back</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.01em;">Hi, ${esc(firstName)}.</div>
        <div style="color:var(--muted);margin-top:6px;max-width:560px;line-height:1.5;">
          ${esc(ROLE_GREETINGS[ctx.role] || "Here's your Catalyst workspace.")}
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${ctx.role === "writer" || ctx.role === "editor" || ctx.role === "admin" ? `<a class="btn btn-accent" href="#/writer/draft">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Start a draft
        </a>` : ""}
        ${ctx.role === "newsletter_builder" || ctx.role === "admin" ? `<a class="btn btn-primary" href="#/newsletter/builder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><polyline points="22,6 12,13 2,6"/></svg>
          Build newsletter
        </a>` : ""}
      </div>
    </div>`;
  container.appendChild(hero);

  // Quick stats
  const statsGrid = el("div", { class: "grid grid-4", style: { marginTop: "20px" } });
  statsGrid.innerHTML = `
    <div class="stat"><div class="stat-label">Drafts in progress</div><div class="stat-value" data-k="drafts">…</div></div>
    <div class="stat"><div class="stat-label">Awaiting review</div><div class="stat-value" data-k="pending">…</div></div>
    <div class="stat"><div class="stat-label">Published this month</div><div class="stat-value" data-k="published">…</div></div>
    <div class="stat"><div class="stat-label">Active subscribers</div><div class="stat-value" data-k="subs">…</div></div>`;
  container.appendChild(statsGrid);

  loadQuickStats(statsGrid, ctx).catch((err) => console.warn("stats failed", err));

  // Recent activity
  const recent = el("div", { class: "card", style: { marginTop: "20px" } });
  recent.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Recent articles</div>
        <div class="card-subtitle">The last 6 updates from the newsroom</div>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/writer/feed">See all &rarr;</a>
    </div>
    <div class="card-body" id="recent-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(recent);
  loadRecentArticles(recent.querySelector("#recent-body"), ctx);

  // Staff directory
  const staff = el("div", { class: "card", style: { marginTop: "20px" } });
  staff.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">The team</div>
        <div class="card-subtitle">Everyone on staff and what they do</div>
      </div>
      ${ctx.role === "admin" ? `<a class="btn btn-ghost btn-sm" href="#/admin/users">Manage &rarr;</a>` : ""}
    </div>
    <div class="card-body" id="staff-body"><div class="loading-state"><div class="spinner"></div>Loading&hellip;</div></div>`;
  container.appendChild(staff);
  loadStaff(staff.querySelector("#staff-body"), ctx);

  // Shared pipeline
  const pipeline = el("div", { class: "card", style: { marginTop: "20px" } });
  pipeline.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Catalyst in the Capital — Editorial workflow</div>
        <div class="card-subtitle">Live from the scheduler database</div>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/pipeline/interviews">Full view &rarr;</a>
    </div>
    <div id="pipeline-mount"></div>`;
  container.appendChild(pipeline);
  renderPipeline(pipeline.querySelector("#pipeline-mount"), ctx, { compact: true });
}

async function loadQuickStats(gridEl, ctx) {
  try {
    const storiesRef = collection(db, "stories");
    const drafts = await getDocs(query(storiesRef, where("status", "==", "draft")));
    const pending = await getDocs(query(storiesRef, where("status", "==", "pending")));
    const published = await getDocs(query(storiesRef, where("status", "==", "published")));

    const monthCutoff = new Date();
    monthCutoff.setDate(monthCutoff.getDate() - 30);
    const publishedThisMonth = published.docs.filter((d) => {
      const pub = d.data().publishedAt;
      return pub && new Date(pub) > monthCutoff;
    }).length;

    gridEl.querySelector('[data-k="drafts"]').textContent = drafts.size;
    gridEl.querySelector('[data-k="pending"]').textContent = pending.size;
    gridEl.querySelector('[data-k="published"]').textContent = publishedThisMonth;

    // Subscribers — only for roles that can read subscribers, otherwise hide.
    if (["admin", "marketing", "editor", "newsletter_builder"].includes(ctx.role) || ctx.role === "admin") {
      try {
        const subs = await getDocs(query(collection(db, "subscribers"), where("status", "==", "active")));
        gridEl.querySelector('[data-k="subs"]').textContent = subs.size;
      } catch (err) {
        gridEl.querySelector('[data-k="subs"]').textContent = "—";
      }
    } else {
      gridEl.querySelector('[data-k="subs"]').textContent = "—";
    }
  } catch (err) {
    console.warn("Quick stats failed:", err);
    gridEl.querySelectorAll("[data-k]").forEach((n) => (n.textContent = "—"));
  }
}

const ROLE_META = {
  admin:              { label: "Administrator",      group: "Leadership",  order: 1, color: "#7c3aed" },
  editor:             { label: "Editor",             group: "Editorial",   order: 2, color: "#0f766e" },
  writer:             { label: "Writer",             group: "Editorial",   order: 3, color: "#0891b2" },
  newsletter_builder: { label: "Newsletter Builder", group: "Publishing",  order: 4, color: "#b45309" },
  marketing:          { label: "Marketing",          group: "Publishing",  order: 5, color: "#db2777" },
  reader:             { label: "Reader",             group: "Community",   order: 6, color: "#64748b" },
};

const GROUP_ORDER = ["Leadership", "Editorial", "Publishing", "Community"];

async function loadStaff(mount, ctx) {
  try {
    const snap = await getDocs(query(collection(db, "users"), limit(200)));
    if (snap.empty) {
      mount.innerHTML = `<div class="empty-state">No teammates found yet.</div>`;
      return;
    }

    // Group by role-group, filter out readers unless viewer is admin.
    const showReaders = ctx.role === "admin";
    const people = [];
    snap.forEach((d) => {
      const u = d.data();
      const role = u.role || "reader";
      if (role === "reader" && !showReaders) return;
      if ((u.status || "active") === "inactive") return;
      people.push({ id: d.id, ...u, role });
    });

    if (!people.length) {
      mount.innerHTML = `<div class="empty-state">No teammates found yet.</div>`;
      return;
    }

    // Sort by role order, then by name.
    people.sort((a, b) => {
      const ao = ROLE_META[a.role]?.order ?? 99;
      const bo = ROLE_META[b.role]?.order ?? 99;
      if (ao !== bo) return ao - bo;
      return (a.name || a.email || "").localeCompare(b.name || b.email || "");
    });

    // Group
    const groups = {};
    for (const p of people) {
      const g = ROLE_META[p.role]?.group || "Community";
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }

    mount.innerHTML = "";
    for (const gName of GROUP_ORDER) {
      const list = groups[gName];
      if (!list || !list.length) continue;

      const section = el("div", { class: "staff-group" });
      section.innerHTML = `
        <div class="staff-group-head">
          <span class="staff-group-title">${esc(gName)}</span>
          <span class="staff-group-count">${list.length}</span>
        </div>
        <div class="staff-grid"></div>`;
      const grid = section.querySelector(".staff-grid");

      list.forEach((p) => {
        const meta = ROLE_META[p.role] || ROLE_META.reader;
        const name = p.name || p.email || "Unknown";
        const init = getInitials(name);
        const card = el("div", { class: "staff-card" });
        card.innerHTML = `
          <div class="staff-avatar" style="background:${meta.color};">${esc(init)}</div>
          <div class="staff-info">
            <div class="staff-name">${esc(name)}</div>
            <div class="staff-role" style="color:${meta.color};">${esc(meta.label)}</div>
            ${p.email ? `<div class="staff-email">${esc(p.email)}</div>` : ""}
          </div>`;
        grid.appendChild(card);
      });

      mount.appendChild(section);
    }
  } catch (err) {
    console.warn("[overview] staff load failed", err);
    mount.innerHTML = `<div class="error-state">Could not load the team. ${esc(err?.message || "")}</div>`;
  }
}

function getInitials(nameOrEmail) {
  const s = String(nameOrEmail || "").trim();
  if (!s) return "?";
  if (s.includes("@")) return s[0].toUpperCase();
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function loadRecentArticles(mount, ctx) {
  try {
    const storiesRef = collection(db, "stories");
    const snap = await getDocs(query(storiesRef, orderBy("updatedAt", "desc"), limit(6)));
    if (snap.empty) {
      mount.innerHTML = `<div class="empty-state">No articles yet. Be the first to submit a draft.</div>`;
      return;
    }
    const list = el("div", {});
    snap.forEach((d) => {
      const a = d.data();
      const row = el("div", { class: "article-row" });
      row.innerHTML = `
        <div>
          <div class="article-title">${esc(a.title || "Untitled")}</div>
          <div class="article-meta">
            by ${esc(a.authorName || a.author || "Unknown")} · ${fmtRelative(a.updatedAt)} · ${statusPill(a.status)}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${a.status === "published" && a.url
            ? `<a class="btn btn-secondary btn-xs" href="${esc(a.url)}" target="_blank" rel="noopener">View</a>`
            : ""}
        </div>`;
      list.appendChild(row);
    });
    mount.innerHTML = "";
    mount.appendChild(list);
  } catch (err) {
    mount.innerHTML = `<div class="error-state">Could not load recent articles. ${esc(err?.message || "")}</div>`;
  }
}
