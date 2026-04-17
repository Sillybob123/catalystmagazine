// POST /api/newsletter/preview
// Generates a newsletter HTML preview from the N most recent published stories,
// optionally overriding subject/headline/intro/article selection.
//
// Body: {
//   count?: 1 | 2 | 3 (default 3),
//   subject?, headline?, intro?,
//   articleIds?: string[]  // optional explicit selection (overrides count)
// }

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreRunQuery, firestoreGet } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { buildNewsletter } from "../../_utils/newsletter-template.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin", "newsletter_builder", "editor"]);
    if (auth instanceof Response) return auth;

    let body = {};
    try { body = await request.json(); } catch { /* empty body OK */ }

    const count = clamp(parseInt(body.count, 10) || 3, 1, 3);
    const subject = body.subject || "New from The Catalyst";
    const headline = body.headline || (count === 1 ? "A fresh story from The Catalyst" : `${count} new stories from The Catalyst`);
    const intro = body.intro || "Here is the latest reporting from our team of student writers. Tap any card to read the full piece.";
    const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";

    let articles;
    if (Array.isArray(body.articleIds) && body.articleIds.length) {
      // Explicit selection: fetch each by ID.
      const fetches = body.articleIds.slice(0, 3).map((id) => firestoreGet(env, `stories/${id}`));
      const results = await Promise.all(fetches);
      articles = results.filter(Boolean).map(docToArticle);
    } else {
      // Most-recent published stories.
      const docs = await firestoreRunQuery(env, {
        from: [{ collectionId: "stories" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "published" },
          },
        },
        orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
        limit: count,
      });
      articles = docs.map((d) => ({ id: d.id, ...d.data })).map(rowToArticle);
    }

    if (!articles.length) return badRequest("No published stories found.");

    const html = buildNewsletter({
      subject,
      preheader: articles[0]?.title || "",
      headline,
      intro,
      articles: articles.slice(0, count),
      siteUrl,
    });

    return json({ ok: true, html, subject, articles });
  } catch (err) {
    return serverError(err);
  }
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function rowToArticle(a) {
  return {
    id: a.id,
    title: a.title || "Untitled",
    excerpt: a.excerpt || a.dek || "",
    coverImage: a.coverImage || a.image || "",
    category: a.category || "Feature",
    author: a.author || a.authorName || "",
    url: a.url || a.slug || (a.id ? `/posts/${a.id}.html` : ""),
  };
}

function docToArticle(firestoreDoc) {
  // firestoreGet returns the raw Firestore REST doc; convert its fields.
  const f = firestoreDoc.fields || {};
  const pick = (k) => (f[k]?.stringValue ?? f[k]?.integerValue ?? "");
  const id = firestoreDoc.name ? firestoreDoc.name.split("/").pop() : null;
  return {
    id,
    title: pick("title") || "Untitled",
    excerpt: pick("excerpt") || pick("dek") || "",
    coverImage: pick("coverImage") || pick("image") || "",
    category: pick("category") || "Feature",
    author: pick("author") || pick("authorName") || "",
    url: pick("url") || pick("slug") || (id ? `/posts/${id}.html` : ""),
  };
}
