// Intercepts GET /article.html and rewrites head meta tags so that link-
// preview crawlers (iMessage, Facebook, Twitter, WhatsApp, LinkedIn, Slack,
// Discord) see the article's title, description, and cover image.
//
// Crawlers do NOT execute JavaScript, so we can't rely on the client-side
// meta updates in js/main.js. We fetch the underlying static article.html
// asset from Cloudflare Pages and use HTMLRewriter to patch the head in
// place before returning it.

import { fetchArticleById, titleToSlug, resolveOgImage, getSiteUrl, getFallbackImage, buildArticleDescription } from "./_utils/article-meta.js";

const SITE_NAME = "The Catalyst Magazine";

export const onRequestGet = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  // No id -> serve the static article.html unchanged (client JS will redirect).
  if (!id) return next();

  const article = await fetchArticleById(id, url.origin).catch(() => null);
  if (!article) return next();

  const siteUrl = getSiteUrl(request, env);

  // Pull the static article.html asset from Pages.
  const origin = await next();
  if (!origin.ok) return origin;
  const ct = origin.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return origin;

  const canonical = article.title
    ? `${siteUrl}/article/${encodeURIComponent(titleToSlug(article.title))}`
    : `${siteUrl}/article?id=${encodeURIComponent(id)}`;
  const title = `${article.title} | ${SITE_NAME}`;
  const description = buildArticleDescription(article, 160);
  const image = resolveOgImage(article.image, siteUrl) || getFallbackImage(siteUrl);
  const author = article.author || SITE_NAME;
  const published = toIsoDate(article.date);
  const section = formatCategory(article.category);

  const jsonLd = buildArticleJsonLd({
    title: article.title,
    description,
    image,
    author,
    published,
    section,
    canonical,
    siteUrl,
  });

  const rewriter = new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(escapeHtml(title));
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute("content", title);
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('meta[property="og:image"]', {
      element(el) {
        el.setAttribute("content", image);
      },
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute("content", canonical);
      },
    })
    .on('meta[property="og:type"]', {
      element(el) {
        el.setAttribute("content", "article");
      },
    })
    .on('meta[name="twitter:title"]', {
      element(el) {
        el.setAttribute("content", title);
      },
    })
    .on('meta[name="twitter:description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('meta[name="twitter:image"]', {
      element(el) {
        el.setAttribute("content", image);
      },
    })
    .on('meta[name="twitter:url"]', {
      element(el) {
        el.setAttribute("content", canonical);
      },
    })
    .on('meta[property="og:image:alt"]', {
      element(el) {
        el.setAttribute("content", article.title);
      },
    })
    .on('meta[name="twitter:image:alt"]', {
      element(el) {
        el.setAttribute("content", article.title);
      },
    })
    // Remove stale hardcoded width/height so we can replace with correct values.
    .on('meta[property="og:image:width"]', { element: (el) => el.remove() })
    .on('meta[property="og:image:height"]', { element: (el) => el.remove() })
    // Inject canonical + extra article meta + JSON-LD at the end of <head>.
    .on("head", {
      element(el) {
        el.append(`<link rel="canonical" href="${escapeAttr(canonical)}">`, { html: true });
        el.append(
          `<meta property="og:image:secure_url" content="${escapeAttr(image)}">`,
          { html: true }
        );
        el.append(`<meta property="og:image:width" content="1200">`, { html: true });
        el.append(`<meta property="og:image:height" content="630">`, { html: true });
        el.append(
          `<meta property="article:author" content="${escapeAttr(author)}">`,
          { html: true }
        );
        if (published) {
          el.append(
            `<meta property="article:published_time" content="${escapeAttr(published)}">`,
            { html: true }
          );
        }
        if (section) {
          el.append(
            `<meta property="article:section" content="${escapeAttr(section)}">`,
            { html: true }
          );
        }
        el.append(`<meta name="author" content="${escapeAttr(author)}">`, { html: true });
        el.append(
          `<script type="application/ld+json">${jsonLd}</script>`,
          { html: true }
        );
      },
    });

  const response = rewriter.transform(origin);
  const headers = new Headers(response.headers);
  // Cache at the edge for a minute — fresh enough for new publishes, cheap
  // enough to absorb crawler traffic.
  headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
  headers.set("X-Article-Id", article.id);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

function truncate(str, max) {
  const s = (str || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function toIsoDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  return d.toISOString();
}

function formatCategory(cat) {
  if (!cat) return "Feature";
  const map = {
    feature: "Feature",
    profile: "Profile",
    interview: "Interview",
    "op-ed": "Op-Ed",
    oped: "Op-Ed",
    editorial: "Editorial",
    news: "News",
  };
  return map[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
}

function buildArticleJsonLd({ title, description, image, author, published, section, canonical, siteUrl }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: title,
    description,
    image: [image],
    author: [{ "@type": "Person", name: author }],
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/NewLogoShape.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonical,
    },
    url: canonical,
    articleSection: section,
  };
  if (published) {
    data.datePublished = published;
    data.dateModified = published;
  }
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
