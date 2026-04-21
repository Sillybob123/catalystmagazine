// Final-review module — the link an admin sends to the writer after pressing
// "Approve" on an article. Renders the story exactly as it will appear on the
// public site (same hero, headers, body, byline) and offers two actions:
//
//   - Publish now       → flips status to 'published' and stamps publishedAt
//   - Request changes   → flips status back to 'reviewing' so the editor/
//                         writer can continue iterating
//
// Accessible to the story's author and to any admin/editor. Route is
// #/final-review?id=<storyId>; it's hidden from the sidebar and is shared by
// copying the URL out of the admin Approve toast.
//
// We reuse the public-site stylesheets by injecting <link> tags on mount; a
// scoped `.final-review-stage` wrapper contains any layout side effects so the
// dashboard chrome is unaffected.

import { db } from "../firebase-config.js";
import {
  doc, getDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { el, esc, confirmDialog, statusPill } from "./ui.js";

const PUBLIC_STYLESHEETS = [
  "/css/styles.css",
  "/css/article-premium.css",
];

export async function mount(ctx, container) {
  container.innerHTML = "";

  const storyId = getHashParam("id");
  if (!storyId) {
    container.innerHTML = `<div class="error-state">Missing story id in the URL.</div>`;
    return;
  }

  ensurePublicStylesheets();

  const docRef = doc(db, "stories", storyId);
  let story;
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) { container.innerHTML = `<div class="error-state">Story not found.</div>`; return; }
    story = snap.data();
  } catch (err) {
    container.innerHTML = `<div class="error-state">${esc(err.message)}</div>`; return;
  }

  // Access gate: admin/editor always, writer only if they're the author.
  const isAdmin  = ctx.role === "admin";
  const isEditor = ctx.role === "editor";
  const isAuthor = story.authorId === ctx.user.uid;
  if (!isAdmin && !isEditor && !isAuthor) {
    container.innerHTML = `<div class="error-state">You don't have access to this review page.</div>`;
    return;
  }

  const stage = el("div", { class: "final-review-stage" });
  container.appendChild(stage);

  // Header bar: status pill + action buttons. Kept above the article so the
  // reviewer sees what they're about to do without scrolling through the body.
  const bar = el("div", { class: "final-review-bar" });
  bar.innerHTML = `
    <div class="final-review-bar__info">
      <div class="final-review-bar__title">Final review</div>
      <div class="final-review-bar__sub">
        Review the article below as it will appear to readers. When you're satisfied, publish it.
        <span class="final-review-bar__status">${statusPill(story.status)}</span>
      </div>
    </div>
    <div class="final-review-bar__actions">
      <button class="btn btn-ghost btn-sm" id="fr-copy-link" title="Copy this review URL to share">Copy review link</button>
      <button class="btn btn-secondary btn-sm" id="fr-request-changes">Request changes</button>
      <button class="btn btn-accent btn-sm" id="fr-publish">Publish now</button>
    </div>`;
  stage.appendChild(bar);

  if (story.status === "published") {
    const banner = el("div", { class: "final-review-banner final-review-banner--done" },
      "This article is already published.");
    stage.appendChild(banner);
  } else if (story.status !== "approved") {
    const banner = el("div", { class: "final-review-banner final-review-banner--warn" },
      `Status is "${story.status || "draft"}" — normally this page opens after an admin approves the piece.`);
    stage.appendChild(banner);
  }

  // The actual preview surface — identical markup/classes to the public site's
  // renderArticleDetail() so the CSS in article-premium.css styles it 1:1.
  const articleEl = el("div", { class: "final-review-article article-detail" });
  articleEl.innerHTML = renderArticleMarkup(story);
  stage.appendChild(articleEl);

  // ---- wire actions ----
  bar.querySelector("#fr-copy-link").addEventListener("click", async () => {
    const url = `${window.location.origin}/admin/#/final-review?id=${encodeURIComponent(storyId)}`;
    try {
      await navigator.clipboard.writeText(url);
      ctx.toast("Review link copied.", "success");
    } catch {
      ctx.toast("Copy failed — URL: " + url, "info", 6000);
    }
  });

  const publishBtn = bar.querySelector("#fr-publish");
  const requestBtn = bar.querySelector("#fr-request-changes");
  if (story.status === "published") {
    publishBtn.disabled = true;
    publishBtn.textContent = "Published";
    requestBtn.disabled = true;
  }

  publishBtn.addEventListener("click", async () => {
    const ok = await confirmDialog(
      "Publish this article now? It will go live immediately.",
      { confirmText: "Publish" }
    );
    if (!ok) return;
    publishBtn.disabled = true; publishBtn.textContent = "Publishing…";
    try {
      const patch = {
        status: "published",
        finalApprovedById: ctx.user.uid,
        finalApprovedByName: ctx.profile?.name || ctx.user.email,
        finalApprovedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // Preserve an existing publishedAt (admin may have set it manually from
      // the edit modal, or it carried over from a legacy import).
      if (!story.publishedAt) patch.publishedAt = new Date().toISOString();
      await updateDoc(docRef, patch);
      ctx.toast("Published. It's live on the site.", "success");
      publishBtn.textContent = "Published";
    } catch (err) {
      ctx.toast("Publish failed: " + (err?.message || err), "error");
      publishBtn.disabled = false; publishBtn.textContent = "Publish now";
    }
  });

  requestBtn.addEventListener("click", async () => {
    // Writer authors cannot transition 'approved' → 'reviewing' per the
    // firestore rules (writer updates are clamped to draft/pending or the
    // approved→published jump). Hide this action from non-editors so they
    // don't hit a permission-denied error.
    if (!isAdmin && !isEditor) {
      ctx.toast("Only an admin or editor can send this back for changes.", "error");
      return;
    }
    const ok = await confirmDialog(
      "Send this back to the editor/writer for more changes? Status will return to 'reviewing'.",
      { confirmText: "Request changes" }
    );
    if (!ok) return;
    requestBtn.disabled = true;
    try {
      await updateDoc(docRef, {
        status: "reviewing",
        updatedAt: new Date().toISOString(),
      });
      ctx.toast("Sent back for revision.", "success");
      location.hash = "#/admin/articles";
    } catch (err) {
      ctx.toast("Update failed: " + (err?.message || err), "error");
      requestBtn.disabled = false;
    }
  });

  // Hide the Request-changes button entirely for pure writers — it wouldn't
  // succeed against firestore rules and shouldn't look clickable.
  if (!isAdmin && !isEditor) requestBtn.remove();

  return () => {
    // No persistent listeners to tear down.
  };
}

// ---- helpers ----------------------------------------------------------------

function getHashParam(name) {
  const q = location.hash.split("?")[1];
  if (!q) return null;
  return new URLSearchParams(q).get(name);
}

// Idempotently inject the public site's article stylesheets so the preview
// renders with the real hero / typography / colors. The dashboard shell
// normally only loads dashboard.css.
function ensurePublicStylesheets() {
  for (const href of PUBLIC_STYLESHEETS) {
    if (document.querySelector(`link[data-final-review-css="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-final-review-css", href);
    document.head.appendChild(link);
  }
}

// Build the article HTML using the same structure the public-site renderer
// produces in js/main.js (renderArticleDetail). We deliberately mirror class
// names so article-premium.css styles this without modification.
function renderArticleMarkup(story) {
  const title = story.title || "Untitled";
  const dek = story.dek || story.excerpt || "";
  const category = (story.category || "Feature");
  const lightCover = !!story.lightCover;
  const cover = story.coverImage || story.image || "/NewLogoShape.png";
  const bodyHtml = story.body || story.content || "";
  const authorName = story.authorName
    || (Array.isArray(story.authors) ? story.authors.map(a => a?.name).filter(Boolean).join(", ") : "")
    || "The Catalyst";

  // Reading time — 220 wpm matches the public-site estimator.
  const wordCount = (bodyHtml.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length);
  const readingTime = `${Math.max(1, Math.round(wordCount / 220))} min read`;

  // Date — prefer publishedAt (if set by the admin at approve time), otherwise
  // fall back to today so the hero never shows an empty date slot.
  const rawDate = story.publishedAt || story.createdAt;
  let dateStr = "";
  if (rawDate) {
    const d = new Date(typeof rawDate === "string" ? rawDate : rawDate?.toDate?.() || rawDate);
    if (!isNaN(d.getTime())) {
      dateStr = d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    }
  }
  if (!dateStr) {
    dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  const initials = authorName.split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "TC";

  return `
    <header class="article-hero${lightCover ? ' article-hero--light-cover' : ''}">
      <div class="article-hero__image" style="background-image:url('${escAttr(cover)}')"></div>
      <div class="article-hero__inner">
        <div class="article-hero__surface">
          <span class="article-hero__category">${esc(category)}</span>
          <h1 class="article-hero__title">${esc(title)}</h1>
          ${dek ? `<p class="article-hero__deck">${esc(dek)}</p>` : ""}
          <div class="article-hero__meta">
            <span>By <strong>${esc(authorName)}</strong></span>
            <span class="dot"></span>
            <span>${esc(dateStr)}</span>
            <span class="dot"></span>
            <span class="reading-time">${esc(readingTime)}</span>
          </div>
        </div>
      </div>
    </header>
    <div class="article-body-wrap">
      <article class="article-body">${bodyHtml}</article>
      <aside class="article-byline">
        <div class="article-byline__avatar">${esc(initials)}</div>
        <div>
          <div class="article-byline__name">${esc(authorName)}</div>
          <div class="article-byline__role">Contributing writer · The Catalyst Magazine</div>
        </div>
      </aside>
    </div>`;
}

function escAttr(s) { return esc(s); }
