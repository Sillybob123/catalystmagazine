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
import { el, esc, fmtRelative, fmtDate, statusPill, confirmDialog, openModal, slugify } from "./ui.js";
import { loadImageLibrary, renderLibraryGrid, uploadToFirebase, openImageLibraryPicker, openArticlePreviewFromData } from "./writer.js";

export async function mount(ctx, container) {
  container.innerHTML = "";
  if (ctx.mountKey === "users") return mountUsers(ctx, container);
  if (ctx.mountKey === "images") return mountImages(ctx, container);
  return mountArticles(ctx, container);
}

// ====================== ARTICLES ==========================================
async function mountArticles(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">All articles &amp; approvals</div>
        <div class="card-subtitle">Assign editors, approve, publish, or reject. You have ultimate control.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <select class="select" id="filter-status" style="min-width:180px;">
          <option value="all">All statuses</option>
          <option value="pending">Pending review</option>
          <option value="reviewing">Reviewing</option>
          <option value="approved">Approved (ready to publish)</option>
          <option value="published">Published</option>
          <option value="rejected">Rejected</option>
          <option value="draft">Drafts</option>
        </select>
      </div>
    </div>
    <div class="pipeline-tabs article-type-tabs" role="tablist" aria-label="Choose story type">
      <button class="pipeline-tab active" type="button" role="tab" aria-selected="true" data-type-filter="stories">
        Stories <span class="count" data-count="stories">0</span>
      </button>
      <button class="pipeline-tab" type="button" role="tab" aria-selected="false" data-type-filter="book-reviews">
        Book reviews <span class="count" data-count="book-reviews">0</span>
      </button>
    </div>
    <div class="card-body card-body--flush" id="articles-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  // Cache editors for assignment dropdown.
  const editors = await getEditors();
  const filterEl = card.querySelector("#filter-status");
  const typeTabs = [...card.querySelectorAll("[data-type-filter]")];
  let typeFilter = "stories";

  const load = async () => {
    const body = card.querySelector("#articles-body");
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading…</div>`;
    try {
      const snap = await getDocs(query(collection(db, "stories"), orderBy("updatedAt", "desc")));
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      const statusFiltered = filterEl.value === "all"
        ? rows
        : rows.filter((r) => (r.status || "draft") === filterEl.value);
      const storyCount = statusFiltered.filter((r) => !isBookReviewStory(r)).length;
      const bookReviewCount = statusFiltered.filter(isBookReviewStory).length;
      card.querySelector('[data-count="stories"]').textContent = storyCount;
      card.querySelector('[data-count="book-reviews"]').textContent = bookReviewCount;

      const filtered = statusFiltered.filter((r) =>
        typeFilter === "book-reviews" ? isBookReviewStory(r) : !isBookReviewStory(r)
      );

      if (!filtered.length) {
        body.innerHTML = `<div class="empty-state">${typeFilter === "book-reviews" ? "No book reviews match this status." : "No regular stories match this status."}</div>`;
        return;
      }

      body.innerHTML = "";
      const list = el("div", { class: "articles-list" });
      for (const a of filtered) list.appendChild(renderRow(a, editors, ctx, load));
      body.appendChild(list);
    } catch (err) {
      body.innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
    }
  };

  filterEl.addEventListener("change", load);
  typeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      typeFilter = tab.dataset.typeFilter || "stories";
      typeTabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      load();
    });
  });
  load();
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
  const tr = el("div", { class: "ar-row" });
  const categoryLabel = esc(formatStoryCategory(a.category));
  const editorSelect = `<select class="select ar-editor-select" data-action="assign-editor" data-id="${esc(a.id)}">
      <option value="">— Unassigned —</option>
      ${editors.map((e) => `<option value="${esc(e.id)}" ${e.id === a.editorId ? "selected" : ""}>${esc(e.name || e.email)}</option>`).join("")}
    </select>`;

  tr.innerHTML = `
    <div class="ar-main">
      <div class="ar-title">${esc(a.title || "Untitled")}</div>
      <div class="ar-meta">
        <span class="category-chip">${categoryLabel}</span>
        <span class="ar-author">${esc(a.authorName || "Unknown")}</span>
        <span class="ar-sep">·</span>
        <span class="ar-time">${fmtRelative(a.updatedAt)}</span>
      </div>
    </div>
    <div class="ar-side">
      <div class="ar-status-editor">
        ${statusPill(a.status)}
        ${editorSelect}
      </div>
      <div class="ar-actions">
        ${a.status === "approved"
          ? `<button class="btn btn-ghost btn-xs" data-action="final-review" data-id="${esc(a.id)}" title="Open the final-review page">Open review link</button>
             <button class="btn btn-accent btn-xs" data-action="publish" data-id="${esc(a.id)}" title="Skip the writer's final review and publish now">Publish now</button>`
          : (a.status !== "published"
              ? `<button class="btn btn-accent btn-xs" data-action="approve" data-id="${esc(a.id)}" title="Approve and send to the writer for final review">Approve</button>`
              : "")}
        ${a.status !== "rejected" ? `<button class="btn btn-secondary btn-xs" data-action="reject" data-id="${esc(a.id)}">Reject</button>` : ""}
        <button class="btn btn-ghost btn-xs" data-action="view" data-id="${esc(a.id)}">Review</button>
        <button class="btn btn-secondary btn-xs" data-action="edit-details" data-id="${esc(a.id)}">Edit</button>
        <button class="btn btn-ghost btn-xs ar-danger" data-action="delete" data-id="${esc(a.id)}">Delete</button>
      </div>
    </div>`;

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
      const ok = await confirmDialog(
        "Approve this article and generate a final-review link to send to the writer? It won't be published until they (or you) click Publish on the review page.",
        { confirmText: "Approve" }
      );
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
    if (action === "final-review") {
      location.hash = `#/final-review?id=${encodeURIComponent(a.id)}`;
      return;
    }
    if (action === "publish") {
      // Admin override: skip the writer's final review and ship now. Useful
      // for tiny corrections or time-critical pieces where the admin has
      // already done a full review.
      const ok = await confirmDialog(
        "Publish this article now? It will go live immediately — the writer will not get a chance to approve it first.",
        { confirmText: "Publish" }
      );
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
        try { sessionStorage.removeItem("catalyst_fs_cache_v5"); } catch {}
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
        ctx.toast("Published.", "success");
        reload();
      } catch (err) { ctx.toast("Publish failed: " + err.message, "error"); }
      return;
    }
    if (action === "reject") {
      const ok = await confirmDialog("Reject this article? The writer will see it's been declined.", { confirmText: "Reject", danger: true });
      if (!ok) return;
      try {
        await updateDoc(doc(db, "stories", a.id), {
          status: "rejected",
          rejectedById: ctx.user.uid,
          rejectedByName: ctx.profile.name || ctx.user.email,
          updatedAt: new Date().toISOString(),
        });
        try { sessionStorage.removeItem("catalyst_fs_cache_v5"); } catch {}
        ctx.toast("Rejected.", "success"); reload();
      } catch (err) { ctx.toast("Failed: " + err.message, "error"); }
    }
    if (action === "delete") {
      const ok = await confirmDialog("Permanently delete this article? This cannot be undone.", { confirmText: "Delete", danger: true });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "stories", a.id));
        try { sessionStorage.removeItem("catalyst_fs_cache_v5"); } catch {}
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
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Users &amp; roles</div>
        <div class="card-subtitle">Assign roles, check who's active, and pause Catalyst bot reminders for specific writers when needed.</div>
      </div>
      <button class="btn btn-accent btn-sm" id="add-user-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        Add user
      </button>
    </div>
    <div class="card-body" id="users-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  card.querySelector("#add-user-btn").addEventListener("click", () => openAddUserModal(ctx, () => load()));
  const load = () => loadUsers(card.querySelector("#users-body"), ctx, load);
  load();
}

async function loadUsers(mount, ctx, reload) {
  mount.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading…</div>`;
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
    if (snap.empty) { mount.innerHTML = `<div class="empty-state">No users yet.</div>`; return; }

    // Pull presence mirror docs.
    const presenceSnap = await getDocs(collection(db, "user_presence"));
    const presence = new Map();
    presenceSnap.forEach((d) => presence.set(d.id, d.data()));

    mount.innerHTML = "";

    // Scroll wrapper so the table never breaks the card layout on any screen size.
    const scrollWrap = el("div", { style: { overflowX: "auto", width: "100%" } });

    const table = el("table", { class: "table" });
    // colgroup lets us set proportional widths without fighting auto-layout.
    table.style.cssText = "table-layout:fixed;min-width:860px;";
    table.innerHTML = `
      <colgroup>
        <col style="width:12%"><!-- User -->
        <col style="width:18%"><!-- Email -->
        <col style="width:12%"><!-- Role -->
        <col style="width:8%"> <!-- Status -->
        <col style="width:16%"><!-- Bot reminders -->
        <col style="width:9%"> <!-- Created -->
        <col style="width:13%"><!-- Last seen -->
        <col style="width:12%"><!-- Actions -->
      </colgroup>
      <thead><tr>
        <th>User</th>
        <th>Email</th>
        <th>Role</th>
        <th>Status</th>
        <th>Bot reminders</th>
        <th>Created</th>
        <th>Last seen</th>
        <th>Actions</th>
      </tr></thead><tbody></tbody>`;
    const tbody = table.querySelector("tbody");

    snap.forEach((d) => {
      const u = d.data();
      const p = presence.get(d.id);
      const last = p?.lastSeenAt || u.lastSeenAt;
      const reminderStatus = getBotReminderExemptionState(u);
      const extraEmails = Array.isArray(u.extraEmails) ? u.extraEmails.filter(Boolean) : [];
      const tr = el("tr", {});
      // data-label is read by the mobile stylesheet to render a label
      // next to each cell when the table collapses into stacked cards
      // on phones. Without it, the cards look like an unlabeled blob.
      tr.innerHTML = `
        <td data-label="User" style="font-weight:600;color:var(--ink);">${esc(u.name || "—")}</td>
        <td data-label="Email" style="max-width:0;overflow:hidden;">
          <div title="${escAttr(u.email || "")}" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(u.email || "")}</div>
          ${extraEmails.map(e => `<div title="${escAttr(e)}" style="margin-top:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--muted);background:var(--surface-2,#f8fafc);border:1px solid var(--hairline,#e2e8f0);border-radius:4px;padding:1px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;">${esc(e)}</div>`).join("")}
        </td>
        <td data-label="Role">
          <select class="select" style="font-size:12px;padding:5px 6px;width:100%;" data-action="role" data-id="${esc(d.id)}">
            ${["admin","editor","writer","newsletter_builder","marketing","reader"].map(r =>
              `<option value="${r}" ${u.role === r ? "selected" : ""}>${roleLabel(r)}</option>`).join("")}
          </select>
        </td>
        <td data-label="Status"><span class="pill ${u.status === "active" ? "pill-published" : "pill-draft"}" style="font-size:11px;">${esc(u.status || "active")}</span></td>
        <td data-label="Bot reminders">${renderBotReminderStatus(reminderStatus)}</td>
        <td data-label="Created" style="font-size:12px;color:var(--muted);white-space:nowrap;">${u.createdAt ? fmtDate(u.createdAt) : "—"}</td>
        <td data-label="Last seen" style="white-space:nowrap;">
          ${last
            ? `<div style="font-size:12px;color:var(--ink-2);">${fmtRelative(last)}</div><div style="font-size:11px;color:var(--muted);margin-top:2px;">${fmtDate(last)}</div>`
            : `<span style="color:var(--muted);">—</span>`}
        </td>
        <td data-label="Actions">
          <div style="display:flex;flex-direction:column;gap:5px;">
            <button class="btn btn-secondary btn-xs" data-action="extra-access" data-id="${esc(d.id)}" style="white-space:nowrap;" title="Grant access to specific dashboard pages">Extra access${Array.isArray(u.extraAccess) && u.extraAccess.length ? ` <span style="opacity:.7;">(${u.extraAccess.length})</span>` : ""}</button>
            <button class="btn btn-secondary btn-xs" data-action="bot-exemption" data-id="${esc(d.id)}" style="white-space:nowrap;">Edit bot</button>
            <button class="btn btn-ghost btn-xs" data-action="delete" data-id="${esc(d.id)}" ${d.id === ctx.user.uid ? "disabled" : ""} style="color:var(--danger);white-space:nowrap;">Delete</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });

    scrollWrap.appendChild(table);

    tbody.addEventListener("change", async (e) => {
      const sel = e.target.closest('[data-action="role"]');
      if (!sel) return;
      const uid = sel.dataset.id;
      try {
        await updateDoc(doc(db, "users", uid), { role: sel.value });
        ctx.toast("Role updated.", "success");
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

    mount.appendChild(scrollWrap);
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
  // Editorial / pipeline
  { group: "Editorial pipeline", hash: "#/admin/articles",     label: "All articles & approvals",   baseRoles: ["admin"] },
  { group: "Editorial pipeline", hash: "#/admin/submissions",  label: "Submissions inbox",          baseRoles: ["admin"] },
  { group: "Editorial pipeline", hash: "#/admin/book-reviews", label: "Book reviews queue",         baseRoles: ["admin", "editor"] },
  { group: "Editorial pipeline", hash: "#/editor/queue",       label: "Editor queue",               baseRoles: ["admin", "editor"] },

  // Marketing
  { group: "Marketing",          hash: "#/marketing/analytics",     label: "Subscribers & growth",        baseRoles: ["admin", "marketing", "newsletter_builder"] },
  { group: "Marketing",          hash: "#/marketing/subscribers",   label: "Subscriber list",             baseRoles: ["admin", "marketing"] },
  { group: "Marketing",          hash: "#/marketing/collabs",       label: "Collaboration requests",      baseRoles: ["admin", "marketing"] },
  { group: "Marketing",          hash: "#/marketing/social",        label: "Social media posts",          baseRoles: ["admin", "marketing"] },
  { group: "Marketing",          hash: "#/marketing/searchability", label: "Searchability (Search Console)", baseRoles: ["admin", "marketing"] },

  // Newsletter
  { group: "Newsletter",         hash: "#/newsletter/builder", label: "Newsletter builder",         baseRoles: ["admin", "newsletter_builder"] },
  { group: "Newsletter",         hash: "#/newsletter/history", label: "Campaign history",           baseRoles: ["admin", "newsletter_builder", "marketing"] },

  // Admin tools (only super-rare grants — admin can extend if they truly want)
  { group: "Admin tools",        hash: "#/admin/users",        label: "Users & roles",              baseRoles: ["admin"] },
  { group: "Admin tools",        hash: "#/admin/images",       label: "Image library",              baseRoles: ["admin"] },
  { group: "Admin tools",        hash: "#/admin/games",        label: "Games",                      baseRoles: ["admin"] },
];

// Routes a user with this role ALREADY sees via the regular role map.
// Used to gray-out checkboxes that would be redundant.
function routeAlreadyVisible(route, userRole) {
  const effective = userRole === "editor" ? ["editor", "writer"] : [userRole];
  if (userRole === "admin") return true;
  return route.baseRoles.some((r) => effective.includes(r));
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

  const modal = openModal({
    title: `Extra page access — ${user.name || user.email}`,
    bodyHtml: `
      <div style="font-size:13px;color:var(--muted);line-height:1.55;margin-bottom:14px;">
        Give <strong>${esc(user.name || user.email)}</strong> access to specific dashboard pages beyond their <strong>${esc(roleLabel(userRole))}</strong> role.
        Pages already visible via their role are disabled below.
      </div>
      <div class="extra-access-list" id="extra-access-list">
        ${groupsHtml}
      </div>`,
    footer: [cancelBtn, saveBtn],
  });

  cancelBtn.addEventListener("click", () => modal.close());
  saveBtn.addEventListener("click", async () => {
    const newAccess = Array.from(modal.bodyEl.querySelectorAll('input[type="checkbox"]'))
      .filter((cb) => cb.checked && !cb.disabled)
      .map((cb) => cb.dataset.hash);
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await updateDoc(doc(db, "users", user.id), { extraAccess: newAccess });
      ctx.toast("Extra access updated. The user will see new pages after they refresh.", "success");
      modal.close();
      onSaved?.();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      ctx.toast("Save failed: " + err.message, "error");
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

  const body = el("div", {});
  body.innerHTML = `
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
            `<option value="${s}" ${s === (story.status || "draft") ? "selected" : ""}>${s}</option>`).join("")}
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
            style="padding:6px 14px;border-radius:999px;border:1px solid ${on ? "var(--ink,#0f172a)" : "var(--line,#e6e6e6)"};background:${on ? "var(--ink,#0f172a)" : "#fff"};color:${on ? "#fff" : "var(--ink-2,#475569)"};font-size:13px;font-weight:600;cursor:pointer;transition:all .15s ease;">${esc(t)}</button>`;
        }).join("")}
      </div>
      <div class="hint">Topic tags drive the subject filters on the home page and Articles index. Click to add or remove. ${isBookReview ? "(Book reviews are normally filtered by genre, not topics.)" : ""}</div>
    </div>

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

    <details style="margin-top:12px;">
      <summary style="cursor:pointer;font-weight:600;color:var(--ink-2);padding:8px 0;">Advanced: edit body HTML</summary>
      <div class="field" style="margin-top:8px;">
        <label class="label">Body (HTML)</label>
        <textarea class="textarea" id="sd-body" rows="10" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">${esc(story.body || story.content || story.reviewText || "")}</textarea>
        <div class="hint">Full rewrite of the article body. Use the review surface for inline edits; this is for post-publish corrections.</div>
      </div>
    </details>

    <div class="field">
      <label class="label">Created at (read-only)</label>
      <input class="input" value="${escAttr(createdAtISO || "—")}" disabled>
    </div>

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
      chip.style.background = on ? "var(--ink,#0f172a)" : "#fff";
      chip.style.color = on ? "#fff" : "var(--ink-2,#475569)";
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

  const saveBtn = el("button", { class: "btn btn-accent" }, "Save changes");
  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const previewBtn = el("button", {
    class: "btn btn-ghost",
    title: "Open a full preview of how this article will look when published — with cover, headers, and sections.",
  }, "Preview as published");
  const modalTitle = isBookReview
    ? `Edit book review — ${initialBookTitle || story.title || "Untitled"}`
    : `Edit story — ${story.title || "Untitled"}`;
  const m = openModal({ title: modalTitle, body, footer: [cancelBtn, previewBtn, saveBtn] });
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
      try { sessionStorage.removeItem("catalyst_fs_cache_v5"); } catch {}
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
  const body = el("div", {});
  body.innerHTML = `
    <p style="margin:0 0 10px;">
      <strong>${esc(title)}</strong> is now approved and staged for final review.
      It <strong>won't appear on the public site</strong> until someone clicks Publish on the review page below.
    </p>
    <p style="margin:0 0 6px;color:var(--muted);">Send this link to the writer so they can approve it as the last step:</p>
    <div style="display:flex;gap:8px;align-items:center;">
      <input class="input" id="fr-link-input" readonly value="${escAttr(url)}" style="flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">
      <button class="btn btn-secondary btn-sm" id="fr-link-copy">Copy</button>
    </div>
    <p class="hint" style="margin-top:10px;">You can also open the review page yourself and publish it directly.</p>`;

  const openBtn = el("button", { class: "btn btn-accent" }, "Open review page");
  const doneBtn = el("button", { class: "btn btn-secondary" }, "Done");
  const m = openModal({ title: "Article approved", body, footer: [doneBtn, openBtn] });
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
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input class="input" id="img-search" placeholder="Filter by writer or filename" style="min-width:240px;" />
        <select class="select" id="img-filter-usage" style="min-width:160px;">
          <option value="all">All images</option>
          <option value="unused">Unused only</option>
          <option value="used">Used only</option>
        </select>
        <select class="select" id="img-sort" style="min-width:160px;">
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
