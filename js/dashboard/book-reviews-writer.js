// js/dashboard/book-reviews-writer.js
// Writer-facing composer for book reviews.
//
// Why a separate module from writer.js?
//   • Book reviews need book-specific metadata (ISBN, rating, book author
//     separate from byline). Bolting these onto the regular draft form
//     would clutter every other category.
//   • A book review is short by design (a few paragraphs, no rich-media,
//     no quiz). A focused composer keeps it that way.
//   • The route is its own sidebar entry under Writing ("Write a book
//     review" + "My book reviews") so writers don't have to fish through
//     the general drafts list to find them.
//
// Mount keys:
//   • "write" → composer form (?edit=<storyId> to re-open a saved draft)
//   • "mine"  → writer's own list of book-review stories
//
// Saves directly to the Firestore `stories` collection — Firestore rules
// already enforce:
//   • authorId === request.auth.uid on create
//   • status in {draft, pending} on writer create/update
//   • only editors/admins can flip to "approved" or "published"
// So the regular publish pipeline (admin approves → final-review page)
// applies here exactly the same. No new server endpoint needed; no new
// trust boundary.

import { auth, db } from "../firebase-config.js";
import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, toast, confirmDialog, fmtRelative, fmtDate, slugify, statusPill } from "./ui.js";
import { uploadToFirebase } from "./writer.js";

export async function mount(ctx, container) {
  container.innerHTML = "";
  if (ctx.mountKey === "mine") return mountMine(ctx, container);
  return mountComposer(ctx, container);
}

// ============================================================
// COMPOSER
// ============================================================
async function mountComposer(ctx, container) {
  const params = new URLSearchParams((location.hash.split("?")[1] || ""));
  const editingId = params.get("edit") || null;

  // If we're editing, load the existing doc and confirm the caller is
  // allowed to (their own draft, or admin/editor). Firestore rules will
  // re-enforce on save; this is the friendly client-side gate.
  let initial = null;
  if (editingId) {
    try {
      const snap = await getDoc(doc(db, "stories", editingId));
      if (snap.exists()) {
        const d = snap.data();
        const mine = d.authorId === ctx.user.uid;
        const staff = ["admin", "editor"].includes(ctx.role);
        if (!mine && !staff) {
          container.innerHTML = `<div class="card"><div class="card-body empty-state">You don't have access to that book review.</div></div>`;
          return;
        }
        initial = { id: snap.id, ...d };
      }
    } catch (err) {
      container.innerHTML = `<div class="card"><div class="card-body error-state">${esc(err.message)}</div></div>`;
      return;
    }
  }

  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">${editingId ? "Edit book review" : "Write a book review"}</div>
        <div class="card-subtitle">
          A short, honest write-up on a STEM book. Saves as a draft; submit for review
          when you're ready and an editor will publish it to The Catalyst Reviews.
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <a class="btn btn-ghost btn-sm" href="#/book-reviews/mine">← My book reviews</a>
      </div>
    </div>
    <div class="card-body">
      <form class="brw-form" id="brw-form" novalidate>
        <div class="brw-grid">
          <div class="brw-field">
            <label class="label" for="brw-bookTitle">Book title <span class="req">*</span></label>
            <input class="input" id="brw-bookTitle" name="bookTitle" maxlength="200" required>
          </div>
          <div class="brw-field">
            <label class="label" for="brw-bookAuthor">Book author <span class="req">*</span></label>
            <input class="input" id="brw-bookAuthor" name="bookAuthor" maxlength="160" required>
          </div>

          <div class="brw-field">
            <label class="label" for="brw-isbn">ISBN</label>
            <input class="input" id="brw-isbn" name="isbn" inputmode="numeric" pattern="[0-9Xx\\- ]*" maxlength="32"
                   placeholder="978-0-…">
            <div class="hint">Optional. Lets us auto-fetch the cover later.</div>
          </div>
          <div class="brw-field">
            <label class="label" for="brw-rating-input">Your rating</label>
            <div class="brw-rating-slider" id="brw-rating-slider" data-value="0" role="group" aria-label="Your rating, on a 0 to 5 scale">
              <div class="brw-rating-slider-track" aria-hidden="true">
                <input type="range" class="brw-rating-slider-input" id="brw-rating-input"
                       min="0" max="5" step="0.1" value="0" aria-label="Slide to set your rating">
                <div class="brw-rating-slider-stars">
                  <div class="brw-rating-slider-stars-base"><span>★</span><span>★</span><span>★</span><span>★</span><span>★</span></div>
                  <div class="brw-rating-slider-stars-fill"><span>★</span><span>★</span><span>★</span><span>★</span><span>★</span></div>
                </div>
              </div>
              <div class="brw-rating-slider-value">— Optional —</div>
            </div>
            <span class="hint brw-rating-slider-flavor">Drag to set a rating from 0 to 5. Optional.</span>
            <input type="hidden" id="brw-rating" name="rating" value="">
          </div>

          <div class="brw-field brw-field-wide">
            <label class="label" for="brw-genre">Discipline <span class="req">*</span></label>
            <select class="select" id="brw-genre" name="genre" required>
              <option value="">— Pick the closest fit —</option>
              <option value="astronomy">Astronomy</option>
              <option value="biology">Biology</option>
              <option value="chemistry">Chemistry</option>
              <option value="climate">Climate</option>
              <option value="computer-science">Computer Science</option>
              <option value="mathematics">Mathematics</option>
              <option value="memoir">Memoir</option>
              <option value="physics">Physics</option>
              <option value="stem">Other STEM</option>
            </select>
            <div class="hint">Sorts the review onto the right shelf on The Catalyst Reviews.</div>
          </div>

          <div class="brw-field brw-field-wide">
            <label class="label" for="brw-coverImage">Cover image</label>
            <div class="cover-picker">
              <button type="button" class="btn btn-secondary btn-sm" id="brw-cover-upload-btn">Upload from computer</button>
              <input type="file" id="brw-cover-file" accept="image/*" hidden>
              <div class="cover-picker-progress" id="brw-cover-progress" hidden>
                <div class="cover-picker-progress-track"><div class="cover-picker-progress-fill" id="brw-cover-progress-fill"></div></div>
                <div class="cover-picker-progress-text" id="brw-cover-progress-text">Uploading…</div>
              </div>
            </div>
            <input class="input" id="brw-coverImage" name="coverImage" maxlength="2048"
                   placeholder="https://… or upload above" style="margin-top:10px;">
            <div class="hint">Upload an image or paste a direct URL. Uploading converts to WebP automatically.</div>
          </div>

          <div class="brw-field brw-field-wide">
            <label class="label" for="brw-deck">One-line summary <span class="req">*</span></label>
            <input class="input" id="brw-deck" name="deck" maxlength="220" required
                   placeholder="A one-sentence pitch — what makes this book worth reading.">
          </div>

          <div class="brw-field brw-field-wide">
            <label class="label" for="brw-body">Your review <span class="req">*</span></label>
            <div class="brw-editor">
              <div class="brw-toolbar" role="toolbar" aria-label="Formatting">
                <button type="button" class="brw-tb-btn" data-format="bold" title="Bold (Ctrl/Cmd+B)" aria-label="Bold"><strong>B</strong></button>
                <button type="button" class="brw-tb-btn" data-format="italic" title="Italic (Ctrl/Cmd+I)" aria-label="Italic"><em>I</em></button>
                <button type="button" class="brw-tb-btn" data-format="link" title="Link (Ctrl/Cmd+K)" aria-label="Link">Link</button>
                <button type="button" class="brw-tb-btn" data-format="quote" title="Block quote" aria-label="Block quote">&ldquo; &rdquo;</button>
              </div>
              <textarea class="textarea brw-textarea" id="brw-body" name="body" minlength="120" maxlength="8000" required
                        rows="14"
                        placeholder="A few paragraphs on what the book is about, what it does well, who it's for, and why it earned a spot on the shelf."></textarea>
            </div>
            <div class="hint">Separate paragraphs with a blank line. Use the toolbar (or <code>**bold**</code>, <code>*italic*</code>, <code>[text](url)</code>, <code>&gt; quote</code>) for formatting.</div>
          </div>
        </div>

        <div class="brw-error" id="brw-error" hidden></div>

        <div class="brw-actions">
          <button class="btn btn-secondary" type="button" id="brw-save-draft">Save draft</button>
          <button class="btn btn-accent" type="submit" id="brw-submit">Submit for review</button>
          ${editingId ? `<button class="btn btn-danger" type="button" id="brw-delete" style="margin-left:auto;">Delete draft</button>` : ""}
        </div>
      </form>
    </div>
  `;
  container.appendChild(card);

  // Wire the rating slider before prefill so we can drive it from the
  // initial value when editing. Sets up event listeners on the visible
  // range input and keeps the hidden #brw-rating in sync — the submit
  // handler still reads .value off that hidden input.
  const syncRatingSlider = wireRatingSlider(card);
  wireFormattingToolbar(card);

  // Prefill if editing
  if (initial) {
    card.querySelector("#brw-bookTitle").value  = initial.bookTitle || initial.title || "";
    card.querySelector("#brw-bookAuthor").value = initial.bookAuthor || "";
    card.querySelector("#brw-isbn").value       = initial.isbn || "";
    card.querySelector("#brw-rating").value     = initial.rating != null ? String(initial.rating) : "";
    card.querySelector("#brw-genre").value      = initial.genre || "";
    card.querySelector("#brw-coverImage").value = initial.coverImage || "";
    card.querySelector("#brw-deck").value       = initial.deck || initial.dek || initial.excerpt || "";
    card.querySelector("#brw-body").value       = bodyFromStory(initial);
    // Drive the slider's visual state from the hidden input we just set.
    if (initial.rating != null) syncRatingSlider(Number(initial.rating));
  }

  // ISBN auto-cover. When the writer leaves the ISBN field, probe
  // Open Library and (only if cover field is empty) fill it in. A small
  // preview thumbnail appears next to the ISBN field so the writer can
  // see what they're about to publish with.
  wireIsbnCoverLookup(card);
  wireCoverUpload(card, ctx);

  // Wire actions
  const errBox = card.querySelector("#brw-error");
  function showError(msg) { errBox.textContent = msg; errBox.hidden = false; errBox.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  function clearError()    { errBox.hidden = true; errBox.textContent = ""; }

  card.querySelector("#brw-save-draft").addEventListener("click", () => saveStory(ctx, card, editingId, "draft", showError, clearError));
  card.querySelector("#brw-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveStory(ctx, card, editingId, "pending", showError, clearError);
  });

  const delBtn = card.querySelector("#brw-delete");
  if (delBtn) {
    delBtn.addEventListener("click", async () => {
      const ok = await confirmDialog("Delete this book-review draft? This can't be undone.", { confirmText: "Delete", danger: true });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "stories", editingId));
        toast("Draft deleted.", "success");
        location.hash = "#/book-reviews/mine";
      } catch (err) {
        showError(err.message);
      }
    });
  }
}

// Pull paragraph text back out of the stored HTML body (if any) so the
// edit form shows the same plain text the writer typed in.
function bodyFromStory(story) {
  if (story.bodyPlain) return story.bodyPlain;
  if (!story.body && !story.content) return "";
  let html = String(story.body || story.content);
  // Convert inline formatting tags back to their markdown markers so the
  // textarea round-trips cleanly on edit. Order matters: strong/em first
  // (so their attributes don't interfere with anchor parsing), then
  // anchors, then blockquotes.
  html = html
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
      // Each paragraph or line inside becomes its own quoted line.
      const text = inner
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\/p\s*>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .trim();
      return text.split(/\n/).map((l) => l.trim() ? `> ${l}` : "").join("\n");
    });
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g,  "<")
    .replace(/&gt;/g,  ">")
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Convert plain text with markdown-light syntax into safe HTML for the
// story body. Supports: **bold**, *italic*, [text](url), and > quote at
// line start. Every HTML metachar is escaped FIRST so writer text can
// never become a real tag; then the markers are matched against the
// escaped string and replaced with real tags. URLs inside links are
// validated against an http/https/mailto allowlist.
function paragraphsToSafeHtml(text) {
  const escChar = (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]);
  const esc = (s) => String(s).replace(/[&<>"']/g, escChar);
  const isSafeUrl = (u) => /^(https?:\/\/|mailto:)/i.test(String(u).trim());

  // Apply inline markdown to an already-escaped string.
  function inline(s) {
    return s
      // Links — [text](url). Reject URLs that don't match the allowlist
      // (drop the link entirely, keep raw text).
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, txt, url) => {
        const decoded = url.replace(/&amp;/g, "&");
        if (!isSafeUrl(decoded)) return `${txt} (${url})`;
        return `<a href="${esc(decoded)}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
      })
      // Bold — **text**
      .replace(/\*\*([^*\n][^*\n]*?)\*\*/g, "<strong>$1</strong>")
      // Italic — *text* (after bold so we don't eat its delimiters)
      .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<em>$1</em>");
  }

  const blocks = String(text || "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split("\n");
    const allQuoted = lines.every((l) => /^>\s?/.test(l));
    if (allQuoted) {
      const inner = lines.map((l) => l.replace(/^>\s?/, "")).join("\n");
      const html = inline(esc(inner)).replace(/\n/g, "<br>");
      return `<blockquote><p>${html}</p></blockquote>`;
    }
    return `<p>${inline(esc(block)).replace(/\n/g, "<br>")}</p>`;
  }).join("\n");
}

async function saveStory(ctx, card, editingId, desiredStatus, showError, clearError) {
  clearError();

  const bookTitle  = card.querySelector("#brw-bookTitle").value.trim();
  const bookAuthor = card.querySelector("#brw-bookAuthor").value.trim();
  const isbnRaw    = card.querySelector("#brw-isbn").value.trim();
  const isbn       = isbnRaw.replace(/[^0-9Xx-]/g, "").slice(0, 32);
  const ratingRaw  = card.querySelector("#brw-rating").value;
  const genreRaw   = (card.querySelector("#brw-genre").value || "").trim().toLowerCase();
  const coverRaw   = card.querySelector("#brw-coverImage").value.trim();
  const deck       = card.querySelector("#brw-deck").value.trim();
  const bodyText   = card.querySelector("#brw-body").value;

  // Closed set mirrors the pill filter on /book-reviews so the discipline
  // we save here lines up with how the public page shelves it.
  const ALLOWED_GENRES = new Set([
    "astronomy","biology","chemistry","computer-science","physics",
    "mathematics","climate","memoir","stem",
  ]);
  const genre = ALLOWED_GENRES.has(genreRaw) ? genreRaw : "";

  // Required-field validation (Firestore rules re-validate)
  if (!bookTitle)  return showError("Book title is required.");
  if (!bookAuthor) return showError("Book author is required.");
  if (!genre && desiredStatus === "pending") {
    return showError("Pick a discipline before submitting for review.");
  }
  if (!deck)       return showError("A one-line summary is required.");
  if (!bodyText || bodyText.trim().length < 120) {
    return showError("Please write a few paragraphs about the book (at least ~120 characters).");
  }

  // Cover URL: only allow http(s) to keep javascript: / data: out of the body.
  let coverImage = "";
  if (coverRaw) {
    try {
      const u = new URL(coverRaw);
      if (u.protocol === "http:" || u.protocol === "https:") coverImage = u.toString();
      else return showError("Cover image URL must start with http:// or https://");
    } catch {
      return showError("Cover image URL is not a valid URL.");
    }
  }

  // Permanent cover upgrade. If the writer has an ISBN AND the current
  // cover URL is either empty or a low-res Open Library thumbnail, try
  // to fetch the high-res Google Books scan and store THAT instead.
  // This way the upgrade is persisted to Firestore and every future
  // visitor sees the high-res cover on first paint — no client probe
  // needed. Falls back silently to whatever we had if Google has no
  // record of the book.
  if (isbn) {
    const isLowResOpenLibrary = !coverImage ||
      /covers\.openlibrary\.org\/b\/isbn\//.test(coverImage);
    if (isLowResOpenLibrary) {
      try {
        const upgraded = await bestCoverForIsbn(isbn);
        // Only swap if Google returned a different (higher-res) URL.
        // bestCoverForIsbn can also return an Open Library URL when
        // Google has nothing — in that case we keep what's already in
        // the field (or use the Open Library URL if it was empty).
        if (upgraded && upgraded.indexOf("books.google.com") !== -1) {
          coverImage = upgraded;
        } else if (!coverImage && upgraded) {
          coverImage = upgraded;
        }
      } catch { /* network failure → keep existing coverImage */ }
    }
  }

  let rating = null;
  if (ratingRaw) {
    const n = Number(ratingRaw);
    if (Number.isFinite(n) && n >= 1 && n <= 5) rating = Math.round(n * 2) / 2;
  }

  const bodyHtml = paragraphsToSafeHtml(bodyText);

  // The "title" of the story is the book title (writers don't separately
  // name a book review). authorName is the writer's name (the byline).
  const payload = {
    title: bookTitle,
    bookTitle,
    bookAuthor,
    isbn,
    rating,
    genre,                           // shelved by the pill filter on /book-reviews
    category: "book-review",
    communityPick: false,            // writer authored, not a reader pick
    status: desiredStatus,           // "draft" or "pending"
    deck,
    dek: deck,
    excerpt: deck,
    body: bodyHtml,
    content: bodyHtml,
    bodyPlain: bodyText,             // preserve raw text for round-trip edits
    coverImage,
    image: coverImage,
    slug: slugify(`${bookTitle} review`),
    updatedAt: new Date().toISOString(),
  };

  try {
    let id = editingId;
    if (editingId) {
      await updateDoc(doc(db, "stories", editingId), payload);
    } else {
      payload.authorId   = ctx.user.uid;
      payload.authorName = ctx.profile?.name || ctx.user.email;
      payload.author     = ctx.profile?.name || ctx.user.email;
      payload.createdAt  = new Date().toISOString();
      const ref = await addDoc(collection(db, "stories"), payload);
      id = ref.id;
    }
    // Bust the public listing's session cache so /book-reviews shows the
    // new/updated story on the very next page load, not after the cache
    // naturally expires (sessionStorage lives for the tab's lifetime).
    bustStoriesCache();
    toast(desiredStatus === "pending" ? "Submitted for review." : "Draft saved.", "success");
    // Keep the writer on the page after first save by adding ?edit so a
    // second save updates the same doc instead of creating a duplicate.
    if (!editingId && id) {
      location.hash = `#/book-reviews/write?edit=${id}`;
    }
  } catch (err) {
    showError("Save failed: " + err.message);
  }
}

// Shared cache key with main.js / articles-new.js / book-reviews.js.
// Anywhere a story write happens that could affect /book-reviews or the
// main feeds, we clear this so the next page load fetches fresh from
// Firestore instead of serving a stale listing.
function bustStoriesCache() {
  try { sessionStorage.removeItem("catalyst_fs_cache_v5"); } catch {}
}

// ============================================================
// Cover image upload
// ============================================================
function wireCoverUpload(card, ctx) {
  const uploadBtn    = card.querySelector("#brw-cover-upload-btn");
  const fileInput    = card.querySelector("#brw-cover-file");
  const coverInput   = card.querySelector("#brw-coverImage");
  const progress     = card.querySelector("#brw-cover-progress");
  const progressFill = card.querySelector("#brw-cover-progress-fill");
  const progressText = card.querySelector("#brw-cover-progress-text");
  if (!uploadBtn || !fileInput || !coverInput) return;

  uploadBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Please choose an image file.", "error"); return; }

    progress.hidden = false;
    progressFill.style.width = "0%";
    progressText.textContent = "Preparing…";
    uploadBtn.disabled = true;

    try {
      const url = await uploadToFirebase(file, "image", ctx, (pct) => {
        progressFill.style.width = pct + "%";
        progressText.textContent = `Uploading… ${pct}%`;
      });
      coverInput.value = url;
      coverInput.dispatchEvent(new Event("input", { bubbles: true }));
      progressText.textContent = "Uploaded.";
      setTimeout(() => { progress.hidden = true; }, 800);
    } catch (err) {
      toast("Cover upload failed: " + (err?.message || err), "error");
      progress.hidden = true;
    } finally {
      uploadBtn.disabled = false;
      fileInput.value = "";
    }
  });
}

// ============================================================
// ISBN → cover auto-lookup (Open Library)
// Probes covers.openlibrary.org with ?default=false so a missing cover
// returns 404 instead of a 1x1 placeholder. Runs on blur of the ISBN
// field; never overwrites a cover URL the writer typed manually.
// ============================================================
function wireIsbnCoverLookup(card) {
  const isbnEl   = card.querySelector("#brw-isbn");
  const coverEl  = card.querySelector("#brw-coverImage");
  if (!isbnEl || !coverEl) return;

  // Insert a small preview / status chip below the ISBN field. Skipping
  // the cover field intentionally — writers may type their own URL there
  // and the chip would be visually duplicative.
  const status = document.createElement("div");
  status.className = "brw-isbn-status";
  status.innerHTML = `<span class="brw-isbn-status-text" hidden></span>`;
  isbnEl.parentElement.appendChild(status);
  const statusText = status.querySelector(".brw-isbn-status-text");

  let lastProbedIsbn = "";

  async function probe() {
    const raw = String(isbnEl.value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
    if (!raw) {
      statusText.hidden = true;
      return;
    }
    if (raw === lastProbedIsbn) return;
    lastProbedIsbn = raw;

    statusText.hidden = false;
    statusText.textContent = "Looking up cover…";
    statusText.className = "brw-isbn-status-text is-busy";

    try {
      const url = await bestCoverForIsbn(raw);

      if (!url) {
        statusText.textContent = "No cover found online for that ISBN. You can paste one manually above.";
        statusText.className = "brw-isbn-status-text is-empty";
        return;
      }

      const source = url.indexOf('books.google.com') !== -1 ? 'Google Books' : 'Open Library';

      // Don't trample a URL the writer typed manually.
      if (coverEl.value.trim()) {
        statusText.innerHTML = `High-res cover available from ${esc(source)} (<a href="${esc(url)}" target="_blank" rel="noopener">preview</a>) — clear the URL field if you want to use it.`;
        statusText.className = "brw-isbn-status-text is-ok";
        return;
      }
      coverEl.value = url;
      statusText.innerHTML = `<span>Cover loaded from ${esc(source)}</span>
        <img src="${esc(url)}" alt="" class="brw-isbn-thumb">`;
      statusText.className = "brw-isbn-status-text is-ok";
    } catch (err) {
      statusText.textContent = "Couldn't reach the cover lookup service. Try again or paste a URL manually.";
      statusText.className = "brw-isbn-status-text is-error";
    }
  }

  isbnEl.addEventListener("blur", probe);
  isbnEl.addEventListener("change", probe);
  // Paste fires before the value updates; defer to next tick.
  isbnEl.addEventListener("paste", () => setTimeout(probe, 0));
}

// ── ISBN → high-res cover URL ───────────────────────────────────────────
// Two sources tried in order:
//   1) Google Books API — gives 1000+ px scans; we strip zoom + edge=curl
//      so we get the original-resolution flat scan instead of a
//      page-curled thumbnail.
//   2) Open Library — capped around 500 px but always works; used as
//      the fallback so the writer never gets a "no cover found"
//      message when Open Library has one we could ship.
// Both are public, no API key needed, CORS-friendly.
// Wires the rating slider widget. Mirrors the public form's slider:
// drag a 0–5 range input, update the star fill, numeric readout, flavor
// label, and hidden #brw-rating input the submit handler reads. Returns
// a sync(value) function so prefill on edit can drive the slider from
// the loaded review's rating.
const RATING_FLAVORS = [
  { min: 4.7, label: "Couldn't put it down" },
  { min: 4.0, label: "Strongly recommend" },
  { min: 3.5, label: "Very good" },
  { min: 2.8, label: "Solid" },
  { min: 2.0, label: "Mixed" },
  { min: 1.0, label: "Disappointing" },
  { min: 0.1, label: "Skip it" },
];
function flavorForRating(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  for (const f of RATING_FLAVORS) if (n >= f.min) return f.label;
  return "";
}
function wireRatingSlider(card) {
  const root    = card.querySelector("#brw-rating-slider");
  const input   = card.querySelector("#brw-rating-input");
  const valueEl = card.querySelector(".brw-rating-slider-value");
  const flavor  = card.querySelector(".brw-rating-slider-flavor");
  const hidden  = card.querySelector("#brw-rating");
  if (!root || !input || !hidden) return () => {};

  const render = () => {
    const raw = parseFloat(input.value);
    const n = Number.isFinite(raw) ? Math.round(raw * 10) / 10 : 0;
    const pct = Math.max(0, Math.min(100, (n / 5) * 100));
    root.style.setProperty("--brw-pct", String(pct));
    root.dataset.value = n > 0 ? String(n) : "0";
    if (valueEl) {
      if (n > 0) valueEl.innerHTML = `${n.toFixed(1)}<small>/ 5</small>`;
      else valueEl.textContent = "— Optional —";
    }
    if (flavor) {
      flavor.textContent = flavorForRating(n) || "Drag to set a rating from 0 to 5. Optional.";
    }
    hidden.value = n > 0 ? n.toFixed(1) : "";
  };

  input.addEventListener("input", render);
  input.addEventListener("change", render);
  render();

  // Sync from external value (used by prefill on edit).
  return (n) => {
    const safe = Number.isFinite(n) && n >= 0 && n <= 5 ? n : 0;
    input.value = String(safe);
    render();
  };
}

// Wires the lightweight formatting toolbar above the review textarea.
// Each button rewrites the current selection in the #brw-body textarea
// using a tiny markdown-ish vocabulary that paragraphsToSafeHtml below
// understands: **bold**, *italic*, [text](url), and > quote at line
// start. Keyboard shortcuts: Ctrl/Cmd+B, +I, +K (link).
function wireFormattingToolbar(card) {
  const ta = card.querySelector("#brw-body");
  const bar = card.querySelector(".brw-toolbar");
  if (!ta || !bar) return;

  function wrap(prefix, suffix, placeholder) {
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const sel   = ta.value.slice(start, end);
    const text  = sel || placeholder || "";
    const next  = ta.value.slice(0, start) + prefix + text + suffix + ta.value.slice(end);
    ta.value = next;
    // Place cursor: if there was a selection, keep it inside the new wrappers.
    const newStart = start + prefix.length;
    const newEnd   = newStart + text.length;
    ta.setSelectionRange(newStart, newEnd);
    ta.focus();
  }

  function toggleQuote() {
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const lineStart = before.lastIndexOf("\n") + 1;
    const rest   = ta.value.slice(end);
    const afterNl = rest.indexOf("\n");
    const lineEnd = end + (afterNl === -1 ? rest.length : afterNl);
    const block = ta.value.slice(lineStart, lineEnd);
    const allQuoted = block.split("\n").every((l) => /^> ?/.test(l) || l.trim() === "");
    const next = block.split("\n").map((l) => {
      if (l.trim() === "") return l;
      return allQuoted ? l.replace(/^> ?/, "") : `> ${l}`;
    }).join("\n");
    ta.value = ta.value.slice(0, lineStart) + next + ta.value.slice(lineEnd);
    ta.setSelectionRange(lineStart, lineStart + next.length);
    ta.focus();
  }

  function linkPrompt() {
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const sel   = ta.value.slice(start, end);
    const url = window.prompt("Link URL (https://…):", "https://");
    if (!url) return;
    const trimmed = url.trim();
    if (!/^(https?:\/\/|mailto:)/i.test(trimmed)) {
      toast("Link URL must start with https://, http://, or mailto:", "error");
      return;
    }
    const text = sel || "link text";
    const insert = `[${text}](${trimmed})`;
    ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
    // If there was no selection, leave the cursor positioned over the
    // placeholder "link text" so the writer can immediately retype it.
    if (sel) {
      const after = start + insert.length;
      ta.setSelectionRange(after, after);
    } else {
      ta.setSelectionRange(start + 1, start + 1 + text.length);
    }
    ta.focus();
  }

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".brw-tb-btn");
    if (!btn) return;
    e.preventDefault();
    switch (btn.dataset.format) {
      case "bold":   wrap("**", "**", "bold text"); break;
      case "italic": wrap("*", "*", "italic text"); break;
      case "link":   linkPrompt(); break;
      case "quote":  toggleQuote(); break;
    }
  });

  ta.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); wrap("**", "**", "bold text"); }
    else if (k === "i") { e.preventDefault(); wrap("*", "*", "italic text"); }
    else if (k === "k") { e.preventDefault(); linkPrompt(); }
  });
}

async function bestCoverForIsbn(isbn) {
  const clean = String(isbn || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (!clean) return null;

  // Try Google Books first (high-res).
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(clean)}&country=US&maxResults=1`);
    if (res.ok) {
      const data = await res.json();
      const item  = data.items && data.items[0];
      const links = item?.volumeInfo?.imageLinks;
      const raw   = links?.extraLarge || links?.large || links?.medium ||
                    links?.small || links?.thumbnail || links?.smallThumbnail;
      if (raw) {
        // Unscale: zoom=0 + drop edge=curl + force https.
        let url = String(raw).replace(/^http:\/\//i, "https://");
        url = url.replace(/(\?|&)zoom=\d+/g, "$1zoom=0");
        url = url.replace(/(\?|&)edge=curl/g, "$1edge=none");
        return url;
      }
    }
  } catch { /* fall through to Open Library */ }

  // Fallback: probe Open Library cover. ?default=false → 404 on miss.
  return await new Promise((resolve) => {
    const img = new Image();
    const url = `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg?default=false`;
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    img.onload  = () => done(img.naturalWidth > 1 ? url : null);
    img.onerror = () => done(null);
    setTimeout(() => done(null), 6000);
    img.src = url;
  });
}

// ============================================================
// MINE — writer's own book reviews
// ============================================================
async function mountMine(ctx, container) {
  const card = el("div", { class: "card" });
  card.innerHTML = `
    <div class="card-header">
      <div>
        <div class="card-title">My book reviews</div>
        <div class="card-subtitle">Drafts and submitted reviews you've written. Pick one to edit, or start a new one.</div>
      </div>
      <div>
        <a class="btn btn-accent btn-sm" href="#/book-reviews/write">+ New book review</a>
      </div>
    </div>
    <div class="card-body card-body--flush" id="brw-mine-body">
      <div class="loading-state"><div class="spinner"></div>Loading…</div>
    </div>
  `;
  container.appendChild(card);

  const body = card.querySelector("#brw-mine-body");
  try {
    // Pull every book-review story for this user. Two filters in one query
    // (where + where) needs a composite index in Firestore; do client-side
    // filter for category to keep this dependency-free.
    const snap = await getDocs(query(
      collection(db, "stories"),
      where("authorId", "==", ctx.user.uid),
      orderBy("updatedAt", "desc"),
    ));
    const rows = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.category === "book-review") rows.push({ id: d.id, ...data });
    });
    if (!rows.length) {
      body.innerHTML = `<div class="empty-state" style="padding:36px 22px;">
        <p style="margin:0 0 12px;">You haven't written a book review yet.</p>
        <a class="btn btn-accent btn-sm" href="#/book-reviews/write">Write your first one</a>
      </div>`;
      return;
    }
    body.innerHTML = "";
    const list = el("div", { class: "articles-list" });
    rows.forEach((r) => list.appendChild(renderMineRow(r)));
    body.appendChild(list);
  } catch (err) {
    body.innerHTML = `<div class="error-state">${esc(err.message)}</div>`;
  }
}

function renderMineRow(r) {
  const row = el("div", { class: "ar-row" });
  row.innerHTML = `
    <div class="ar-main">
      <div class="ar-title">${esc(r.bookTitle || r.title || "Untitled")}</div>
      <div class="ar-meta">
        ${r.bookAuthor ? `<span>by ${esc(r.bookAuthor)}</span>` : ""}
        ${r.rating != null ? `<span>· ${esc(String(r.rating))}/5</span>` : ""}
        <span>· updated ${esc(fmtRelative(r.updatedAt))}</span>
      </div>
    </div>
    <div class="ar-actions">
      ${statusPill(r.status || "draft")}
      <a class="btn btn-secondary btn-xs" href="#/book-reviews/write?edit=${esc(r.id)}">Edit</a>
    </div>
  `;
  return row;
}
