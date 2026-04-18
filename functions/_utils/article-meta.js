// Shared helpers for loading article metadata server-side.
// Used by functions/article.html.js (OG meta injection) and
// functions/sitemap.xml.js (sitemap generation).
//
// Data comes from two sources:
//   1. posts/article<N>.json — committed JSON files
//   2. Firestore `stories` collection (status == "published")

const SITE_URL = "https://www.catalyst-magazine.com";
const FALLBACK_IMAGE = `${SITE_URL}/NewLogoShape.png`;
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

// Cover images in JSON posts are either (a) already-absolute URLs (Wix CDN)
// or (b) repo-relative paths like "postimages/foo.webp". Resolve both.
function resolveImage(src) {
  if (!src) return FALLBACK_IMAGE;
  if (/^https?:\/\//i.test(src)) return src;
  const clean = src.replace(/^\/+/, "");
  return `${SITE_URL}/${clean}`;
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
// Must stay in sync with the client-side titleToSlug() in js/main.js.
export function titleToSlug(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export { SITE_URL, FALLBACK_IMAGE };
