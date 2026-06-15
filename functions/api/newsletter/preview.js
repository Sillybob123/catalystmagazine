// POST /api/newsletter/preview
// Generates a newsletter HTML preview from the N most recent published stories,
// optionally overriding subject/headline/intro/article selection.
//
// Body: {
//   count?: 1 | 2 | 3 (default 3),
//   subject?, headline?, intro?,
//   articleIds?: string[],     // optional explicit selection (overrides count)
//   bookReviewIds?: string[],  // optional 0–2 book reviews for the bottom shelf
// }

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreRunQuery, firestoreGet } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { buildNewsletter, buildInboxNewsletter } from "../../_utils/newsletter-template.js";
import { buildArticlePath } from "../../_utils/article-meta.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    // Preview is read-only rendering. A user granted the Newsletter builder
    // page may preview; sending/cancelling stays newsletter_builder/admin-only.
    const auth = await requireRole(request, env, ["admin", "newsletter_builder", "editor"], ["#/newsletter/builder"]);
    if (auth instanceof Response) return auth;

    let body = {};
    try { body = await request.json(); } catch { /* empty body OK */ }

    const count = clamp(parseInt(body.count, 10) || 3, 1, 3);
    const theme = body.theme === "inbox" ? "inbox" : "classic";
    const subject = body.subject || "New from The Catalyst";
    const headline = body.headline || "New Stories From The Catalyst";
    const intro = body.intro || (theme === "inbox" ? "" : "Here is the latest reporting from our team of student writers. Tap any card to read the full piece.");
    const brainTeaser = body.brainTeaser === true;
    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";

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

    // Optional book-review section. Capped at 2 to keep the email scannable
    // and keep image weight under Gmail's clipping threshold. Each fetch is
    // wrapped so a single missing doc doesn't 500 the whole preview — we'd
    // rather render the issue without that one review than block the admin.
    let bookReviews = [];
    if (Array.isArray(body.bookReviewIds) && body.bookReviewIds.length) {
      const ids = body.bookReviewIds.slice(0, 2);
      const results = await Promise.all(
        ids.map((id) =>
          firestoreGet(env, `stories/${id}`).catch((err) => {
            console.warn("[newsletter/preview] firestoreGet stories/" + id + " failed:", err?.message || err);
            return null;
          })
        )
      );
      bookReviews = results.filter(Boolean).map(docToBookReview);
      console.log("[newsletter/preview] bookReviewIds:", ids, "→ resolved:", bookReviews.length);
    }

    const slicedArticles = articles.slice(0, count);
    const html = theme === "inbox"
      ? buildInboxNewsletter({
          subject,
          preheader: articles[0]?.title || "",
          headline,
          intro,
          articles: slicedArticles,
          bookReviews,
          brainTeaser,
          siteUrl,
          recipientFirstName: "Reader",
        })
      : buildNewsletter({
          subject,
          preheader: articles[0]?.title || "",
          headline,
          intro,
          articles: slicedArticles,
          bookReviews,
          brainTeaser,
          siteUrl,
          recipientFirstName: "Reader",
        });

    return json({ ok: true, html, subject, articles, bookReviews, brainTeaser, theme });
  } catch (err) {
    return serverError(err);
  }
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function rowToArticle(a) {
  const article = {
    id: a.id,
    title: a.title || "Untitled",
    excerpt: a.excerpt || a.dek || "",
    coverImage: a.coverImage || a.image || "",
    category: a.category || "Feature",
    author: a.author || a.authorName || "",
    slug: a.slug || "",
    url: a.url || a.link || "",
  };
  article.url = buildArticlePath(article);
  return article;
}

function docToArticle(firestoreDoc) {
  // firestoreGet returns the raw Firestore REST doc; convert its fields.
  const f = firestoreDoc.fields || {};
  const pick = (k) => (f[k]?.stringValue ?? f[k]?.integerValue ?? "");
  const id = firestoreDoc.name ? firestoreDoc.name.split("/").pop() : null;
  const article = {
    id,
    title: pick("title") || "Untitled",
    excerpt: pick("excerpt") || pick("dek") || "",
    coverImage: pick("coverImage") || pick("image") || "",
    category: pick("category") || "Feature",
    author: pick("author") || pick("authorName") || "",
    slug: pick("slug") || "",
    url: pick("url") || pick("link") || "",
  };
  article.url = buildArticlePath(article);
  return article;
}

// Same shape as docToArticle but pulls the book-review-specific fields
// (bookAuthor, rating, isbn) the email template uses.
function docToBookReview(firestoreDoc) {
  const f = firestoreDoc.fields || {};
  const pick = (k) => (f[k]?.stringValue ?? f[k]?.integerValue ?? "");
  const ratingRaw = f.rating;
  let rating = null;
  if (ratingRaw) {
    if ("doubleValue" in ratingRaw) rating = Number(ratingRaw.doubleValue);
    else if ("integerValue" in ratingRaw) rating = parseInt(ratingRaw.integerValue, 10);
  }
  const id = firestoreDoc.name ? firestoreDoc.name.split("/").pop() : null;
  return {
    id,
    title: pick("title") || "Untitled",
    excerpt: pick("excerpt") || pick("deck") || pick("dek") || "",
    coverImage: pick("coverImage") || pick("image") || "",
    category: "book-review",
    author: pick("authorName") || pick("author") || "",
    bookAuthor: pick("bookAuthor") || "",
    isbn: pick("isbn") || "",
    rating,
    slug: pick("slug") || "",
  };
}
