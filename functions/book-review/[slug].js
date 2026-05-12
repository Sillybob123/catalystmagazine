// Handles GET /book-review/<slug> — slug is the book-review title in
// kebab-case. Mirrors functions/article/[slug].js but is dedicated to
// book reviews so the URL surfaces the category.
//
// The page itself is still served by the existing article.html shell;
// js/main.js routes to renderBookReviewDetail() when category === 'book-review',
// so the only differences from /article/<slug> are:
//   • only resolves articles whose category is "book-review"
//     (other categories 404 here so the URL stays clean)
//   • canonical URL is /book-review/<slug>, not /article/<slug>
//   • JSON-LD type is Review (with itemReviewed = the book) rather than
//     NewsArticle, so search engines surface the rating + author of the
//     book being reviewed.
//
// Backward-compat: /article/<slug> still resolves book reviews and
// 301-redirects to the new URL — see functions/article/[slug].js.

import {
  findArticleBySlug,
  listAllArticles,
  titleToSlug,
  titleToLegacySlug,
  resolveOgImage,
  getSiteUrl,
  getFallbackImage,
  buildArticleDescription,
} from "../_utils/article-meta.js";

const SITE_NAME = "The Catalyst Magazine";

export const onRequestGet = async ({ request, env, params, next }) => {
  const slug = params.slug || "";
  if (!slug) return next();

  // Try direct slug field match first (fast — one Firestore query),
  // then fall back to title-derived slug scan. We try both the canonical
  // (NFKD-folded) slug and a legacy form so URLs from before the
  // diacritic-stripping landed — e.g. "g-del-escher-bach…" for "Gödel,
  // Escher, Bach…" — still resolve.
  const wanted = slug.toLowerCase();
  let article = await findArticleBySlug(wanted).catch(() => null);
  if (!article) {
    const articles = await listAllArticles().catch(() => []);
    article =
      articles.find((a) => titleToSlug(a.title) === wanted) ||
      articles.find((a) => titleToLegacySlug(a.title) === wanted) ||
      null;
  }

  const siteUrl = getSiteUrl(request, env);

  // Reject non-book-review hits at this URL — keep the path category-correct.
  // If a normal article slipped in, send the reader to the correct /article/<slug>.
  if (article && String(article.category || "").toLowerCase() !== "book-review") {
    const canonicalSlug = article.slug || titleToSlug(article.title) || slug;
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${siteUrl}/article/${encodeURIComponent(canonicalSlug)}`,
        "Cache-Control": "public, max-age=300, s-maxage=600",
      },
    });
  }

  // Fetch article.html shell by absolute URL — avoids Cloudflare Pages'
  // automatic 308 redirect when next() resolves the static asset.
  const origin = new URL(request.url).origin;
  const origin_response = await fetch(`${origin}/article`);
  if (!origin_response.ok) return origin_response;

  if (!article) return origin_response;

  const canonical = `${siteUrl}/book-review/${encodeURIComponent(slug)}`;
  const title = `${article.title} | ${SITE_NAME}`;
  const description = buildArticleDescription(article, 160);
  const image = resolveOgImage(article.image, siteUrl) || getFallbackImage(siteUrl);
  const author = article.author || SITE_NAME;
  const published = toIsoDate(article.publishedAt || article.date);

  const jsonLd = buildBookReviewJsonLd({
    article,
    title,
    description,
    image,
    author,
    published,
    canonical,
    siteUrl,
  });

  const rewriter = new HTMLRewriter()
    .on("title", { element: (el) => el.setInnerContent(escapeHtml(title)) })
    .on('meta[name="description"]', { element: (el) => el.setAttribute("content", description) })
    .on('meta[property="og:title"]', { element: (el) => el.setAttribute("content", title) })
    .on('meta[property="og:description"]', { element: (el) => el.setAttribute("content", description) })
    .on('meta[property="og:image"]', { element: (el) => el.setAttribute("content", image) })
    .on('meta[property="og:url"]', { element: (el) => el.setAttribute("content", canonical) })
    .on('meta[property="og:type"]', { element: (el) => el.setAttribute("content", "article") })
    .on('meta[name="twitter:title"]', { element: (el) => el.setAttribute("content", title) })
    .on('meta[name="twitter:description"]', { element: (el) => el.setAttribute("content", description) })
    .on('meta[name="twitter:image"]', { element: (el) => el.setAttribute("content", image) })
    .on('meta[name="twitter:url"]', { element: (el) => el.setAttribute("content", canonical) })
    .on('meta[property="og:image:alt"]', { element: (el) => el.setAttribute("content", article.title) })
    .on('meta[name="twitter:image:alt"]', { element: (el) => el.setAttribute("content", article.title) })
    .on('meta[property="og:image:width"]', { element: (el) => el.remove() })
    .on('meta[property="og:image:height"]', { element: (el) => el.remove() })
    .on("head", {
      element(el) {
        el.append(`<link rel="canonical" href="${escapeAttr(canonical)}">`, { html: true });
        el.append(`<meta property="og:image:secure_url" content="${escapeAttr(image)}">`, { html: true });
        el.append(`<meta property="og:image:width" content="1200">`, { html: true });
        el.append(`<meta property="og:image:height" content="630">`, { html: true });
        el.append(`<meta property="article:author" content="${escapeAttr(author)}">`, { html: true });
        if (published) {
          el.append(`<meta property="article:published_time" content="${escapeAttr(published)}">`, { html: true });
        }
        el.append(`<meta property="article:section" content="Book Review">`, { html: true });
        el.append(`<meta name="author" content="${escapeAttr(author)}">`, { html: true });
        el.append(`<script type="application/ld+json">${jsonLd}</script>`, { html: true });
        // Embed the article ID so client JS can load without a slug→id lookup.
        el.append(`<meta name="catalyst-article-id" content="${escapeAttr(String(article.id))}">`, { html: true });
      },
    });

  const response = rewriter.transform(origin_response);
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
  headers.set("X-Article-Id", String(article.id));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

function toIsoDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return isNaN(d) ? "" : d.toISOString();
}

// Schema.org Review structured data — gives Google a rating, an author for
// the review, and (when ISBN is present) a Book itemReviewed so rich
// results can show the star rating.
function buildBookReviewJsonLd({ article, title, description, image, author, published, canonical, siteUrl }) {
  const rating =
    typeof article.rating === "number" && article.rating >= 0 && article.rating <= 5
      ? article.rating
      : null;

  const itemReviewed = {
    "@type": "Book",
    name: article.title,
  };
  if (article.bookAuthor) {
    itemReviewed.author = { "@type": "Person", name: article.bookAuthor };
  }
  if (article.isbn) {
    itemReviewed.isbn = article.isbn;
  }

  const data = {
    "@context": "https://schema.org",
    "@type": "Review",
    headline: title,
    name: article.title,
    description,
    image: [image],
    author: { "@type": "Person", name: author },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: `${siteUrl}/NewLogoShape.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    url: canonical,
    itemReviewed,
  };
  if (rating != null) {
    data.reviewRating = {
      "@type": "Rating",
      ratingValue: rating,
      bestRating: 5,
      worstRating: 0,
    };
  }
  if (published) {
    data.datePublished = published;
    data.dateModified = published;
  }
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
