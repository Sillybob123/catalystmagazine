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
          when you're ready and an editor will publish it to The Stacks.
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
            <label class="label" for="brw-rating">Your rating</label>
            <select class="select" id="brw-rating" name="rating">
              <option value="">— Optional —</option>
              <option value="5">★★★★★ 5</option>
              <option value="4.5">★★★★½ 4.5</option>
              <option value="4">★★★★ 4</option>
              <option value="3.5">★★★½ 3.5</option>
              <option value="3">★★★ 3</option>
              <option value="2.5">★★½ 2.5</option>
              <option value="2">★★ 2</option>
              <option value="1.5">★½ 1.5</option>
              <option value="1">★ 1</option>
            </select>
          </div>

          <div class="brw-field brw-field-wide">
            <label class="label" for="brw-genre">Discipline <span class="req">*</span></label>
            <select class="select" id="brw-genre" name="genre" required>
              <option value="">— Pick the closest fit —</option>
              <option value="astronomy">Astronomy</option>
              <option value="biology">Biology</option>
              <option value="computer-science">Computer Science</option>
              <option value="physics">Physics</option>
              <option value="mathematics">Mathematics</option>
              <option value="climate">Climate</option>
              <option value="memoir">Memoir</option>
              <option value="stem">Other STEM</option>
            </select>
            <div class="hint">Sorts the review onto the right shelf on The Stacks.</div>
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
            <textarea class="textarea brw-textarea" id="brw-body" name="body" minlength="120" maxlength="8000" required
                      rows="14"
                      placeholder="A few paragraphs on what the book is about, what it does well, who it's for, and why it earned a spot on the shelf."></textarea>
            <div class="hint">Plain text or paragraphs separated by blank lines. No markdown needed.</div>
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
  const html = story.body || story.content;
  // Strip tags but preserve paragraph breaks (<p> → \n\n, <br> → \n).
  return String(html)
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

// Convert plain text (paragraphs separated by blank lines) into safe HTML
// for the story body. We escape every HTML metachar so a writer's text can
// never become a script tag in the article renderer.
function paragraphsToSafeHtml(text) {
  const escChar = (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]);
  return String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/[&<>]/g, escChar).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
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
    "astronomy","biology","computer-science","physics",
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
