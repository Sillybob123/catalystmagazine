// Server-rendered article body for /article/<slug> and /book-review/<slug>.
//
// The article shell (article.html) ships an empty #article-detail that
// js/main.js fills from Firestore. Crawlers that don't run JavaScript (Bing,
// DuckDuckGo, AI search bots, link previews) — and Google's first, pre-render
// pass — would otherwise see no headline, byline or text at all. These
// helpers render the same story into the shell on the server, using the
// classes js/main.js uses (renderArticleDetail / renderBookReviewDetail), so
// the page reads the same before and after the client re-renders it.
//
// #article-detail gets data-ssr="1"; js/main.js then skips its loading
// skeleton and replaces this markup with the full interactive version.

// Mirror of cleanStoryHtml + rootRelativePaths in js/main.js, plus a
// conservative scrub: story HTML is staff-written, but it is injected into
// every reader's page, so drop anything executable.
export function sanitizeStoryHtml(html) {
  return String(html || "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|link|meta|base|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/<figure\b[^>]*>\s*<img\b[^>]*\ssrc=["']\/?posts\/insidearticleimages\/[^"']*["'][^>]*>[\s\S]*?<\/figure>/gi, "")
    .replace(/<img\b[^>]*\ssrc=["']\/?posts\/insidearticleimages\/[^"']*["'][^>]*>/gi, "")
    .replace(/<div\b[^>]*\barticle-game\b[^>]*>\s*<iframe\b[\s\S]*?<\/iframe>\s*<\/div>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<[a-z][^>]*>/gi, (tag) => tag
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/(\s(?:href|src)\s*=\s*)(["'])\s*javascript:[^"']*\2/gi, "$1$2#$2"))
    .replace(
      /(\s(?:src|href|poster|data-src)\s*=\s*)(["'])(?![a-z][a-z0-9+.-]*:|\/|#|\?|\s)([^"']+)\2/gi,
      "$1$2/$3$2"
    )
    // Lazy-load body images so the server copy never competes with the hero.
    .replace(/<img\b(?![^>]*\sloading=)/gi, '<img loading="lazy"');
}

// Mirror of getResizedImageUrl() in js/main.js: the server's cover <img>
// must request the exact URL the client re-renders with, or readers would
// download the photo twice.
function resizedImageUrl(src, width, quality) {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return src;
  try {
    if (!/^https?:\/\//i.test(src)) return src;
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
    const params = new URLSearchParams({ url: decoded, w: width, q: quality, output: "webp", fit: "cover", we: "" });
    return `https://wsrv.nl/?${params}`;
  } catch {
    return src;
  }
}

// The cover as js/main.js renders it (falls back to the same newsletter art).
function heroImage(article) {
  const raw = article.rawImage || "";
  return raw ? resizedImageUrl(raw, 1600, 80) : "/NewsletterHeader1.png";
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function storyBody(article) {
  const raw = article.contentHtml || "";
  return raw ? sanitizeStoryHtml(raw) : `<p>${esc(article.excerpt || "")}</p>`;
}

function readingTime(article) {
  const words = String(article.contentHtml || article.excerpt || "")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return `${Math.max(2, Math.round(words / 225))} min read`;
}

function timeTag(article) {
  const iso = article.publishedAt ? new Date(article.publishedAt) : null;
  if (!article.date) return "";
  return iso && !isNaN(iso)
    ? `<time datetime="${esc(iso.toISOString())}">${esc(article.date)}</time>`
    : esc(article.date);
}

// Same structure as renderArticleDetail() in js/main.js. The cover is a
// real <img> so it can be indexed by image search.
export function renderArticleSsr(article, category) {
  const author = article.author || "The Catalyst";
  return `
        <header class="article-hero${article.lightCover ? " article-hero--light-cover" : ""}">
            <div class="article-hero__image"><img src="${esc(heroImage(article))}" alt="${esc(article.title)}" fetchpriority="high" decoding="async"></div>
            <div class="article-hero__inner">
                <div class="article-hero__surface">
                    <span class="article-hero__category">${esc(category)}</span>
                    <h1 class="article-hero__title">${esc(article.title)}</h1>
                    ${article.deck ? `<p class="article-hero__deck">${esc(article.deck)}</p>` : ""}
                    <div class="article-hero__meta">
                        <span>By <strong>${esc(author)}</strong></span>
                        <span class="dot"></span>
                        <span>${timeTag(article)}</span>
                        <span class="dot"></span>
                        <span class="reading-time">${readingTime(article)}</span>
                    </div>
                </div>
            </div>
        </header>
        <div class="article-body-wrap">
            <article class="article-body">${storyBody(article)}</article>
        </div>`;
}

// Same opening structure as renderBookReviewDetail() in js/main.js. The
// cover column is left to the client (it picks the cover by ISBN), so the
// spread is a single column until then.
export function renderBookReviewSsr(article) {
  const author = article.author || "The Catalyst";
  return `
        <article class="brx" data-has-cover="false">
            <header class="brx-hero">
                <div class="brx-hero-inner">
                    <div class="brx-hero-meta">
                        <span class="brx-kicker">${article.communityPick ? "Reader pick · The Catalyst Reviews" : "The Catalyst Reviews"}</span>
                    </div>
                    <h1 class="brx-title">${esc(article.title)}</h1>
                    ${article.bookAuthor ? `<p class="brx-book-author">by <strong>${esc(article.bookAuthor)}</strong></p>` : ""}
                    ${article.deck ? `<p class="brx-deck">${esc(article.deck)}</p>` : ""}
                    <div class="brx-byline">
                        <div class="brx-byline-pair">
                            <span class="brx-byline-label">Reviewed by</span>
                            <span class="brx-byline-name">${esc(author)}</span>
                        </div>
                        ${article.date ? `<div class="brx-byline-pair">
                            <span class="brx-byline-label">Published</span>
                            <span class="brx-byline-name">${timeTag(article)}</span>
                        </div>` : ""}
                    </div>
                </div>
            </header>
            <section class="brx-spread" style="display:block">
                <div class="brx-verdict">
                    <div class="brx-body">${storyBody(article)}</div>
                </div>
            </section>
        </article>`;
}
