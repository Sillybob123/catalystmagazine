// Shared helpers for loading article metadata server-side.
// Used by functions/article.html.js (OG meta injection) and
// functions/sitemap.xml.js (sitemap generation).
//
// Data comes from two sources:
//   1. posts/article<N>.json — committed JSON files
//   2. Firestore `stories` collection (status == "published")

// Canonical host matches the verified Google Search Console property.
const DEFAULT_SITE_URL = "https://www.catalyst-magazine.com";
const SITE_URL = DEFAULT_SITE_URL;
const FALLBACK_IMAGE_PATH = "/NewLogoShape.png";
const FALLBACK_IMAGE = `${SITE_URL}${FALLBACK_IMAGE_PATH}`;
const FIRESTORE_PROJECT = "catalystwriters-5ce43";

const MAX_JSON_ARTICLE_INDEX = 100;

// Convert a posts/article<N>.json payload into a normalized article record.
function normalizeJsonArticle(data, index) {
  const meta = data?.article_data?.metadata || {};
  const blocks = Array.isArray(data?.article_data?.content_blocks)
    ? data.article_data.content_blocks
    : [];
  const title = (meta.title || "").trim();
  if (!title) return null;

  const excerpt =
    (meta.excerpt || "").trim() ||
    buildExcerptFromBlocks(blocks) ||
    "Read this story on The Catalyst Magazine.";

  const cover = (meta.cover_image_url || "").trim();

  return {
    id: `a${index}`,
    title,
    author: (meta.author || "The Catalyst").trim(),
    date: (meta.publish_date || "").trim(),
    image: resolveImage(cover),
    excerpt,
    category: (meta.category || "feature").toLowerCase().trim(),
  };
}

function buildExcerptFromBlocks(blocks) {
  const firstPara = blocks.find((b) => (b.type || "").toLowerCase().includes("paragraph"));
  if (!firstPara?.content) return "";
  return firstPara.content.replace(/\s+/g, " ").trim().slice(0, 220);
}

function normalizeSiteUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function isLocalOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return true;
  }
}

// Force canonical host so SEO output always matches the GSC-verified property,
// even when the request arrived on the naked domain or the *.pages.dev preview.
function forceCanonicalHost(origin) {
  if (!origin) return SITE_URL;
  try {
    const u = new URL(origin);
    if (/(^|\.)catalyst-magazine\.com$/i.test(u.hostname)) {
      return "https://www.catalyst-magazine.com";
    }
    if (u.hostname.endsWith(".pages.dev")) {
      return SITE_URL;
    }
    return origin;
  } catch {
    return SITE_URL;
  }
}

export function getSiteUrl(request, env) {
  const requestOrigin = request?.url ? normalizeSiteUrl(new URL(request.url).origin) : "";
  if (requestOrigin && !isLocalOrigin(requestOrigin)) return forceCanonicalHost(requestOrigin);

  const envSiteUrl = normalizeSiteUrl(env?.SITE_URL);
  if (envSiteUrl && !isLocalOrigin(envSiteUrl)) return forceCanonicalHost(envSiteUrl);

  return SITE_URL;
}

export function getFallbackImage(siteUrl = SITE_URL) {
  return `${siteUrl}${FALLBACK_IMAGE_PATH}`;
}

function stripOrigin(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.pathname || ""}${url.search || ""}${url.hash || ""}`;
  } catch {
    return raw;
  }
}

function normalizeArticleSlug(value) {
  const raw = stripOrigin(value)
    .split(/[?#]/, 1)[0]
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!raw) return "";
  if (raw.startsWith("article/")) return raw.slice("article/".length);
  if (raw.includes("/")) return "";
  return raw;
}

export function buildArticlePath(article = {}) {
  const slug =
    normalizeArticleSlug(article.slug) ||
    titleToSlug(article.title) ||
    normalizeArticleSlug(article.url) ||
    normalizeArticleSlug(article.link);
  if (slug) return `/article/${encodeURIComponent(slug)}`;

  const rawFallback = String(article.url || article.link || "").trim();
  if (/^https?:\/\//i.test(rawFallback)) return rawFallback;

  const fallback = stripOrigin(rawFallback);
  if (!fallback) return "/articles";
  return fallback.startsWith("/") ? fallback : `/${fallback}`;
}

export function buildArticleUrl(article = {}, siteUrl = SITE_URL) {
  const base = String(siteUrl || SITE_URL).replace(/\/+$/, "");
  const path = buildArticlePath(article);
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

// Cover images in JSON posts are either (a) already-absolute URLs (Wix CDN)
// or (b) repo-relative paths like "postimages/foo.webp". Resolve both.
function resolveImage(src, siteUrl = SITE_URL) {
  if (!src) return getFallbackImage(siteUrl);
  if (/^https?:\/\//i.test(src)) return src;
  const clean = src.replace(/^\/+/, "");
  return `${siteUrl}/${clean}`;
}

// Return a 1200×630 cropped version of the image for OG tags.
// Wix static images support path-based transforms; other URLs are returned as-is.
export function resolveOgImage(src, siteUrl = SITE_URL) {
  const url = resolveImage(src, siteUrl);
  if (!url || url === getFallbackImage(siteUrl)) return url;
  try {
    const u = new URL(url);
    if (u.hostname.includes("static.wixstatic.com")) {
      // Strip any existing /v1/... transform segment and append a fresh one.
      // Wix 403s if the asset filename isn't present before /v1/, so the
      // transform goes *after* the asset path, not in place of it.
      const v1Idx = u.pathname.indexOf("/v1/");
      const assetPath = v1Idx >= 0 ? u.pathname.slice(0, v1Idx) : u.pathname;
      const filename = assetPath.split("/").filter(Boolean).pop();
      return `${u.origin}${assetPath}/v1/fill/w_1200,h_630,al_c,q_90,usm_0.66_1.00_0.01,enc_auto/${filename}`;
    }
  } catch {
    // not a valid URL — fall through
  }
  return url;
}

function firestoreDocToArticle(doc) {
  const name = doc?.name || "";
  const id = name.split("/").pop();
  if (!id) return null;
  const f = doc.fields || {};
  const str = (k) => f[k]?.stringValue ?? "";
  const title = str("title");
  if (!title) return null;

  const publishedRaw =
    f.publishedAt?.timestampValue ||
    f.publishedAt?.stringValue ||
    f.createdAt?.timestampValue ||
    f.createdAt?.stringValue ||
    "";
  let date = "";
  if (publishedRaw) {
    const d = new Date(publishedRaw);
    if (!isNaN(d)) {
      date = d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    }
  }

  const deck = str("deck");
  const content = str("content");
  const excerpt =
    deck ||
    (content
      ? content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220)
      : "Read this story on The Catalyst Magazine.");

  return {
    id,
    title,
    slug: str("slug") || "",
    author: str("authorName") || str("author") || "The Catalyst",
    date,
    image: resolveImage(str("coverImage")),
    excerpt,
    category: (str("category") || "feature").toLowerCase(),
    publishedAt: publishedRaw,
  };
}

// Fetch a single article by ID. ID conventions:
//   "a<N>"  -> posts/article<N>.json  (stable, preferred)
//   "<N>"   -> posts/article<N>.json  (legacy filename-number)
//   other   -> Firestore doc ID in `stories` collection
export async function fetchArticleById(id, origin) {
  if (!id) return null;

  // JSON-post lookup
  const jsonMatch = /^a?(\d+)$/i.exec(String(id).trim());
  if (jsonMatch) {
    const idx = parseInt(jsonMatch[1], 10);
    if (idx >= 2 && idx <= MAX_JSON_ARTICLE_INDEX) {
      const article = await fetchJsonArticle(idx, origin);
      if (article) return article;
    }
  }

  // Firestore lookup (doc IDs are arbitrary strings)
  try {
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/stories/${encodeURIComponent(id)}`
    );
    if (!res.ok) return null;
    const doc = await res.json();
    const fields = doc.fields || {};
    if (fields.status?.stringValue !== "published") return null;
    return firestoreDocToArticle(doc);
  } catch {
    return null;
  }
}

async function fetchJsonArticle(index, origin) {
  try {
    const res = await fetch(`${origin}/posts/article${index}.json`);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/html")) return null;
    const text = await res.text();
    const data = JSON.parse(text.replace(/^\uFEFF/, "").trim());
    return normalizeJsonArticle(data, index);
  } catch {
    return null;
  }
}

// List every available article (for sitemap).
// JSON posts have all been migrated to Firestore — only query Firestore.
export async function listAllArticles() {
  const all = [];

  try {
    const body = {
      structuredQuery: {
        from: [{ collectionId: "stories" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "published" },
          },
        },
        orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
        limit: 200,
      },
    };
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows)) {
        rows
          .map((r) => r.document)
          .filter(Boolean)
          .map(firestoreDocToArticle)
          .filter(Boolean)
          .forEach((a) => all.push(a));
      }
    }
  } catch {
    // Firestore unavailable — return empty list.
  }

  return all;
}

// Find a single published article by slug — one Firestore query, no scanning.
export async function findArticleBySlug(slug) {
  if (!slug) return null;
  try {
    const body = {
      structuredQuery: {
        from: [{ collectionId: "stories" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: "status" },
                  op: "EQUAL",
                  value: { stringValue: "published" },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: "slug" },
                  op: "EQUAL",
                  value: { stringValue: slug },
                },
              },
            ],
          },
        },
        limit: 1,
      },
    };
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows[0]?.document) return null;
    return firestoreDocToArticle(rows[0].document);
  } catch {
    return null;
  }
}

// Convert an article title to a URL-safe kebab-case slug.
// Must stay in sync with js/dashboard/ui.js:slugify and js/main.js:titleToSlug.
export function titleToSlug(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Produce a keyword-rich meta description that always has useful content.
// Priority: provided excerpt → article deck → first content paragraph →
// title-based fallback. Always ends with a subtle brand/category tag so
// Google has context even for bare/empty-excerpt articles.
export function buildArticleDescription(article, maxLength = 160) {
  const clean = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const sources = [article?.excerpt, article?.deck, article?.content, article?.body];
  let base = "";
  for (const s of sources) {
    const v = clean(s);
    if (v.length >= 40) { base = v; break; }
  }
  if (!base) {
    const t = clean(article?.title);
    base = t
      ? `${t} — a STEM story from The Catalyst Magazine, Washington D.C.'s student-run science publication.`
      : "A STEM story from The Catalyst Magazine, Washington D.C.'s student-run science publication.";
  }
  if (base.length > maxLength) {
    base = base.slice(0, maxLength - 1).replace(/\s+\S*$/, "") + "…";
  }
  return base;
}

export { SITE_URL, FALLBACK_IMAGE };
