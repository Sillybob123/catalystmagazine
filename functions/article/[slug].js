// Handles GET /article/<slug> — slug is the article title in kebab-case.
//
// Responsibilities:
//   1. Look up the article whose slug matches the URL segment.
//   2. Serve the static article.html shell (via next()) so the browser
//      gets the page content.
//   3. Use HTMLRewriter to inject correct OG / Twitter / JSON-LD meta so
//      that link-preview crawlers (which don't run JS) see the right data.
//
// Slug lookup strategy:
//   a) Scan all JSON posts (posts/article<N>.json) for a title whose slug
//      matches — these are numbered articles migrated to Firestore.
//   b) Query Firestore `stories` collection for a published doc where the
//      stored `slug` field matches, OR whose title slugifies to the same
//      value.
//   c) Fall back to serving the bare article.html shell (client JS will
//      redirect to /articles if nothing is found).

import { listAllArticles, titleToSlug, SITE_URL, FALLBACK_IMAGE } from "../_utils/article-meta.js";

const SITE_NAME = "The Catalyst Magazine";

export const onRequestGet = async ({ request, params, next }) => {
  const slug = params.slug || "";
  if (!slug) return next();

  const origin = new URL(request.url).origin;
  const articles = await listAllArticles(origin).catch(() => []);
  const article = articles.find((a) => titleToSlug(a.title) === slug.toLowerCase());

  // Always serve the HTML shell so the page loads even if we can't find the
  // article server-side (client JS will handle the lookup).
  const origin_response = await next();
  if (!origin_response.ok) return origin_response;
  const ct = origin_response.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return origin_response;

  if (!article) return origin_response;

  const canonical = `${SITE_URL}/article/${encodeURIComponent(slug)}`;
  const title = `${article.title} | ${SITE_NAME}`;
  const description = truncate(article.excerpt || article.deck || "", 200);
  const image = article.image || FALLBACK_IMAGE;
  const author = article.author || SITE_NAME;
  const published = toIsoDate(article.publishedAt || article.date);
  const section = formatCategory(article.category);

  const jsonLd = buildArticleJsonLd({ title: article.title, description, image, author, published, section, canonical });

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
    .on("head", {
      element(el) {
        el.append(`<link rel="canonical" href="${escapeAttr(canonical)}">`, { html: true });
        el.append(`<meta property="og:image:secure_url" content="${escapeAttr(image)}">`, { html: true });
        el.append(`<meta property="article:author" content="${escapeAttr(author)}">`, { html: true });
        if (published) {
          el.append(`<meta property="article:published_time" content="${escapeAttr(published)}">`, { html: true });
        }
        if (section) {
          el.append(`<meta property="article:section" content="${escapeAttr(section)}">`, { html: true });
        }
        el.append(`<meta name="author" content="${escapeAttr(author)}">`, { html: true });
        el.append(`<script type="application/ld+json">${jsonLd}</script>`, { html: true });
        // Embed the article ID so client JS can load without a slug→id lookup.
        el.append(`<meta name="catalyst-article-id" content="${escapeAttr(String(article.id))}">`, { html: true });
      },
    });

  const response = rewriter.transform(origin_response);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
  headers.set("X-Article-Id", String(article.id));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

function truncate(str, max) {
  const s = (str || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function toIsoDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return isNaN(d) ? "" : d.toISOString();
}

function formatCategory(cat) {
  if (!cat) return "Feature";
  const map = { feature: "Feature", profile: "Profile", interview: "Interview", "op-ed": "Op-Ed", oped: "Op-Ed", editorial: "Editorial", news: "News" };
  return map[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
}

function buildArticleJsonLd({ title, description, image, author, published, section, canonical }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: title,
    description,
    image: [image],
    author: [{ "@type": "Person", name: author }],
    publisher: { "@type": "Organization", name: SITE_NAME, logo: { "@type": "ImageObject", url: `${SITE_URL}/NewLogoShape.png` } },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    url: canonical,
    articleSection: section,
  };
  if (published) { data.datePublished = published; data.dateModified = published; }
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
