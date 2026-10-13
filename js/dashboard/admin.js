// Admin module — mount keys:
//   - "articles": all articles with approve / deny / publish / assign-editor
//   - "users":    users directory with role assignment + last-login
//   - "images":   library manager — browse every image in Firebase Storage
//                 and delete orphaned or duplicate files

import { app, db, auth, storage } from "../firebase-config.js";
import {
  collection, getDocs, doc, updateDoc, deleteDoc, query, orderBy,
  where, getDoc, setDoc, deleteField,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { el, esc, fmtRelative, fmtDate, statusPill, confirmDialog, openModal, slugify, clearPublicStoryCache } from "./ui.js";
import { loadImageLibrary, renderLibraryGrid, uploadToFirebase, openImageLibraryPicker, openArticlePreviewFromData } from "./writer.js?v=wd-3";
import { markStoryPublishedOnProject } from "./publish-sync.js";

export async function mount(ctx, container) {
  container.innerHTML = "";
  if (ctx.mountKey === "users") return mountUsers(ctx, container);
  if (ctx.mountKey === "images") return mountImages(ctx, container);
  return mountArticles(ctx, container);
}

// ====================== ARTICLES ==========================================
// Articles & approvals (#/admin/articles): every story and book review, on
// the page (no card). Status filters with counts ("Needs a decision" first),
// search, and one row per story with the next step as its main button; the
// rarer actions sit in a ⋯ menu. "Edit" opens a side panel.
const AR_FILTERS = [
  { id: "decide",    label: "Needs a decision", match: (s) => s === "pending" || s === "reviewing" },
  { id: "ready",     label: "Ready to publish", match: (s) => s === "approved" },
  { id: "published", label: "Published",        match: (s) => s === "published" },
  { id: "draft",     label: "Drafts",           match: (s) => s === "draft" },
  { id: "rejected",  label: "Rejected",         match: (s) => s === "rejected" },
  { id: "all",       label: "All",              match: () => true },
];
const AR_STATUS = {
  draft:     { label: "Draft",            tone: "" },
  pending:   { label: "Waiting for review", tone: "warn" },
  reviewing: { label: "In review",        tone: "info" },
  approved:  { label: "Ready to publish", tone: "good" },
  published: { label: "Published",        tone: "live" },
  rejected:  { label: "Rejected",         tone: "bad" },
};
let arType = "stories";
let arFilter = null;

async function mountArticles(ctx, container) {
  container.innerHTML = `
    <div class="ar-page">
      <div class="ar-toolbar">
        <div class="ar-type" role="tablist" aria-label="Story type">
          <button type="button" role="tab" data-type="stories">Stories <span data-count="stories">0</span></button>
          <button type="button" role="tab" data-type="book-reviews">Book reviews <span data-count="book-reviews">0</span></button>
        </div>
        <label class="ar-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="ar-q" placeholder="Search titles or authors" aria-label="Search stories" autocomplete="off">
        </label>
      </div>
      <div class="ar-filters" id="ar-filters" role="group" aria-label="Status"></div>
      <div id="articles-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
    </div>`;

  const editors = await getEditors();
  const body = container.querySelector("#articles-body");
  const qEl = container.querySelector("#ar-q");
  let rows = [];

  const render = () => {
    const ofType = rows.filter((r) => (arType === "book-reviews") === isBookReviewStory(r));
    container.querySelector('[data-count="stories"]').textContent = rows.filter((r) => !isBookReviewStory(r)).length;
    container.querySelector('[data-count="book-reviews"]').textContent = rows.filter(isBookReviewStory).length;
    container.querySelectorAll("[data-type]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.type === arType)));
    const counts = Object.fromEntries(AR_FILTERS.map((f) => [f.id, ofType.filter((r) => f.match(r.status || "draft")).length]));
    if (!arFilter) arFilter = counts.decide ? "decide" : counts.ready ? "ready" : "all";
    const fEl = container.querySelector("#ar-filters");
    fEl.innerHTML = AR_FILTERS.map((f) => `<button type="button" data-filter="${f.id}" aria-pressed="${f.id === arFilter}" class="${(f.id === "decide" || f.id === "ready") && counts[f.id] ? "has-items" : ""}">${esc(f.label)}<span>${counts[f.id]}</span></button>`).join("");
    fEl.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { arFilter = b.dataset.filter; render(); }));

    const f = AR_FILTERS.find((x) => x.id === arFilter) || AR_FILTERS[5];
    const q = qEl.value.trim().toLowerCase();
    const list = ofType.filter((r) => f.match(r.status || "draft"))
      .filter((r) => !q || [r.title, r.authorName, r.bookAuthor, r.editorName].some((x) => String(x || "").toLowerCase().includes(q)));
    if (!list.length) {
      body.innerHTML = `<div class="ar-empty">${q ? `Nothing matches “${esc(qEl.value.trim())}”.`
        : arFilter === "decide" ? "Nothing is waiting for a decision. You're all caught up."
        : arFilter === "ready" ? "Nothing is ready to publish right now."
        : "Nothing here."}</div>`;
      return;
    }
    const ul = el("ul", { class: "ar-list" });
    for (const a of list) ul.appendChild(renderRow(a, editors, ctx, load));
    body.innerHTML = "";
    body.appendChild(ul);
  };

  const load = async () => {
    try {
      const snap = await getDocs(query(collection(db, "stories"), orderBy("updatedAt", "desc")));
      rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    } catch (err) {
      body.innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
    }
  };

  container.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => { arType = b.dataset.type; arFilter = null; render(); }));
  qEl.addEventListener("input", render);
  load();
}

// A titled confirm with a plain-language explanation (instead of "Confirm").
function arAsk({ title, text, confirm, danger = false }) {
  return new Promise((resolve) => {
    const body = el("p", { class: "ar-ask" }, text);
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    const m = openModal({
      title, body, stack: true,
      footer: [
        el("button", { class: "btn btn-secondary", type: "button", onclick: () => { m.close(); finish(false); } }, "Cancel"),
        el("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"}`, type: "button", onclick: () => { finish(true); m.close(); } }, confirm),
      ],
      onClose: () => finish(false),
    });
  });
}

const AR_DOTS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

function liveUrlOf(a) {
  if (!a.slug) return "";
  return `/${isBookReviewStory(a) ? "book-review" : "article"}/${encodeURIComponent(a.slug)}`;
}

function categoryKey(category = "") {
  return String(category || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function isBookReviewStory(story = {}) {
  const key = categoryKey(story.category);
  return key === "book-review" || key === "bookreview";
}

function normalizeStoryCategory(category = "") {
  const raw = String(category || "").trim();
  const key = categoryKey(raw);
  if (key === "book-review" || key === "bookreview") return "book-review";
  return raw || "Feature";
}

function formatStoryCategory(category = "") {
  const key = categoryKey(category);
  const labels = {
    "feature": "Feature",
    "profile": "Profile",
    "interview": "Interview",
    "op-ed": "Op-Ed",
    "oped": "Op-Ed",
    "editorial": "Editorial",
    "news": "News",
    "science": "Science",
    "book-review": "Book Review",
    "bookreview": "Book Review",
  };
  return labels[key] || (category || "Feature").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Canonical topic tags — must match HOME_TOPIC_ORDER (js/main.js) and TOPIC_ORDER
// (js/articles-new.js) and scripts/backfill-tags.js so the front-end filter pills
// line up with what admins set here. Topics are stored on stories/{id}.tags.
const STORY_TOPICS = ["AI", "Health", "Medicine", "Biology", "Chemistry",
  "Public Health", "Physics", "Environment", "Space", "Neuroscience",
  "Technology", "Policy"];

function renderRow(a, editors, ctx, reload) {
  const status = a.status || "draft";
  const st = AR_STATUS[status] || AR_STATUS.draft;
  const cover = a.coverImage || a.image || "";
  const live = liveUrlOf(a);
  const book = isBookReviewStory(a);
  const primary =
    status === "pending" || status === "reviewing" ? `<button class="btn btn-primary btn-sm" type="button" data-action="approve" title="Approve and send the writer a final-review link">Approve</button>`
    : status === "approved" ? `<button class="btn btn-primary btn-sm" type="button" data-action="publish" title="Publish now, without waiting for the writer's final look">Publish now</button>`
    : status === "published" && live ? `<a class="btn btn-secondary btn-sm" href="${escAttr(live)}" target="_blank" rel="noopener">View live</a>`
    : `<button class="btn btn-secondary btn-sm" type="button" data-action="edit-details">Edit</button>`;
  const menu = [
    `<button type="button" role="menuitem" data-action="view">Open in the review editor</button>`,
    status !== "draft" && status !== "rejected" ? `<button type="button" role="menuitem" data-action="edit-details">Edit details</button>` : "",
    status === "approved" ? `<button type="button" role="menuitem" data-action="final-review">Open the final-review page</button>` : "",
    status === "approved" ? `<button type="button" role="menuitem" data-action="copy-link">Copy the writer's review link</button>` : "",
    status === "published" && live ? `<a role="menuitem" href="${escAttr(live)}" target="_blank" rel="noopener">View on the site</a>` : "",
    status !== "rejected" && status !== "published" ? `<button type="button" role="menuitem" data-action="reject" class="is-danger">Reject</button>` : "",
    `<button type="button" role="menuitem" data-action="delete" class="is-danger">Delete permanently</button>`,
  ].filter(Boolean).join("");

  const tr = el("li", { class: "ar-row" });
  tr.innerHTML = `
    <span class="ar-thumb${cover ? "" : " is-empty"}" aria-hidden="true">${cover ? `<img src="${escAttr(cover)}" alt="" loading="lazy" decoding="async">` : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/></svg>`}</span>
    <div class="ar-main">
      <button type="button" class="ar-title" data-action="view" title="Open in the review editor">${esc(a.title || "Untitled")}</button>
      <div class="ar-meta">
        <span class="ar-chip">${esc(formatStoryCategory(a.category))}</span>
        <span>${esc(book && a.bookAuthor ? `${a.authorName || "Unknown"} on ${a.bookAuthor}` : (a.authorName || "Unknown"))}</span>
        <span class="ar-dot" aria-hidden="true"></span>
        <span title="${escAttr(a.updatedAt ? "Last updated " + fmtDate(a.updatedAt) : "")}">${status === "published" && a.publishedAt ? `Published ${esc(fmtDate(typeof a.publishedAt === "string" ? a.publishedAt : (a.publishedAt?.toDate?.() || new Date()).toISOString()))}` : `Updated ${esc(fmtRelative(a.updatedAt))}`}</span>
      </div>
    </div>
    <div class="ar-state">
      <span class="ar-status${st.tone ? " is-" + st.tone : ""}">${esc(st.label)}</span>
      <label class="ar-editor">
        <span class="sr-only">Editor for ${esc(a.title || "this story")}</span>
        <select class="select" data-action="assign-editor" data-id="${esc(a.id)}">
          <option value="">No editor</option>
          ${editors.map((e) => `<option value="${esc(e.id)}" ${e.id === a.editorId ? "selected" : ""}>${esc(e.name || e.email)}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="ar-actions">
      <button class="ar-link" type="button" data-action="view">Review</button>
      ${primary}
      <div class="ar-more">
        <button class="ar-more-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${escAttr(a.title || "this story")}" data-more>${AR_DOTS}</button>
        <div class="ar-menu" role="menu" hidden>${menu}</div>
      </div>
    </div>`;

  // ⋯ menu: opens under the button, closes on outside click or Escape.
  const moreBtn = tr.querySelector("[data-more]");
  const menuEl = tr.querySelector(".ar-menu");
  const closeMenu = () => { menuEl.hidden = true; moreBtn.setAttribute("aria-expanded", "false"); document.removeEventListener("click", outside, true); document.removeEventListener("keydown", onKey); };
  const outside = (e) => { if (!tr.querySelector(".ar-more").contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === "Escape") { closeMenu(); moreBtn.focus(); } };
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!menuEl.hidden) return closeMenu();
    document.querySelectorAll(".ar-menu:not([hidden])").forEach((m) => { m.hidden = true; });
    menuEl.hidden = false; moreBtn.setAttribute("aria-expanded", "true");
    // Flip upward when there's no room below.
    menuEl.classList.toggle("is-up", moreBtn.getBoundingClientRect().bottom + menuEl.offsetHeight + 16 > window.innerHeight);
    menuEl.querySelector("[role=menuitem]")?.focus();
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", onKey);
  });
  menuEl.addEventListener("click", () => closeMenu());

  tr.addEventListener("change", async (e) => {
    const sel = e.target.closest('[data-action="assign-editor"]');
    if (!sel) return;
    const editorId = sel.value || null;
    const editor = editors.find((x) => x.id === editorId);
    try {
      await updateDoc(doc(db, "stories", a.id), {
        editorId: editorId,
        editorName: editor ? (editor.name || editor.email) : null,
        updatedAt: new Date().toISOString(),
      });
      ctx.toast(editorId ? `Assigned to ${editor.name || editor.email}` : "Editor unassigned", "success");
    } catch (err) { ctx.toast("Assign failed: " + err.message, "error"); }
  });

  tr.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "view") { location.hash = `#/editor/queue?review=${a.id}`; return; }
    if (action === "edit-details") { openStoryDetailsModal(ctx, a.id, reload); return; }
    if (action === "approve") {
      // Two-step publish: admin approves, which stages the article and gives
      // us a shareable final-review URL to send to the writer. Only when the
      // writer (or admin) opens that URL and clicks "Publish now" does the
      // article actually go live.
      const ok = await arAsk({
        title: `Approve “${a.title || "Untitled"}”?`,
        text: "You'll get a final-review link to send the writer. It stays off the site until they (or you) press Publish on that page.",
        confirm: "Approve",
      });
      if (!ok) return;
      try {
        const patch = {
          status: "approved",
          approvedById: ctx.user.uid,
          approvedByName: ctx.profile.name || ctx.user.email,
          approvedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await updateDoc(doc(db, "stories", a.id), patch);
        await showFinalReviewLinkModal(ctx, a.id, a.title || "Untitled");
        reload();
      } catch (err) { ctx.toast("Approve failed: " + err.message, "error"); }
      return;
    }
    if (action === "copy-link") {
      const url = `${window.location.origin}/admin/#/final-review?id=${encodeURIComponent(a.id)}`;
      try { await navigator.clipboard.writeText(url); ctx.toast("Review link copied. Send it to the writer.", "success"); }
      catch { ctx.toast(url, "info", 8000); }
      return;
    }
    if (action === "final-review") {
      location.hash = `#/final-review?id=${encodeURIComponent(a.id)}`;
      return;
    }
    if (action === "publish") {
      // Admin override: skip the writer's final review and ship now. Useful
      // for tiny corrections or time-critical pieces where the admin has
      // already done a full review.
      const ok = await arAsk({
        title: `Publish “${a.title || "Untitled"}” now?`,
        text: "It goes live on the site right away, without waiting for the writer's final look. The author gets a congratulations email.",
        confirm: "Publish now",
      });
      if (!ok) return;
      try {
        const patch = {
          status: "published",
          finalApprovedById: ctx.user.uid,
          finalApprovedByName: ctx.profile.name || ctx.user.email,
          finalApprovedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (!a.publishedAt) patch.publishedAt = new Date().toISOString();
        await updateDoc(doc(db, "stories", a.id), patch);
        // Bust the public listing cache so the article (and especially
        // book reviews, which read the same cache key) shows up on the
        // next /book-reviews or /articles load without a hard refresh.
        clearPublicStoryCache();
        // Congratulate the author by email (CC admins). Best-effort and
        // idempotent server-side — never block or fail the publish on it.
        try {
          await ctx.authedFetch("/api/notify/published", {
            method: "POST",
            body: JSON.stringify({ storyId: a.id }),
          });
        } catch (notifyErr) {
          console.warn("published notify failed (non-blocking):", notifyErr);
        }
        // Flip the matching workflow-pipeline card from purple ("needs
        // publishing") to a regular completed card. Best-effort.
        markStoryPublishedOnProject({ id: a.id, title: a.title }, ctx.profile.name || ctx.user.email);
        ctx.toast("Published.", "success");
        reload();
      } catch (err) { ctx.toast("Publish failed: " + err.message, "error"); }
      return;
    }
    if (action === "reject") {
      const ok = await arAsk({ title: `Reject “${a.title || "Untitled"}”?`, text: "The writer will see it's been declined. You can still edit it or change its status later.", confirm: "Reject", danger: true });
      if (!ok) return;
      try {
        await updateDoc(doc(db, "stories", a.id), {
          status: "rejected",
          rejectedById: ctx.user.uid,
          rejectedByName: ctx.profile.name || ctx.user.email,
          updatedAt: new Date().toISOString(),
        });
        clearPublicStoryCache();
        ctx.toast("Rejected.", "success"); reload();
      } catch (err) { ctx.toast("Failed: " + err.message, "error"); }
    }
    if (action === "delete") {
      const ok = await arAsk({ title: `Delete “${a.title || "Untitled"}”?`, text: "This removes the story for good, including from the site if it's published. It can't be undone.", confirm: "Delete permanently", danger: true });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "stories", a.id));
        clearPublicStoryCache();
        ctx.toast("Deleted.", "success"); reload();
      } catch (err) { ctx.toast("Delete failed: " + err.message, "error"); }
    }
  });

  return tr;
}

async function getEditors() {
  try {
    const snap = await getDocs(query(collection(db, "users"), where("role", "in", ["editor", "admin"])));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("Could not load editors:", err);
    return [];
  }
}

// ====================== USERS ==============================================
async function mountUsers(ctx, container) {
  container.innerHTML = `
    <div class="ua-page">
      <div class="ua-toolbar">
        <label class="ua-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="ua-q" placeholder="Find a person or email" aria-label="Find a person" autocomplete="off">
        </label>
        <div class="ua-filters" id="ua-filters" role="group" aria-label="Show"></div>
        <button class="btn btn-primary btn-sm ua-add" id="add-user-btn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add user
        </button>
      </div>
      <div id="users-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>
    </div>`;
  container.querySelector("#add-user-btn").addEventListener("click", () => openAddUserModal(ctx, () => load()));
  const load = () => loadUsers(container.querySelector("#users-body"), ctx, load, container);
  load();
}

const UA_GROUPS = [
  { id: "all", label: "Everyone" },
  { id: "admin", label: "Admins", roles: ["admin"] },
  { id: "editorial", label: "Editors & writers", roles: ["editor", "writer"] },
  { id: "growth", label: "Social & growth", roles: ["social_media", "marketing", "newsletter_builder"] },
];
let uaFilter = "all";

function lastSeenText(iso) {
  if (!iso) return "Never signed in";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(days)) return "";
  if (days <= 0) return "Active today";
  if (days === 1) return "Active yesterday";
  if (days < 30) return `Active ${days} days ago`;
  return `Last seen ${fmtDate(iso)}`;
}
function uaAvatarColor(str) {
  let h = 0;
  for (const ch of String(str || "")) h = ch.charCodeAt(0) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 30%, 44%)`;
}
function uaInitials(name, email) {
  const s = String(name || email || "?").trim();
  if (s.includes("@") && !name) return s[0].toUpperCase();
  const parts = s.split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

async function loadUsers(mount, ctx, reload, page) {
  mount.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading…</div>`;
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
    if (snap.empty) { mount.innerHTML = `<div class="empty-state">No users yet.</div>`; return; }

    const presenceSnap = await getDocs(collection(db, "user_presence"));
    const presence = new Map();
    presenceSnap.forEach((d) => presence.set(d.id, d.data()));

    // Readers have no Suite access and get no bot reminders (see
    // isFormerTeamMember in functions/_utils/bot-logic.js): the team first,
    // readers folded away underneath.
    const isReader = (u) => (u.role || "reader") === "reader";
    // One person can have several accounts with the same email (e.g. they
    // signed in two different ways). Their roles move together, or a person
    // set to Reader stays on the team through the other account.
    const emailKey = (u) => String(u.email || "").trim().toLowerCase();
    const sameEmail = new Map();
    snap.docs.forEach((d) => { const k = emailKey(d.data()); if (k) sameEmail.set(k, [...(sameEmail.get(k) || []), d.id]); });
    const accountsOf = (id) => { const d = snap.docs.find((x) => x.id === id); const k = d ? emailKey(d.data()) : ""; return k ? sameEmail.get(k) : [id]; };
    const byName = (a, b) => String(a.data().name || a.data().email || "").localeCompare(String(b.data().name || b.data().email || ""));
    const team = snap.docs.filter((d) => !isReader(d.data())).sort((a, b) => (Number(!!b.data().owner) - Number(!!a.data().owner)) || byName(a, b));
    const readers = snap.docs.filter((d) => isReader(d.data())).sort(byName);

    const rowHtml = (d) => {
      const u = d.data();
      const reader = isReader(u);
      const p = presence.get(d.id);
      const last = p?.lastSeenAt || u.lastSeenAt;
      const rem = getBotReminderExemptionState(u);
      const extra = Array.isArray(u.extraAccess) ? u.extraAccess.length : 0;
      const limited = !u.owner && Array.isArray(u.blockedAccess) ? u.blockedAccess.length : 0;
      const dupes = accountsOf(d.id).length;
      const extraEmails = Array.isArray(u.extraEmails) ? u.extraEmails.filter(Boolean) : [];
      const lockedOwner = u.owner && !ctx.isOwner;
      const tags = [
        u.owner ? `<span class="ua-tag ua-tag--owner" title="Decides which pages everyone can open. Only they can change their own account.">Owner</span>` : "",
        !reader && rem.exists && rem.active ? `<span class="ua-tag ua-tag--warn" title="${escAttr(rem.reason || "")}">Reminders ${esc(rem.label.charAt(0).toLowerCase() + rem.label.slice(1))}</span>` : "",
        extra ? `<span class="ua-tag" title="Pages added beyond their role">+${extra} page${extra === 1 ? "" : "s"}</span>` : "",
        limited && ctx.isOwner ? `<span class="ua-tag ua-tag--bad" title="Pages you took away">${limited} limited</span>` : "",
        dupes > 1 ? `<span class="ua-tag ua-tag--warn" title="This email has ${dupes} accounts. Changing the role here changes all of them.">${dupes} accounts</span>` : "",
      ].filter(Boolean).join("");
      return `
        <li class="ua-row${reader ? " is-reader" : ""}" data-search="${escAttr([u.name, u.email, ...extraEmails].join(" ").toLowerCase())}" data-role="${escAttr(u.role || "reader")}">
          <div class="ua-who">
            <span class="ua-av" style="--av:${uaAvatarColor(u.name || u.email)}" aria-hidden="true">${esc(uaInitials(u.name, u.email))}</span>
            <span class="ua-who-text">
              <span class="ua-name">${esc(u.name || "No name")}${d.id === ctx.user.uid ? ` <i>(you)</i>` : ""}</span>
              <span class="ua-email" title="${escAttr([u.email, ...extraEmails].filter(Boolean).join(", "))}">${esc(u.email || "No email")}${extraEmails.length ? ` <span class="ua-more-emails">+${extraEmails.length}</span>` : ""}</span>
            </span>
          </div>
          <label class="ua-role">
            <span class="sr-only">Role for ${esc(u.name || u.email || "user")}</span>
            <select class="select" data-action="role" data-id="${esc(d.id)}" ${lockedOwner ? 'disabled title="Only the owner can change this account."' : ""}>
              ${["admin", "editor", "writer", "newsletter_builder", "marketing", "social_media", "reader"].map((r) => `<option value="${r}" ${u.role === r || (!u.role && r === "reader") ? "selected" : ""}>${roleLabel(r)}</option>`).join("")}
            </select>
          </label>
          <div class="ua-meta">
            <span class="ua-seen${last && Date.now() - new Date(last).getTime() < 86400000 * 2 ? " is-recent" : ""}">${esc(reader ? "No Suite access" : lastSeenText(last))}</span>
            ${tags}
          </div>
          <div class="ua-actions">
            ${ctx.isOwner && !u.owner && !reader ? `<button class="ua-btn" type="button" data-action="limit-pages" data-id="${esc(d.id)}" title="Take specific pages away from this person, whatever their role">Limit pages</button>` : ""}
            ${!reader ? `<button class="ua-btn" type="button" data-action="extra-access" data-id="${esc(d.id)}" ${lockedOwner ? "disabled" : ""} title="Give extra pages and add email addresses">Access</button>` : ""}
            ${!reader ? `<button class="ua-btn" type="button" data-action="bot-exemption" data-id="${esc(d.id)}" title="Pause or resume the reminder bot's emails">Reminders</button>` : ""}
            <button class="ua-btn ua-btn--icon ua-delete" type="button" data-action="delete" data-id="${esc(d.id)}" ${d.id === ctx.user.uid || u.owner ? "disabled" : ""} title="Remove this account" aria-label="Delete ${escAttr(u.name || u.email || "user")}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>
            </button>
          </div>
        </li>`;
    };

    // A fresh wrapper per load, so reloads never stack event listeners.
    const wrap = el("div", { class: "ua-wrap" });
    wrap.innerHTML = `
      <p class="ua-summary" id="ua-summary"></p>
      <ul class="ua-list" id="ua-team">${team.map(rowHtml).join("")}</ul>
      <p class="ua-none" id="ua-none" hidden>No one matches.</p>
      ${readers.length ? `
      <details class="ua-readers" id="ua-readers">
        <summary><span class="ua-readers-title">Readers</span><span class="ua-readers-count">${readers.length}</span><span class="ua-readers-note">No Suite access and no reminder emails. Pick a role to bring someone back.</span></summary>
        <ul class="ua-list">${readers.map(rowHtml).join("")}</ul>
      </details>` : ""}`;
    mount.innerHTML = "";
    mount.appendChild(wrap);
    const tbody = wrap;

    // Filters + search (client-side; the list is small).
    const counts = Object.fromEntries(UA_GROUPS.map((g) => [g.id, g.roles ? team.filter((d) => g.roles.includes(d.data().role)).length : team.length]));
    const filtersEl = page.querySelector("#ua-filters");
    const qEl = page.querySelector("#ua-q");
    const apply = () => {
      const g = UA_GROUPS.find((x) => x.id === uaFilter) || UA_GROUPS[0];
      const q = qEl.value.trim().toLowerCase();
      let shown = 0;
      mount.querySelectorAll("#ua-team .ua-row").forEach((r) => {
        const ok = (!g.roles || g.roles.includes(r.dataset.role)) && (!q || r.dataset.search.includes(q));
        r.hidden = !ok; if (ok) shown++;
      });
      let readersShown = 0;
      mount.querySelectorAll("#ua-readers .ua-row").forEach((r) => { const ok = !q || r.dataset.search.includes(q); r.hidden = !ok; if (ok) readersShown++; });
      const rd = mount.querySelector("#ua-readers");
      if (rd) { rd.hidden = !!q && !readersShown; if (q && readersShown) rd.open = true; }
      mount.querySelector("#ua-none").hidden = shown > 0 || (q && readersShown > 0);
      filtersEl.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === uaFilter)));
    };
    filtersEl.innerHTML = UA_GROUPS.map((g) => `<button type="button" data-filter="${g.id}" aria-pressed="${g.id === uaFilter}">${esc(g.label)}<span>${counts[g.id]}</span></button>`).join("");
    filtersEl.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { uaFilter = b.dataset.filter; apply(); }));
    qEl.oninput = apply;
    const active7 = team.filter((d) => { const l = presence.get(d.id)?.lastSeenAt || d.data().lastSeenAt; return l && Date.now() - new Date(l).getTime() < 7 * 86400000; }).length;
    mount.querySelector("#ua-summary").innerHTML = `<b>${team.length}</b> on the team · ${active7} active this week${readers.length ? ` · ${readers.length} readers` : ""}`;
    apply();

    tbody.addEventListener("change", async (e) => {
      const sel = e.target.closest('[data-action="role"]');
      if (!sel) return;
      const uid = sel.dataset.id;
      const ids = accountsOf(uid);
      try {
        // Every account with this email gets the same role.
        await Promise.all(ids.map((id) => updateDoc(doc(db, "users", id), { role: sel.value })));
        const many = ids.length > 1 ? ` (all ${ids.length} of their accounts)` : "";
        ctx.toast(sel.value === "reader" ? `Set to Reader${many}: no access, no reminders.` : `Role updated${many}.`, "success");
        reload();   // regroup: readers sit in their own section at the bottom
      } catch (err) { ctx.toast("Update failed: " + err.message, "error"); }
    });

    tbody.addEventListener("click", async (e) => {
      const exemptBtn = e.target.closest('[data-action="bot-exemption"]');
      if (exemptBtn) {
        const uid = exemptBtn.dataset.id;
        const userDoc = snap.docs.find((docSnap) => docSnap.id === uid);
        if (!userDoc) return;
        openBotReminderExemptionModal(ctx, { id: uid, ...userDoc.data() }, reload);
        return;
      }

      const limitBtn = e.target.closest('[data-action="limit-pages"]');
      if (limitBtn) {
        const uid = limitBtn.dataset.id;
        const userDoc = snap.docs.find((docSnap) => docSnap.id === uid);
        if (!userDoc) return;
        openLimitPagesModal(ctx, { id: uid, ...userDoc.data() }, accountsOf(uid), reload);
        return;
      }

      const accessBtn = e.target.closest('[data-action="extra-access"]');
      if (accessBtn) {
        const uid = accessBtn.dataset.id;
        const userDoc = snap.docs.find((docSnap) => docSnap.id === uid);
        if (!userDoc) return;
        openExtraAccessModal(ctx, { id: uid, ...userDoc.data() }, reload);
        return;
      }

      const btn = e.target.closest('[data-action="delete"]');
      if (!btn || btn.disabled) return;
      const uid = btn.dataset.id;
      const ok = await confirmDialog("Delete this user's profile? (Their Firebase Auth record will remain; contact Firebase console to remove fully.)", { confirmText: "Delete", danger: true });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "users", uid));
        ctx.toast("User profile deleted.", "success"); reload();
      } catch (err) { ctx.toast("Delete failed: " + err.message, "error"); }
    });

  } catch (err) {
    mount.innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
}

function roleLabel(r) {
  return {
    admin: "Admin",
    editor: "Editor",
    writer: "Writer",
    newsletter_builder: "Newsletter Builder",
    marketing: "Marketing",
    social_media: "Social Media",
    reader: "Reader",
  }[r] || r;
}

// Grantable routes — what an admin can hand out to individual users via
// the Extra-access modal. Each entry's `baseRoles` is the set of roles
// that already see it via the normal role map, so the modal can show
// which routes a given user is actually missing.
//
// Keep this in sync with ROUTES in app.js. If a new route is added there
// that should be admin-grantable, add it here too.
const GRANTABLE_ROUTES = [
  // Writing — lets any role (e.g. social media) submit and manage drafts.
  { group: "Writing",            hash: "#/writer/draft",       label: "Submit a draft",             baseRoles: ["admin", "editor", "writer"] },
  { group: "Writing",            hash: "#/writer/mine",        label: "My articles",                baseRoles: ["admin", "editor", "writer"] },
  { group: "Writing",            hash: "#/writer/feed",        label: "Articles in the works",      baseRoles: ["admin", "editor", "writer"] },
  { group: "Writing",            hash: "#/writer/guidelines",  label: "Editorial standards",        baseRoles: ["admin", "editor", "writer"] },
  { group: "Writing",            hash: "#/book-reviews/write", label: "Write a book review",        baseRoles: ["admin", "editor", "writer"] },
  { group: "Writing",            hash: "#/book-reviews/mine",  label: "My book reviews",            baseRoles: ["admin", "editor", "writer"] },

  // Editorial / pipeline
  { group: "Editorial pipeline", hash: "#/admin/articles",     label: "All articles & approvals",   baseRoles: ["admin"] },
  { group: "Editorial pipeline", hash: "#/admin/submissions",  label: "Submissions inbox",          baseRoles: ["admin"] },
  { group: "Editorial pipeline", hash: "#/admin/book-reviews", label: "Book reviews queue",         baseRoles: ["admin", "editor"] },
  { group: "Editorial pipeline", hash: "#/editor/queue",       label: "Editor queue",               baseRoles: ["admin", "editor"] },
  { group: "Editorial pipeline", hash: "#/admin/tasks",        label: "Tasks (admin queue)",        baseRoles: ["admin"] },

  // Marketing
  { group: "Marketing",          hash: "#/planner",                 label: "Planner (upcoming stories)",  baseRoles: ["admin", "marketing", "social_media"] },
  // Not a page — a capability. Grants the "Assign a post" tools inside the
  // Planner (assign social posts to specific people with deadlines).
  { group: "Marketing",          hash: "#/planner/assign",          label: "Planner: assign social posts + deadlines", baseRoles: ["admin"] },
  { group: "Marketing",          hash: "#/marketing/analytics",     label: "Subscribers & growth",        baseRoles: ["admin", "marketing", "newsletter_builder", "social_media"] },
  { group: "Marketing",          hash: "#/marketing/subscribers",   label: "Subscriber list",             baseRoles: ["admin", "marketing", "social_media"] },
  { group: "Marketing",          hash: "#/marketing/collabs",       label: "Collaboration requests",      baseRoles: ["admin", "marketing"] },
  { group: "Marketing",          hash: "#/marketing/social",        label: "Social media posts",          baseRoles: ["admin", "marketing", "social_media"] },
  { group: "Marketing",          hash: "#/marketing/searchability", label: "Searchability (Search Console)", baseRoles: ["admin", "marketing", "social_media"] },

  // Newsletter
  { group: "Newsletter",         hash: "#/newsletter/builder", label: "Newsletter builder",         baseRoles: ["admin", "newsletter_builder"] },
  { group: "Newsletter",         hash: "#/newsletter/history", label: "Campaign history",           baseRoles: ["admin", "newsletter_builder", "marketing"] },

  // Admin tools (only super-rare grants — admin can extend if they truly want)
  { group: "Admin tools",        hash: "#/admin/users",        label: "Users & roles",              baseRoles: ["admin"] },
  { group: "Admin tools",        hash: "#/admin/images",       label: "Image library",              baseRoles: ["admin"] },
  { group: "Admin tools",        hash: "#/admin/games",        label: "Games",                      baseRoles: ["admin"] },
  { group: "Admin tools",        hash: "#/admin/activity",     label: "Activity",                   baseRoles: ["admin"] },
  { group: "Admin tools",        hash: "#/admin/advanced",     label: "Advanced tools",             baseRoles: ["admin"] },
];

// Routes a user with this role ALREADY sees via the regular role map.
// Used to gray-out checkboxes that would be redundant.
function routeAlreadyVisible(route, userRole) {
  const effective = userRole === "editor" ? ["editor", "writer"] : [userRole];
  if (userRole === "admin") return true;
  return route.baseRoles.some((r) => effective.includes(r));
}

// Pages the owner can take away. Everything a role normally opens, so the
// list covers more than GRANTABLE_ROUTES (Story Tracker, Team tasks…).
// Overview is never listed: it's everyone's home page.
const LIMITABLE_ROUTES = [
  { group: "Everyday", hash: "#/calendar",       label: "Editorial calendar", baseRoles: ["admin", "editor", "writer", "marketing", "newsletter_builder", "social_media"] },
  { group: "Everyday", hash: "#/pipeline/all",   label: "Story Tracker",      baseRoles: ["*"] },
  { group: "Everyday", hash: "#/pipeline/mine",  label: "My assignments",     baseRoles: ["*"] },
  { group: "Everyday", hash: "#/tasks",          label: "Team tasks",         baseRoles: ["*"] },
  { group: "Everyday", hash: "#/directory",      label: "Team & messages",    baseRoles: ["*"] },
  { group: "Admin tools", hash: "#/admin/briefing", label: "Briefing",        baseRoles: ["admin"] },
  ...GRANTABLE_ROUTES.filter((r) => r.hash !== "#/planner/assign"),
  { group: "Marketing", hash: "#/planner/assign", label: "Planner: assign social posts + deadlines", baseRoles: ["admin"] },
];

// Owner only: choose which pages this person may open. Unticking a page
// adds it to users/{uid}.blockedAccess, on every account with their email.
// The rules let only the owner write that field.
function openLimitPagesModal(ctx, user, accountIds, onSaved) {
  const role = user.role || "reader";
  const blocked = new Set(Array.isArray(user.blockedAccess) ? user.blockedAccess : []);
  const extra = new Set(Array.isArray(user.extraAccess) ? user.extraAccess : []);
  const visible = (r) => r.baseRoles.includes("*") || routeAlreadyVisible(r, role) || extra.has(r.hash);
  const routes = LIMITABLE_ROUTES.filter(visible);
  const byGroup = new Map();
  for (const r of routes) byGroup.set(r.group, [...(byGroup.get(r.group) || []), r]);

  const body = el("div", {});
  body.innerHTML = `
    <p style="margin:0 0 14px;font-size:13.5px;line-height:1.55;color:var(--muted);">
      Untick a page to take it away from <strong style="color:var(--ink);">${esc(user.name || user.email)}</strong>, even though their <strong style="color:var(--ink);">${esc(roleLabel(role))}</strong> role would normally include it. It disappears from their menu, and the Suite and the server refuse it. Only you can change this.
    </p>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <button type="button" class="btn btn-ghost btn-xs" data-all="on">Allow all</button>
      <button type="button" class="btn btn-ghost btn-xs" data-all="off">Take all away</button>
    </div>
    <div class="extra-access-list">
      ${[...byGroup.entries()].map(([g, list]) => `
        <div class="extra-access-group">
          <div class="extra-access-group-title">${esc(g)}</div>
          ${list.map((r) => `
            <label class="extra-access-row">
              <input type="checkbox" data-hash="${esc(r.hash)}" ${blocked.has(r.hash) ? "" : "checked"}>
              <span class="extra-access-label">${esc(r.label)}</span>
            </label>`).join("")}
        </div>`).join("")}
    </div>
    <p class="hint" id="lp-msg" style="color:var(--danger);margin-top:10px;"></p>`;

  const cancel = el("button", { class: "btn btn-secondary" }, "Cancel");
  const save = el("button", { class: "btn btn-primary" }, "Save");
  const modal = openModal({ title: `Pages ${user.name || user.email} can open`, body, footer: [cancel, save] });
  cancel.addEventListener("click", () => modal.close());
  body.querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", () => {
    body.querySelectorAll("input[data-hash]").forEach((cb) => { cb.checked = b.dataset.all === "on"; });
  }));
  save.addEventListener("click", async () => {
    // Keep restrictions on pages not shown here (e.g. from an earlier role).
    const shown = new Set(routes.map((r) => r.hash));
    const next = [...blocked].filter((h) => !shown.has(h));
    body.querySelectorAll("input[data-hash]").forEach((cb) => { if (!cb.checked) next.push(cb.dataset.hash); });
    save.disabled = true; save.textContent = "Saving…";
    try {
      await Promise.all((accountIds && accountIds.length ? accountIds : [user.id]).map((id) => updateDoc(doc(db, "users", id), { blockedAccess: next })));
      ctx.toast(next.length ? `Saved: ${next.length} page${next.length === 1 ? "" : "s"} taken away. It applies on their next page load.` : "Saved: every page is allowed again.", "success");
      modal.close();
      onSaved?.();
    } catch (err) {
      body.querySelector("#lp-msg").textContent = err?.message || "Couldn't save.";
      save.disabled = false; save.textContent = "Save";
    }
  });
}

function openExtraAccessModal(ctx, user, onSaved) {
  const grantedSet = new Set(Array.isArray(user.extraAccess) ? user.extraAccess : []);
  const userRole = user.role || "reader";

  // Group routes by section for the modal layout
  const byGroup = new Map();
  for (const r of GRANTABLE_ROUTES) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(r);
  }

  const groupsHtml = Array.from(byGroup.entries()).map(([groupName, routes]) => `
    <div class="extra-access-group">
      <div class="extra-access-group-title">${esc(groupName)}</div>
      ${routes.map((r) => {
        const already = routeAlreadyVisible(r, userRole);
        const checked = grantedSet.has(r.hash);
        return `
          <label class="extra-access-row ${already ? "is-already" : ""}">
            <input type="checkbox" data-hash="${esc(r.hash)}" ${checked ? "checked" : ""} ${already ? "disabled" : ""}>
            <span class="extra-access-label">
              ${esc(r.label)}
              ${already ? `<span class="extra-access-already">already visible via ${esc(roleLabel(userRole))} role</span>` : ""}
            </span>
          </label>`;
      }).join("")}
    </div>`).join("");

  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const saveBtn   = el("button", { class: "btn btn-accent" },   "Save");

  const primaryEmail = String(user.email || "").trim();
  const existingExtras = Array.isArray(user.extraEmails) ? user.extraEmails.filter(Boolean) : [];

  const body = el("div", {});
  body.innerHTML = `
    <div style="font-size:13px;color:var(--muted);line-height:1.55;margin-bottom:14px;">
      Give <strong>${esc(user.name || user.email)}</strong> access to specific dashboard pages beyond their <strong>${esc(roleLabel(userRole))}</strong> role,
      and manage which inboxes their dashboard mail reaches.
    </div>

    <div style="border:1px solid var(--hairline,#e2e8f0);border-radius:10px;padding:14px 16px;margin-bottom:18px;background:#fafbfc;">
      <div style="font-weight:700;font-size:13px;color:var(--ink);">Email addresses</div>
      <div style="font-size:12.5px;color:var(--muted);line-height:1.5;margin:4px 0 10px;">
        Direct messages and dashboard notifications go to the primary email <em>and</em> every address listed here.
      </div>
      ${primaryEmail
        ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
             <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:var(--ink);">${esc(primaryEmail)}</span>
             <span style="font-size:10.5px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;background:#e2e8f0;padding:2px 7px;border-radius:999px;">Primary</span>
           </div>`
        : `<div style="font-size:12.5px;color:var(--danger,#b91c1c);margin-bottom:8px;">No primary email on this account.</div>`}
      <div id="ea-extra-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;"></div>
      <button type="button" class="btn btn-ghost btn-xs" id="ea-add-email" style="align-self:flex-start;">+ Add another email</button>
    </div>

    <div style="font-weight:700;font-size:13px;color:var(--ink);margin-bottom:8px;">Page access</div>
    <div class="extra-access-list" id="extra-access-list">
      ${groupsHtml}
    </div>
    <div id="ea-msg" class="hint" style="color:var(--danger);margin-top:10px;"></div>`;

  const modal = openModal({
    title: `Page access — ${user.name || user.email}`,
    body,
    footer: [cancelBtn, saveBtn],
  });

  // Dynamic extra-email rows (add/remove without re-render), mirroring the
  // Edit-bot modal so both stay consistent.
  const extraList = body.querySelector("#ea-extra-list");
  const msgEl = body.querySelector("#ea-msg");
  const extras = [...existingExtras];
  function renderExtras() {
    extraList.innerHTML = "";
    if (!extras.length) {
      extraList.innerHTML = `<div style="font-size:13px;color:var(--muted);">No additional addresses.</div>`;
      return;
    }
    extras.forEach((email, i) => {
      const row = el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } });
      row.innerHTML = `
        <input class="input" type="email" data-extra-idx="${i}" value="${escAttr(email)}" placeholder="another@example.com" style="flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;">
        <button type="button" class="btn btn-ghost btn-xs" data-remove-extra="${i}" style="color:var(--danger);flex-shrink:0;">Remove</button>`;
      extraList.appendChild(row);
    });
  }
  renderExtras();
  extraList.addEventListener("input", (e) => {
    const inp = e.target.closest("[data-extra-idx]");
    if (!inp) return;
    extras[parseInt(inp.dataset.extraIdx, 10)] = inp.value.trim();
  });
  extraList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-extra]");
    if (!btn) return;
    extras.splice(parseInt(btn.dataset.removeExtra, 10), 1);
    renderExtras();
  });
  body.querySelector("#ea-add-email").addEventListener("click", () => {
    extras.push("");
    renderExtras();
    const inputs = extraList.querySelectorAll("input[data-extra-idx]");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  cancelBtn.addEventListener("click", () => modal.close());
  saveBtn.addEventListener("click", async () => {
    msgEl.textContent = "";

    // Validate + dedupe extra emails (drop any that equal the primary).
    const seen = new Set(primaryEmail ? [primaryEmail.toLowerCase()] : []);
    const cleanExtras = [];
    for (const raw of extras) {
      const e = String(raw || "").trim();
      if (!e) continue;
      if (!e.includes("@") || /\s/.test(e)) {
        msgEl.textContent = `"${e}" doesn't look like a valid email address.`;
        return;
      }
      const key = e.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleanExtras.push(e);
    }

    const newAccess = Array.from(modal.bodyEl.querySelectorAll('.extra-access-list input[type="checkbox"]'))
      .filter((cb) => cb.checked && !cb.disabled)
      .map((cb) => cb.dataset.hash);

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await updateDoc(doc(db, "users", user.id), {
        extraAccess: newAccess,
        extraEmails: cleanExtras,
      });
      ctx.toast("Saved. Page access updates on their next refresh; mail now reaches every listed inbox.", "success");
      modal.close();
      onSaved?.();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      msgEl.textContent = "Save failed: " + (err.message || err);
    }
  });
}

const BOT_REMINDER_TIMEZONE = "America/New_York";

function dateKeyInTimeZone(date, timeZone = BOT_REMINDER_TIMEZONE) {
  const d = toJsDate(date);
  if (!d) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!byType.year || !byType.month || !byType.day) return null;
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (value?.toDate) return value.toDate();
  if (value?.seconds) return new Date(value.seconds * 1000);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeBotReminderDate(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  return dateKeyInTimeZone(value);
}

function formatBotReminderDate(value) {
  if (!value) return "";
  const d = new Date(`${value}T12:00:00`);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getBotReminderExemptionState(user, now = new Date()) {
  const raw = user?.botReminderExemption;
  if (!raw || typeof raw !== "object") {
    return {
      exists: false,
      active: false,
      label: "Active",
      reason: null,
      untilDate: null,
      updatedAt: null,
      updatedByName: null,
    };
  }

  const untilDate = normalizeBotReminderDate(raw.untilDate || raw.until || null);
  const today = dateKeyInTimeZone(now);
  const active = !untilDate || !today || untilDate >= today;
  const updatedAt = toJsDate(raw.updatedAt);

  return {
    exists: true,
    active,
    label: !untilDate
      ? "Paused indefinitely"
      : active
        ? `Paused until ${formatBotReminderDate(untilDate)}`
        : `Expired ${formatBotReminderDate(untilDate)}`,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : null,
    untilDate: untilDate || null,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
    updatedByName: raw.updatedByName || null,
  };
}

function renderBotReminderStatus(state) {
  if (!state.exists) {
    return `<span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:11px;font-weight:600;">Active</span>`;
  }

  const tone = state.active
    ? { bg: "#eff6ff", ink: "#1d4ed8", sub: "#1e40af" }
    : { bg: "#f1f5f9", ink: "#475569", sub: "#64748b" };

  return `
    <div style="display:flex;flex-direction:column;gap:3px;">
      <span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;background:${tone.bg};color:${tone.ink};font-size:11px;font-weight:700;width:max-content;">${esc(state.label)}</span>
      ${state.reason ? `<div style="font-size:11px;color:${tone.sub};line-height:1.4;">${esc(state.reason)}</div>` : ""}
    </div>
  `;
}

function openBotReminderExemptionModal(ctx, user, onDone) {
  const current = getBotReminderExemptionState(user);
  const today = dateKeyInTimeZone(new Date()) || "";
  const existingExtras = Array.isArray(user.extraEmails) ? user.extraEmails.filter(Boolean) : [];

  const body = el("div", {});
  body.innerHTML = `
    <div class="field">
      <label class="label">Writer</label>
      <div style="font-weight:700;color:var(--ink);">${esc(user.name || user.email || "Unknown user")}</div>
      ${user.email ? `<div style="font-size:12px;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:2px;">${esc(user.email)}</div>` : ""}
    </div>

    <div class="field" style="border-top:1px solid var(--hairline,#e2e8f0);padding-top:16px;margin-top:4px;">
      <label class="label">Additional email addresses</label>
      <div class="hint" style="margin-bottom:8px;">Bot reminders go to the primary email above <em>and</em> every address listed here. Useful for people who check multiple inboxes.</div>
      <div id="bre-extra-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;"></div>
      <button type="button" class="btn btn-ghost btn-xs" id="bre-add-email" style="align-self:flex-start;">+ Add another email</button>
    </div>

    <div class="field" style="border-top:1px solid var(--hairline,#e2e8f0);padding-top:16px;margin-top:4px;">
      <label class="label">Reminder behavior</label>
      <select class="select" id="bre-mode">
        <option value="none" ${!current.exists ? "selected" : ""}>Send reminders normally</option>
        <option value="indefinite" ${current.exists && !current.untilDate ? "selected" : ""}>Pause indefinitely</option>
        <option value="until" ${current.untilDate ? "selected" : ""}>Pause until a specific date</option>
      </select>
      <div class="hint">This pauses automatic writer reminder emails and suppresses writer nudge suggestions in the Saturday admin digest.</div>
    </div>
    <div class="field" id="bre-until-wrap">
      <label class="label">Pause through</label>
      <input class="input" id="bre-until" type="date" min="${escAttr(today)}" value="${escAttr(current.untilDate || today)}">
      <div class="hint">The writer becomes eligible again the day after this date.</div>
    </div>
    <div class="field">
      <label class="label">Reason (optional)</label>
      <textarea class="textarea" id="bre-reason" rows="3" placeholder="Emergency, approved break, paused assignment…">${esc(current.reason || "")}</textarea>
    </div>
    ${current.exists ? `<div class="hint">Current setting: ${esc(current.label)}${current.updatedByName ? ` · last updated by ${esc(current.updatedByName)}` : ""}${current.updatedAt ? ` · ${esc(fmtDate(current.updatedAt))}` : ""}</div>` : ""}
    <div id="bre-msg" class="hint" style="color:var(--danger);"></div>
  `;

  // Build the extra-emails list dynamically so add/remove works without a re-render.
  const extraList = body.querySelector("#bre-extra-list");
  const extras = [...existingExtras];

  function renderExtras() {
    extraList.innerHTML = "";
    if (!extras.length) {
      extraList.innerHTML = `<div style="font-size:13px;color:var(--muted);">No additional addresses.</div>`;
      return;
    }
    extras.forEach((email, i) => {
      const row = el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } });
      row.innerHTML = `
        <input class="input" type="email" data-extra-idx="${i}" value="${escAttr(email)}" placeholder="extra@example.com" style="flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;">
        <button type="button" class="btn btn-ghost btn-xs" data-remove-extra="${i}" style="color:var(--danger);flex-shrink:0;">Remove</button>`;
      extraList.appendChild(row);
    });
  }
  renderExtras();

  extraList.addEventListener("input", (e) => {
    const inp = e.target.closest("[data-extra-idx]");
    if (!inp) return;
    extras[parseInt(inp.dataset.extraIdx, 10)] = inp.value.trim();
  });
  extraList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-extra]");
    if (!btn) return;
    extras.splice(parseInt(btn.dataset.removeExtra, 10), 1);
    renderExtras();
  });
  body.querySelector("#bre-add-email").addEventListener("click", () => {
    extras.push("");
    renderExtras();
    const inputs = extraList.querySelectorAll("input[data-extra-idx]");
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  const saveBtn = el("button", { class: "btn btn-accent" }, "Save");
  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const modal = openModal({
    title: `Bot settings — ${user.name || user.email || "User"}`,
    body,
    footer: [cancelBtn, saveBtn],
  });

  const modeEl = body.querySelector("#bre-mode");
  const untilWrap = body.querySelector("#bre-until-wrap");
  const untilEl = body.querySelector("#bre-until");
  const msgEl = body.querySelector("#bre-msg");

  const syncMode = () => {
    untilWrap.style.display = modeEl.value === "until" ? "" : "none";
  };
  syncMode();
  modeEl.addEventListener("change", syncMode);
  cancelBtn.addEventListener("click", modal.close);

  saveBtn.addEventListener("click", async () => {
    msgEl.textContent = "";
    const mode = modeEl.value;
    const reason = body.querySelector("#bre-reason").value.trim();

    // Validate extra emails.
    const cleanExtras = extras.map((e) => e.trim()).filter(Boolean);
    const invalidExtra = cleanExtras.find((e) => !e.includes("@"));
    if (invalidExtra) {
      msgEl.textContent = `"${invalidExtra}" doesn't look like a valid email address.`;
      return;
    }

    if (mode === "until") {
      const untilDate = untilEl.value;
      if (!untilDate) {
        msgEl.textContent = "Choose the date through which reminders should stay paused.";
        return;
      }
      if (today && untilDate < today) {
        msgEl.textContent = "The pause date can't be in the past.";
        return;
      }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
      const patch = { extraEmails: cleanExtras };

      if (mode === "none") {
        patch.botReminderExemption = deleteField();
      } else {
        patch.botReminderExemption = {
          untilDate: mode === "until" ? untilEl.value : null,
          reason: reason || null,
          updatedAt: new Date().toISOString(),
          updatedById: ctx.user.uid,
          updatedByName: ctx.profile.name || ctx.user.email,
        };
      }

      await updateDoc(doc(db, "users", user.id), patch);
      ctx.toast(mode === "none" ? "Bot settings saved." : "Bot reminder pause saved.", "success");
      modal.close();
      onDone && onDone();
    } catch (err) {
      msgEl.textContent = err.message || String(err);
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });
}

// ====================== STORY DETAILS (full admin override) ================
// Lets admin rewrite any story field: title, authors (multi), publish date,
// category, cover image, status, slug, dek, body. This is the escape hatch
// for corrections after publish.
async function openStoryDetailsModal(ctx, storyId, onDone) {
  let story;
  try {
    const snap = await getDoc(doc(db, "stories", storyId));
    if (!snap.exists()) { ctx.toast("Story not found.", "error"); return; }
    story = snap.data();
  } catch (err) { ctx.toast("Load failed: " + err.message, "error"); return; }

  // Authors: stored as either `authorName` (string) or `authors` (array of
  // {id?, name}). Normalize to array for editing, then write both fields back.
  const authors = Array.isArray(story.authors) && story.authors.length
    ? story.authors.map((a) => (typeof a === "string" ? { name: a } : a))
    : (story.authorName ? [{ name: story.authorName, id: story.authorId || null }] : [{ name: "" }]);

  const publishedAtISO = story.publishedAt ? toDatetimeLocal(story.publishedAt) : "";
  const createdAtISO = story.createdAt ? toDatetimeLocal(story.createdAt) : "";

  // Book reviews get a dedicated editor: the public-facing fields are
  // bookTitle / bookAuthor / isbn / rating / genre / deck — none of which
  // exist on a normal Article. We branch the form layout but keep the
  // shared infrastructure (status, publish date, slug, authors, cover, body)
  // so admins don't lose any of the corrective levers they're used to.
  const isBookReview = isBookReviewStory(story);
  const initialBookTitle  = story.bookTitle  || (isBookReview ? story.title : "") || "";
  const initialBookAuthor = story.bookAuthor || "";
  const initialIsbn       = story.isbn || "";
  const initialRating     = story.rating != null ? String(story.rating) : "";
  const initialGenre      = (story.genre || "").toLowerCase();

  // Shelf options shared with the writer composer + the public dropdowns.
  // Chemistry was added 2026-05-11.
  const SHELVES = [
    { v: "astronomy",        l: "Astronomy" },
    { v: "biology",          l: "Biology" },
    { v: "chemistry",        l: "Chemistry" },
    { v: "climate",          l: "Climate" },
    { v: "computer-science", l: "Computer Science" },
    { v: "mathematics",      l: "Mathematics" },
    { v: "memoir",           l: "Memoir" },
    { v: "physics",          l: "Physics" },
    { v: "stem",             l: "Other STEM" },
  ];

  const body = el("div", { class: "sd-form" });
  body.innerHTML = `
    <h4 class="sd-sec">${isBookReview ? "The book" : "Basics"}</h4>
    ${isBookReview ? `
      <!-- Book-review-only header. Title is renamed "Book title", and the
           reviewer's name lives in the Authors block further down. -->
      <div class="field" style="padding:14px 14px 12px;border:1px solid var(--hairline);border-radius:10px;background:var(--surface-2,rgba(122,31,43,.04));margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent,#7a1f2b);">Book details</span>
        </div>
        <div class="grid grid-2" style="gap:12px;">
          <div class="field" style="margin:0;">
            <label class="label">Book title</label>
            <input class="input" id="sd-book-title" value="${escAttr(initialBookTitle)}" placeholder="e.g. Astrophysics for People in a Hurry">
          </div>
          <div class="field" style="margin:0;">
            <label class="label">Book author</label>
            <input class="input" id="sd-book-author" value="${escAttr(initialBookAuthor)}" placeholder="e.g. Neil deGrasse Tyson">
          </div>
        </div>
        <div class="grid grid-2" style="gap:12px;margin-top:10px;">
          <div class="field" style="margin:0;">
            <label class="label">ISBN</label>
            <input class="input" id="sd-book-isbn" value="${escAttr(initialIsbn)}" placeholder="optional — fills the cover automatically" inputmode="numeric" pattern="[0-9Xx\\- ]*" maxlength="32">
            <div class="hint">Helps the public page show the right Open Library cover.</div>
          </div>
          <div class="field" style="margin:0;">
            <label class="label" for="sd-book-rating-input">Rating</label>
            <div class="brw-rating-slider" id="sd-book-rating-slider" data-value="0" role="group" aria-label="Rating, on a 0 to 5 scale">
              <div class="brw-rating-slider-track" aria-hidden="true">
                <input type="range" class="brw-rating-slider-input" id="sd-book-rating-input"
                       min="0" max="5" step="0.1" value="0" aria-label="Slide to set rating">
                <div class="brw-rating-slider-stars">
                  <div class="brw-rating-slider-stars-base"><span>★</span><span>★</span><span>★</span><span>★</span><span>★</span></div>
                  <div class="brw-rating-slider-stars-fill"><span>★</span><span>★</span><span>★</span><span>★</span><span>★</span></div>
                </div>
              </div>
              <div class="brw-rating-slider-value">— None —</div>
            </div>
            <span class="hint brw-rating-slider-flavor">Drag to set a rating from 0 to 5. Optional.</span>
            <input type="hidden" id="sd-book-rating" value="${escAttr(initialRating)}">
          </div>
        </div>
        <div class="field" style="margin:10px 0 0;">
          <label class="label">Shelf (discipline)</label>
          <select class="select" id="sd-book-genre">
            <option value="">— Pick the closest fit —</option>
            ${SHELVES.map(s => `<option value="${s.v}" ${s.v === initialGenre ? "selected" : ""}>${s.l}</option>`).join("")}
          </select>
          <div class="hint">Sorts the review onto the right shelf on /book-reviews.</div>
        </div>
      </div>
      <!-- Hidden mirror of the title field so the rest of the editor (slug
           autofill, preview, save patch) keeps working without a parallel
           code path. We keep sd-title in sync with sd-book-title below. -->
      <input type="hidden" id="sd-title" value="${escAttr(initialBookTitle)}">
    ` : `
      <div class="field">
        <label class="label">Title</label>
        <input class="input" id="sd-title" value="${escAttr(story.title || "")}">
      </div>
    `}
    <div class="grid grid-2">
      <div class="field">
        <label class="label">Status</label>
        <select class="select" id="sd-status">
          ${["draft","pending","reviewing","approved","published","rejected"].map(s =>
            `<option value="${s}" ${s === (story.status || "draft") ? "selected" : ""}>${esc((AR_STATUS[s] || { label: s }).label)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label class="label">Category</label>
        <select class="select" id="sd-category">
          ${[
            { v: "Feature",     l: "Feature" },
            { v: "Profile",     l: "Profile" },
            { v: "Interview",   l: "Interview" },
            { v: "Op-Ed",       l: "Op-Ed" },
            { v: "News",        l: "News" },
            { v: "Science",     l: "Science" },
            { v: "book-review", l: "Book Review" },
          ].map(c =>
            `<option value="${c.v}" ${categoryKey(c.v) === categoryKey(story.category || "Feature") ? "selected" : ""}>${c.l}</option>`).join("")}
        </select>
        <div class="hint">Book Review stories appear on /book-reviews and are hidden from the home page and main Articles index.</div>
      </div>
    </div>
    <div class="grid grid-2">
      <div class="field">
        <label class="label">Publish date</label>
        <input class="input" id="sd-published" type="datetime-local" value="${escAttr(publishedAtISO)}">
        <div class="hint">Controls the date shown on the article and the publish order.</div>
      </div>
      <div class="field">
        <label class="label">Slug (URL)</label>
        <input class="input" id="sd-slug" value="${escAttr(story.slug || "")}" placeholder="auto">
      </div>
    </div>

    <h4 class="sd-sec">People &amp; topics</h4>
    <div class="field">
      <label class="label">${isBookReview ? "Reviewer" : "Authors"}</label>
      <div id="sd-authors"></div>
      <button class="btn btn-ghost btn-xs" id="sd-add-author" type="button" style="margin-top:6px;">+ Add ${isBookReview ? "reviewer" : "author"}</button>
      <div class="hint">${isBookReview ? "The Catalyst contributor who wrote this review. Add a second name if it's a joint review." : "Add as many authors as the piece has. The first one is used for bylines that only take a single name."}</div>
    </div>

    <div class="field">
      <label class="label">Topics</label>
      <div id="sd-topics" class="sd-topic-chips" style="display:flex;flex-wrap:wrap;gap:8px;">
        ${STORY_TOPICS.map(t => {
          const on = Array.isArray(story.tags) && story.tags.includes(t);
          return `<button type="button" class="sd-topic-chip${on ? " is-on" : ""}" data-topic="${escAttr(t)}" aria-pressed="${on ? "true" : "false"}"
            style="padding:6px 14px;border-radius:999px;border:1px solid ${on ? "var(--ink,#0f172a)" : "var(--line,#e6e6e6)"};background:${on ? "var(--ink,#0f172a)" : "var(--surface)"};color:${on ? "var(--surface)" : "var(--ink-2,#475569)"};font-size:13px;font-weight:600;cursor:pointer;transition:all .15s ease;">${esc(t)}</button>`;
        }).join("")}
      </div>
      <div class="hint">Topic tags drive the subject filters on the home page and Articles index. Click to add or remove. ${isBookReview ? "(Book reviews are normally filtered by genre, not topics.)" : ""}</div>
    </div>

    <h4 class="sd-sec">Cover &amp; summary</h4>
    <div class="field">
      <label class="label">Cover image</label>
      <div class="cover-picker">
        <button type="button" class="btn btn-secondary btn-sm" id="sd-cover-upload-btn">Upload from computer</button>
        <button type="button" class="btn btn-ghost btn-sm" id="sd-cover-library-btn">Choose from library</button>
        <input type="file" id="sd-cover-file" accept="image/*" hidden>
        <div class="cover-picker-progress" id="sd-cover-progress" hidden>
          <div class="cover-picker-progress-track"><div class="cover-picker-progress-fill" id="sd-cover-progress-fill"></div></div>
          <div class="cover-picker-progress-text" id="sd-cover-progress-text">Uploading…</div>
        </div>
      </div>
      <input class="input" id="sd-cover" placeholder="https://… or upload above" value="${escAttr(story.coverImage || story.image || "")}" style="margin-top:10px;">
      <div class="hint">Upload an image (auto-converts to WebP), pick from the library, or paste a public URL.</div>
      <div id="sd-cover-preview" style="margin-top:8px;"></div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;font-size:13px;color:var(--ink-2);">
        <input type="checkbox" id="sd-light-cover" ${story.lightCover ? "checked" : ""} style="width:16px;height:16px;cursor:pointer;">
        <span>Cover image is bright/white — add dark overlay so the title text is readable</span>
      </label>
    </div>

    <div class="field">
      <label class="label">${isBookReview ? "One-sentence summary" : "Excerpt / dek"}</label>
      <textarea class="textarea" id="sd-dek" rows="2" ${isBookReview ? 'placeholder="A one-line pitch — what makes this book worth reading. Shows up under the title on the card and at the top of the page."' : ""}>${esc(story.dek || story.excerpt || "")}</textarea>
      ${isBookReview ? '<div class="hint">Shows up under the title on the review card and at the top of the article.</div>' : ""}
    </div>

    <details class="sd-advanced">
      <summary>Advanced: edit the body HTML</summary>
      <div class="field" style="margin-top:8px;">
        <label class="label">Body (HTML)</label>
        <textarea class="textarea" id="sd-body" rows="10" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">${esc(story.body || story.content || story.reviewText || "")}</textarea>
        <div class="hint">Full rewrite of the article body. Use the review surface for inline edits; this is for post-publish corrections.</div>
      </div>
    </details>

    <p class="sd-created">Created ${escAttr(createdAtISO ? fmtDate(createdAtISO) : "—")}${story.editedByAdminName ? ` · last edited by ${esc(story.editedByAdminName)}` : ""}</p>

    <div id="sd-msg" class="hint" style="color:var(--danger);"></div>`;

  const authorsMount = body.querySelector("#sd-authors");
  function renderAuthorRows() {
    authorsMount.innerHTML = "";
    authors.forEach((a, i) => {
      const row = el("div", { style: { display: "flex", gap: "8px", marginBottom: "6px" } });
      row.innerHTML = `
        <input class="input" data-idx="${i}" data-k="name" value="${escAttr(a.name || "")}" placeholder="Author name" style="flex:1;">
        <button class="btn btn-ghost btn-xs" data-remove="${i}" type="button" ${authors.length === 1 ? "disabled" : ""} style="color:var(--danger);">Remove</button>`;
      authorsMount.appendChild(row);
    });
  }
  renderAuthorRows();

  authorsMount.addEventListener("input", (e) => {
    const input = e.target.closest('input[data-idx]');
    if (!input) return;
    const idx = parseInt(input.dataset.idx, 10);
    authors[idx] = { ...authors[idx], [input.dataset.k]: input.value };
  });
  authorsMount.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn || btn.disabled) return;
    authors.splice(parseInt(btn.dataset.remove, 10), 1);
    renderAuthorRows();
  });
  body.querySelector("#sd-add-author").addEventListener("click", () => {
    authors.push({ name: "" });
    renderAuthorRows();
  });

  // Topic chips — toggle the on/off state (and its inline styling) on click.
  // Selected topics are read back from the .is-on chips at save time.
  body.querySelectorAll(".sd-topic-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const on = chip.classList.toggle("is-on");
      chip.setAttribute("aria-pressed", on ? "true" : "false");
      chip.style.background = on ? "var(--ink,#0f172a)" : "var(--surface)";
      chip.style.color = on ? "var(--surface)" : "var(--ink-2,#475569)";
      chip.style.borderColor = on ? "var(--ink,#0f172a)" : "var(--line,#e6e6e6)";
    });
  });

  // For book reviews, the visible field is #sd-book-title; the hidden
  // #sd-title is its mirror so all downstream logic (slug autofill, save,
  // preview) keeps reading a single canonical source. Wire the proxy.
  const bookTitleInput = body.querySelector("#sd-book-title");
  const bookAuthorInput = body.querySelector("#sd-book-author");
  if (bookTitleInput) {
    bookTitleInput.addEventListener("input", () => {
      const t = body.querySelector("#sd-title");
      if (t) {
        t.value = bookTitleInput.value;
        t.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }

  // Rating slider — same widget as the writer composer. The save handler
  // reads the hidden #sd-book-rating input, so wiring is just: drive the
  // range input from the initial value, keep the hidden mirror in sync,
  // and paint the stars/flavor as the admin drags.
  wireAdminRatingSlider(body, initialRating);

  // Auto-fill the slug from the title until the admin edits the slug by hand.
  // Once they type in the slug field we stop overwriting it.
  const titleInput = body.querySelector("#sd-title");
  const slugInput = body.querySelector("#sd-slug");
  let slugTouched = !!(story.slug && story.slug.trim());
  slugInput.addEventListener("input", () => { slugTouched = true; });
  titleInput.addEventListener("input", () => {
    if (!slugTouched) slugInput.value = slugify(titleInput.value);
  });
  if (!slugTouched) slugInput.value = slugify(titleInput.value);

  // Live preview for the cover image — so the admin can see whether the URL
  // actually resolves before saving.
  const coverInput = body.querySelector("#sd-cover");
  const coverPreview = body.querySelector("#sd-cover-preview");
  function renderCoverPreview() {
    const url = coverInput.value.trim();
    if (!url) { coverPreview.innerHTML = ""; return; }
    coverPreview.innerHTML = `<img src="${escAttr(url)}" alt="" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--hairline);">`;
  }
  coverInput.addEventListener("input", renderCoverPreview);
  renderCoverPreview();

  // Cover upload + library picker — same flow writers get in the compose view.
  const coverUploadBtn = body.querySelector("#sd-cover-upload-btn");
  const coverLibraryBtn = body.querySelector("#sd-cover-library-btn");
  const coverFileInput = body.querySelector("#sd-cover-file");
  const coverProgress = body.querySelector("#sd-cover-progress");
  const coverProgressFill = body.querySelector("#sd-cover-progress-fill");
  const coverProgressText = body.querySelector("#sd-cover-progress-text");

  coverUploadBtn.addEventListener("click", () => coverFileInput.click());
  coverLibraryBtn.addEventListener("click", () => {
    openImageLibraryPicker(ctx, (pickedUrl) => {
      coverInput.value = pickedUrl;
      coverInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  coverFileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { ctx.toast("Please choose an image file.", "error"); return; }
    if (file.size > 10 * 1024 * 1024) ctx.toast("Preparing large image…");

    coverProgress.hidden = false;
    coverProgressFill.style.width = "0%";
    coverProgressText.textContent = "Preparing…";
    coverUploadBtn.disabled = true;

    try {
      const url = await uploadToFirebase(file, "image", ctx, (pct) => {
        coverProgressFill.style.width = pct + "%";
        coverProgressText.textContent = `Uploading… ${pct}%`;
      });
      coverInput.value = url;
      coverInput.dispatchEvent(new Event("input", { bubbles: true }));
      coverProgressText.textContent = "Uploaded.";
      setTimeout(() => { coverProgress.hidden = true; }, 800);
    } catch (err) {
      ctx.toast("Cover upload failed: " + (err?.message || err), "error");
      coverProgress.hidden = true;
    } finally {
      coverUploadBtn.disabled = false;
      coverFileInput.value = "";
    }
  });

  const saveBtn = el("button", { class: "btn btn-primary" }, "Save changes");
  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const previewBtn = el("button", {
    class: "btn btn-ghost",
    title: "Open a full preview of how this article will look when published — with cover, headers, and sections.",
  }, "Preview");
  const modalTitle = isBookReview
    ? (initialBookTitle || story.title || "Untitled book review")
    : (story.title || "Untitled story");
  previewBtn.style.marginRight = "auto";
  const m = openModal({ title: modalTitle, body, footer: [previewBtn, cancelBtn, saveBtn], size: "drawer" });
  cancelBtn.addEventListener("click", m.close);

  previewBtn.addEventListener("click", () => {
    const cleanAuthors = authors
      .map((a) => ({ ...a, name: (a.name || "").trim() }))
      .filter((a) => a.name);
    const authorName = cleanAuthors.length
      ? cleanAuthors.map((a) => a.name).join(", ")
      : (story.authorName || "The Catalyst");
    const publishedLocal = body.querySelector("#sd-published").value;
    const publishedDate = publishedLocal
      ? new Date(publishedLocal)
      : (story.publishedAt ? new Date(story.publishedAt) : new Date());
    openArticlePreviewFromData({
      title: body.querySelector("#sd-title").value.trim(),
      dek: body.querySelector("#sd-dek").value.trim(),
      cover: body.querySelector("#sd-cover").value.trim(),
      lightCover: !!body.querySelector("#sd-light-cover")?.checked,
      category: body.querySelector("#sd-category").value || "Feature",
      author: authorName,
      bodyHtml: body.querySelector("#sd-body").value || story.body || story.content || "",
      publishedDate,
    }, ctx);
  });

  saveBtn.addEventListener("click", async () => {
    const msg = body.querySelector("#sd-msg");
    msg.textContent = "";
    const cleanAuthors = authors
      .map((a) => ({ ...a, name: (a.name || "").trim() }))
      .filter((a) => a.name);
    if (!cleanAuthors.length) { msg.textContent = "At least one author name is required."; return; }

    const publishedLocal = body.querySelector("#sd-published").value;
    const publishedAt = publishedLocal ? new Date(publishedLocal).toISOString() : null;
    const status = body.querySelector("#sd-status").value;

    // For a book review the "Book title" field is the canonical title; we
    // mirrored it into the hidden #sd-title, so reading either one would
    // work. We pull from the visible book-title field directly to be safe
    // against missed input events.
    const titleFromForm = (isBookReview
      ? (body.querySelector("#sd-book-title")?.value || "")
      : (body.querySelector("#sd-title")?.value || "")
    ).trim();

    const patch = {
      title: titleFromForm,
      status,
      category: normalizeStoryCategory(body.querySelector("#sd-category").value),
      slug: (body.querySelector("#sd-slug").value.trim() || slugify(titleFromForm)) || null,
      coverImage: body.querySelector("#sd-cover").value.trim(),
      lightCover: !!body.querySelector("#sd-light-cover")?.checked,
      dek: body.querySelector("#sd-dek").value.trim(),
      body: body.querySelector("#sd-body").value,
      // Public article renderer reads `content`, dashboard reads `body`; keep
      // them in sync so saved edits actually show up on the live site.
      content: body.querySelector("#sd-body").value,
      authors: cleanAuthors,
      authorName: cleanAuthors.map((a) => a.name).join(", "),
      authorId: cleanAuthors[0]?.id || story.authorId || null,
      tags: Array.from(body.querySelectorAll(".sd-topic-chip.is-on"))
        .map((c) => c.dataset.topic)
        .filter(Boolean),
      updatedAt: new Date().toISOString(),
      editedByAdminId: ctx.user.uid,
      editedByAdminName: ctx.profile.name || ctx.user.email,
      editedByAdminAt: new Date().toISOString(),
    };

    // Book-review-specific fields. These are what /book-reviews and the
    // detail renderer (.is-book-review) actually read for the card + page.
    if (isBookReview) {
      const bookTitle  = (body.querySelector("#sd-book-title")?.value || "").trim();
      const bookAuthor = (body.querySelector("#sd-book-author")?.value || "").trim();
      const isbnRaw    = (body.querySelector("#sd-book-isbn")?.value || "").trim();
      const isbn       = isbnRaw.replace(/[^0-9Xx-]/g, "").slice(0, 32);
      const ratingRaw  = body.querySelector("#sd-book-rating")?.value || "";
      const rating     = ratingRaw === "" ? null : Number(ratingRaw);
      const genre      = (body.querySelector("#sd-book-genre")?.value || "").trim().toLowerCase();

      if (!bookTitle)  { msg.textContent = "Book title is required.";  return; }
      if (!bookAuthor) { msg.textContent = "Book author is required."; return; }

      patch.title       = bookTitle; // canonical
      patch.bookTitle   = bookTitle;
      patch.bookAuthor  = bookAuthor;
      patch.isbn        = isbn || "";
      patch.rating      = rating;
      patch.genre       = genre || "stem";
    }

    if (publishedAt) patch.publishedAt = publishedAt;
    // If admin flipped this to "published" but no date set, stamp now.
    if (status === "published" && !patch.publishedAt && !story.publishedAt) {
      patch.publishedAt = new Date().toISOString();
    }

    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      await updateDoc(doc(db, "stories", storyId), patch);
      // Bust the shared public-listing cache so /book-reviews and /articles
      // pick up the edit on their very next load instead of waiting for
      // the per-tab sessionStorage cache to expire.
      clearPublicStoryCache();
      // If this save is what flips the story to "published" (it wasn't before),
      // congratulate the author by email (CC admins). Best-effort + idempotent
      // server-side — never block the save on it. Editing an already-published
      // story won't re-trigger because the prior status was already published.
      if (status === "published" && story.status !== "published") {
        try {
          await ctx.authedFetch("/api/notify/published", {
            method: "POST",
            body: JSON.stringify({ storyId }),
          });
        } catch (notifyErr) {
          console.warn("published notify failed (non-blocking):", notifyErr);
        }
        // Flip the matching workflow-pipeline card from purple ("needs
        // publishing") to a regular completed card. Best-effort.
        markStoryPublishedOnProject({ id: storyId, title: patch.title || story.title }, ctx.profile.name || ctx.user.email);
      }
      ctx.toast("Story updated.", "success");
      m.close();
      onDone && onDone();
    } catch (err) {
      msg.textContent = err.message;
      saveBtn.disabled = false; saveBtn.textContent = "Save changes";
    }
  });
}

// Firestore/ISO timestamps can be either strings or Firestore Timestamp
// objects. Normalize to a local datetime-local input value (YYYY-MM-DDTHH:mm).
function toDatetimeLocal(v) {
  if (!v) return "";
  let d;
  if (typeof v === "string") d = new Date(v);
  else if (v?.toDate) d = v.toDate();
  else if (v?.seconds) d = new Date(v.seconds * 1000);
  else return "";
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escAttr(s) { return esc(s); }

// Wires the rating slider inside the story editor modal. Same widget as
// the writer composer (.brw-rating-slider-*), but the hidden mirror is
// #sd-book-rating so the existing save patch in saveDetails() reads
// .value off it unchanged. Accepts the initial rating ("4.5" or "") so
// the slider lands on the saved value when the modal opens.
function wireAdminRatingSlider(body, initialRating) {
  const root    = body.querySelector("#sd-book-rating-slider");
  const input   = body.querySelector("#sd-book-rating-input");
  const valueEl = body.querySelector(".brw-rating-slider-value");
  const flavor  = body.querySelector(".brw-rating-slider-flavor");
  const hidden  = body.querySelector("#sd-book-rating");
  if (!root || !input || !hidden) return;

  const FLAVORS = [
    { min: 4.7, label: "Couldn't put it down" },
    { min: 4.0, label: "Strongly recommend" },
    { min: 3.5, label: "Very good" },
    { min: 2.8, label: "Solid" },
    { min: 2.0, label: "Mixed" },
    { min: 1.0, label: "Disappointing" },
    { min: 0.1, label: "Skip it" },
  ];
  const flavorFor = (n) => {
    if (!Number.isFinite(n) || n <= 0) return "";
    for (const f of FLAVORS) if (n >= f.min) return f.label;
    return "";
  };

  const render = () => {
    const raw = parseFloat(input.value);
    const n = Number.isFinite(raw) ? Math.round(raw * 10) / 10 : 0;
    const pct = Math.max(0, Math.min(100, (n / 5) * 100));
    root.style.setProperty("--brw-pct", String(pct));
    root.dataset.value = n > 0 ? String(n) : "0";
    if (valueEl) {
      if (n > 0) valueEl.innerHTML = `${n.toFixed(1)}<small>/ 5</small>`;
      else valueEl.textContent = "— None —";
    }
    if (flavor) flavor.textContent = flavorFor(n) || "Drag to set a rating from 0 to 5. Optional.";
    hidden.value = n > 0 ? n.toFixed(1) : "";
  };

  input.addEventListener("input", render);
  input.addEventListener("change", render);

  // Seed from the saved rating, if any.
  const seed = Number(initialRating);
  if (Number.isFinite(seed) && seed >= 0 && seed <= 5) input.value = String(seed);
  render();
}

// Shown after an admin presses Approve. Hands the admin the shareable URL
// they need to paste into an email/Slack to the writer. The writer (or the
// admin) opens that URL to land on the final-review page where they can
// push the piece live.
async function showFinalReviewLinkModal(ctx, storyId, title) {
  const url = `${window.location.origin}/admin/#/final-review?id=${encodeURIComponent(storyId)}`;
  const body = el("div", { class: "ar-approved" });
  body.innerHTML = `
    <div class="ar-approved-head">
      <span class="ar-approved-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
      <p><strong>${esc(title)}</strong> is approved. It stays off the site until someone presses Publish on its final-review page.</p>
    </div>
    <ol class="ar-steps">
      <li><b>Send the writer this link</b> so they can take a last look and publish.
        <div class="ar-copy"><input class="input" id="fr-link-input" readonly value="${escAttr(url)}" aria-label="Final-review link"><button class="btn btn-secondary btn-sm" id="fr-link-copy" type="button">Copy link</button></div>
      </li>
      <li><b>Or publish it yourself</b> from the review page, or with <em>Publish now</em> on its row.</li>
    </ol>`;

  const openBtn = el("button", { class: "btn btn-primary" }, "Open the review page");
  const doneBtn = el("button", { class: "btn btn-secondary" }, "Done");
  const m = openModal({ title: "Approved", body, footer: [doneBtn, openBtn] });
  doneBtn.addEventListener("click", m.close);
  openBtn.addEventListener("click", () => {
    m.close();
    location.hash = `#/final-review?id=${encodeURIComponent(storyId)}`;
  });
  body.querySelector("#fr-link-copy").addEventListener("click", async () => {
    const input = body.querySelector("#fr-link-input");
    try {
      await navigator.clipboard.writeText(input.value);
      ctx.toast("Review link copied.", "success");
    } catch {
      input.select();
      try { document.execCommand("copy"); ctx.toast("Copied.", "success"); }
      catch { ctx.toast("Copy failed — select and copy manually.", "info"); }
    }
  });
  // Pre-select the URL so the admin can grab it with ⌘C immediately.
  setTimeout(() => {
    const inp = body.querySelector("#fr-link-input");
    if (inp) { inp.focus(); inp.select(); }
  }, 50);
}

function openAddUserModal(ctx, onDone) {
  const body = el("div", {});
  body.innerHTML = `
    <div class="field"><label class="label">Name</label><input class="input" id="nu-name" placeholder="Full name"></div>
    <div class="field"><label class="label">Email</label><input class="input" id="nu-email" type="email" placeholder="name@example.com"></div>
    <div class="field"><label class="label">Temporary password</label><input class="input" id="nu-pass" type="password" minlength="6" placeholder="At least 6 characters"></div>
    <div class="field"><label class="label">Role</label>
      <select class="select" id="nu-role">
        ${["writer","editor","newsletter_builder","marketing","admin","reader"].map(r => `<option value="${r}">${roleLabel(r)}</option>`).join("")}
      </select>
    </div>
    <div id="nu-msg" class="hint" style="color:var(--danger);"></div>`;

  const saveBtn = el("button", { class: "btn btn-accent" }, "Create user");
  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");

  const m = openModal({ title: "Add a new user", body, footer: [cancelBtn, saveBtn] });
  cancelBtn.addEventListener("click", m.close);

  saveBtn.addEventListener("click", async () => {
    const name = body.querySelector("#nu-name").value.trim();
    const email = body.querySelector("#nu-email").value.trim();
    const password = body.querySelector("#nu-pass").value;
    const role = body.querySelector("#nu-role").value;
    const msg = body.querySelector("#nu-msg");
    msg.textContent = "";

    if (!name || !email || !password) { msg.textContent = "Name, email, and password required."; return; }
    saveBtn.disabled = true; saveBtn.textContent = "Creating…";

    // Spin up a secondary Firebase app using the same config as the primary.
    // createUserWithEmailAndPassword auto-signs-in on whichever auth instance
    // it's called with, so by using a throwaway app here we keep the admin's
    // primary session untouched. The secondary app is signed out + deleted
    // in the finally block so no state leaks.
    let secondaryApp = null;
    try {
      secondaryApp = initializeApp(app.options, `user-creator-${Date.now()}`);
      const secondaryAuth = getAuth(secondaryApp);

      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      // displayName on the Auth user (shown in Firebase console + available
      // as user.displayName anywhere). Firestore also gets `name` as the
      // primary field the app reads for bylines, reminders, etc.
      await updateProfile(cred.user, { displayName: name });

      await setDoc(doc(db, "users", cred.user.uid), {
        name,
        displayName: name,  // Keep the two fields aligned so any legacy reader gets the right value.
        email,
        role,
        status: "active",
        createdAt: new Date().toISOString(),
        createdBy: ctx.user.uid,
      });

      ctx.toast(`User created: ${name} (${role}).`, "success");
      m.close();
      onDone && onDone();
    } catch (err) {
      msg.textContent = err.message;
      saveBtn.disabled = false; saveBtn.textContent = "Create user";
    } finally {
      // Tear down the secondary app so its auth state doesn't linger in memory.
      if (secondaryApp) {
        try {
          await signOut(getAuth(secondaryApp));
        } catch { /* secondary session may already be gone */ }
        try {
          await deleteApp(secondaryApp);
        } catch { /* nothing we can do if cleanup fails */ }
      }
    }
  });
}

// ====================== IMAGES ============================================
// Extract the Firebase Storage object path from a download URL. Download
// URLs look like `.../o/stories%2F<uid>%2Fimages%2F<hash>.webp?alt=media&token=…`,
// and the decoded path segment is the stable ID of the object (the token
// rotates on each upload-override). We match library entries to article
// references on this path so token drift and URL param reordering don't
// produce false negatives.
function storagePathFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

// Walk every Firestore story doc and collect the Firebase Storage paths
// referenced in coverImage + body HTML. Anything NOT in this set is a
// candidate for deletion.
async function buildUsedImagePathSet() {
  const used = new Set();
  const snap = await getDocs(collection(db, "stories"));
  snap.forEach((d) => {
    const data = d.data() || {};
    const cover = storagePathFromUrl(data.coverImage);
    if (cover) used.add(cover);
    const body = typeof data.body === "string" ? data.body : "";
    // Cheap HTML scan — any `.../o/<path>?...` reference in the body HTML.
    const re = /\/o\/([^"'?\s]+)/g;
    let match;
    while ((match = re.exec(body)) !== null) {
      try { used.add(decodeURIComponent(match[1])); }
      catch { used.add(match[1]); }
    }
  });
  return used;
}

async function mountImages(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Image library</div>
        <div class="card-subtitle">Every image uploaded by any writer. Click to copy the URL, hover to delete. Unused images are flagged so you can safely clean them up.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
        <input class="input" id="img-search" placeholder="Filter by writer or filename" style="width:auto;flex:1 1 240px;min-width:0;max-width:300px;" />
        <select class="select" id="img-filter-usage" style="width:auto;min-width:150px;">
          <option value="all">All images</option>
          <option value="unused">Unused only</option>
          <option value="used">Used only</option>
        </select>
        <select class="select" id="img-sort" style="width:auto;min-width:150px;">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="largest">Largest first</option>
        </select>
      </div>
    </div>
    <div class="card-body">
      <div class="library-grid-toolbar">
        <div class="library-grid-count" id="img-count">Loading…</div>
        <div class="hint" id="img-size-total"></div>
      </div>
      <div id="img-grid" class="library-grid">
        <div class="loading-state" style="grid-column:1/-1;"><div class="spinner"></div>Scanning Firebase Storage…</div>
      </div>
      <div class="media-error" id="img-error"></div>
    </div>`;
  container.appendChild(card);

  const grid = card.querySelector("#img-grid");
  const countEl = card.querySelector("#img-count");
  const sizeTotalEl = card.querySelector("#img-size-total");
  const searchEl = card.querySelector("#img-search");
  const usageEl = card.querySelector("#img-filter-usage");
  const sortEl = card.querySelector("#img-sort");
  const errorEl = card.querySelector("#img-error");

  let entries = [];
  let ownerNames = new Map(); // uid → display name
  let usedPaths = new Set();

  try {
    [entries, usedPaths] = await Promise.all([
      loadImageLibrary(null),
      buildUsedImagePathSet().catch((err) => {
        // Don't fail the whole view if we can't read stories — just skip the badge.
        console.warn("[admin-images] usage scan failed", err);
        return new Set();
      }),
    ]);
  } catch (err) {
    errorEl.textContent = "Could not load images: " + (err?.message || err);
    grid.innerHTML = "";
    return;
  }

  if (!entries.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">No images uploaded yet.</div>`;
    countEl.textContent = "0 images";
    return;
  }

  // Resolve uid → display name so the tile caption shows the writer, not a hash.
  const uniqueOwners = [...new Set(entries.map((e) => e.owner).filter(Boolean))];
  await Promise.all(uniqueOwners.map(async (uid) => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      const name = snap.exists() ? (snap.data().name || snap.data().email) : null;
      if (name) ownerNames.set(uid, name);
    } catch { /* ignore */ }
  }));
  entries.forEach((e) => {
    if (ownerNames.has(e.owner)) e.ownerName = ownerNames.get(e.owner);
  });

  const isUsed = (entry) => usedPaths.has(entry.fullPath);

  const refresh = () => {
    const q = searchEl.value.trim().toLowerCase();
    const usageMode = usageEl.value;
    let filtered = entries.filter((e) => {
      if (q) {
        const matches = (
          (e.name || "").toLowerCase().includes(q) ||
          (e.ownerName || "").toLowerCase().includes(q) ||
          (e.owner || "").toLowerCase().includes(q)
        );
        if (!matches) return false;
      }
      if (usageMode === "unused" && isUsed(e)) return false;
      if (usageMode === "used" && !isUsed(e)) return false;
      return true;
    });
    const sort = sortEl.value;
    if (sort === "oldest") filtered.sort((a, b) => a.updated - b.updated);
    else if (sort === "largest") filtered.sort((a, b) => (b.size || 0) - (a.size || 0));
    else filtered.sort((a, b) => b.updated - a.updated);

    const totalBytes = filtered.reduce((sum, e) => sum + (e.size || 0), 0);
    const unusedCount = entries.reduce((n, e) => n + (isUsed(e) ? 0 : 1), 0);
    const unusedNote = unusedCount ? ` · ${unusedCount} unused` : "";
    countEl.textContent = `${filtered.length} of ${entries.length} image${entries.length === 1 ? "" : "s"}${unusedNote}`;
    sizeTotalEl.textContent = totalBytes ? `Total size: ${formatBytes(totalBytes)}` : "";

    // Decorate each entry so the tile caption shows the writer's name.
    const decorated = filtered.map((e) => ({
      ...e,
      // The generic renderer uses entry.owner for the caption — override it
      // with the resolved display name for this admin view.
      owner: e.ownerName || e.owner,
    }));

    if (!decorated.length) {
      const msg = q ? `No images match "${esc(q)}".` : "No images match the current filter.";
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">${msg}</div>`;
      return;
    }

    renderLibraryGrid(grid, decorated, {
      allowDelete: true,
      usageBadge: (entry) => (isUsed(entry) ? "used" : "unused"),
      onPick: async (entry) => {
        try {
          await navigator.clipboard.writeText(entry.url);
          ctx.toast("Image URL copied to clipboard.", "success");
        } catch {
          ctx.toast("Copy failed — URL: " + entry.url, "info", 6000);
        }
      },
      onDelete: async (entry, tile) => {
        const body = el("div", {}, [
          el("p", {}, "This permanently removes the file from Firebase Storage. Articles that reference it will show a broken image."),
          el("p", { style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px", color: "var(--muted)", marginTop: "8px", wordBreak: "break-all" } }, entry.fullPath),
        ]);
        const ok = await confirmDialog(body, { confirmText: "Delete", danger: true });
        if (!ok) return;
        try {
          await deleteObject(entry.ref);
          entries = entries.filter((x) => x.fullPath !== entry.fullPath);
          tile.remove();
          refresh();
          ctx.toast("Image deleted.", "success");
        } catch (err) {
          ctx.toast("Could not delete: " + (err?.message || err), "error");
        }
      },
    });
  };

  searchEl.addEventListener("input", refresh);
  usageEl.addEventListener("change", refresh);
  sortEl.addEventListener("change", refresh);
  refresh();
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
