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

// We deliberately do NOT load /css/article-premium.css as a normal <link> —
// most of its rules are unscoped (.article-body, .article-share, etc.) and
// would leak into the writer's compose view, which reuses class names like
// `.article-body`. Instead we fetch it once, rescope every selector under
// `.final-review-article`, and inject as a <style> tag (see ensureFinalReviewShim).
//
// styles.css is the public-site shell sheet; it's safe to load globally on
// the dashboard because the admin already sits next to it in production.
const PUBLIC_STYLESHEETS = [
  "/css/styles.css",
];

const ARTICLE_FALLBACK_IMAGE = "/NewsletterHeader1.png";

export async function mount(ctx, container) {
  container.innerHTML = "";

  const storyId = getHashParam("id");
  if (!storyId) {
    container.innerHTML = `<div class="error-state">Missing story id in the URL.</div>`;
    return;
  }

  ensurePublicStylesheets();

  // article-premium.css is scoped under body[data-page="article"], so loading
  // it inside the dashboard does almost nothing on its own — the preview was
  // falling back to dashboard typography and looking janky compared to the
  // live page. Inject a small shim that republishes the public-site article
  // design tokens onto our .final-review-article subtree so the hero, body
  // serif, byline, and share row render the same as on the article page —
  // without flipping the whole document into "article mode" (which would
  // zero out <main> padding and clobber the admin chrome).
  ensureFinalReviewShim();

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

  // Wire the in-article share row's "Copy link" button. The X / LinkedIn
  // anchors work natively; the copy button on the live page calls a global
  // copyArticleLink() that doesn't exist in the dashboard bundle.
  const shareCopyBtn = articleEl.querySelector("[data-fr-copy-share]");
  if (shareCopyBtn) {
    shareCopyBtn.addEventListener("click", async () => {
      const url = `${window.location.origin}/article/${encodeURIComponent(slugFor(story))}`;
      try { await navigator.clipboard.writeText(url); ctx.toast("Article link copied.", "success"); }
      catch { ctx.toast("Copy failed — URL: " + url, "info", 6000); }
    });
  }

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
      // Bust the public listing cache so /book-reviews and /articles
      // pick up the freshly-published story on the next load instead of
      // serving the previous session-cache snapshot.
      try { sessionStorage.removeItem("catalyst_fs_cache_v5"); } catch {}
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
    // No persistent listeners to tear down. The shim stylesheet is left in
    // place — it's idempotent and only affects .final-review-article, so it
    // does no harm when other dashboard routes are mounted.
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

// article-premium.css scopes everything under body[data-page="article"]. The
// admin dashboard's body has no such attribute, and we don't want to flip it
// (that would zero out <main> padding and break the dashboard chrome).
//
// Instead we fetch the stylesheet, rewrite each `body[data-page="article"]`
// occurrence to a `.final-review-article`-scoped selector, and inject the
// rewritten CSS in a <style> tag. The result: every premium rule applies to
// the preview surface only, and the file remains the single source of truth.
let finalReviewShimPromise = null;
function ensureFinalReviewShim() {
  if (document.getElementById("final-review-shim-style")) return finalReviewShimPromise;
  if (finalReviewShimPromise) return finalReviewShimPromise;
  finalReviewShimPromise = (async () => {
    try {
      const res = await fetch("/css/article-premium.css", { cache: "force-cache" });
      if (!res.ok) return;
      const css = await res.text();
      const rescoped = rescopeArticlePremium(css);
      const style = document.createElement("style");
      style.id = "final-review-shim-style";
      style.textContent = rescoped;
      document.head.appendChild(style);
    } catch {
      // Fall through silently — preview will use whatever the unrescoped
      // article-premium.css applies (which is "almost nothing").
    }
  })();
  return finalReviewShimPromise;
}

// Rescope every rule in article-premium.css so it targets ONLY the
// `.final-review-article` subtree, never the document at large.
//
// The file mixes two selector shapes:
//   body[data-page="article"]          { ...page-level resets... }
//   body[data-page="article"] .foo     { ...descendant rules... }
//   .article-hero, .article-body, …    { ...unscoped rules... }
// The unscoped block exists because the file is normally loaded only on the
// article page (which already carries data-page="article"). When we inject
// it as a <style> tag inside the dashboard, those unscoped rules would leak
// onto class names the writer compose view also uses (notably .article-body),
// so we walk every selector in the sheet and force-prefix it.
function rescopeArticlePremium(css) {
  // Strip /* ... */ comments first. Otherwise comments containing
  // `body[data-page="article"]` (the file's header banner mentions it) or
  // floating between rules confuse the selector-list matcher below.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // Match a selector list that ends at a `{`, anchored to either the start
  // of the file, a closing `}` (end of previous rule), or an opening `{`
  // (the first selector inside an @media block). Selectors can't legally
  // contain `{`, `}`, `;`, or `@`, so excluding those keeps us out of
  // declaration bodies and at-rule preludes.
  return stripped.replace(/(^|[}{])([^{};@]+?)\{/g, (_, lead, selectorList) => {
    const rescoped = selectorList
      .split(",")
      .map(sel => rescopeOneSelector(sel.trim()))
      .filter(Boolean)
      .join(",\n");
    return `${lead}\n${rescoped} {`;
  });
}

function rescopeOneSelector(sel) {
  if (!sel) return "";
  // Leave at-rule keyframe selectors (from/to/percentages) and bare
  // pseudo-element scoped CSS variables (::root etc.) alone — they aren't
  // descendant selectors and prefixing would break them.
  if (/^(from|to|\d+%)$/.test(sel)) return sel;
  if (sel.startsWith("@")) return sel;

  // Replace the page-level scope. `body[data-page="article"]` becomes the
  // root of our preview — without it, `--ink` and friends defined on that
  // selector wouldn't reach our subtree.
  if (/^body\[data-page="article"\]$/.test(sel)) return ".final-review-article";
  if (/^body\[data-page="article"\]\s+/.test(sel)) {
    return sel.replace(/^body\[data-page="article"\]\s+/, ".final-review-article ");
  }

  // Already scoped under our preview wrapper — leave as-is.
  if (sel.startsWith(".final-review-article")) return sel;

  // Otherwise, force every selector to live inside `.final-review-article`.
  return `.final-review-article ${sel}`;
}

// Build the article HTML using the same structure the public-site renderer
// produces in js/main.js (renderArticleDetail). We deliberately mirror class
// names, helpers, and copy verbatim so article-premium.css styles this 1:1
// with the live page — same hero, same typography, same byline, same share
// row. If you change one renderer, mirror the change in the other.
function renderArticleMarkup(story) {
  const title = story.title || "Untitled";
  const dek = story.dek || story.deck || story.excerpt || "";
  const rawCategory = (story.category || "feature").toLowerCase();
  const category = formatCategory(rawCategory);
  const lightCover = !!story.lightCover;
  const rawCover = story.coverImage || story.image || ARTICLE_FALLBACK_IMAGE;
  const heroImage = getResizedImageUrl(rawCover, 1600, 80);
  const bodyHtml = story.body || story.content || "";
  const authorName = story.authorName
    || (Array.isArray(story.authors) ? story.authors.map(a => a?.name).filter(Boolean).join(", ") : "")
    || story.author
    || "The Catalyst";

  // Reading time — match main.js estimateReadingTime() exactly: 225 wpm,
  // minimum 2 minutes, counted off the stripped body text.
  const plain = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = plain ? plain.split(" ").filter(Boolean).length : 0;
  const readingTime = `${Math.max(2, Math.round(wordCount / 225))} min read`;

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

  // Share row mirrors the live article. It links to the eventual public URL
  // so the writer can sanity-check what gets shared, even though the article
  // isn't live yet.
  const articleUrl = `${window.location.origin}/article/${encodeURIComponent(titleToSlug(title))}`;
  const shareUrl = encodeURIComponent(articleUrl);
  const shareText = encodeURIComponent(title);

  return `
    <header class="article-hero${lightCover ? ' article-hero--light-cover' : ''}">
      <div class="article-hero__image" style="background-image:url('${esc(heroImage)}')"></div>
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
            <span class="reading-time">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              ${esc(readingTime)}
            </span>
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

      <div class="article-share" role="group" aria-label="Share this story">
        <span>Share</span>
        <a class="article-share__btn" href="https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareText}" target="_blank" rel="noopener" aria-label="Share on X">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
        <a class="article-share__btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}" target="_blank" rel="noopener" aria-label="Share on LinkedIn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8h4.56v14H.22V8zM7.78 8h4.37v1.93h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 7v7.45h-4.56v-6.6c0-1.58-.03-3.61-2.2-3.61-2.2 0-2.54 1.72-2.54 3.5V22H7.78V8z"/></svg>
        </a>
        <button class="article-share__btn" type="button" data-fr-copy-share aria-label="Copy link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
      </div>
    </div>`;
}

// Mirrors js/main.js formatCategory(). Keep in sync.
function formatCategory(category) {
  const map = {
    "feature": "Feature",
    "profile": "Profile",
    "interview": "Interview",
    "op-ed": "Op-Ed",
    "oped": "Op-Ed",
    "editorial": "Editorial",
    "article": "Feature",
    "news": "News",
    "science": "Science",
    "book-review": "Book Review",
    "bookreview": "Book Review",
  };
  if (!category) return "Feature";
  return map[category] || category.charAt(0).toUpperCase() + category.slice(1);
}

// Slim mirror of js/main.js titleToSlug(). Used to build the public-site URL
// the share buttons point at.
function slugFor(story) {
  return titleToSlug(story?.title || "");
}

function titleToSlug(title = "") {
  return String(title)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Slim mirror of js/main.js getResizedImageUrl(). The published renderer
// runs the cover through wsrv.nl (or the Wix transformer) at 1600w/q80 so
// hero images aren't the full Firebase Storage original. Without this the
// preview hero looks heavier and slower than the live page.
function getResizedImageUrl(src, width, quality) {
  if (!src || src === ARTICLE_FALLBACK_IMAGE || src.startsWith("data:") || src.startsWith("blob:")) return src;
  try {
    const isAbsolute = /^https?:\/\//i.test(src);
    if (!isAbsolute) return src;
    const url = new URL(src);
    if (url.hostname.includes("static.wixstatic.com")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const filename = parts[parts.length - 1];
      if (parts.includes("v1")) {
        return src.replace(/q_\d+/g, `q_${quality}`).replace(/w_\d+/g, `w_${width}`);
      }
      const h = Math.round(width * 0.66);
      return `${src}/v1/fill/w_${width},h_${h},al_c,q_${quality},enc_auto/${filename}`;
    }
    const SENTINEL = "ENCSLASH";
    const protected_ = src.replace(/%2F/gi, SENTINEL);
    let decoded;
    try { decoded = decodeURIComponent(protected_); } catch { decoded = protected_; }
    decoded = decoded.replace(new RegExp(SENTINEL, "g"), "%2F");
    const params = new URLSearchParams({
      url: decoded,
      w: width,
      q: quality,
      output: "webp",
      fit: "cover",
      we: "",
    });
    return `https://wsrv.nl/?${params}`;
  } catch { return src; }
}
