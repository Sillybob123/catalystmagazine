// Admin module — mount keys:
//   - "articles": all articles with approve / deny / publish / assign-editor
//   - "users":    users directory with role assignment + last-login
//   - "images":   library manager — browse every image in Firebase Storage
//                 and delete orphaned or duplicate files

import { db, auth, storage } from "../firebase-config.js";
import {
  collection, getDocs, doc, updateDoc, deleteDoc, query, orderBy,
  where, getDoc, setDoc, deleteField,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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
    <div class="card-body card-body--flush" id="articles-body"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
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
      const list = el("div", { class: "articles-list" });
      for (const a of filtered) list.appendChild(renderRow(a, editors, ctx, load));
      body.appendChild(list);
    } catch (err) {
      body.innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
    }
  };

  filterEl.addEventListener("change", load);
  load();
}

function renderRow(a, editors, ctx, reload) {
  const tr = el("div", { class: "ar-row" });
  const categoryLabel = esc((a.category || "Feature").replace(/\b\w/g, (c) => c.toUpperCase()));
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
    const table = el("table", { class: "table" });
    table.innerHTML = `
      <thead><tr>
        <th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Bot reminders</th><th>Created</th><th>Last seen</th><th>Actions</th>
      </tr></thead><tbody></tbody>`;
    const tbody = table.querySelector("tbody");

    snap.forEach((d) => {
      const u = d.data();
      const p = presence.get(d.id);
      const last = p?.lastSeenAt || u.lastSeenAt;
      const reminderStatus = getBotReminderExemptionState(u);
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
        <td>${renderBotReminderStatus(reminderStatus)}</td>
        <td>${u.createdAt ? fmtDate(u.createdAt) : "—"}</td>
        <td>${last ? `${fmtRelative(last)} <div style="color:var(--muted);font-size:11px;">${fmtDate(last)}</div>` : "—"}</td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-secondary btn-xs" data-action="bot-exemption" data-id="${esc(d.id)}">Edit bot</button>
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
      const exemptBtn = e.target.closest('[data-action="bot-exemption"]');
      if (exemptBtn) {
        const uid = exemptBtn.dataset.id;
        const userDoc = snap.docs.find((docSnap) => docSnap.id === uid);
        if (!userDoc) return;
        openBotReminderExemptionModal(ctx, { id: uid, ...userDoc.data() }, reload);
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
    return `<div style="min-width:190px;"><span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:#f8fafc;color:#475569;font-size:12px;font-weight:600;">Active</span></div>`;
  }

  const tone = state.active
    ? { bg: "#eff6ff", ink: "#1d4ed8", sub: "#1e40af" }
    : { bg: "#f8fafc", ink: "#475569", sub: "#64748b" };

  return `
    <div style="min-width:190px;display:grid;gap:4px;">
      <span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:${tone.bg};color:${tone.ink};font-size:12px;font-weight:700;width:max-content;">${esc(state.label)}</span>
      ${state.reason ? `<div style="font-size:12px;color:${tone.sub};line-height:1.45;">${esc(state.reason)}</div>` : ""}
    </div>
  `;
}

function openBotReminderExemptionModal(ctx, user, onDone) {
  const current = getBotReminderExemptionState(user);
  const today = dateKeyInTimeZone(new Date()) || "";

  const body = el("div", {});
  body.innerHTML = `
    <div class="field">
      <label class="label">Writer</label>
      <div style="font-weight:700;color:var(--ink);">${esc(user.name || user.email || "Unknown user")}</div>
      ${user.email ? `<div style="font-size:12px;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:2px;">${esc(user.email)}</div>` : ""}
    </div>
    <div class="field">
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

  const saveBtn = el("button", { class: "btn btn-accent" }, "Save");
  const cancelBtn = el("button", { class: "btn btn-secondary" }, "Cancel");
  const modal = openModal({
    title: `Catalyst bot reminders — ${user.name || user.email || "User"}`,
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
      if (mode === "none") {
        await updateDoc(doc(db, "users", user.id), {
          botReminderExemption: deleteField(),
        });
        ctx.toast("Catalyst bot reminders re-enabled.", "success");
      } else {
        await updateDoc(doc(db, "users", user.id), {
          botReminderExemption: {
            untilDate: mode === "until" ? untilEl.value : null,
            reason: reason || null,
            updatedAt: new Date().toISOString(),
            updatedById: ctx.user.uid,
            updatedByName: ctx.profile.name || ctx.user.email,
          },
        });
        ctx.toast("Catalyst bot reminder pause saved.", "success");
      }

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
          ${["Feature","Profile","Interview","Op-Ed","News","Science"].map(c =>
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
    if (file.size > 15 * 1024 * 1024) { ctx.toast("Image must be under 15 MB.", "error"); return; }

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
  const m = openModal({ title: `Edit story — ${story.title || "Untitled"}`, body, footer: [cancelBtn, previewBtn, saveBtn] });
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

    const patch = {
      title: body.querySelector("#sd-title").value.trim(),
      status,
      category: body.querySelector("#sd-category").value,
      slug: (body.querySelector("#sd-slug").value.trim() || slugify(body.querySelector("#sd-title").value.trim())) || null,
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
