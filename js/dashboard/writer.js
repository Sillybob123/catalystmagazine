// Writer module — three mount keys:
//   - "draft": compose / edit a draft
//   - "mine":  list the current user's own articles
//   - "feed":  read-only feed of everything in the works across the newsroom

import { db, storage } from "../firebase-config.js";
import {
  collection, query, where, orderBy, getDocs, doc, setDoc, updateDoc,
  addDoc, serverTimestamp, getDoc, onSnapshot, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { paintSuggestionMarks, renderSuggestionsPanel } from "./editor.js";
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { el, esc, fmtRelative, statusPill, slugify, confirmDialog, toast } from "./ui.js";
import { convertToWebp } from "../image-utils.js";

// Writer self-review checklist. Every item must be checked before a draft
// can be submitted for editor review — mirrors the editor-side checklist
// so writers catch structural issues on their own pass first.
const WRITER_CHECKLIST = [
  { id: "lead",       text: "I've written a lead that earns the reader's attention — specific, not a summary." },
  { id: "angle",      text: "The piece has a clear, concrete angle, not just a broad topic." },
  { id: "structure",  text: "Sections flow logically and every paragraph moves the story forward." },
  { id: "quotes",     text: "All quotes are attributed correctly and placed in context." },
  { id: "sources",    text: "Every factual claim is backed by a source I can cite." },
  { id: "terms",      text: "Scientific terms are defined for a college-level reader." },
  { id: "ending",     text: "The ending lands — a quote, callback, or forward-looking implication." },
  { id: "proofread",  text: "I've read the full piece through for grammar, clarity, and flow." },
];

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

  const wrap = el("div", { class: "compose" });
  wrap.innerHTML = `
    <!-- Sticky command bar -->
    <div class="compose-bar">
      <div class="compose-bar-left">
        <div class="compose-eyebrow">${editingId ? "Editing draft" : "New draft"}</div>
        <span class="compose-status" id="editor-status"></span>
      </div>
      <div class="compose-bar-right">
        <button class="btn btn-ghost btn-sm" id="toggle-settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Settings
        </button>
        <button class="btn btn-secondary btn-sm" id="save-draft-btn">Save draft</button>
        <button class="btn btn-accent btn-sm" id="submit-btn">Submit for review</button>
      </div>
    </div>

    <!-- Floating formatting toolbar -->
    <div class="rt-toolbar" id="rt-toolbar" role="toolbar" aria-label="Formatting">
      <div class="rt-group">
        <select class="rt-select" data-block title="Text style">
          <option value="p">Paragraph</option>
          <option value="h2">Heading 1</option>
          <option value="h3">Heading 2</option>
          <option value="h4">Section label</option>
        </select>
      </div>
      <div class="rt-group">
        <button class="rt-btn" data-cmd="bold" title="Bold (⌘B)" aria-label="Bold"><span style="font-weight:800;">B</span></button>
        <button class="rt-btn" data-cmd="italic" title="Italic (⌘I)" aria-label="Italic"><span style="font-style:italic;font-family:Georgia,serif;">I</span></button>
        <button class="rt-btn" data-cmd="underline" title="Underline (⌘U)" aria-label="Underline"><span style="text-decoration:underline;text-underline-offset:3px;">U</span></button>
        <button class="rt-btn" data-cmd="strikeThrough" title="Strikethrough" aria-label="Strikethrough"><span style="text-decoration:line-through;">S</span></button>
      </div>
      <div class="rt-group">
        <button class="rt-btn" data-cmd="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.2" fill="currentColor"/><circle cx="4" cy="12" r="1.2" fill="currentColor"/><circle cx="4" cy="18" r="1.2" fill="currentColor"/></svg>
        </button>
        <button class="rt-btn" data-cmd="insertOrderedList" title="Numbered list" aria-label="Numbered list">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
        </button>
      </div>
      <div class="rt-group">
        <button class="rt-btn" data-action="link" title="Insert link" aria-label="Insert link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
        <button class="rt-btn" data-action="blockquote" title="Pull quote" aria-label="Pull quote">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 7h4v4H6zM14 7h4v4h-4z"/><path d="M6 11c0 3-1 5-3 6"/><path d="M14 11c0 3-1 5-3 6"/></svg>
        </button>
        <button class="rt-btn" data-action="divider" title="Section divider" aria-label="Section divider">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="18" cy="12" r="1" fill="currentColor"/></svg>
        </button>
        <button class="rt-btn" data-action="image" title="Insert image (upload or URL)" aria-label="Insert image">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </button>
        <button class="rt-btn" data-action="video" title="Insert video (upload or URL)" aria-label="Insert video">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        </button>
      </div>
      <div class="rt-group">
        <button class="rt-btn rt-btn-wide" data-action="new-section" title="Insert a new section (heading + paragraph)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>New section</span>
        </button>
      </div>
      <div class="rt-group">
        <button class="rt-btn" data-cmd="removeFormat" title="Clear formatting" aria-label="Clear formatting">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V4h16v3"/><line x1="5" y1="20" x2="19" y2="20"/><path d="M13 4L8 20"/></svg>
        </button>
      </div>
    </div>

    <!-- The canvas: looks exactly like a published Catalyst article -->
    <article class="compose-article" data-has-cover="false">
      <!-- Hero (cover image + overlay) -->
      <header class="compose-hero">
        <div class="compose-hero-image" id="hero-image"></div>
        <div class="compose-hero-overlay"></div>
        <div class="compose-hero-inner">
          <div class="compose-hero-category" id="hero-category">FEATURE</div>
          <h1 class="compose-hero-title" id="f-title"
              contenteditable="true"
              data-placeholder="Your headline…"
              spellcheck="true"></h1>
          <p class="compose-hero-deck" id="f-dek"
             contenteditable="true"
             data-placeholder="One-sentence deck that teases the story…"
             spellcheck="true"></p>
          <div class="compose-hero-meta">
            <span class="compose-hero-byline">By ${esc(ctx.profile.name || ctx.user.email)}</span>
            <span class="dot"></span>
            <span id="hero-reading-time">1 min read</span>
          </div>
        </div>
      </header>

      <!-- Body — rendered with the same typography as the public article page -->
      <div class="compose-body-wrap">
        <div class="compose-body article-body"
             id="f-body"
             contenteditable="true"
             data-placeholder="Start telling your story. Press ⌘B for bold, ⌘I for italic, or use the toolbar for headings, quotes, and images."
             spellcheck="true"></div>
      </div>
    </article>

    <!-- Settings drawer (category, cover, hidden fields) -->
    <aside class="compose-settings" id="compose-settings" aria-hidden="true">
      <div class="compose-settings-inner">
        <div class="compose-settings-head">
          <div class="compose-settings-title">Article settings</div>
          <button class="compose-settings-close" id="close-settings" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
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
          <label class="label">Cover image</label>
          <div class="cover-picker">
            <button type="button" class="btn btn-secondary btn-sm" id="f-cover-upload-btn">Upload from computer</button>
            <input type="file" id="f-cover-file" accept="image/*" hidden>
            <div class="cover-picker-progress" id="f-cover-progress" hidden>
              <div class="cover-picker-progress-track"><div class="cover-picker-progress-fill" id="f-cover-progress-fill"></div></div>
              <div class="cover-picker-progress-text" id="f-cover-progress-text">Uploading…</div>
            </div>
          </div>
          <input class="input" id="f-cover" placeholder="https://… or upload above" style="margin-top:10px;">
          <div class="hint">Upload an image (auto-converts to WebP) or paste a public URL.</div>
        </div>
        <div class="field">
          <label class="label">Status</label>
          <div class="compose-settings-note">
            Use <strong>Save draft</strong> to keep working, or <strong>Submit for review</strong>
            to send to editors. You can keep editing after submission.
          </div>
        </div>
      </div>
    </aside>
    <div class="compose-settings-scrim" id="settings-scrim"></div>

    <div id="form-msg" class="editor-msg"></div>
  `;
  container.appendChild(wrap);

  const editorEl = wrap.querySelector("#f-body");
  wireRichToolbar(wrap, editorEl, ctx);
  wireHeroPreview(wrap);
  wireSettingsDrawer(wrap);
  wireCoverUpload(wrap, ctx);

  // Writer self-review checklist — shown to writers/editors who need to clear
  // it before submitting for editor review. Admins bypass it entirely (see
  // the submit handler below), so we don't render the card for them.
  const showChecklist = ctx.role !== "admin";
  const checklistCard = el("div", { class: "card", style: { marginTop: "20px", display: showChecklist ? "" : "none" } });
  checklistCard.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">Pre-submission checklist</div>
        <div class="card-subtitle">Every item must be confirmed before you can submit for editor review.</div>
      </div>
      <div class="writer-checklist-progress" id="writer-checklist-progress">0/${WRITER_CHECKLIST.length}</div>
    </div>
    <div class="card-body" id="writer-checklist-body"></div>`;
  container.appendChild(checklistCard);
  const checklistBody = checklistCard.querySelector("#writer-checklist-body");
  const checklistProgress = checklistCard.querySelector("#writer-checklist-progress");
  WRITER_CHECKLIST.forEach((item) => {
    const line = el("label", { class: "checklist-item" });
    line.innerHTML = `
      <input type="checkbox" data-k="${item.id}">
      <span class="checklist-label">${esc(item.text)}</span>`;
    checklistBody.appendChild(line);
  });
  const refreshChecklistProgress = () => {
    const boxes = checklistBody.querySelectorAll('input[type="checkbox"]');
    const done = Array.from(boxes).filter((b) => b.checked).length;
    checklistProgress.textContent = `${done}/${WRITER_CHECKLIST.length}`;
    checklistProgress.classList.toggle("complete", done === WRITER_CHECKLIST.length);
  };
  checklistBody.addEventListener("change", async (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    cb.closest(".checklist-item").classList.toggle("done", cb.checked);
    refreshChecklistProgress();
    // Persist checklist state on the story doc so it survives reloads.
    if (editingId) {
      const items = {};
      checklistBody.querySelectorAll('input[type="checkbox"]').forEach((b) => { items[b.dataset.k] = b.checked; });
      try {
        await updateDoc(doc(db, "stories", editingId), {
          writerChecklist: items,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        ctx.toast("Could not save checklist: " + err.message, "error");
      }
    }
  });

  // Comments + suggestions sidebar when editing.
  if (editingId) {
    const suggestions = el("div", { class: "card", style: { marginTop: "20px" } });
    suggestions.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title">Editor suggestions</div>
          <div class="card-subtitle">Accept to apply the change. Reject to dismiss.</div>
        </div>
      </div>
      <div class="card-body" id="draft-suggestions"><div class="empty-state">No suggestions yet.</div></div>`;
    container.appendChild(suggestions);
    subscribeToSuggestions(ctx, editingId, wrap, suggestions.querySelector("#draft-suggestions"));

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
    btn.addEventListener("click", () => handleBlockAction(btn.dataset.action, editorEl, ctx));
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

function handleBlockAction(action, editorEl, ctx) {
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
    openMediaDialog("image", editorEl, ctx);
    return;
  }
  if (action === "video") {
    openMediaDialog("video", editorEl, ctx);
    return;
  }
  if (action === "new-section") {
    // Gap + heading + empty paragraph. The zero-width space in the <p>
    // keeps contenteditable from collapsing the empty paragraph.
    const html = `<p><br/></p><h2 class="rt-section-heading">New section</h2><p>&#8203;</p>`;
    insertBlockAtCaret(editorEl, html);
    // Select the "New section" text so the user can type right over it.
    const headings = editorEl.querySelectorAll("h2.rt-section-heading");
    const heading = headings[headings.length - 1];
    if (heading) {
      const range = document.createRange();
      range.selectNodeContents(heading);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
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

// ===== Media upload dialog (images + videos) ================================
function openMediaDialog(kind, editorEl, ctx) {
  const isImage = kind === "image";
  const accept = isImage ? "image/*" : "video/*";
  const label = isImage ? "image" : "video";

  // Build the modal
  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog" });
  modal.innerHTML = `
    <div class="media-dialog-head">
      <div class="media-dialog-title">Insert ${label}</div>
      <button class="media-dialog-close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="media-dialog-body">
      <div class="media-dropzone" id="m-drop" tabindex="0">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <div class="media-dropzone-title">Drop a ${label} here, or <span class="link">browse your computer</span></div>
        <div class="media-dropzone-hint">${isImage ? "JPG, PNG, WebP, or GIF — up to 10 MB." : "MP4 or WebM — up to 100 MB."}</div>
        <input type="file" id="m-file" accept="${accept}" hidden />
      </div>

      <div class="media-or"><span>or paste a URL</span></div>

      <div class="field">
        <input class="input" id="m-url" placeholder="https://…" />
      </div>

      <div class="field">
        <label class="label">${isImage ? "Alt text (for accessibility)" : "Caption / description"}</label>
        <input class="input" id="m-alt" placeholder="${isImage ? "Describe what's in the image" : "What's happening in this video"}" />
      </div>
      <div class="field">
        <label class="label">Caption (optional)</label>
        <input class="input" id="m-caption" placeholder="Shown beneath the ${label}" />
      </div>
      ${isImage ? `
      <div class="field">
        <label class="label">Size</label>
        <div class="media-size-picker" role="radiogroup" aria-label="Image size">
          <label class="media-size-opt"><input type="radio" name="m-size" value="small"><span><strong>Small</strong><em>Inline thumb, ~320px</em></span></label>
          <label class="media-size-opt"><input type="radio" name="m-size" value="compact"><span><strong>Compact</strong><em>Column width, ~520px</em></span></label>
          <label class="media-size-opt"><input type="radio" name="m-size" value="standard" checked><span><strong>Standard</strong><em>Body width, ~720px</em></span></label>
          <label class="media-size-opt"><input type="radio" name="m-size" value="large"><span><strong>Large</strong><em>Full-bleed, edge to edge</em></span></label>
        </div>
      </div>` : ""}

      <div class="media-progress" id="m-progress" hidden>
        <div class="media-progress-bar"><span id="m-progress-fill"></span></div>
        <div class="media-progress-text" id="m-progress-text">Uploading… 0%</div>
      </div>

      <div class="media-error" id="m-error"></div>
    </div>
    <div class="media-dialog-foot">
      <button class="btn btn-ghost btn-sm" id="m-cancel">Cancel</button>
      <button class="btn btn-accent btn-sm" id="m-insert" disabled>Insert</button>
    </div>
  `;

  document.body.appendChild(scrim);
  document.body.appendChild(modal);
  requestAnimationFrame(() => { scrim.classList.add("open"); modal.classList.add("open"); });

  const fileInput = modal.querySelector("#m-file");
  const urlInput = modal.querySelector("#m-url");
  const altInput = modal.querySelector("#m-alt");
  const capInput = modal.querySelector("#m-caption");
  const drop = modal.querySelector("#m-drop");
  const insertBtn = modal.querySelector("#m-insert");
  const progressWrap = modal.querySelector("#m-progress");
  const progressFill = modal.querySelector("#m-progress-fill");
  const progressText = modal.querySelector("#m-progress-text");
  const errorEl = modal.querySelector("#m-error");

  let resolvedUrl = null;
  let pendingFile = null;

  const close = () => {
    scrim.classList.remove("open");
    modal.classList.remove("open");
    setTimeout(() => { scrim.remove(); modal.remove(); }, 200);
  };
  modal.querySelector(".media-dialog-close").addEventListener("click", close);
  modal.querySelector("#m-cancel").addEventListener("click", close);
  scrim.addEventListener("click", close);

  const updateInsertState = () => {
    insertBtn.disabled = !(resolvedUrl || urlInput.value.trim());
  };
  urlInput.addEventListener("input", () => {
    resolvedUrl = null;
    pendingFile = null;
    updateInsertState();
  });

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("hover"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("hover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("hover");
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) handleFile(f);
  });

  const maxBytes = isImage ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
  async function handleFile(file) {
    errorEl.textContent = "";
    if (isImage && !file.type.startsWith("image/")) { errorEl.textContent = "Please choose an image file."; return; }
    if (!isImage && !file.type.startsWith("video/")) { errorEl.textContent = "Please choose a video file."; return; }
    if (file.size > maxBytes) {
      errorEl.textContent = `File too large. Max ${isImage ? "10 MB" : "100 MB"}.`;
      return;
    }
    pendingFile = file;
    urlInput.value = file.name;
    urlInput.disabled = true;
    drop.classList.add("has-file");

    try {
      progressWrap.hidden = false;
      resolvedUrl = await uploadToFirebase(file, kind, ctx, (pct) => {
        progressFill.style.width = pct + "%";
        progressText.textContent = `Uploading… ${pct}%`;
      });
      progressText.textContent = "Upload complete.";
      updateInsertState();
    } catch (err) {
      errorEl.textContent = "Upload failed: " + (err?.message || err);
      progressWrap.hidden = true;
      urlInput.disabled = false;
      urlInput.value = "";
      resolvedUrl = null;
      pendingFile = null;
      drop.classList.remove("has-file");
    }
  }

  insertBtn.addEventListener("click", () => {
    const url = resolvedUrl || urlInput.value.trim();
    if (!url) return;
    const alt = altInput.value.trim();
    const caption = capInput.value.trim();
    let html;
    if (isImage) {
      const sizeEl = modal.querySelector('input[name="m-size"]:checked');
      const size = sizeEl ? sizeEl.value : "standard";
      html = `
        <figure class="rt-figure rt-size-${size}">
          <img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" />
          ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}
        </figure>
        <p><br/></p>`;
    } else {
      html = `
        <figure class="rt-figure rt-figure-video">
          <video src="${escapeAttr(url)}" controls playsinline preload="metadata"${alt ? ` aria-label="${escapeAttr(alt)}"` : ""}></video>
          ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}
        </figure>
        <p><br/></p>`;
    }
    insertBlockAtCaret(editorEl, html);
    close();
  });
}

async function uploadToFirebase(file, kind, ctx, onProgress) {
  const uid = ctx?.user?.uid || "anonymous";
  const toUpload = kind === "image" ? await convertToWebp(file) : file;
  const safeName = toUpload.name.replace(/[^\w.\-]+/g, "_");
  const path = `stories/${uid}/${kind}s/${Date.now()}-${safeName}`;
  const ref = storageRef(storage, path);
  const task = uploadBytesResumable(ref, toUpload, { contentType: toUpload.type });
  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        onProgress && onProgress(pct);
      },
      (err) => reject(err),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (err) { reject(err); }
      }
    );
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/`/g, "&#96;"); }

// ===== Hero live preview ====================================================
function wireHeroPreview(wrap) {
  const article = wrap.querySelector(".compose-article");
  const heroImg = wrap.querySelector("#hero-image");
  const coverInput = wrap.querySelector("#f-cover");
  const categoryEl = wrap.querySelector("#f-category");
  const heroCategory = wrap.querySelector("#hero-category");
  const body = wrap.querySelector("#f-body");
  const readingTime = wrap.querySelector("#hero-reading-time");

  const refreshCover = () => {
    const url = coverInput.value.trim();
    if (url) {
      heroImg.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
      article.setAttribute("data-has-cover", "true");
    } else {
      heroImg.style.backgroundImage = "";
      article.setAttribute("data-has-cover", "false");
    }
  };
  const refreshCategory = () => {
    heroCategory.textContent = (categoryEl.value || "Feature").toUpperCase();
  };
  const refreshReadingTime = () => {
    const words = (body.textContent || "").trim().split(/\s+/).filter(Boolean).length;
    const mins = Math.max(1, Math.round(words / 220));
    readingTime.textContent = `${mins} min read`;
  };

  coverInput.addEventListener("input", refreshCover);
  categoryEl.addEventListener("change", refreshCategory);
  body.addEventListener("input", refreshReadingTime);
  refreshCover(); refreshCategory(); refreshReadingTime();

  // Make title/dek single-line-ish: prevent Enter from creating <div>s inside them.
  ["#f-title", "#f-dek"].forEach((sel) => {
    const n = wrap.querySelector(sel);
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Move focus into the next field / body.
        if (sel === "#f-title") wrap.querySelector("#f-dek").focus();
        else wrap.querySelector("#f-body").focus();
      }
    });
    // Strip any pasted HTML in title/dek.
    n.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain").replace(/\n+/g, " ");
      document.execCommand("insertText", false, text);
    });
  });
}

// ===== Settings drawer ======================================================
function wireSettingsDrawer(wrap) {
  const panel = wrap.querySelector("#compose-settings");
  const scrim = wrap.querySelector("#settings-scrim");
  const open = () => { panel.classList.add("open"); scrim.classList.add("open"); panel.setAttribute("aria-hidden", "false"); };
  const close = () => { panel.classList.remove("open"); scrim.classList.remove("open"); panel.setAttribute("aria-hidden", "true"); };
  wrap.querySelector("#toggle-settings").addEventListener("click", open);
  wrap.querySelector("#close-settings").addEventListener("click", close);
  scrim.addEventListener("click", close);
}

// ===== Cover-image upload ===================================================
function wireCoverUpload(wrap, ctx) {
  const btn       = wrap.querySelector("#f-cover-upload-btn");
  const fileInput = wrap.querySelector("#f-cover-file");
  const urlInput  = wrap.querySelector("#f-cover");
  const progress  = wrap.querySelector("#f-cover-progress");
  const fill      = wrap.querySelector("#f-cover-progress-fill");
  const text      = wrap.querySelector("#f-cover-progress-text");

  btn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { ctx.toast("Please choose an image file.", "error"); return; }
    if (file.size > 15 * 1024 * 1024) { ctx.toast("Image must be under 15 MB.", "error"); return; }

    progress.hidden = false;
    fill.style.width = "0%";
    text.textContent = "Preparing…";
    btn.disabled = true;

    try {
      const url = await uploadToFirebase(file, "image", ctx, (pct) => {
        fill.style.width = pct + "%";
        text.textContent = `Uploading… ${pct}%`;
      });
      urlInput.value = url;
      urlInput.dispatchEvent(new Event("input", { bubbles: true }));
      text.textContent = "Uploaded.";
      setTimeout(() => { progress.hidden = true; }, 800);
    } catch (err) {
      ctx.toast("Cover upload failed: " + (err?.message || err), "error");
      progress.hidden = true;
    } finally {
      btn.disabled = false;
      fileInput.value = "";
    }
  });
}

async function loadDraft(id, wrap, ctx) {
  try {
    const snap = await getDoc(doc(db, "stories", id));
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.authorId !== ctx.user.uid && ctx.role !== "admin" && ctx.role !== "editor") {
      wrap.querySelector("#form-msg").textContent = "You don't have permission to edit this article.";
      wrap.querySelectorAll("input, select, button").forEach((n) => n.disabled = true);
      wrap.querySelectorAll("[contenteditable]").forEach((n) => n.setAttribute("contenteditable", "false"));
      return;
    }
    wrap.querySelector("#f-title").textContent = d.title || "";
    wrap.querySelector("#f-category").value = d.category || "Feature";
    wrap.querySelector("#f-cover").value = d.coverImage || "";
    wrap.querySelector("#f-dek").textContent = d.dek || d.excerpt || "";
    wrap.querySelector("#f-body").innerHTML = d.body || "";
    // Restore the writer's checklist state so progress carries across sessions.
    const saved = d.writerChecklist || {};
    document.querySelectorAll('#writer-checklist-body input[type="checkbox"]').forEach((cb) => {
      cb.checked = !!saved[cb.dataset.k];
      cb.closest(".checklist-item").classList.toggle("done", cb.checked);
    });
    const progressEl = document.getElementById("writer-checklist-progress");
    if (progressEl) {
      const total = document.querySelectorAll('#writer-checklist-body input[type="checkbox"]').length;
      const done = document.querySelectorAll('#writer-checklist-body input[type="checkbox"]:checked').length;
      progressEl.textContent = `${done}/${total}`;
      progressEl.classList.toggle("complete", done === total);
    }
    // Refresh hero preview
    wrap.querySelector("#f-cover").dispatchEvent(new Event("input", { bubbles: true }));
    wrap.querySelector("#f-category").dispatchEvent(new Event("change", { bubbles: true }));
  } catch (err) {
    wrap.querySelector("#form-msg").textContent = "Could not load draft: " + err.message;
  }
}

async function saveStory(ctx, wrap, desiredStatus, editingId) {
  const title = (wrap.querySelector("#f-title").textContent || "").trim();
  const category = wrap.querySelector("#f-category").value;
  const coverImage = wrap.querySelector("#f-cover").value.trim();
  const dek = (wrap.querySelector("#f-dek").textContent || "").trim();
  const bodyEl = wrap.querySelector("#f-body");
  // Strip any live suggestion marks before persisting — they're rendered on top, not saved.
  const body = bodyEl.innerHTML.replace(/<mark class="sx-mark[^"]*"[^>]*>([\s\S]*?)<\/mark>/g, "$1");
  const bodyText = bodyEl.textContent || "";
  const msg = wrap.querySelector("#form-msg");

  // Collect the writer's self-review checklist state.
  const writerChecklist = {};
  document.querySelectorAll('#writer-checklist-body input[type="checkbox"]').forEach((cb) => {
    writerChecklist[cb.dataset.k] = cb.checked;
  });
  const checklistDone = WRITER_CHECKLIST.every((item) => writerChecklist[item.id]);

  if (!title) { msg.textContent = "Please add a title before saving."; return; }

  if (desiredStatus === "pending") {
    // Hard gate for "Submit for review": title, cover image, excerpt (dek),
    // body, and every item on the writer's checklist must be checked.
    const missing = [];
    if (!title) missing.push("a title");
    if (!coverImage) missing.push("a cover image");
    if (!dek) missing.push("an excerpt (the one-sentence deck under the headline)");
    if (!bodyText.trim()) missing.push("body text");
    if (missing.length) {
      msg.textContent = "Before submitting, please add " + missing.join(", ") + ".";
      ctx.toast("Can't submit yet — missing " + missing.join(", ") + ".", "error");
      return;
    }
    // Admins bypass the checklist — they're expected to be self-editing and
    // often import or publish pieces that never went through a writer's review.
    if (!checklistDone && ctx.role !== "admin") {
      msg.textContent = "Before submitting, please complete every item on the pre-submission checklist.";
      ctx.toast("Complete the checklist to submit for review.", "error");
      // Flash the checklist card so the writer notices it.
      const card = document.getElementById("writer-checklist-body")?.closest(".card");
      if (card) {
        card.classList.add("flash-attention");
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => card.classList.remove("flash-attention"), 1600);
      }
      return;
    }
  }

  const payload = {
    title, category, coverImage, dek, body,
    slug: slugify(title),
    writerChecklist,
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

function subscribeToSuggestions(ctx, storyId, wrap, panel) {
  const bodyEl = wrap.querySelector("#f-body");
  const q = query(collection(db, "stories", storyId, "suggestions"), orderBy("createdAt", "asc"));
  let lastKey = "";
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));

    // Only re-paint the body when the set of suggestions actually changed,
    // to avoid losing the writer's caret on every snapshot echo.
    const key = items.map((s) => `${s.id}:${s.start}-${s.end}`).join("|");
    if (key !== lastKey) {
      lastKey = key;
      const cleanHtml = bodyEl.innerHTML.replace(/<mark class="sx-mark[^"]*"[^>]*>([\s\S]*?)<\/mark>/g, "$1");
      paintSuggestionMarks(bodyEl, cleanHtml, items);
    }

    const writerCtx = {
      ...ctx,
      onAccept: async (s) => {
        try {
          if (s.kind === "replace") {
            applyReplacement(bodyEl, s);
            await persistBody(storyId, bodyEl);
          }
          await deleteDoc(doc(db, "stories", storyId, "suggestions", s.id));
          ctx.toast("Applied.", "success");
        } catch (err) { ctx.toast("Could not apply: " + err.message, "error"); }
      },
      onReject: async (s) => {
        try {
          await deleteDoc(doc(db, "stories", storyId, "suggestions", s.id));
        } catch (err) { ctx.toast("Failed: " + err.message, "error"); }
      },
    };
    renderSuggestionsPanel(panel, items, writerCtx, "writer");
  });
}

// Replace the range [s.start, s.end) with s.replacementText in the editable body.
// Falls back to no-op if the text no longer matches (writer edited around it).
function applyReplacement(bodyEl, s) {
  // Strip any existing marks for cleanness before measuring offsets.
  bodyEl.querySelectorAll("mark.sx-mark").forEach((m) => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  bodyEl.normalize();

  const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null);
  let count = 0;
  let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const len = n.nodeValue.length;
    if (!startNode && count + len >= s.start) {
      startNode = n;
      startOffset = s.start - count;
    }
    if (!endNode && count + len >= s.end) {
      endNode = n;
      endOffset = s.end - count;
      break;
    }
    count += len;
  }
  if (!startNode || !endNode) throw new Error("range not found in current text");

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  // Conflict check: has the text underneath drifted?
  if (range.toString() !== (s.originalText || "")) {
    throw new Error("text has changed since the suggestion was made");
  }
  range.deleteContents();
  if (s.replacementText) {
    range.insertNode(document.createTextNode(s.replacementText));
  }
}

async function persistBody(storyId, bodyEl) {
  await updateDoc(doc(db, "stories", storyId), {
    body: bodyEl.innerHTML,
    updatedAt: new Date().toISOString(),
  });
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
        ${allowEdit ? `<button class="btn btn-ghost btn-xs" data-action="delete" data-id="${esc(d.id)}" style="color:var(--danger);">Delete</button>` : ""}
      </div>`;
    mount.appendChild(row);
  });

  if (!allowEdit) return;
  mount.addEventListener("click", async (e) => {
    const btn = e.target.closest('[data-action="delete"]');
    if (!btn) return;
    const id = btn.dataset.id;
    const ok = await confirmDialog(
      "Delete this article? This cannot be undone.",
      { confirmText: "Delete", danger: true },
    );
    if (!ok) return;
    btn.disabled = true;
    try {
      await deleteDoc(doc(db, "stories", id));
      toast("Article deleted.", "success");
      // Remove the row without a full reload.
      btn.closest(".article-row")?.remove();
      if (!mount.querySelector(".article-row")) {
        mount.innerHTML = `<div class="empty-state">Nothing here yet.</div>`;
      }
    } catch (err) {
      btn.disabled = false;
      toast("Delete failed: " + err.message, "error");
    }
  });
}

function getHashParam(name) {
  const q = location.hash.split("?")[1];
  if (!q) return null;
  return new URLSearchParams(q).get(name);
}
