// Writer module — three mount keys:
//   - "draft": compose / edit a draft
//   - "mine":  list the current user's own articles
//   - "feed":  read-only feed of everything in the works across the newsroom

import { db } from "../firebase-config.js";
import {
  collection, query, where, orderBy, getDocs, doc, setDoc, updateDoc,
  addDoc, serverTimestamp, getDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, fmtRelative, statusPill } from "./ui.js";

export async function mount(ctx, container) {
  container.innerHTML = "";
  switch (ctx.mountKey) {
    case "draft": return mountDraftEditor(ctx, container);
    case "mine":  return mountMyArticles(ctx, container);
    case "feed":  return mountFeed(ctx, container);
    default:      return mountMyArticles(ctx, container);
  }
}

// ===== Draft editor =========================================================
function mountDraftEditor(ctx, container) {
  // Support ?edit=<storyId> in hash for editing an existing draft.
  const editingId = getHashParam("edit");

  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">${editingId ? "Edit draft" : "Submit a new draft"}</div>
        <div class="card-subtitle">${editingId ? "Update and save your article." : "Write freely — you can save drafts and come back anytime."}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary btn-sm" id="save-draft-btn">Save draft</button>
        <button class="btn btn-accent btn-sm" id="submit-btn">Submit for review</button>
      </div>
    </div>
    <div class="card-body">
      <div class="field">
        <label class="label">Title</label>
        <input class="input" id="f-title" placeholder="A working title for your piece">
      </div>
      <div class="grid grid-2">
        <div class="field">
          <label class="label">Category</label>
          <select class="select" id="f-category">
            <option value="Feature">Feature</option>
            <option value="Interview">Interview</option>
            <option value="Op-Ed">Op-Ed</option>
            <option value="News">News</option>
            <option value="Science">Science</option>
          </select>
        </div>
        <div class="field">
          <label class="label">Cover image URL (optional)</label>
          <input class="input" id="f-cover" placeholder="https://...">
        </div>
      </div>
      <div class="field">
        <label class="label">Dek / short blurb</label>
        <textarea class="textarea" id="f-dek" rows="2" placeholder="One-sentence summary that will appear in the newsletter card."></textarea>
      </div>
      <div class="field">
        <label class="label">Body (Markdown or plain text)</label>
        <textarea class="textarea" id="f-body" rows="16" placeholder="Start typing your story..."></textarea>
        <div class="hint">Tip: you can paste HTML too — Catalyst will render it on the public post page.</div>
      </div>
      <div id="form-msg" class="hint" style="margin-top:12px;"></div>
    </div>`;
  container.appendChild(card);

  // Comments sidebar when editing.
  if (editingId) {
    const comments = el("div", { class: "card", style: { marginTop: "20px" } });
    comments.innerHTML = `
      <div class="card-header"><div class="card-title">Editor feedback</div></div>
      <div class="card-body" id="draft-comments"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
    container.appendChild(comments);
    subscribeToComments(editingId, comments.querySelector("#draft-comments"));
  }

  // Prefill when editing.
  if (editingId) loadDraft(editingId, card, ctx);

  card.querySelector("#save-draft-btn").addEventListener("click", () => saveStory(ctx, card, "draft", editingId));
  card.querySelector("#submit-btn").addEventListener("click", () => saveStory(ctx, card, "pending", editingId));
}

async function loadDraft(id, card, ctx) {
  try {
    const snap = await getDoc(doc(db, "stories", id));
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.authorId !== ctx.user.uid && ctx.role !== "admin" && ctx.role !== "editor") {
      card.querySelector("#form-msg").textContent = "You don't have permission to edit this article.";
      card.querySelectorAll("input, textarea, select, button").forEach((n) => n.disabled = true);
      return;
    }
    card.querySelector("#f-title").value = d.title || "";
    card.querySelector("#f-category").value = d.category || "Feature";
    card.querySelector("#f-cover").value = d.coverImage || "";
    card.querySelector("#f-dek").value = d.dek || d.excerpt || "";
    card.querySelector("#f-body").value = d.body || "";
  } catch (err) {
    card.querySelector("#form-msg").textContent = "Could not load draft: " + err.message;
  }
}

async function saveStory(ctx, card, desiredStatus, editingId) {
  const title = card.querySelector("#f-title").value.trim();
  const category = card.querySelector("#f-category").value;
  const coverImage = card.querySelector("#f-cover").value.trim();
  const dek = card.querySelector("#f-dek").value.trim();
  const body = card.querySelector("#f-body").value;
  const msg = card.querySelector("#form-msg");

  if (!title) { msg.textContent = "Please add a title before saving."; return; }
  if (desiredStatus === "pending" && !body.trim()) { msg.textContent = "Please add some body text before submitting for review."; return; }

  const payload = {
    title, category, coverImage, dek, body,
    status: desiredStatus,
    authorId: ctx.user.uid,
    authorName: ctx.profile.name || ctx.user.email,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (editingId) {
      await updateDoc(doc(db, "stories", editingId), payload);
      ctx.toast(desiredStatus === "pending" ? "Submitted for review." : "Draft saved.", "success");
    } else {
      payload.createdAt = new Date().toISOString();
      const ref = await addDoc(collection(db, "stories"), payload);
      ctx.toast(desiredStatus === "pending" ? "Submitted for review." : "Draft saved.", "success");
      location.hash = `#/writer/draft?edit=${ref.id}`;
    }
    msg.textContent = "";
  } catch (err) {
    msg.textContent = "Save failed: " + err.message;
    ctx.toast("Save failed: " + err.message, "error");
  }
}

function subscribeToComments(storyId, mount) {
  const q = query(collection(db, "stories", storyId, "comments"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    if (snap.empty) {
      mount.innerHTML = `<div class="empty-state">No editor feedback yet.</div>`;
      return;
    }
    mount.innerHTML = "";
    snap.forEach((d) => {
      const c = d.data();
      mount.appendChild(el("div", { class: "comment" }, [
        el("div", { class: "comment-head" }, [
          el("span", { class: "comment-author" }, c.authorName || "Editor"),
          el("span", {}, ` · ${fmtRelative(c.createdAt)}`),
          c.paragraph ? el("span", { style: { color: "var(--muted-2)" } }, ` · ¶${c.paragraph}`) : "",
        ]),
        el("div", { class: "comment-body" }, c.body || ""),
      ]));
    });
  });
}

// ===== My articles ==========================================================
async function mountMyArticles(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">My articles</div>
        <div class="card-subtitle">Every piece you've written or are working on.</div>
      </div>
      <a class="btn btn-accent btn-sm" href="#/writer/draft">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New draft
      </a>
    </div>
    <div class="card-body" id="my-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  try {
    const snap = await getDocs(query(
      collection(db, "stories"),
      where("authorId", "==", ctx.user.uid),
      orderBy("updatedAt", "desc"),
    ));
    renderArticleRows(card.querySelector("#my-list"), snap, true);
  } catch (err) {
    card.querySelector("#my-list").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
}

// ===== Public-to-newsroom feed =============================================
async function mountFeed(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Articles in the works</div>
        <div class="card-subtitle">Everything the newsroom is working on — read-only across the team.</div>
      </div>
    </div>
    <div class="card-body" id="feed-list"><div class="loading-state"><div class="spinner"></div>Loading…</div></div>`;
  container.appendChild(card);

  try {
    // Show everything except rejected; order by most recently updated.
    const snap = await getDocs(query(
      collection(db, "stories"),
      orderBy("updatedAt", "desc"),
    ));
    renderArticleRows(card.querySelector("#feed-list"), snap, false);
  } catch (err) {
    card.querySelector("#feed-list").innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
}

function renderArticleRows(mount, snap, allowEdit) {
  if (snap.empty) {
    mount.innerHTML = `<div class="empty-state">Nothing here yet.</div>`;
    return;
  }
  mount.innerHTML = "";
  snap.forEach((d) => {
    const a = d.data();
    const row = el("div", { class: "article-row" });
    row.innerHTML = `
      <div>
        <div class="article-title">${esc(a.title || "Untitled")}</div>
        <div class="article-meta">
          by ${esc(a.authorName || a.author || "Unknown")} · ${fmtRelative(a.updatedAt)} · ${statusPill(a.status)}
          ${a.category ? ` · <span>${esc(a.category)}</span>` : ""}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        ${allowEdit ? `<a class="btn btn-secondary btn-xs" href="#/writer/draft?edit=${esc(d.id)}">Open</a>` : ""}
        ${a.status === "published" && a.url
          ? `<a class="btn btn-ghost btn-xs" href="${esc(a.url)}" target="_blank" rel="noopener">View</a>` : ""}
      </div>`;
    mount.appendChild(row);
  });
}

function getHashParam(name) {
  const q = location.hash.split("?")[1];
  if (!q) return null;
  return new URLSearchParams(q).get(name);
}
