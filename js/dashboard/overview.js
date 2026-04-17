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

  // Shared pipeline
  const pipeline = el("div", { class: "card", style: { marginTop: "20px" } });
  pipeline.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Catalyst in the Capital — Editorial workflow</div>
        <div class="card-subtitle">Live from the scheduler database</div>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/pipeline">Full view &rarr;</a>
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
