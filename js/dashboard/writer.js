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

  const wrap = el("div", { class: "editor-wrap" });
  wrap.innerHTML = `
    <div class="editor-topbar">
      <div>
        <div class="editor-eyebrow">${editingId ? "Editing" : "New draft"}</div>
        <div class="editor-hint">Autosaves stay in draft until you submit.</div>
      </div>
      <div class="editor-actions">
        <span class="editor-status" id="editor-status"></span>
        <button class="btn btn-secondary btn-sm" id="save-draft-btn">Save draft</button>
        <button class="btn btn-accent btn-sm" id="submit-btn">Submit for review</button>
      </div>
    </div>

    <div class="editor-canvas">
      <input class="editor-title" id="f-title" placeholder="Your headline…" />
      <textarea class="editor-dek" id="f-dek" rows="2" placeholder="One-sentence summary that previews in the newsletter."></textarea>

      <div class="editor-meta">
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
          <label class="label">Cover image URL</label>
          <input class="input" id="f-cover" placeholder="https://…">
        </div>
      </div>

      <!-- Formatting toolbar -->
      <div class="rt-toolbar" id="rt-toolbar" role="toolbar" aria-label="Formatting">
        <div class="rt-group">
          <select class="rt-select" data-block>
            <option value="p">Paragraph</option>
            <option value="h2">Heading 1</option>
            <option value="h3">Heading 2</option>
            <option value="h4">Heading 3</option>
          </select>
        </div>
        <div class="rt-group">
          <button class="rt-btn" data-cmd="bold" title="Bold (⌘B)"><b>B</b></button>
          <button class="rt-btn" data-cmd="italic" title="Italic (⌘I)"><i>I</i></button>
          <button class="rt-btn" data-cmd="underline" title="Underline (⌘U)"><u>U</u></button>
          <button class="rt-btn" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
        </div>
        <div class="rt-group">
          <button class="rt-btn" data-cmd="insertUnorderedList" title="Bulleted list">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
          </button>
          <button class="rt-btn" data-cmd="insertOrderedList" title="Numbered list">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
          </button>
        </div>
        <div class="rt-group">
          <button class="rt-btn" data-action="link" title="Insert link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
          <button class="rt-btn" data-action="blockquote" title="Pull quote">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1 0-2 .75-2 2v7c0 1.25.75 2 2 2h2c0 4.5-1 5-3 5zm14 0c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1 0-2 .75-2 2v7c0 1.25.75 2 2 2h2c0 4.5-1 5-3 5z"/></svg>
          </button>
          <button class="rt-btn" data-action="divider" title="Horizontal divider">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="12" x2="21" y2="12"/></svg>
          </button>
          <button class="rt-btn" data-action="image" title="Insert image">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </button>
        </div>
        <div class="rt-group">
          <button class="rt-btn" data-cmd="removeFormat" title="Clear formatting">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V4h16v3"/><line x1="5" y1="20" x2="19" y2="20"/><path d="M13 4L8 20"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
          </button>
        </div>
      </div>

      <div class="rt-editor" id="f-body" contenteditable="true" data-placeholder="Start telling your story…"></div>

      <div id="form-msg" class="editor-msg"></div>
    </div>
  `;
  container.appendChild(wrap);

  const editorEl = wrap.querySelector("#f-body");
  wireRichToolbar(wrap, editorEl, ctx);

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
  if (editingId) loadDraft(editingId, wrap, ctx);

  wrap.querySelector("#save-draft-btn").addEventListener("click", () => saveStory(ctx, wrap, "draft", editingId));
  wrap.querySelector("#submit-btn").addEventListener("click", () => saveStory(ctx, wrap, "pending", editingId));
}

// ===== Rich-text toolbar wiring =============================================
function wireRichToolbar(wrap, editorEl, ctx) {
  const toolbar = wrap.querySelector("#rt-toolbar");

  // Block-type dropdown
  toolbar.querySelector('[data-block]').addEventListener("change", (e) => {
    editorEl.focus();
    document.execCommand("formatBlock", false, e.target.value);
    e.target.value = e.target.value; // keep selection
  });

  // Inline formatting buttons
  toolbar.querySelectorAll("[data-cmd]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // don't steal focus
    btn.addEventListener("click", () => {
      editorEl.focus();
      document.execCommand(btn.dataset.cmd, false, null);
      updateToolbarState(toolbar);
    });
  });

  // Block insertions
  toolbar.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => handleBlockAction(btn.dataset.action, editorEl));
  });

  // Reflect active states as user moves caret
  const update = () => updateToolbarState(toolbar);
  editorEl.addEventListener("keyup", update);
  editorEl.addEventListener("mouseup", update);
  editorEl.addEventListener("input", update);

  // Keyboard shortcuts are handled natively by contenteditable for B/I/U.

  // Paste as plain text for safety (strip Google Docs / Word junk).
  editorEl.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, text);
  });
}

function updateToolbarState(toolbar) {
  const check = (cmd) => {
    try { return document.queryCommandState(cmd); } catch { return false; }
  };
  toolbar.querySelectorAll("[data-cmd]").forEach((btn) => {
    const cmd = btn.dataset.cmd;
    if (["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"].includes(cmd)) {
      btn.classList.toggle("active", check(cmd));
    }
  });
}

function handleBlockAction(action, editorEl) {
  editorEl.focus();
  if (action === "link") {
    const url = prompt("Link URL (https://…)");
    if (!url) return;
    document.execCommand("createLink", false, url);
    // Force links to open in a new tab
    editorEl.querySelectorAll('a:not([target])').forEach((a) => {
      a.target = "_blank";
      a.rel = "noopener";
    });
    return;
  }
  if (action === "divider") {
    insertBlockAtCaret(editorEl, '<hr class="rt-divider" />');
    return;
  }
  if (action === "blockquote") {
    const text = prompt("Quote text");
    if (!text) return;
    const who = prompt("Attribution (optional)") || "";
    const html = `<figure class="rt-pullquote"><blockquote>${escapeHtml(text)}</blockquote>${who ? `<figcaption>— ${escapeHtml(who)}</figcaption>` : ""}</figure><p><br/></p>`;
    insertBlockAtCaret(editorEl, html);
    return;
  }
  if (action === "image") {
    const url = prompt("Image URL (paste a public image link)");
    if (!url) return;
    const alt = prompt("Alt text (describe the image for accessibility)") || "";
    const caption = prompt("Caption (optional)") || "";
    const html = `
      <figure class="rt-figure">
        <img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" />
        ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}
      </figure>
      <p><br/></p>`;
    insertBlockAtCaret(editorEl, html);
    return;
  }
}

function insertBlockAtCaret(editorEl, html) {
  editorEl.focus();
  // Make sure we have a selection in the editor; if not, append to end.
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editorEl.contains(sel.anchorNode)) {
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  document.execCommand("insertHTML", false, html);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/`/g, "&#96;"); }

async function loadDraft(id, wrap, ctx) {
  try {
    const snap = await getDoc(doc(db, "stories", id));
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.authorId !== ctx.user.uid && ctx.role !== "admin" && ctx.role !== "editor") {
      wrap.querySelector("#form-msg").textContent = "You don't have permission to edit this article.";
      wrap.querySelectorAll("input, textarea, select, button, [contenteditable]").forEach((n) => {
        if (n.hasAttribute("contenteditable")) n.setAttribute("contenteditable", "false");
        else n.disabled = true;
      });
      return;
    }
    wrap.querySelector("#f-title").value = d.title || "";
    wrap.querySelector("#f-category").value = d.category || "Feature";
    wrap.querySelector("#f-cover").value = d.coverImage || "";
    wrap.querySelector("#f-dek").value = d.dek || d.excerpt || "";
    wrap.querySelector("#f-body").innerHTML = d.body || "";
  } catch (err) {
    wrap.querySelector("#form-msg").textContent = "Could not load draft: " + err.message;
  }
}

async function saveStory(ctx, wrap, desiredStatus, editingId) {
  const title = wrap.querySelector("#f-title").value.trim();
  const category = wrap.querySelector("#f-category").value;
  const coverImage = wrap.querySelector("#f-cover").value.trim();
  const dek = wrap.querySelector("#f-dek").value.trim();
  const bodyEl = wrap.querySelector("#f-body");
  const body = bodyEl.innerHTML;
  const bodyText = bodyEl.textContent || "";
  const msg = wrap.querySelector("#form-msg");

  if (!title) { msg.textContent = "Please add a title before saving."; return; }
  if (desiredStatus === "pending" && !bodyText.trim()) { msg.textContent = "Please add some body text before submitting for review."; return; }

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
