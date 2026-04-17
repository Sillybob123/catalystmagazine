// Admin module — mount keys:
//   - "articles": all articles with approve / deny / publish / assign-editor
//   - "users":    users directory with role assignment + last-login

import { db, auth } from "../firebase-config.js";
import {
  collection, getDocs, doc, updateDoc, deleteDoc, query, orderBy,
  where, getDoc, setDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { el, esc, fmtRelative, fmtDate, statusPill, confirmDialog, openModal, slugify } from "./ui.js";

export async function mount(ctx, container) {
  container.innerHTML = "";
  if (ctx.mountKey === "users") return mountUsers(ctx, container);
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
    <div class="card-body" id="articles-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  // Cache editors for assignment dropdown.
  const editors = await getEditors();
  const filterEl = card.querySelector("#filter-status");

  const load = async () => {
    const body = card.querySelector("#articles-body");
    body.innerHTML = `<div class="loading-state"><div class="spinner"></div>Loading…</div>`;
    try {
      const snap = await getDocs(query(collection(db, "stories"), orderBy("updatedAt", "desc")));
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      const filtered = filterEl.value === "all"
        ? rows
        : rows.filter((r) => (r.status || "draft") === filterEl.value);

      if (!filtered.length) { body.innerHTML = `<div class="empty-state">Nothing here.</div>`; return; }

      body.innerHTML = "";
      const table = el("table", { class: "table" });
      table.innerHTML = `
        <thead><tr>
          <th>Article</th><th>Author</th><th>Status</th><th>Assigned editor</th><th>Updated</th><th>Actions</th>
        </tr></thead>
        <tbody></tbody>`;
      const tbody = table.querySelector("tbody");
      for (const a of filtered) tbody.appendChild(renderRow(a, editors, ctx, load));
      body.appendChild(table);
    } catch (err) {
      body.innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
    }
  };

  filterEl.addEventListener("change", load);
  load();
}

function renderRow(a, editors, ctx, reload) {
  const tr = el("tr", {});
  const editorSelect = `<select class="select" style="min-width:160px;font-size:13px;padding:6px 8px;" data-action="assign-editor" data-id="${esc(a.id)}">
      <option value="">— Unassigned —</option>
      ${editors.map((e) => `<option value="${esc(e.id)}" ${e.id === a.editorId ? "selected" : ""}>${esc(e.name || e.email)}</option>`).join("")}
    </select>`;

  tr.innerHTML = `
    <td><strong>${esc(a.title || "Untitled")}</strong><br><span class="article-meta">${esc(a.category || "Feature")}</span></td>
    <td>${esc(a.authorName || "Unknown")}</td>
    <td>${statusPill(a.status)}</td>
    <td>${editorSelect}</td>
    <td>${fmtRelative(a.updatedAt)}</td>
    <td>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${a.status !== "published" ? `<button class="btn btn-accent btn-xs" data-action="approve" data-id="${esc(a.id)}">Approve &amp; publish</button>` : ""}
        ${a.status !== "rejected" ? `<button class="btn btn-secondary btn-xs" data-action="reject" data-id="${esc(a.id)}">Reject</button>` : ""}
        <button class="btn btn-ghost btn-xs" data-action="view" data-id="${esc(a.id)}">Review</button>
        <button class="btn btn-secondary btn-xs" data-action="edit-details" data-id="${esc(a.id)}">Edit details</button>
        <button class="btn btn-ghost btn-xs" data-action="delete" data-id="${esc(a.id)}" style="color:var(--danger);">Delete</button>
      </div>
    </td>`;

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
      const ok = await confirmDialog("Approve and publish this article? It will go live.", { confirmText: "Publish" });
      if (!ok) return;
      try {
        await updateDoc(doc(db, "stories", a.id), {
          status: "published",
          approvedById: ctx.user.uid,
          approvedByName: ctx.profile.name || ctx.user.email,
          publishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        ctx.toast("Published.", "success");
        reload();
      } catch (err) { ctx.toast("Publish failed: " + err.message, "error"); }
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
        ctx.toast("Rejected.", "success"); reload();
      } catch (err) { ctx.toast("Failed: " + err.message, "error"); }
    }
    if (action === "delete") {
      const ok = await confirmDialog("Permanently delete this article? This cannot be undone.", { confirmText: "Delete", danger: true });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "stories", a.id));
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
        <div class="card-subtitle">Assign roles and check who's active. Last-seen is updated every 5 minutes while a user has the dashboard open.</div>
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
    const table = el("table", { class: "table" });
    table.innerHTML = `
      <thead><tr>
        <th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Last seen</th><th>Actions</th>
      </tr></thead><tbody></tbody>`;
    const tbody = table.querySelector("tbody");

    snap.forEach((d) => {
      const u = d.data();
      const p = presence.get(d.id);
      const last = p?.lastSeenAt || u.lastSeenAt;
      const tr = el("tr", {});
      tr.innerHTML = `
        <td><strong>${esc(u.name || "—")}</strong></td>
        <td>${esc(u.email || "")}</td>
        <td>
          <select class="select" style="font-size:13px;padding:6px 8px;" data-action="role" data-id="${esc(d.id)}">
            ${["admin","editor","writer","newsletter_builder","marketing","reader"].map(r =>
              `<option value="${r}" ${u.role === r ? "selected" : ""}>${roleLabel(r)}</option>`).join("")}
          </select>
        </td>
        <td><span class="pill ${u.status === "active" ? "pill-published" : "pill-draft"}">${esc(u.status || "active")}</span></td>
        <td>${u.createdAt ? fmtDate(u.createdAt) : "—"}</td>
        <td>${last ? `${fmtRelative(last)} <div style="color:var(--muted);font-size:11px;">${fmtDate(last)}</div>` : "—"}</td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-xs" data-action="delete" data-id="${esc(d.id)}" ${d.id === ctx.user.uid ? "disabled" : ""} style="color:var(--danger);">Delete</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });

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

    mount.appendChild(table);
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

  const body = el("div", {});
  body.innerHTML = `
    <div class="field">
      <label class="label">Title</label>
      <input class="input" id="sd-title" value="${escAttr(story.title || "")}">
    </div>
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
          ${["Feature","Interview","Op-Ed","News","Science"].map(c =>
            `<option ${c === (story.category || "Feature") ? "selected" : ""}>${c}</option>`).join("")}
        </select>
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
      <label class="label">Authors</label>
      <div id="sd-authors"></div>
      <button class="btn btn-ghost btn-xs" id="sd-add-author" type="button" style="margin-top:6px;">+ Add author</button>
      <div class="hint">Add as many authors as the piece has. The first one is used for bylines that only take a single name.</div>
    </div>

    <div class="field">
      <label class="label">Cover image URL</label>
      <input class="input" id="sd-cover" value="${escAttr(story.coverImage || story.image || "")}">
      <div id="sd-cover-preview" style="margin-top:8px;"></div>
    </div>

    <div class="field">
      <label class="label">Excerpt / dek</label>
      <textarea class="textarea" id="sd-dek" rows="2">${esc(story.dek || story.excerpt || "")}</textarea>
    </div>

    <details style="margin-top:12px;">
      <summary style="cursor:pointer;font-weight:600;color:var(--ink-2);padding:8px 0;">Advanced: edit body HTML</summary>
      <div class="field" style="margin-top:8px;">
        <label class="label">Body (HTML)</label>
        <textarea class="textarea" id="sd-body" rows="10" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">${esc(story.body || "")}</textarea>
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

  const saveBtn = el("button", { class: "btn btn-accent" }, "Save changes");
  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const m = openModal({ title: `Edit story — ${story.title || "Untitled"}`, body, footer: [cancelBtn, saveBtn] });
  cancelBtn.addEventListener("click", m.close);

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

    const patch = {
      title: body.querySelector("#sd-title").value.trim(),
      status,
      category: body.querySelector("#sd-category").value,
      slug: (body.querySelector("#sd-slug").value.trim() || slugify(body.querySelector("#sd-title").value.trim())) || null,
      coverImage: body.querySelector("#sd-cover").value.trim(),
      dek: body.querySelector("#sd-dek").value.trim(),
      body: body.querySelector("#sd-body").value,
      authors: cleanAuthors,
      authorName: cleanAuthors.map((a) => a.name).join(", "),
      authorId: cleanAuthors[0]?.id || story.authorId || null,
      updatedAt: new Date().toISOString(),
      editedByAdminId: ctx.user.uid,
      editedByAdminName: ctx.profile.name || ctx.user.email,
      editedByAdminAt: new Date().toISOString(),
    };
    if (publishedAt) patch.publishedAt = publishedAt;
    // If admin flipped this to "published" but no date set, stamp now.
    if (status === "published" && !patch.publishedAt && !story.publishedAt) {
      patch.publishedAt = new Date().toISOString();
    }

    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      await updateDoc(doc(db, "stories", storyId), patch);
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
    try {
      // This signs out the current admin on the client side — acceptable for a
      // small staff; admin can sign back in afterward. A server-side admin SDK
      // endpoint would be better long-term but requires service-account setup.
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        name, email, role,
        status: "active",
        createdAt: new Date().toISOString(),
        createdBy: ctx.user.uid,
      });
      ctx.toast(`User created: ${name} (${role}). You may be signed out — please sign back in.`, "success", 6000);
      m.close();
      onDone && onDone();
    } catch (err) {
      msg.textContent = err.message;
      saveBtn.disabled = false; saveBtn.textContent = "Create user";
    }
  });
}
