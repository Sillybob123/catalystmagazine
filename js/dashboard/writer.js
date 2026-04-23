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
  listAll,
  getMetadata,
  deleteObject,
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
        <button class="btn btn-ghost btn-sm" id="editorial-standards-btn" title="Open Catalyst's editorial standards in a new tab">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          Editorial standards
        </button>
        <button class="btn btn-ghost btn-sm" id="format-guide-btn" title="See an example of a professionally formatted article">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          How to format
        </button>
        <button class="btn btn-ghost btn-sm" id="preview-btn" title="Open a full preview of how this article will look when published">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Preview
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
        <button class="rt-btn rt-btn-wide" data-action="paste-gdoc" title="Paste from a Google Doc and keep headings, bold, italic, and links">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="12" height="16" rx="2"/><path d="M4 6v14a2 2 0 0 0 2 2h10"/></svg>
          <span>Paste from Google Doc</span>
        </button>
        <button class="rt-btn rt-btn-wide" data-action="quiz" title="Add a 3-question knowledge quiz to the end of the article">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Add quiz</span>
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
          <div class="compose-hero-surface">
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
        </div>
      </header>

      <!-- Body — rendered with the same typography as the public article page.
           The ghost-template next to it shows a suggested structure (hero ¶,
           sections, pull-quote, closing) and fades out as soon as the writer
           starts typing. It's a sibling, not a child, so it can never end up
           saved to Firestore. -->
      <div class="compose-body-wrap">
        <div class="compose-body-ghost" id="f-body-ghost" aria-hidden="true">
          <div class="compose-body-ghost-inner">
            <p class="ghost-tag">Suggested structure · tap anywhere to start</p>
            <p class="ghost-lead"><strong>Opening paragraph.</strong> Lead with a specific scene, detail, or question that earns the reader's attention — not a summary. This is the hook.</p>
            <p>Add one or two setup paragraphs that establish context, stakes, or your angle. Who, what, and <em>why this matters right now.</em></p>
            <h2 class="rt-section-heading">First section heading</h2>
            <p>Use section headings to break the piece into 2–4 clear movements. Each section should move the story forward and flow logically from the last.</p>
            <p>Support claims with a quote, a statistic, or a source. Pull-quotes highlight a powerful line:</p>
            <figure class="rt-pullquote"><blockquote>A memorable quote or line from your piece pulled out for emphasis.</blockquote><figcaption>— Attribution (optional)</figcaption></figure>
            <h2 class="rt-section-heading">Second section heading</h2>
            <p>Deepen the argument here. Introduce a counterpoint, a new source, or zoom into a specific example. Insert images using the toolbar — captions and credits help.</p>
            <h2 class="rt-section-heading">Closing</h2>
            <p>End with a callback to your opening, a forward-looking implication, or the sharpest quote you saved for last. Land it.</p>
            <p class="ghost-tip">Tip: use the toolbar for headings, quotes, lists, images, and dividers — or paste from a Google Doc to bring an outline straight in.</p>
          </div>
        </div>
        <div class="compose-body article-body"
             id="f-body"
             contenteditable="true"
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
            <option value="Profile">Profile</option>
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
            <button type="button" class="btn btn-ghost btn-sm" id="f-cover-library-btn">Choose from library</button>
            <input type="file" id="f-cover-file" accept="image/*" hidden>
            <div class="cover-picker-progress" id="f-cover-progress" hidden>
              <div class="cover-picker-progress-track"><div class="cover-picker-progress-fill" id="f-cover-progress-fill"></div></div>
              <div class="cover-picker-progress-text" id="f-cover-progress-text">Uploading…</div>
            </div>
          </div>
          <input class="input" id="f-cover" placeholder="https://… or upload above" style="margin-top:10px;">
          <div class="hint">Upload an image (auto-converts to WebP) or paste a public URL.</div>
          <label class="cover-light-toggle">
            <input type="checkbox" id="f-cover-light">
            <span>
              <strong>Cover image is light or bright</strong>
              <span class="cover-light-toggle__hint">Adds a dark overlay so the title stays readable.</span>
            </span>
          </label>
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

  wrap.querySelector("#editorial-standards-btn").addEventListener("click", openEditorialStandards);
  wrap.querySelector("#format-guide-btn").addEventListener("click", openFormatGuide);
  wrap.querySelector("#preview-btn").addEventListener("click", () => openArticlePreview(wrap, ctx));
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

  // Paste handling:
  //   - If the clipboard has Google Docs / Word HTML (headings, styled runs,
  //     or embedded images), run it through the same importer the "Paste from
  //     Google Doc" button uses. Images are uploaded to Firebase Storage and
  //     their <img src> rewritten to the CDN URL, so we never inline massive
  //     base64 into the article body (which would blow Firestore's 1 MB doc
  //     limit on save).
  //   - Otherwise, insert plain text so we don't smuggle in foreign styles.
  editorEl.addEventListener("paste", (e) => {
    const cd = e.clipboardData || window.clipboardData;
    const html = cd.getData("text/html") || "";
    const text = cd.getData("text/plain") || "";

    if (html && looksLikeRichPaste(html)) {
      e.preventDefault();
      importRichPasteInline(html, editorEl, ctx);
      return;
    }

    e.preventDefault();
    document.execCommand("insertText", false, text);
  });

  // Click on an inserted image/video figure → open the edit dialog so the
  // writer can change size, caption, alt text, or replace/remove the media.
  // We don't hijack clicks on the <video> element itself — those should play
  // the video, not open the dialog.
  editorEl.addEventListener("click", (e) => {
    const quizFig = e.target.closest("figure.rt-quiz");
    if (quizFig && editorEl.contains(quizFig)) {
      e.preventDefault();
      openQuizDialog(editorEl, ctx, quizFig);
      return;
    }
    const figure = e.target.closest("figure.rt-figure");
    if (!figure || !editorEl.contains(figure)) return;
    if (e.target.tagName === "VIDEO") return; // let native controls work
    e.preventDefault();
    const kind = figure.classList.contains("rt-figure-video") ? "video" : "image";
    openMediaDialog(kind, editorEl, ctx, figure);
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
    insertDividerAtCaret(editorEl);
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
    openMediaDialog("image", editorEl, ctx, null, captureEditorRange(editorEl));
    return;
  }
  if (action === "video") {
    openMediaDialog("video", editorEl, ctx, null, captureEditorRange(editorEl));
    return;
  }
  if (action === "paste-gdoc") {
    openGoogleDocPasteDialog(editorEl, ctx);
    return;
  }
  if (action === "quiz") {
    openQuizDialog(editorEl, ctx, null);
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

// ===== Google Docs paste ====================================================
// Opens a dialog where writers paste from a Google Doc (or upload a .docx).
// We sanitize the HTML, map Docs' styles to our magazine blocks, extract any
// images the Doc carried over, upload them to Firebase Storage, rewrite their
// <img src> to point at the uploaded file, and then insert the result into
// the article body.
function openGoogleDocPasteDialog(editorEl, ctx) {
  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog", style: { maxWidth: "820px" } });
  modal.innerHTML = `
    <div class="media-dialog-head">
      <div class="media-dialog-title">Paste from Google Doc</div>
      <button class="media-dialog-close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="media-dialog-body">
      <div class="hint" style="margin-bottom:10px;">
        Paste directly from your Google Doc below (⌘A, ⌘C, then ⌘V here). Headings, bold, italic, links, lists, quotes, and images all carry over.
        If an image didn't come through, use the <strong>Upload .docx</strong> option — it's 100% reliable.
      </div>
      <div id="gdoc-paste-target"
           contenteditable="true"
           style="min-height:180px;max-height:260px;overflow:auto;border:1px dashed var(--hairline-2);border-radius:10px;padding:14px 16px;background:var(--surface-1);font-family:inherit;"
           data-placeholder="Paste your Google Doc content here…"></div>
      <div class="hint" id="gdoc-count" style="margin-top:8px;">Waiting for paste…</div>

      <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--hairline-2);">
        <div class="hint" style="margin-bottom:8px;">
          <strong>Fallback:</strong> export your Doc (File → Download → Microsoft Word .docx) and drop it here. This is the most reliable way to bring images across.
        </div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
          <input type="file" id="gdoc-docx" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none;" />
          Upload .docx file
        </label>
        <span id="gdoc-docx-name" class="hint" style="margin-left:10px;"></span>
      </div>

      <div class="field" style="margin-top:14px;">
        <label class="label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="gdoc-replace" />
          <span>Replace the entire article body (otherwise content is inserted at the cursor)</span>
        </label>
      </div>
      <div id="gdoc-progress" class="hint" style="margin-top:10px;display:none;"></div>
      <div class="media-error" id="gdoc-error"></div>
    </div>
    <div class="media-dialog-foot">
      <button class="btn btn-ghost btn-sm" id="gdoc-cancel">Cancel</button>
      <button class="btn btn-accent btn-sm" id="gdoc-insert" disabled>Insert into article</button>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.appendChild(modal);
  requestAnimationFrame(() => { scrim.classList.add("open"); modal.classList.add("open"); });

  const target = modal.querySelector("#gdoc-paste-target");
  const countEl = modal.querySelector("#gdoc-count");
  const insertBtn = modal.querySelector("#gdoc-insert");
  const replaceBox = modal.querySelector("#gdoc-replace");
  const errorEl = modal.querySelector("#gdoc-error");
  const progressEl = modal.querySelector("#gdoc-progress");
  const docxInput = modal.querySelector("#gdoc-docx");
  const docxName = modal.querySelector("#gdoc-docx-name");

  const close = () => {
    scrim.classList.remove("open");
    modal.classList.remove("open");
    setTimeout(() => { scrim.remove(); modal.remove(); }, 200);
  };
  modal.querySelector(".media-dialog-close").addEventListener("click", close);
  modal.querySelector("#gdoc-cancel").addEventListener("click", close);
  scrim.addEventListener("click", close);

  let cleanedHtml = "";
  let busy = false;

  const setBusy = (on, message = "") => {
    busy = on;
    insertBtn.disabled = on || !cleanedHtml;
    progressEl.style.display = on || message ? "block" : "none";
    progressEl.textContent = message;
  };

  const updateCount = () => {
    const words = (target.textContent || "").trim().split(/\s+/).filter(Boolean).length;
    const imgs = target.querySelectorAll("img").length;
    const parts = [];
    if (words) parts.push(`about ${words.toLocaleString()} word${words === 1 ? "" : "s"}`);
    if (imgs) parts.push(`${imgs} image${imgs === 1 ? "" : "s"}`);
    countEl.textContent = cleanedHtml
      ? `Ready to insert — ${parts.join(", ") || "content parsed"}.`
      : "Nothing to paste yet.";
  };

  // Run the async import pipeline: convert clipboard HTML, upload every image
  // to Firebase Storage, and rewrite <img src> to point at the uploaded file.
  const runImport = async (rawHtml, plain) => {
    errorEl.textContent = "";
    if (!rawHtml && !plain) {
      cleanedHtml = "";
      target.innerHTML = `<p style="color:var(--muted-2)">Nothing to paste.</p>`;
      updateCount();
      insertBtn.disabled = true;
      return;
    }
    if (!rawHtml) {
      cleanedHtml = plainTextToHtml(plain);
      target.innerHTML = cleanedHtml;
      updateCount();
      insertBtn.disabled = !cleanedHtml;
      return;
    }

    setBusy(true, "Parsing your Doc…");
    try {
      const { wrapper, imageNodes } = convertGoogleDocsHtml(rawHtml);

      if (imageNodes.length) {
        const failures = [];
        let done = 0;
        const total = imageNodes.length;
        const updateProgress = () => {
          progressEl.textContent = `Uploading images… ${done}/${total}`;
        };
        updateProgress();

        // Upload in parallel (capped to 4 at a time to avoid hammering storage).
        await runWithConcurrency(imageNodes, 4, async (node) => {
          try {
            const uploaded = await uploadPastedImage(node.src, node.filename, ctx);
            node.el.setAttribute("src", uploaded);
            node.el.setAttribute("data-uploaded", "1");
          } catch (err) {
            failures.push({ src: node.src, err });
            // Leave the original src on the image and tag it so the writer
            // sees which ones didn't transfer.
            node.el.setAttribute("data-upload-failed", "1");
          } finally {
            done++;
            updateProgress();
          }
        });

        if (failures.length) {
          errorEl.textContent = `${failures.length} image${failures.length === 1 ? "" : "s"} couldn't be uploaded automatically. Try the .docx upload below for those.`;
        }
      }

      // Re-serialize AFTER uploads so the rewritten src="firebase://..." URLs
      // land in the inserted HTML instead of the original data: URIs.
      cleanedHtml = wrapper.innerHTML;
      target.innerHTML = cleanedHtml;
      updateCount();
      insertBtn.disabled = !cleanedHtml;
    } catch (err) {
      errorEl.textContent = "Could not parse the Doc: " + (err?.message || err);
    } finally {
      setBusy(false, "");
    }
  };

  // Intercept the paste so we can read Google Docs' HTML directly instead of
  // whatever the browser would insert into a contenteditable.
  target.addEventListener("paste", (e) => {
    e.preventDefault();
    if (busy) return;
    const cd = e.clipboardData || window.clipboardData;
    const html = cd.getData("text/html") || "";
    const plain = cd.getData("text/plain") || "";
    runImport(html, plain);
  });

  // .docx upload — use mammoth.js to convert to HTML, then run it through the
  // same image-upload pipeline. mammoth gives us data:image URLs for embedded
  // images, which always upload cleanly.
  docxInput.addEventListener("change", async () => {
    const file = docxInput.files && docxInput.files[0];
    if (!file) return;
    docxName.textContent = file.name;
    setBusy(true, "Converting .docx…");
    try {
      const mammoth = await loadMammoth();
      const buf = await file.arrayBuffer();
      const result = await mammoth.convertToHtml(
        { arrayBuffer: buf },
        {
          // Map Word heading styles explicitly so we get the right levels.
          styleMap: [
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Heading 4'] => h4:fresh",
            "p[style-name='Quote'] => blockquote:fresh",
            "p[style-name='Intense Quote'] => blockquote:fresh",
          ],
        }
      );
      setBusy(true, "Parsing document…");
      await runImport(result.value, "");
    } catch (err) {
      errorEl.textContent = "Could not read .docx: " + (err?.message || err);
      setBusy(false, "");
    }
  });

  // Focus the target so the user can immediately paste.
  requestAnimationFrame(() => target.focus());

  insertBtn.addEventListener("click", () => {
    if (!cleanedHtml || busy) return;
    // Pull the LIVE preview HTML, not the snapshot from the last paste — the
    // writer may have deleted paragraphs or edited text inside the preview
    // before hitting Insert. Fall back to the snapshot if the preview is
    // somehow empty.
    const liveHtml = (target.innerHTML || "").trim();
    const htmlToInsert = liveHtml || cleanedHtml;
    try {
      if (replaceBox.checked) {
        editorEl.innerHTML = htmlToInsert;
      } else {
        insertBlockAtCaret(editorEl, htmlToInsert);
      }
      // execCommand("insertHTML") and assigning innerHTML both sometimes nest
      // a <figure> inside a <p> or drop contenteditable="false" — that breaks
      // the click-to-edit handler. Walk every figure we just inserted and
      // make sure it's at block level with the flags the toolbar expects.
      // Also wrap any stray <img> that landed outside a figure, and strip
      // width/height attributes so CSS can control sizing.
      stripInlineImgDimensions(editorEl);
      upgradeLegacyImages(editorEl);
      normalizeEditorFigures(editorEl);
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
      ctx?.toast?.("Pasted from Google Doc.", "success");
      close();
    } catch (err) {
      errorEl.textContent = "Could not insert: " + (err?.message || err);
    }
  });
}

// Repair pasted/inserted figures so the editor's click-to-edit flow works:
//   - hoist figures out of any surrounding <p> (execCommand loves to nest them)
//   - ensure contenteditable="false" so clicks don't drop a caret inside them
//   - ensure a size class (defaults to rt-size-standard)
//   - ensure data-rt-figure so the toolbar's click handler recognizes them
function normalizeEditorFigures(editorEl) {
  editorEl.querySelectorAll("figure.rt-figure").forEach((fig) => {
    // Hoist out of <p> / <div> wrappers that the browser added around it.
    let parent = fig.parentElement;
    while (parent && parent !== editorEl && /^(p|div|span)$/i.test(parent.tagName)) {
      parent.parentElement.insertBefore(fig, parent);
      // If the wrapper is now empty, drop it; otherwise leave the other text.
      if (!parent.textContent.trim() && !parent.querySelector("img, video, figure")) {
        parent.remove();
      }
      parent = fig.parentElement;
    }
    fig.setAttribute("contenteditable", "false");
    const isVideo = fig.classList.contains("rt-figure-video") || fig.querySelector("video");
    if (!fig.hasAttribute("data-rt-figure")) {
      fig.setAttribute("data-rt-figure", isVideo ? "video" : "image");
    }
    if (!/\brt-size-[a-z]+\b/.test(fig.className)) {
      fig.classList.add("rt-size-standard");
    }
  });
}

// Google Docs (and Word) paste <img width="..." height="..." style="width: ..."
// ...>, and those attributes win against "max-width: 100%" — the image gets
// resized to a different aspect ratio and looks cropped/stretched. Strip
// them so our CSS controls sizing purely from the figure's size class.
function stripInlineImgDimensions(editorEl) {
  editorEl.querySelectorAll("img").forEach((img) => {
    img.removeAttribute("width");
    img.removeAttribute("height");
    const style = img.getAttribute("style") || "";
    if (style) {
      const cleaned = style
        .split(";")
        .map((rule) => rule.trim())
        .filter((rule) => rule && !/^(width|height|max-width|max-height|min-width|min-height|aspect-ratio)\s*:/i.test(rule))
        .join("; ");
      if (cleaned) img.setAttribute("style", cleaned);
      else img.removeAttribute("style");
    }
  });
}

// Wrap any bare <img> that isn't already inside a .rt-figure. Legacy drafts
// and some rich pastes can leave raw <img> tags in the body, which the click
// handler ignores (it only matches figure.rt-figure). This converts each one
// into a proper editable figure so writers can click to edit size/alt/caption.
function upgradeLegacyImages(editorEl) {
  const bareImgs = Array.from(editorEl.querySelectorAll("img")).filter((img) => !img.closest("figure.rt-figure"));
  bareImgs.forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!src) { img.remove(); return; }
    const alt = img.getAttribute("alt") || "";

    const figure = document.createElement("figure");
    figure.className = "rt-figure rt-size-standard";
    figure.setAttribute("contenteditable", "false");
    figure.setAttribute("data-rt-figure", "image");
    const newImg = document.createElement("img");
    newImg.setAttribute("src", src);
    newImg.setAttribute("alt", alt);
    figure.appendChild(newImg);

    // Swap the bare img for the figure. If the img's only ancestor up to the
    // editor is a <p>/<div> that held nothing else, drop the wrapper too so
    // we don't leave an empty paragraph behind.
    let replaceTarget = img;
    let wrapper = img.parentElement;
    while (
      wrapper && wrapper !== editorEl &&
      /^(p|div|span)$/i.test(wrapper.tagName) &&
      wrapper.childNodes.length === 1
    ) {
      replaceTarget = wrapper;
      wrapper = wrapper.parentElement;
    }
    replaceTarget.parentNode.replaceChild(figure, replaceTarget);
  });
}

// Dynamically load mammoth.js from a CDN the first time it's needed. We hang
// it off `window.mammoth` so a second .docx in the same session reuses it.
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (window.mammoth) resolve(window.mammoth);
      else reject(new Error("mammoth failed to register"));
    };
    script.onerror = () => reject(new Error("Could not load mammoth.js (check your connection)"));
    document.head.appendChild(script);
  });
}

// Run `task` across `items` with at most `limit` in flight at once.
async function runWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await task(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// Walk the editor body and upload any <img> that still has a data: URI src
// (e.g. a paste import where an upload failed, or an image dropped into the
// contenteditable directly by the browser). Replaces each data: src with the
// uploaded Storage URL in place. Silently skips images that are already
// pointing at https URLs.
async function uploadInlineDataImages(bodyEl, ctx, onProgress) {
  const imgs = Array.from(bodyEl.querySelectorAll("img")).filter((img) => {
    const src = img.getAttribute("src") || "";
    return src.startsWith("data:");
  });
  if (!imgs.length) return;

  let done = 0;
  const total = imgs.length;
  onProgress && onProgress(done, total);

  await runWithConcurrency(imgs, 3, async (img) => {
    const src = img.getAttribute("src") || "";
    const altName = (img.getAttribute("alt") || "pasted") + extFromMimeOrUrl(src);
    try {
      const uploaded = await uploadPastedImage(src, altName, ctx);
      img.setAttribute("src", uploaded);
      img.setAttribute("data-uploaded", "1");
      img.removeAttribute("data-upload-failed");
    } finally {
      done++;
      onProgress && onProgress(done, total);
    }
  });
}

// Convert a pasted <img src> into a File, push it to Firebase Storage via the
// same content-hash pipeline used by the media dialog, and return the public
// download URL. Works for:
//   - data:image/… (Docs desktop app, mammoth.js .docx conversion)
//   - https://lh*.googleusercontent.com/… (Docs browser paste) — subject to CORS
//   - any other https image URL the Doc happened to carry
async function uploadPastedImage(src, filename, ctx) {
  let blob;
  if (src.startsWith("data:")) {
    blob = await (await fetch(src)).blob();
  } else {
    // Cross-origin fetch — if the remote blocks CORS this throws, which the
    // caller catches and reports as a per-image failure.
    const res = await fetch(src, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  }
  if (!blob.type.startsWith("image/")) {
    throw new Error(`Not an image (type: ${blob.type || "unknown"})`);
  }
  const safeName = (filename || "pasted-image").replace(/[^a-z0-9._-]/gi, "_").slice(0, 60);
  const file = new File([blob], safeName, { type: blob.type });
  return await uploadToFirebase(file, "image", ctx);
}

// Detect clipboard HTML that's worth running through the Google Docs
// importer. We don't want to invoke the heavy pipeline for trivial pastes
// (a single styled word from another tab), but we MUST catch anything that
// carries images or Docs-shaped structure — otherwise base64 <img> URIs end
// up in the body and Firestore rejects the save with "too many bytes".
function looksLikeRichPaste(html) {
  if (!html) return false;
  // Images (base64 or remote) are the #1 reason we need to run the importer.
  if (/<img\b/i.test(html)) return true;
  // Google Docs always includes this marker wrapper.
  if (/id="docs-internal-guid/i.test(html)) return true;
  // Headings, lists, tables, blockquotes — import as magazine blocks.
  if (/<(h[1-6]|ul|ol|blockquote|table|figure)\b/i.test(html)) return true;
  return false;
}

// Run a pasted HTML blob through the Google Docs importer and insert the
// result at the current caret. Image uploads happen in the background; we
// insert placeholders first so the writer sees immediate feedback, then
// swap each <img src> to the Storage URL as uploads complete.
async function importRichPasteInline(rawHtml, editorEl, ctx) {
  const savedRange = captureEditorRange(editorEl);

  let converted;
  try {
    converted = convertGoogleDocsHtml(rawHtml);
  } catch (err) {
    console.warn("[paste] could not parse clipboard HTML, falling back to plain text", err);
    const text = new DOMParser().parseFromString(rawHtml, "text/html").body?.textContent || "";
    document.execCommand("insertText", false, text);
    return;
  }

  const { wrapper, imageNodes } = converted;
  const html = wrapper ? wrapper.innerHTML : "";
  if (!html) return;

  // Insert the converted HTML first so the writer sees the content land in
  // place. Each <img> carries its original data:/https src for now; we'll
  // rewrite them to uploaded URLs as the async uploads complete via the
  // liveBySrc map below.
  insertBlockAtCaret(editorEl, html, savedRange);
  stripInlineImgDimensions(editorEl);
  upgradeLegacyImages(editorEl);
  normalizeEditorFigures(editorEl);
  editorEl.dispatchEvent(new Event("input", { bubbles: true }));

  if (!imageNodes.length) return;

  // The <img> nodes that convertGoogleDocsHtml returned live in a detached
  // wrapper, not in the editor. Group the live editor <img>s by src so we
  // can update every copy when an upload finishes (dedupes by src, which is
  // what writers expect — pasting the same image twice should upload once
  // and share the URL).
  const liveBySrc = new Map();
  editorEl.querySelectorAll("img").forEach((img) => {
    const s = img.getAttribute("src") || "";
    if (!s) return;
    if (!liveBySrc.has(s)) liveBySrc.set(s, []);
    liveBySrc.get(s).push(img);
  });

  // One upload per distinct src (imageNodes may list the same src multiple
  // times if the Doc repeats an image).
  const uniqueSrcs = new Map();
  imageNodes.forEach((n) => {
    if (n.src && liveBySrc.has(n.src) && !uniqueSrcs.has(n.src)) {
      uniqueSrcs.set(n.src, n);
    }
  });
  const pending = Array.from(uniqueSrcs.values());
  if (!pending.length) return;

  ctx?.toast?.(`Uploading ${pending.length} pasted image${pending.length === 1 ? "" : "s"}…`, "info");
  let failed = 0;

  await runWithConcurrency(pending, 4, async (node) => {
    const liveImgs = (liveBySrc.get(node.src) || []).filter((img) => editorEl.contains(img));
    if (!liveImgs.length) return;
    try {
      const uploaded = await uploadPastedImage(node.src, node.filename, ctx);
      liveImgs.forEach((img) => {
        img.setAttribute("src", uploaded);
        img.setAttribute("data-uploaded", "1");
      });
    } catch (err) {
      failed++;
      liveImgs.forEach((img) => img.setAttribute("data-upload-failed", "1"));
      console.warn("[paste] image upload failed", err);
    }
  });

  editorEl.dispatchEvent(new Event("input", { bubbles: true }));
  if (failed) {
    ctx?.toast?.(`${failed} image${failed === 1 ? "" : "s"} couldn't upload. Click each to re-upload, or use the .docx option.`, "error");
  } else {
    ctx?.toast?.("Pasted images uploaded.", "success");
  }
}

// Convert Google Docs clipboard HTML into our magazine structure.
// Returns { html, imageNodes } where imageNodes is a live-ish list of
// { el, src, filename } records the caller can upload and rewrite.
function convertGoogleDocsHtml(rawHtml) {
  // Docs wraps the real content in a <b id="docs-internal-guid-…"> or similar;
  // parse with DOMParser so we never inject the raw string into the DOM.
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");

  // Strip <style>, <meta>, <script>, and Google's comment wrappers.
  doc.querySelectorAll("style, meta, script, link, title").forEach((n) => n.remove());

  // If Docs wrapped everything in a single <b id="docs-internal-…">, unwrap it
  // (otherwise the entire article would end up bold).
  doc.querySelectorAll('b[id^="docs-internal-guid"]').forEach((b) => {
    const parent = b.parentNode;
    while (b.firstChild) parent.insertBefore(b.firstChild, b);
    parent.removeChild(b);
  });

  const body = doc.body;
  if (!body) return { html: "", imageNodes: [] };

  // Walk the top-level children and convert each one to a magazine block.
  const out = [];
  body.childNodes.forEach((node) => {
    const block = convertGDocBlock(node);
    if (block) out.push(block);
  });

  // Collapse consecutive empty paragraphs and trailing blanks.
  const rawJoined = out.join("\n").replace(/(<p><br\/?><\/p>\s*){2,}/g, "<p><br/></p>").trim();
  const normalized = normalizeGDocText(rawJoined);

  // Parse the final string once more so we can return live <img> references
  // for the async upload step. The caller mutates these .el nodes in place
  // and must re-serialize wrapper.innerHTML AFTER uploads run — that's why we
  // return the live wrapper, not a pre-serialized string.
  const wrapper = document.createElement("div");
  wrapper.innerHTML = normalized;
  const imageNodes = Array.from(wrapper.querySelectorAll("img"))
    .map((img) => ({
      el: img,
      src: img.getAttribute("src") || "",
      filename: (img.getAttribute("alt") || "pasted") + extFromMimeOrUrl(img.getAttribute("src") || ""),
    }))
    .filter((n) => n.src);

  return { wrapper, imageNodes };
}

function extFromMimeOrUrl(src) {
  if (src.startsWith("data:image/png")) return ".png";
  if (src.startsWith("data:image/jpeg") || src.startsWith("data:image/jpg")) return ".jpg";
  if (src.startsWith("data:image/webp")) return ".webp";
  if (src.startsWith("data:image/gif")) return ".gif";
  const m = src.match(/\.(png|jpe?g|webp|gif)(\?|$)/i);
  return m ? `.${m[1].toLowerCase()}` : ".png";
}

// Tidy up the quirks Docs leaves in text: stray non-breaking spaces, weird
// double-space runs, straight quotes where Docs already had curly ones, and
// zero-width characters it sometimes sprinkles around.
function normalizeGDocText(html) {
  return html
    .replace(/[\u200B-\u200D\uFEFF]/g, "")  // zero-width joiners/space
    .replace(/\u00A0/g, " ")                 // non-breaking → regular space
    .replace(/ {2,}/g, " ");
}

function convertGDocBlock(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.nodeValue.replace(/\s+/g, " ").trim();
    return t ? `<p>${escapeHtml(t)}</p>` : "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();

  // Google Docs maps heading levels to HEADING_1..HEADING_4 in HTML as h1-h4.
  // Our editor treats h2.rt-section-heading as the top-level magazine section
  // break, h3 as a subheading inside a section, h4 as a small eyebrow label.
  if (tag === "h1" || tag === "h2") {
    const inner = convertGDocInline(node);
    // Empty gap before a new section so it visually separates in the editor.
    return inner ? `<p><br/></p><h2 class="rt-section-heading">${inner}</h2>` : "";
  }
  if (tag === "h3") {
    const inner = convertGDocInline(node);
    return inner ? `<h3>${inner}</h3>` : "";
  }
  if (tag === "h4" || tag === "h5" || tag === "h6") {
    const inner = convertGDocInline(node);
    return inner ? `<h4>${inner}</h4>` : "";
  }
  if (tag === "ul" || tag === "ol") {
    const items = [];
    node.querySelectorAll(":scope > li").forEach((li) => {
      const inner = convertGDocInline(li);
      if (inner) items.push(`<li>${inner}</li>`);
    });
    return items.length ? `<${tag}>${items.join("")}</${tag}>` : "";
  }
  if (tag === "blockquote") {
    const inner = convertGDocInline(node);
    return inner ? `<figure class="rt-pullquote"><blockquote>${inner}</blockquote></figure>` : "";
  }
  if (tag === "hr") return `<hr class="rt-divider" />`;
  if (tag === "br") return "";
  if (tag === "table") {
    // Magazine doesn't style raw tables — flatten rows into paragraphs.
    const rows = [];
    node.querySelectorAll("tr").forEach((tr) => {
      const cells = [];
      tr.querySelectorAll("td, th").forEach((c) => {
        const t = convertGDocInline(c);
        if (t) cells.push(t);
      });
      if (cells.length) rows.push(`<p>${cells.join(" · ")}</p>`);
    });
    return rows.join("\n");
  }
  if (tag === "figure") {
    // Word/mammoth sometimes wraps images in <figure>. Dive in for the <img>
    // and any <figcaption>.
    const img = node.querySelector("img");
    const cap = node.querySelector("figcaption");
    if (img) {
      const src = img.getAttribute("src") || "";
      if (!src) return "";
      const alt = img.getAttribute("alt") || "";
      const captionHtml = cap ? `<figcaption><span class="fig-caption-text">${escapeHtml(cap.textContent.trim())}</span></figcaption>` : "";
      return `<figure class="rt-figure rt-size-standard" contenteditable="false" data-rt-figure="image"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />${captionHtml}</figure>`;
    }
    return "";
  }
  if (tag === "img") {
    const src = node.getAttribute("src") || "";
    if (!src) return "";
    const alt = node.getAttribute("alt") || "";
    return `<figure class="rt-figure rt-size-standard" contenteditable="false" data-rt-figure="image"><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" /></figure>`;
  }
  if (tag === "p" || tag === "div") {
    // If the paragraph is just an image (Docs loves to wrap <img> in <p>),
    // hoist it to a figure block.
    const onlyImg = node.children.length === 1 && node.children[0].tagName.toLowerCase() === "img" && !node.textContent.trim();
    if (onlyImg) {
      return convertGDocBlock(node.children[0]);
    }
    // Docs sometimes wraps a heading inside a <p>; if the paragraph has a
    // single heading-ish child, recurse.
    if (node.children.length === 1 && /^h[1-6]$/i.test(node.children[0].tagName)) {
      return convertGDocBlock(node.children[0]);
    }
    const inner = convertGDocInline(node);
    if (!inner) return `<p><br/></p>`;
    return `<p>${inner}</p>`;
  }
  // Unknown element — recurse into children so we don't drop content.
  const parts = [];
  node.childNodes.forEach((child) => {
    const b = convertGDocBlock(child);
    if (b) parts.push(b);
  });
  return parts.join("\n");
}

// Convert inline runs inside a block. Looks at the element's inline style as
// well as the tag name — Google Docs encodes bold/italic via
// `font-weight: 700` and `font-style: italic` on <span>s rather than <b>/<i>.
function convertGDocInline(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.nodeValue);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "<br/>";

  // Inline image (rare — Docs almost always wraps img in a <p>), preserve it
  // so the block-level pass picks it up when we walk the paragraph again.
  if (tag === "img") {
    const src = node.getAttribute("src") || "";
    if (!src) return "";
    return `<img src="${escapeAttr(src)}" alt="${escapeAttr(node.getAttribute("alt") || "")}" />`;
  }

  // Recurse through children first, then wrap based on this element's styling.
  let inner = "";
  node.childNodes.forEach((child) => { inner += convertGDocInline(child); });
  if (!inner) return "";

  if (tag === "a") {
    let href = node.getAttribute("href") || "";
    // Docs wraps external links in a redirect: https://www.google.com/url?q=REAL&sa=…
    try {
      if (href.startsWith("https://www.google.com/url")) {
        const u = new URL(href);
        const real = u.searchParams.get("q");
        if (real) href = real;
      }
    } catch { /* leave as-is */ }
    if (!href) return inner;
    return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener">${inner}</a>`;
  }

  // Sub/superscript — useful for footnote markers and scientific notation.
  if (tag === "sup") return `<sup>${inner}</sup>`;
  if (tag === "sub") return `<sub>${inner}</sub>`;

  const style = (node.getAttribute("style") || "").toLowerCase();
  const weight = (style.match(/font-weight:\s*(\d+|bold|bolder)/) || [])[1];
  const vAlign = (style.match(/vertical-align:\s*([a-z-]+)/) || [])[1];
  const isBold = tag === "b" || tag === "strong" || weight === "bold" || weight === "bolder" || (weight && parseInt(weight, 10) >= 600);
  const isItalic = tag === "i" || tag === "em" || /font-style:\s*italic/.test(style);
  const isUnderline = tag === "u" || /text-decoration[^;]*underline/.test(style);
  const isStrike = tag === "s" || tag === "strike" || tag === "del" || /text-decoration[^;]*line-through/.test(style);
  const isSuper = vAlign === "super";
  const isSub = vAlign === "sub";

  let out = inner;
  if (isBold)      out = `<strong>${out}</strong>`;
  if (isItalic)    out = `<em>${out}</em>`;
  if (isUnderline) out = `<u>${out}</u>`;
  if (isStrike)    out = `<s>${out}</s>`;
  if (isSuper)     out = `<sup>${out}</sup>`;
  if (isSub)       out = `<sub>${out}</sub>`;
  return out;
}

// ===== Article preview ======================================================
// Opens a new tab showing the draft as readers will see it on the live site.
// We reuse the public site's stylesheets (css/styles.css + article-premium.css)
// and mount the same `.article-detail` structure that js/main.js produces, so
// the writer sees a true-to-life preview without needing to publish.
function openArticlePreview(wrap, ctx) {
  const rawBody = wrap.querySelector("#f-body").innerHTML
    .replace(/<mark class="sx-mark[^"]*"[^>]*>([\s\S]*?)<\/mark>/g, "$1");
  return openArticlePreviewFromData({
    title: (wrap.querySelector("#f-title").textContent || "").trim(),
    dek: (wrap.querySelector("#f-dek").textContent || "").trim(),
    cover: wrap.querySelector("#f-cover").value.trim(),
    lightCover: !!wrap.querySelector("#f-cover-light")?.checked,
    category: wrap.querySelector("#f-category").value || "Feature",
    author: ctx.profile?.name || ctx.user?.email || "The Catalyst",
    bodyHtml: rawBody,
    bodyText: (wrap.querySelector("#f-body").textContent || ""),
  }, ctx);
}

// Data-driven twin of openArticlePreview — admin edits don't have the writer's
// compose form, so they build a data object from the details modal and call
// this directly. Kept as a separate function so the writer path stays identical.
export function openArticlePreviewFromData(data, ctx) {
  const title = (data.title || "").trim() || "Untitled draft";
  const dek = (data.dek || "").trim();
  const cover = (data.cover || "").trim();
  const lightCover = !!data.lightCover;
  const category = data.category || "Feature";
  const author = data.author || "The Catalyst";
  const bodyHtml = data.bodyHtml || "";
  const publishedDate = data.publishedDate instanceof Date && !isNaN(data.publishedDate)
    ? data.publishedDate : new Date();

  // Reading time mirrors the public-site estimator: 220 wpm against the body.
  const bodyText = data.bodyText != null
    ? String(data.bodyText)
    : (bodyHtml ? bodyHtml.replace(/<[^>]+>/g, " ") : "");
  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = `${Math.max(1, Math.round(wordCount / 220))} min read`;
  const todayStr = publishedDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const initials = author.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  // Resolve the absolute origin so preview stylesheets, fonts, and the quiz
  // template all load from the live site instead of about:srcdoc.
  const origin = window.location.origin;
  const heroBg = cover || `${origin}/NewLogoShape.png`;

  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Preview · ${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+Pro:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${origin}/css/styles.css">
<link rel="stylesheet" href="${origin}/css/article-premium.css">
<style>
  body { background: var(--canvas, #fafafa); }
  .preview-banner {
    position: sticky; top: 0; z-index: 1000;
    background: #0b1220; color: #fff;
    padding: 10px 20px; text-align: center;
    font: 600 13px/1.4 Inter, system-ui, sans-serif;
    letter-spacing: 0.04em;
  }
  .preview-banner span { opacity: 0.7; font-weight: 400; margin-left: 10px; }
  main { padding-top: 0; }
  .article-page { padding: 40px 24px 80px; }
  .article-page .container { max-width: 1100px; margin: 0 auto; }
</style>
</head>
<body data-page="article">
  <div class="preview-banner">PREVIEW MODE <span>This is how your article will appear when published.</span></div>
  <main>
    <section class="article-page">
      <div class="container">
        <div class="article-detail">
          <header class="article-hero${lightCover ? ' article-hero--light-cover' : ''}">
            <div class="article-hero__image" style="background-image:url('${escAttrJs(heroBg)}')"></div>
            <div class="article-hero__inner">
              <div class="article-hero__surface">
                <span class="article-hero__category">${esc(category)}</span>
                <h1 class="article-hero__title">${esc(title)}</h1>
                ${dek ? `<p class="article-hero__deck">${esc(dek)}</p>` : ""}
                <div class="article-hero__meta">
                  <span>By <strong>${esc(author)}</strong></span>
                  <span class="dot"></span>
                  <span>${esc(todayStr)}</span>
                  <span class="dot"></span>
                  <span class="reading-time">${esc(readingTime)}</span>
                </div>
              </div>
            </div>
          </header>
          <div class="article-body-wrap">
            <article class="article-body" id="preview-article-body">${bodyHtml}</article>
            <aside class="article-byline">
              <div class="article-byline__avatar">${esc(initials || "TC")}</div>
              <div>
                <div class="article-byline__name">${esc(author)}</div>
                <div class="article-byline__role">Contributing writer · The Catalyst Magazine</div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  </main>
  <script>
    // Inline-hydrate any quiz figures using the same template + substitution
    // logic as the public article page. We can't import main.js here because
    // its module entry-point pulls in the full site router; instead we reuse
    // the same template fetch and placeholder-swap.
    (function () {
      const ORIGIN = ${JSON.stringify(origin)};
      function decodeQuiz(raw) {
        try { return JSON.parse(decodeURIComponent(escape(atob(raw)))); }
        catch (e) { return null; }
      }
      function esc(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      function renderGameHtml(template, data) {
        const powers = ['double', 'fire', 'both'];
        const questions = (data.questions || []).map(function (q, i) {
          const correctIdx = Math.max(0, Math.min(q.correct, (q.options || []).length - 1));
          return {
            qID: i,
            q: q.prompt,
            options: (q.options || []).map(function (text, oi) { return { text: text, correct: oi === correctIdx }; }),
            feedbackCorrect: q.feedbackCorrect || '✅ Correct!',
            feedbackIncorrect: q.feedbackIncorrect || '❌ Not quite — give it another look.',
            power: powers[i % powers.length]
          };
        });
        const json = JSON.stringify(questions, null, 2);
        return template
          .replace(/__GAME_TITLE__/g, esc(data.title || 'Knowledge quiz'))
          .replace(/__GAME_INTRO__/g, esc(data.intro || 'Test your knowledge of the article.'))
          .replace('/*__QUESTIONS_JSON__*/[]', json);
      }
      const figures = document.querySelectorAll('figure.rt-quiz[data-quiz]');
      if (!figures.length) return;
      fetch(ORIGIN + '/posts/games/_template.html').then(function (res) {
        if (!res.ok) throw new Error('template ' + res.status);
        return res.text();
      }).then(function (template) {
        figures.forEach(function (figure) {
          const data = decodeQuiz(figure.getAttribute('data-quiz') || '');
          if (!data || !Array.isArray(data.questions) || !data.questions.length) return;
          const wrap = document.createElement('div');
          wrap.className = 'article-block article-quiz';
          const iframe = document.createElement('iframe');
          iframe.className = 'article-quiz-frame';
          iframe.title = data.title || 'Interactive quiz';
          iframe.setAttribute('allow', 'fullscreen');
          iframe.srcdoc = renderGameHtml(template, data);
          wrap.appendChild(iframe);
          figure.replaceWith(wrap);
        });
      }).catch(function (err) { console.warn('preview quiz hydration failed', err); });
    })();
  </script>
</body>
</html>`;

  // Open a fresh window and write the document. Using a Blob URL (rather than
  // document.write) keeps the new tab's history clean and avoids the deprecated
  // open + write pattern that some browsers warn about.
  const blob = new Blob([doc], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    ctx?.toast?.("Allow pop-ups for this site to see the preview.", "error");
    URL.revokeObjectURL(url);
    return;
  }
  // Revoke the URL once the new tab has had time to fetch it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Small helper used by openArticlePreview when the value is going into a
// JS string in the inlined preview document. Mirrors escapeAttr but allows
// embedding directly into a quoted style attribute or JS string.
function escAttrJs(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, " ");
}

// ===== Format guide =========================================================
function openEditorialStandards() {
  const url = new URL("/admin/#/writer/guidelines", window.location.origin).toString();
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    toast("Allow pop-ups for this site to open the editorial standards.", "error");
  }
}

// Opens a new tab showing a fully-formatted example article. The example uses
// the same stylesheets as a real published article (css/styles.css +
// article-premium.css) so what the writer sees here is literally how their
// article will look — modeled after CNN / NYT magazine layouts.
// Each block has a labeled callout on the left explaining what it is and
// how to insert it from the toolbar.
function openFormatGuide() {
  const origin = window.location.origin;
  const heroBg = "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1800&q=80";
  const inlineImg = "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1600&q=80";
  const sideImg = "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80";

  // Each block in the example is tagged with data-guide="…" and a human label
  // via data-guide-label. A small CSS pass then draws a gutter annotation to
  // the left of each block with the label — exactly like a museum placard.
  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>How to format a Catalyst article</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+Pro:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${origin}/css/styles.css">
<link rel="stylesheet" href="${origin}/css/article-premium.css">
<style>
  body { background: var(--canvas, #fafafa); }
  .guide-banner {
    position: sticky; top: 0; z-index: 1000;
    background: linear-gradient(90deg,#0b1220,#1f2a44);
    color: #fff;
    padding: 14px 22px;
    font: 600 13px/1.4 Inter, system-ui, sans-serif;
    letter-spacing: 0.04em;
    display: flex; align-items: center; gap: 14px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  }
  .guide-banner .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; flex: 0 0 auto; box-shadow: 0 0 0 4px rgba(34,197,94,0.2); }
  .guide-banner strong { font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .guide-banner span { opacity: 0.75; font-weight: 400; }
  .guide-banner button {
    margin-left: auto;
    background: rgba(255,255,255,0.12); color: #fff;
    border: 1px solid rgba(255,255,255,0.25);
    padding: 7px 14px; border-radius: 8px;
    font: 600 12px/1 Inter, system-ui, sans-serif;
    letter-spacing: 0.06em; text-transform: uppercase;
    cursor: pointer;
  }
  .guide-banner button:hover { background: rgba(255,255,255,0.2); }

  main { padding-top: 0; }
  .article-page { padding: 40px 24px 100px; }
  .article-page .container { max-width: 1280px; margin: 0 auto; }

  /* Left-gutter annotations — show what each block is called and how to
     insert it. On desktop the callout floats to the left of the article
     in a single card (label + detail stacked inside one ::before so the
     detail always sits right under the label, regardless of how tall the
     annotated block is). On narrower screens the callout stacks above
     each block so nothing gets clipped. */
  .guide-annotation { position: relative; }
  .guide-annotation::before {
    content: attr(data-guide-label);
    position: absolute;
    left: -252px;
    top: -4px;
    width: 230px;
    font: 700 11px/1.5 Inter, system-ui, sans-serif;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #2563eb;
    padding: 10px 14px 6px;
    background: #eff6ff;
    border-left: 3px solid #2563eb;
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
    box-shadow: 0 1px 2px rgba(15,23,42,0.05);
  }
  .guide-annotation::after {
    content: attr(data-guide-detail);
    position: absolute;
    left: -252px;
    top: 34px;
    width: 230px;
    font: 400 12px/1.55 Inter, system-ui, sans-serif;
    color: #475569;
    padding: 0 14px 12px;
    background: #eff6ff;
    border-left: 3px solid #2563eb;
    border-bottom-left-radius: 4px;
    border-bottom-right-radius: 4px;
    box-shadow: 0 1px 2px rgba(15,23,42,0.05);
  }
  /* Short blocks like the divider need reserved vertical space so the
     absolutely-positioned callout doesn't overlap whatever block follows. */
  .guide-divider-wrap { min-height: 120px; margin: 28px 0; }
  .guide-divider-wrap hr { margin: 0; }

  @media (max-width: 1200px) {
    .guide-annotation::before,
    .guide-annotation::after {
      position: static;
      display: block;
      width: auto;
      max-width: 720px;
      margin: 0 auto;
      left: auto;
      top: auto;
      box-shadow: none;
    }
    .guide-annotation::before { margin-top: 10px; border-top-right-radius: 4px; }
    .guide-annotation::after { margin-bottom: 14px; }
    .guide-divider-wrap { min-height: 0; }
  }
</style>
</head>
<body data-page="article">
  <div class="guide-banner">
    <span class="dot"></span>
    <strong>Formatting guide</strong>
    <span>This is what a professionally formatted Catalyst article looks like. Match this structure in your own piece.</span>
    <button onclick="window.close()">Close</button>
  </div>
  <main>
    <section class="article-page">
      <div class="container">
        <div class="article-detail">
          <header class="article-hero guide-annotation"
            data-guide-label="① Hero"
            data-guide-detail="Cover image + category + headline + deck. Set these from the Settings drawer and the title/subtitle fields above the body.">
            <div class="article-hero__image" style="background-image:url('${heroBg}')"></div>
            <div class="article-hero__inner">
              <div class="article-hero__surface">
                <span class="article-hero__category">Feature</span>
                <h1 class="article-hero__title">The Quiet Revolution Inside Your Cells</h1>
                <p class="article-hero__deck">A new generation of researchers is rewriting what we thought we knew about cellular memory — and the implications reach far beyond the lab.</p>
                <div class="article-hero__meta">
                  <span>By <strong>Example Writer</strong></span>
                  <span class="dot"></span>
                  <span>Apr 18, 2026</span>
                  <span class="dot"></span>
                  <span class="reading-time">6 min read</span>
                </div>
              </div>
            </div>
          </header>

          <div class="article-body-wrap">
            <article class="article-body">

              <p class="guide-annotation"
                data-guide-label="② Opening paragraph"
                data-guide-detail="The first paragraph gets an automatic drop-cap. Open with a specific scene, detail, or question — not a summary. This is your hook.">
                It was just past midnight in the basement lab when the cell lit up. For Dr. Lina Ortega, who had spent four years chasing a single blue flicker on a microscope screen, the glow meant everything — proof that a dying cell could be coaxed, briefly, to remember.
              </p>

              <p>That flicker, captured on February 14th in a cramped corner of the Weill Institute, may sound like a small result. But to researchers working at the edge of cellular biology, it is a kind of earthquake. For decades, the conventional wisdom held that memory lived strictly in neurons. Ortega's work — and a growing body of research behind it — suggests otherwise.</p>

              <h2 class="rt-section-heading guide-annotation"
                data-guide-label="③ Section heading"
                data-guide-detail="Use these to break your article into 2–4 movements. Click 'New section' in the toolbar to insert one with a heading + paragraph.">What the cells were telling us</h2>

              <p>The first hint came from an unassuming experiment. When Ortega exposed a line of skin cells to a specific chemical signal and then re-exposed them weeks later, the cells responded <em>faster</em> the second time — as if they had been waiting for it. Something had shifted inside them. Something had stuck.</p>

              <p>"It looked like the cells were learning," Ortega said. "And that's a word we do not throw around casually in this field."</p>

              <figure class="guide-annotation"
                data-guide-label="④ Inline image"
                data-guide-detail="Click the image button in the toolbar. Upload or paste a URL. You can add a caption — add ' — Credit' after the caption text to credit the source.">
                <img src="${inlineImg}" alt="A microscope lab" loading="lazy" />
                <figcaption><span class="fig-caption-text">A late-night session at Weill's cellular imaging bay.</span><span class="fig-caption-credit">Photo — Catalyst Magazine</span></figcaption>
              </figure>

              <p>The finding sits on a foundation laid by quieter work throughout the last decade. In 2019, a team in Kyoto showed that cell membranes could retain structural "echoes" of past stressors. In 2022, researchers in Toronto demonstrated that even bacteria could, in a crude sense, anticipate environments. Each paper was interesting on its own. Taken together, they start to form a pattern.</p>

              <figure class="rt-pullquote guide-annotation"
                data-guide-label="⑤ Pull-quote"
                data-guide-detail="Use the quote icon in the toolbar. Pull-quotes highlight a single, powerful line — use them sparingly, once or twice per article.">
                <blockquote>If cells can remember, the boundary between biology and computation gets much blurrier than anyone wants to admit.</blockquote>
                <figcaption>— Dr. Lina Ortega, Weill Institute</figcaption>
              </figure>

              <h2 class="rt-section-heading">Why this matters beyond the lab</h2>

              <p>The implications reach past pure biology. If cellular memory is real and durable, pharmacologists gain a new handle on chronic disease — the body's own recorded history of exposures could become a target. Ethicists raise different questions: what does it mean for a tissue to "remember" trauma? And what are we transplanting when we transplant cells?</p>

              <ul class="guide-annotation"
                data-guide-label="⑥ Bulleted list"
                data-guide-detail="Use the list buttons in the toolbar. Lists are good for enumerating distinct items — but avoid relying on them as a replacement for strong paragraphs.">
                <li><strong>Chronic-disease research</strong> could target the cellular record of past inflammation, not just the current flare-up.</li>
                <li><strong>Organ transplantation</strong> may need to account for the "history" a donated tissue carries with it.</li>
                <li><strong>Developmental biology</strong> has to grapple with the idea that early-life exposures might echo decades later at the cellular level.</li>
              </ul>

              <div class="guide-annotation guide-divider-wrap"
                data-guide-label="⑦ Divider"
                data-guide-detail="Use the divider button to mark a major transition — a new chapter of your argument, a time jump, or a shift in subject. Use sparingly.">
                <hr class="rt-divider" />
              </div>

              <h2 class="rt-section-heading">The skeptics' case</h2>

              <p>Not everyone is convinced. Dr. Rafael Chen, a cell biologist at Stanford who reviewed Ortega's pre-print, pushed back on the framing. "We have to be careful with the word <em>memory</em>," he said. "What we are seeing could be explained by simpler mechanisms — chromatin state, metabolic priming — that we already have names for. Calling it memory is marketing, not science."</p>

              <p>Ortega takes the critique in stride. "Rafael is right that we need more replication," she said. "But dismissing the language is a way of pretending we already understand the phenomenon. We don't. That's why we're studying it."</p>

              <p>Chen's lab is now running its own version of the experiment. Results are expected by the end of the year.</p>

              <figure class="guide-annotation"
                data-guide-label="⑧ Image with wider size"
                data-guide-detail="When you click an image, a dialog lets you change its size (standard / wide / full) and caption. Use wider sizes sparingly for moments of visual emphasis.">
                <img src="${sideImg}" alt="Abstract visualization" loading="lazy" />
                <figcaption><span class="fig-caption-text">Data visualization of membrane-state echoes across 48 hours.</span><span class="fig-caption-credit">Illustration — Catalyst Magazine</span></figcaption>
              </figure>

              <h2 class="rt-section-heading">What comes next</h2>

              <p>For now, the work continues at the pace that science actually moves: slowly, with long silences between breakthroughs. Ortega's lab has two more papers in the pipeline. Chen's results will either complicate or confirm the picture. Either way, the flicker at midnight is no longer just a quirk on a screen.</p>

              <p class="guide-annotation"
                data-guide-label="⑨ Closing"
                data-guide-detail="Land it. End with a callback to your opening, a forward-looking implication, or the sharpest line you've saved for last. Don't trail off.">
                "The cells aren't telling us what we want to hear yet," Ortega said. "They're telling us something harder — that we've been asking the wrong questions. We have to get better at listening."
              </p>

            </article>

            <aside class="article-byline">
              <div class="article-byline__avatar">EW</div>
              <div>
                <div class="article-byline__name">Example Writer</div>
                <div class="article-byline__role">Contributing writer · The Catalyst Magazine</div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;

  const blob = new Blob([doc], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    alert("Please allow popups to see the format guide.");
    URL.revokeObjectURL(url);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ===== Quiz dialog ==========================================================
// Lets a writer add a 3-question knowledge quiz that renders at the end of the
// article as the same retro-arcade "Neuro Dash" mini-game used elsewhere in
// the magazine. The quiz data is base64-encoded JSON parked on a non-editable
// <figure class="rt-quiz" data-quiz="…"> block. At render time the public
// article page (js/main.js) loads the game template and embeds the game in an
// iframe at that figure's position.
function openQuizDialog(editorEl, ctx, existingFigure = null) {
  const isEdit = !!existingFigure;

  let initial = {
    title: "",
    intro: "",
    questions: defaultQuizQuestions(),
  };
  if (isEdit) {
    try {
      const raw = existingFigure.getAttribute("data-quiz") || "";
      const parsed = decodeQuizData(raw);
      if (parsed && Array.isArray(parsed.questions) && parsed.questions.length === 3) {
        initial = {
          title: parsed.title || "",
          intro: parsed.intro || "",
          questions: parsed.questions,
        };
      }
    } catch { /* fall back to defaults */ }
  }

  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog quiz-dialog", style: { maxWidth: "760px" } });
  modal.innerHTML = `
    <div class="media-dialog-head">
      <div class="media-dialog-title">${isEdit ? "Edit" : "Add"} interactive quiz game</div>
      <button class="media-dialog-close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="media-dialog-body">
      <div class="hint" style="margin-bottom:14px;">
        Add a 3-question retro arcade mini-game to the end of your article.
        Readers run, jump, and collect coins while answering your questions to
        unlock the goal portal.
      </div>
      <div class="field">
        <label class="label">Game title</label>
        <input class="input" id="qz-title" placeholder='e.g. "Neuro Dash: Unfolding the Mystery"' value="${escapeAttr(initial.title || "")}" />
      </div>
      <div class="field">
        <label class="label">Intro line (shown above the game)</label>
        <input class="input" id="qz-intro" placeholder='e.g. "🧠 Test your knowledge about misfolded proteins!"' value="${escapeAttr(initial.intro || "")}" />
      </div>
      <div id="qz-questions"></div>
      <div class="media-error" id="qz-error"></div>
    </div>
    <div class="media-dialog-foot">
      ${isEdit ? `<button class="btn btn-ghost btn-sm" id="qz-delete" style="color:var(--danger);margin-right:auto;">Remove quiz</button>` : ""}
      <button class="btn btn-ghost btn-sm" id="qz-cancel">Cancel</button>
      <button class="btn btn-accent btn-sm" id="qz-save">${isEdit ? "Save changes" : "Insert quiz"}</button>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.appendChild(modal);
  requestAnimationFrame(() => { scrim.classList.add("open"); modal.classList.add("open"); });

  const questionsEl = modal.querySelector("#qz-questions");
  const errorEl = modal.querySelector("#qz-error");

  // Render the 3 question cards. Each card has a prompt, 3 answer choices
  // (matches the canvas game's option modal which sizes for 3), a radio to
  // mark the correct one, and per-question feedback for both outcomes.
  initial.questions.slice(0, 3).forEach((q, qi) => {
    const card = el("div", { class: "quiz-q-card" });
    card.innerHTML = `
      <div class="quiz-q-head">Question ${qi + 1}</div>
      <div class="field">
        <label class="label">Prompt</label>
        <input class="input qz-q-prompt" data-qi="${qi}" placeholder="Ask a question about your article" value="${escapeAttr(q.prompt || "")}" />
      </div>
      <div class="field">
        <label class="label">Answer choices (pick the correct one with the radio)</label>
        <div class="quiz-options" data-qi="${qi}">
          ${[0, 1, 2].map((oi) => {
            const opt = q.options?.[oi] || "";
            const isCorrect = q.correct === oi;
            return `
              <label class="quiz-option-row">
                <input type="radio" name="qz-correct-${qi}" value="${oi}" ${isCorrect ? "checked" : ""} aria-label="Mark choice ${oi + 1} as correct" />
                <input class="input qz-q-option" data-qi="${qi}" data-oi="${oi}" placeholder="Choice ${oi + 1}" value="${escapeAttr(opt)}" />
              </label>`;
          }).join("")}
        </div>
      </div>
      <div class="field">
        <label class="label">Feedback when correct</label>
        <input class="input qz-q-fc" data-qi="${qi}" placeholder='e.g. "✅ Correct! Here\'s why…"' value="${escapeAttr(q.feedbackCorrect || "")}" />
      </div>
      <div class="field">
        <label class="label">Feedback when wrong</label>
        <input class="input qz-q-fi" data-qi="${qi}" placeholder='e.g. "❌ Not quite — the article explains…"' value="${escapeAttr(q.feedbackIncorrect || "")}" />
      </div>
    `;
    questionsEl.appendChild(card);
  });

  const close = () => {
    scrim.classList.remove("open");
    modal.classList.remove("open");
    setTimeout(() => { scrim.remove(); modal.remove(); }, 200);
  };
  modal.querySelector(".media-dialog-close").addEventListener("click", close);
  modal.querySelector("#qz-cancel").addEventListener("click", close);
  scrim.addEventListener("click", close);

  if (isEdit) {
    modal.querySelector("#qz-delete").addEventListener("click", () => {
      // Drop both the figure and the empty paragraph the editor parked after it.
      const after = existingFigure.nextElementSibling;
      existingFigure.remove();
      if (after && after.tagName === "P" && (after.textContent || "").trim() === "") after.remove();
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
      ctx?.toast?.("Quiz removed.", "success");
      close();
    });
  }

  modal.querySelector("#qz-save").addEventListener("click", () => {
    const title = (modal.querySelector("#qz-title").value || "").trim();
    const intro = (modal.querySelector("#qz-intro").value || "").trim();
    if (!title) { errorEl.textContent = "Please add a game title."; return; }

    const questions = [];
    for (let qi = 0; qi < 3; qi++) {
      const prompt = (modal.querySelector(`.qz-q-prompt[data-qi="${qi}"]`).value || "").trim();
      const options = [];
      for (let oi = 0; oi < 3; oi++) {
        const v = (modal.querySelector(`.qz-q-option[data-qi="${qi}"][data-oi="${oi}"]`).value || "").trim();
        if (v) options.push(v);
      }
      const correctRaw = modal.querySelector(`input[name="qz-correct-${qi}"]:checked`)?.value;
      const correct = correctRaw == null ? -1 : Number(correctRaw);
      const feedbackCorrect = (modal.querySelector(`.qz-q-fc[data-qi="${qi}"]`).value || "").trim();
      const feedbackIncorrect = (modal.querySelector(`.qz-q-fi[data-qi="${qi}"]`).value || "").trim();

      if (!prompt) { errorEl.textContent = `Question ${qi + 1} is missing a prompt.`; return; }
      if (options.length < 2) { errorEl.textContent = `Question ${qi + 1} needs at least 2 answer choices.`; return; }
      if (correct < 0 || correct >= options.length) {
        errorEl.textContent = `Question ${qi + 1}: pick which answer is correct (and make sure it's filled in).`;
        return;
      }
      questions.push({ prompt, options, correct, feedbackCorrect, feedbackIncorrect });
    }

    const data = { title, intro, questions };
    const figureHtml = renderQuizFigureHtml(data);

    if (isEdit) {
      existingFigure.outerHTML = figureHtml;
    } else {
      // Always append at the end — the article reads better with the game
      // sitting after the closing paragraph rather than mid-body.
      const wrapper = document.createElement("div");
      wrapper.innerHTML = figureHtml + `<p><br/></p>`;
      while (wrapper.firstChild) editorEl.appendChild(wrapper.firstChild);
    }
    editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    ctx?.toast?.(isEdit ? "Quiz updated." : "Quiz added to the end of your article.", "success");
    close();
  });
}

function defaultQuizQuestions() {
  return [
    { prompt: "", options: ["", "", ""], correct: 0, feedbackCorrect: "", feedbackIncorrect: "" },
    { prompt: "", options: ["", "", ""], correct: 0, feedbackCorrect: "", feedbackIncorrect: "" },
    { prompt: "", options: ["", "", ""], correct: 0, feedbackCorrect: "", feedbackIncorrect: "" },
  ];
}

function encodeQuizData(data) {
  // Base64 keeps the quiz JSON readable to our renderer but opaque to the
  // contenteditable rich-text engine, which would otherwise mangle quotes and
  // angle brackets in the data attribute as the writer types around the block.
  const json = JSON.stringify(data);
  return btoa(unescape(encodeURIComponent(json)));
}

function decodeQuizData(raw) {
  if (!raw) return null;
  try {
    const json = decodeURIComponent(escape(atob(raw)));
    return JSON.parse(json);
  } catch { return null; }
}

function renderQuizFigureHtml(data) {
  const encoded = encodeQuizData(data);
  const count = data.questions.length;
  const title = escapeHtml(data.title || "Knowledge quiz");
  const intro = escapeHtml(data.intro || "Test your knowledge of this article.");
  // The visible content is just an editor-side preview card. The public
  // article page replaces this with the actual game iframe at render time.
  return `<figure class="rt-quiz" contenteditable="false" data-rt-quiz="1" data-quiz="${escapeAttr(encoded)}">
    <div class="rt-quiz-card">
      <div class="rt-quiz-eyebrow">🎮 Interactive quiz game</div>
      <div class="rt-quiz-title">${title}</div>
      <div class="rt-quiz-intro">${intro}</div>
      <div class="rt-quiz-meta">${count} question${count === 1 ? "" : "s"} · readers play to unlock the goal · click to edit</div>
    </div>
  </figure>`;
}

// Fallback when the clipboard has no HTML (rare — plain text copy).
// Double newlines become paragraph breaks; single newlines become <br/>.
function plainTextToHtml(text) {
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

// Insert an <hr class="rt-divider"> as a top-level block in the editor,
// followed by an empty paragraph where the caret lands. Using execCommand
// to insert an <hr> tends to nest it inside the current paragraph and leave
// a stranded empty block above — this routes around that.
function insertDividerAtCaret(editorEl) {
  editorEl.focus();
  const sel = window.getSelection();
  const hr = document.createElement("hr");
  hr.className = "rt-divider";
  const after = document.createElement("p");
  after.innerHTML = "<br/>";
  // Find the top-level block inside the editor that contains the caret.
  let block = null;
  if (sel && sel.rangeCount && editorEl.contains(sel.anchorNode)) {
    let n = sel.anchorNode;
    while (n && n.parentNode !== editorEl) n = n.parentNode;
    block = n;
  }
  if (block && block !== editorEl) {
    block.after(hr);
    hr.after(after);
  } else {
    // No known caret inside a block — append to the end.
    editorEl.appendChild(hr);
    editorEl.appendChild(after);
  }
  // Place caret inside the new paragraph so the writer keeps typing below.
  const range = document.createRange();
  range.setStart(after, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  editorEl.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertBlockAtCaret(editorEl, html, savedRange = null) {
  editorEl.focus();
  const sel = window.getSelection();
  // If the caller captured a range before the dialog stole focus, restore it
  // so the new block lands where the writer's cursor actually was.
  if (savedRange && editorEl.contains(savedRange.startContainer)) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  } else if (!sel || sel.rangeCount === 0 || !editorEl.contains(sel.anchorNode)) {
    // No known position — append to end.
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  document.execCommand("insertHTML", false, html);
}

// Snapshot the editor's current selection so we can restore it after a modal
// has stolen focus. Returns a cloned Range (safe to hold) or null.
function captureEditorRange(editorEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.startContainer)) return null;
  return range.cloneRange();
}

// Split a writer's caption into main text + optional credit line.
// We recognize an em-dash (—), regular dash surrounded by spaces (" - "), or
// a vertical bar ("|") as the credit separator. Everything after is rendered
// in a small, letter-spaced, non-italic span styled by CSS.
function renderFigureCaption(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const match = text.match(/^(.*?)\s*(?:—|–| - | \| )\s*(.+)$/);
  if (match) {
    const main = match[1].trim();
    const credit = match[2].trim();
    return `<figcaption><span class="fig-caption-text">${escapeHtml(main)}</span><span class="fig-caption-credit">${escapeHtml(credit)}</span></figcaption>`;
  }
  return `<figcaption><span class="fig-caption-text">${escapeHtml(text)}</span></figcaption>`;
}

// ===== Media upload dialog (images + videos) ================================
// When `existingFigure` is passed, we edit it in place instead of inserting a
// new one — lets writers click an already-placed image/video to change its
// caption, alt text, or size. When `savedRange` is passed, the new figure is
// inserted at that exact caret position (the caller captured it before the
// dialog stole focus from the contenteditable).
function openMediaDialog(kind, editorEl, ctx, existingFigure = null, savedRange = null) {
  const isImage = kind === "image";
  const accept = isImage ? "image/*" : "video/*";
  const label = isImage ? "image" : "video";
  const isEdit = !!existingFigure;

  // Pull current values out of the figure so we can prefill the dialog.
  let initialUrl = "";
  let initialAlt = "";
  let initialCaption = "";
  let initialSize = "standard";
  if (isEdit) {
    const mediaEl = existingFigure.querySelector(isImage ? "img" : "video");
    initialUrl = mediaEl?.getAttribute("src") || "";
    initialAlt = (isImage ? mediaEl?.getAttribute("alt") : mediaEl?.getAttribute("aria-label")) || "";
    // Reconstruct the writer-facing caption (main — credit) from the split
    // spans. Falls back to the raw textContent for older figures that were
    // inserted before the split-span structure existed.
    const capEl = existingFigure.querySelector("figcaption");
    if (capEl) {
      const mainSpan = capEl.querySelector(".fig-caption-text");
      const creditSpan = capEl.querySelector(".fig-caption-credit");
      if (mainSpan || creditSpan) {
        const main = (mainSpan?.textContent || "").trim();
        const credit = (creditSpan?.textContent || "").trim();
        initialCaption = credit ? `${main} — ${credit}` : main;
      } else {
        initialCaption = capEl.textContent.trim();
      }
    }
    const sizeMatch = (existingFigure.className || "").match(/rt-size-(\w+)/);
    if (sizeMatch) initialSize = sizeMatch[1];
  }

  // Build the modal
  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog" });
  const sizeRadio = (value, title, detail) => `
    <label class="media-size-opt"><input type="radio" name="m-size" value="${value}" ${initialSize === value ? "checked" : ""}><span><strong>${title}</strong><em>${detail}</em></span></label>`;

  modal.innerHTML = `
    <div class="media-dialog-head">
      <div class="media-dialog-title">${isEdit ? "Edit" : "Insert"} ${label}</div>
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
        <div class="media-dropzone-title">${isEdit ? `Replace the ${label}` : `Drop a ${label} here`}, or <span class="link">browse your computer</span></div>
        <div class="media-dropzone-hint">${isImage ? "JPG, PNG, WebP, or GIF — up to 10 MB." : "MP4 or WebM — up to 100 MB."}</div>
        <input type="file" id="m-file" accept="${accept}" hidden />
      </div>

      <div class="media-or"><span>or</span></div>

      ${isImage ? `
      <div class="field">
        <button type="button" class="btn btn-secondary btn-sm" id="m-browse-library" style="width:100%;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          Choose from your image library
        </button>
      </div>` : ""}

      <div class="field">
        <label class="label" style="font-size:12px;">Or paste a URL</label>
        <input class="input" id="m-url" placeholder="https://…" value="${escapeAttr(initialUrl)}" />
      </div>

      <div class="field">
        <label class="label">${isImage ? "Alt text (for accessibility)" : "Caption / description"}</label>
        <input class="input" id="m-alt" placeholder="${isImage ? "Describe what's in the image" : "What's happening in this video"}" value="${escapeAttr(initialAlt)}" />
      </div>
      <div class="field">
        <label class="label">Caption (optional)</label>
        <input class="input" id="m-caption" placeholder='e.g. "Researchers review the sequencing data. — Photo: Jane Doe"' value="${escapeAttr(initialCaption)}" />
        <div class="hint" style="margin-top:6px;">Add a credit by writing it after an em-dash: <em>caption — credit</em>.</div>
      </div>
      ${isImage ? `
      <div class="field">
        <label class="label">Size</label>
        <div class="media-size-picker" role="radiogroup" aria-label="Image size">
          ${sizeRadio("small", "Small", "Inline thumb, ~320px")}
          ${sizeRadio("compact", "Compact", "Column width, ~520px")}
          ${sizeRadio("standard", "Standard", "Body width, ~720px")}
          ${sizeRadio("large", "Large", "Full-bleed, edge to edge")}
        </div>
      </div>` : ""}

      <div class="media-progress" id="m-progress" hidden>
        <div class="media-progress-bar"><span id="m-progress-fill"></span></div>
        <div class="media-progress-text" id="m-progress-text">Uploading… 0%</div>
      </div>

      <div class="media-error" id="m-error"></div>
    </div>
    <div class="media-dialog-foot">
      ${isEdit ? `<button class="btn btn-ghost btn-sm" id="m-delete" style="color:var(--danger);margin-right:auto;">Remove ${label}</button>` : ""}
      <button class="btn btn-ghost btn-sm" id="m-cancel">Cancel</button>
      <button class="btn btn-accent btn-sm" id="m-insert" ${isEdit ? "" : "disabled"}>${isEdit ? "Save changes" : "Insert"}</button>
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

  const libraryBtn = modal.querySelector("#m-browse-library");
  if (libraryBtn) {
    libraryBtn.addEventListener("click", () => {
      openImageLibraryPicker(ctx, (pickedUrl) => {
        resolvedUrl = pickedUrl;
        pendingFile = null;
        urlInput.value = pickedUrl;
        urlInput.disabled = false;
        drop.classList.add("has-file");
        progressWrap.hidden = true;
        errorEl.textContent = "";
        updateInsertState();
      });
    });
  }

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
    const size = isImage
      ? (modal.querySelector('input[name="m-size"]:checked')?.value || "standard")
      : null;

    // Build just the <figure>…</figure> (no trailing <p>) so an in-place edit
    // doesn't duplicate the empty paragraph that already follows the figure.
    const captionHtml = caption ? renderFigureCaption(caption) : "";
    const figureHtml = isImage
      ? `<figure class="rt-figure rt-size-${size}" contenteditable="false" data-rt-figure="image">
           <img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" />
           ${captionHtml}
         </figure>`
      : `<figure class="rt-figure rt-figure-video" contenteditable="false" data-rt-figure="video">
           <video src="${escapeAttr(url)}" controls playsinline preload="metadata"${alt ? ` aria-label="${escapeAttr(alt)}"` : ""}></video>
           ${captionHtml}
         </figure>`;

    if (isEdit) {
      // Replace the existing figure in place. Using outerHTML keeps the
      // surrounding text (and empty paragraph after) exactly as it was.
      existingFigure.outerHTML = figureHtml;
    } else {
      // New insert — use the caret position the toolbar captured before the
      // dialog opened, and add a blank paragraph so typing continues below.
      insertBlockAtCaret(editorEl, figureHtml + `<p><br/></p>`, savedRange);
    }
    editorEl.dispatchEvent(new Event("input", { bubbles: true }));
    close();
  });

  // Remove button (edit mode only) — deletes the figure from the article.
  const deleteBtn = modal.querySelector("#m-delete");
  if (deleteBtn && isEdit) {
    deleteBtn.addEventListener("click", () => {
      existingFigure.remove();
      editorEl.dispatchEvent(new Event("input", { bubbles: true }));
      close();
    });
  }
}

// ===== Image library picker =================================================
// Lists every image the current writer has previously uploaded (both inline
// figures and cover images go to the same path prefix) and lets them pick
// one to reuse. Called from the media dialog and the cover-image field.
export function openImageLibraryPicker(ctx, onPick) {
  const uid = ctx?.user?.uid;
  if (!uid) { ctx?.toast?.("Sign in to browse your library.", "error"); return; }

  const isAdmin = ctx?.role === "admin";
  const scrim = el("div", { class: "media-dialog-scrim" });
  const modal = el("div", { class: "media-dialog media-dialog-wide" });
  modal.innerHTML = `
    <div class="media-dialog-head">
      <div class="media-dialog-title">${isAdmin ? "Image library (all writers)" : "Your image library"}</div>
      <button class="media-dialog-close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="media-dialog-body">
      <div class="library-grid-toolbar">
        <div class="hint">${isAdmin
          ? "Every image uploaded by any writer. Click to reuse, or hover to delete."
          : "Click an image to use it. These are photos you've uploaded from any article."}</div>
        <div class="library-grid-count" id="lib-count"></div>
      </div>
      <div class="library-grid-scroll">
        <div id="lib-grid" class="library-grid">
          <div class="loading-state" style="grid-column:1/-1;"><div class="spinner"></div>Loading images…</div>
        </div>
      </div>
      <div class="media-error" id="lib-error"></div>
    </div>
    <div class="media-dialog-foot">
      <button class="btn btn-ghost btn-sm" id="lib-cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.appendChild(modal);
  requestAnimationFrame(() => { scrim.classList.add("open"); modal.classList.add("open"); });

  const close = () => {
    scrim.classList.remove("open");
    modal.classList.remove("open");
    setTimeout(() => { scrim.remove(); modal.remove(); }, 200);
  };
  modal.querySelector(".media-dialog-close").addEventListener("click", close);
  modal.querySelector("#lib-cancel").addEventListener("click", close);
  scrim.addEventListener("click", close);

  const grid = modal.querySelector("#lib-grid");
  const errorEl = modal.querySelector("#lib-error");
  const countEl = modal.querySelector("#lib-count");

  (async () => {
    try {
      const entries = await loadImageLibrary(isAdmin ? null : uid);
      if (!entries.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">No images yet. Upload one and it'll appear here next time.</div>`;
        countEl.textContent = "";
        return;
      }
      countEl.textContent = `${entries.length} image${entries.length === 1 ? "" : "s"}`;
      renderLibraryGrid(grid, entries, {
        allowDelete: isAdmin,
        onPick: (entry) => { onPick(entry.url); close(); },
        onDelete: async (entry, tile) => {
          const ok = await confirmDialog(
            "Delete this image? It will be removed from Firebase Storage, and any article referencing it will show a broken image.",
            { confirmText: "Delete", danger: true },
          );
          if (!ok) return;
          try {
            await deleteObject(entry.ref);
            tile.remove();
            const remaining = grid.querySelectorAll(".library-tile").length;
            countEl.textContent = remaining ? `${remaining} image${remaining === 1 ? "" : "s"}` : "";
            if (!remaining) {
              grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Library is empty.</div>`;
            }
            ctx?.toast?.("Image deleted.", "success");
          } catch (err) {
            ctx?.toast?.("Could not delete: " + (err?.message || err), "error");
          }
        },
      });
    } catch (err) {
      errorEl.textContent = "Could not load library: " + (err?.message || err);
      grid.innerHTML = "";
    }
  })();
}

// Load the image library entries. When `ownerUid` is passed we only list
// that user's folder; when null we walk every writer's folder (admin view).
export async function loadImageLibrary(ownerUid) {
  const rootPaths = ownerUid ? [`stories/${ownerUid}/images`] : await listAllUserImagePaths();
  const allEntries = [];
  for (const path of rootPaths) {
    try {
      const folderRef = storageRef(storage, path);
      const listing = await listAll(folderRef);
      const batch = await Promise.all(listing.items.map(async (item) => {
        try {
          const [url, meta] = await Promise.all([
            getDownloadURL(item),
            getMetadata(item).catch(() => null),
          ]);
          const updated = meta?.updated ? new Date(meta.updated).getTime() : 0;
          const ownerFromPath = item.fullPath.split("/")[1] || "";
          return {
            url,
            name: item.name,
            ref: item,
            fullPath: item.fullPath,
            owner: ownerFromPath,
            size: meta?.size || 0,
            contentType: meta?.contentType || "",
            updated,
          };
        } catch {
          return null;
        }
      }));
      batch.filter(Boolean).forEach((e) => allEntries.push(e));
    } catch (err) {
      console.warn("[image-library] skipping", path, err?.message || err);
    }
  }
  return allEntries.sort((a, b) => b.updated - a.updated);
}

// Enumerate every writer folder under `stories/`. Admin-only.
async function listAllUserImagePaths() {
  const root = storageRef(storage, "stories");
  const listing = await listAll(root);
  return listing.prefixes.map((p) => `${p.fullPath}/images`);
}

export function renderLibraryGrid(grid, entries, opts = {}) {
  const { allowDelete = false, onPick, onDelete, usageBadge } = opts;
  grid.innerHTML = "";
  entries.forEach((entry) => {
    const tile = el("button", { class: "library-tile", type: "button", title: "Click to use this image" });
    const metaLine = entry.owner ? shortenOwner(entry.owner) : "";
    let badgeHtml = "";
    if (usageBadge) {
      const status = usageBadge(entry); // "used" | "unused" | null
      if (status === "unused") {
        tile.classList.add("library-tile--unused");
        badgeHtml = `<span class="library-tile-badge library-tile-badge--unused" title="This image isn't referenced by any article — safe to delete.">Unused</span>`;
      } else if (status === "used") {
        badgeHtml = `<span class="library-tile-badge library-tile-badge--used" title="Referenced by at least one article.">Used</span>`;
      }
    }
    tile.innerHTML = `
      <img src="${escapeAttr(entry.url)}" alt="" loading="lazy" />
      ${badgeHtml}
      ${metaLine ? `<div class="library-tile-meta">${escapeHtml(metaLine)}</div>` : ""}
      ${allowDelete ? `<span class="library-tile-delete" role="button" aria-label="Delete image" title="Delete this image">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </span>` : ""}`;
    tile.addEventListener("click", (e) => {
      if (allowDelete && e.target.closest(".library-tile-delete")) {
        e.preventDefault();
        e.stopPropagation();
        onDelete && onDelete(entry, tile);
        return;
      }
      onPick && onPick(entry);
    });
    grid.appendChild(tile);
  });
}

function shortenOwner(uid) {
  if (!uid) return "";
  return uid.length > 10 ? `${uid.slice(0, 6)}…${uid.slice(-3)}` : uid;
}

// Content-hash-based upload. The storage path is derived from the file's
// SHA-256, so re-uploading the same image (even with a different filename)
// lands on the same object — automatic dedupe, no orphan copies.
export async function uploadToFirebase(file, kind, ctx, onProgress) {
  const uid = ctx?.user?.uid || "anonymous";
  const toUpload = kind === "image" ? await convertToWebp(file) : file;
  const hash = await hashFile(toUpload);
  const ext = extFromFile(toUpload);
  const path = `stories/${uid}/${kind}s/${hash}${ext}`;
  const ref = storageRef(storage, path);

  // If this exact file was already uploaded, reuse the existing object.
  try {
    await getMetadata(ref);
    onProgress && onProgress(100);
    const url = await getDownloadURL(ref);
    return url;
  } catch (err) {
    // Not found (object-not-found) — proceed with upload. Any other error
    // also falls through; the upload will surface the real problem.
  }

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

async function hashFile(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extFromFile(file) {
  const fromName = (file.name || "").match(/\.[a-z0-9]+$/i);
  if (fromName) return fromName[0].toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type === "image/webp") return ".webp";
  if (type === "image/png") return ".png";
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/gif") return ".gif";
  if (type === "video/mp4") return ".mp4";
  if (type === "video/webm") return ".webm";
  return "";
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
  const lightCoverCb = wrap.querySelector("#f-cover-light");
  const refreshLightCover = () => {
    article.classList.toggle("article--light-cover", !!lightCoverCb?.checked);
  };
  const refreshReadingTime = () => {
    const words = (body.textContent || "").trim().split(/\s+/).filter(Boolean).length;
    const mins = Math.max(1, Math.round(words / 220));
    readingTime.textContent = `${mins} min read`;
  };

  coverInput.addEventListener("input", refreshCover);
  categoryEl.addEventListener("change", refreshCategory);
  body.addEventListener("input", refreshReadingTime);
  if (lightCoverCb) lightCoverCb.addEventListener("change", refreshLightCover);
  refreshCover(); refreshCategory(); refreshReadingTime(); refreshLightCover();

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
  const libraryBtn = wrap.querySelector("#f-cover-library-btn");
  const fileInput = wrap.querySelector("#f-cover-file");
  const urlInput  = wrap.querySelector("#f-cover");
  const progress  = wrap.querySelector("#f-cover-progress");
  const fill      = wrap.querySelector("#f-cover-progress-fill");
  const text      = wrap.querySelector("#f-cover-progress-text");

  btn.addEventListener("click", () => fileInput.click());
  if (libraryBtn) {
    libraryBtn.addEventListener("click", () => {
      openImageLibraryPicker(ctx, (pickedUrl) => {
        urlInput.value = pickedUrl;
        urlInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  }
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { ctx.toast("Please choose an image file.", "error"); return; }
    if (file.size > 10 * 1024 * 1024) ctx.toast("Preparing large image…");

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
    const lightCoverCb = wrap.querySelector("#f-cover-light");
    if (lightCoverCb) {
      lightCoverCb.checked = !!d.lightCover;
      lightCoverCb.dispatchEvent(new Event("change", { bubbles: true }));
    }
    wrap.querySelector("#f-dek").textContent = d.dek || d.excerpt || "";
    const bodyEl = wrap.querySelector("#f-body");
    bodyEl.innerHTML = d.body || "";
    // Repair figures on reload: historical drafts (and older paste imports)
    // may be missing contenteditable="false" or the data-rt-figure flag, and
    // without those the click-to-edit handler can't match them. Also upgrade
    // any bare <img> that never got wrapped in a .rt-figure so writers can
    // edit size/alt/caption on old inline images too. Strip stale width/
    // height attrs that old Docs pastes persisted so CSS can size the image.
    stripInlineImgDimensions(bodyEl);
    upgradeLegacyImages(bodyEl);
    normalizeEditorFigures(bodyEl);
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
  const lightCover = !!wrap.querySelector("#f-cover-light")?.checked;
  const dek = (wrap.querySelector("#f-dek").textContent || "").trim();
  const bodyEl = wrap.querySelector("#f-body");
  const msg = wrap.querySelector("#form-msg");

  // Firestore rejects documents over 1 MB. An inline base64 image can easily
  // be 1–5 MB on its own, so if a paste/upload leaves any data: URIs in the
  // body we must ship them to Storage before writing the doc.
  try {
    await uploadInlineDataImages(bodyEl, ctx, (done, total) => {
      msg.textContent = `Uploading ${done}/${total} embedded image${total === 1 ? "" : "s"}…`;
    });
    msg.textContent = "";
  } catch (err) {
    msg.textContent = "Could not upload embedded images: " + (err?.message || err);
    ctx.toast("Couldn't upload embedded images. " + (err?.message || err), "error");
    return;
  }

  // Wrap any stray <img> in a figure and re-apply contenteditable="false" /
  // data-rt-figure on every figure, so the persisted HTML is clickable when
  // the draft is reopened. Strip any width/height attrs a paste left behind
  // so the saved HTML also renders cleanly on the public article page.
  stripInlineImgDimensions(bodyEl);
  upgradeLegacyImages(bodyEl);
  normalizeEditorFigures(bodyEl);

  // Strip any live suggestion marks before persisting — they're rendered on top, not saved.
  const body = bodyEl.innerHTML.replace(/<mark class="sx-mark[^"]*"[^>]*>([\s\S]*?)<\/mark>/g, "$1");
  const bodyText = bodyEl.textContent || "";

  // Last-resort guard: if anything is still a data: URI (upload genuinely
  // failed) the body is going to be too large for Firestore. Fail early with
  // a readable error instead of the cryptic "too many bytes" from the SDK.
  if (/src="data:/i.test(body)) {
    const failedCount = (body.match(/src="data:/gi) || []).length;
    msg.textContent = `Save blocked: ${failedCount} image${failedCount === 1 ? "" : "s"} couldn't upload to storage. Click each and use the editor's image tool to re-add them.`;
    ctx.toast("Can't save — some images are still inline. See the message above the toolbar.", "error");
    return;
  }
  if (body.length > 900_000) {
    msg.textContent = `Save blocked: body is ${(body.length/1024).toFixed(0)} KB — Firestore limits a single document to ~1 MB. Move some images into a follow-up draft, or contact an editor.`;
    ctx.toast("Article body is too large to save. Try splitting it.", "error");
    return;
  }

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
    title, category, coverImage, lightCover, dek, body,
    slug: slugify(title),
    writerChecklist,
    status: desiredStatus,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (editingId) {
      // Don't stamp author fields on updates — the doc already has them, and
      // overwriting here would clobber bylines on admin-imported drafts when
      // the admin opens them to tweak a cover image or field.
      await updateDoc(doc(db, "stories", editingId), payload);
      ctx.toast(desiredStatus === "pending" ? "Submitted for review." : "Draft saved.", "success");
    } else {
      payload.authorId = ctx.user.uid;
      payload.authorName = ctx.profile.name || ctx.user.email;
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
        ${a.status === "approved"
          ? `<a class="btn btn-accent btn-xs" href="#/final-review?id=${esc(d.id)}" title="Review how the article will look and publish it">Review &amp; publish</a>` : ""}
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
