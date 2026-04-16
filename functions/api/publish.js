// POST /api/publish
// Body: { storyId }
// Headers: Authorization: Bearer <firebase-id-token>
//
// 1. Verifies the caller is an authenticated admin or editor.
// 2. Loads the story, validates it, and marks it published (status=published,
//    publishedAt=now).
// 3. Counts published stories. If the total is a multiple of 3, fetches the
//    3 most recent published stories and emails the full subscriber list.
//
// The "every 3 stories, send a newsletter" rule lives right here.

import {
  json,
  badRequest,
  unauthorized,
  serverError,
  getBearerToken,
} from "../_utils/http.js";
import {
  verifyIdToken,
  firestoreGet,
  firestoreUpdate,
  firestoreRunQuery,
} from "../_utils/firebase.js";
import { sendBulkEmail } from "../_utils/resend.js";
import { newsletterEmail } from "../_utils/emails.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const token = getBearerToken(request);
    if (!token) return unauthorized("Missing Bearer token");

    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) return serverError(new Error("FIREBASE_PROJECT_ID missing"));

    // --- Auth ----------------------------------------------------------------
    let claims;
    try {
      claims = await verifyIdToken(token, projectId);
    } catch (e) {
      return unauthorized(`Invalid token: ${e.message}`);
    }

    const userDoc = await firestoreGet(env, `users/${claims.sub}`);
    if (!userDoc) return unauthorized("User record not found");
    const role = userDoc.fields?.role?.stringValue;
    if (!["admin", "editor"].includes(role)) {
      return unauthorized("Only editors or admins can publish");
    }

    // --- Input ---------------------------------------------------------------
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body");
    }
    const storyId = (body.storyId || "").trim();
    if (!storyId) return badRequest("storyId is required");

    // --- Load + publish ------------------------------------------------------
    const storyResp = await firestoreGet(env, `stories/${storyId}`);
    if (!storyResp) return badRequest("Story not found");

    const storyFields = storyResp.fields || {};
    const title = storyFields.title?.stringValue || "";
    if (!title.trim()) return badRequest("Story has no title");

    const now = new Date().toISOString();
    await firestoreUpdate(env, `stories/${storyId}`, {
      status: "published",
      publishedAt: now,
      publishedBy: claims.sub,
    });

    // --- Count published stories --------------------------------------------
    // We select a minimal set of fields. "select" with no fields returns the
    // document name only, which is all we need for counting.
    const published = await firestoreRunQuery(env, {
      from: [{ collectionId: "stories" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "status" },
          op: "EQUAL",
          value: { stringValue: "published" },
        },
      },
      orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
      limit: 100,
      select: { fields: [{ fieldPath: "title" }, { fieldPath: "publishedAt" }] },
    });

    const totalPublished = published.length;
    const shouldSendNewsletter =
      totalPublished > 0 && totalPublished % 3 === 0;

    let newsletterResult = null;
    if (shouldSendNewsletter) {
      const latestThree = await firestoreRunQuery(env, {
        from: [{ collectionId: "stories" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "published" },
          },
        },
        orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
        limit: 3,
      });

      const articles = latestThree.map((row) => ({
        title: row.data.title || "Untitled",
        excerpt: row.data.excerpt || row.data.deck || "",
        category: row.data.category || "Feature",
        coverImage: row.data.coverImage || row.data.image || "",
        url: row.data.url || row.data.link || `/articles.html`,
      }));

      const subscribers = await firestoreRunQuery(env, {
        from: [{ collectionId: "subscribers" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "active" },
          },
        },
        limit: 5000,
        select: { fields: [{ fieldPath: "email" }] },
      });

      const emails = subscribers
        .map((s) => s.data.email)
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i);

      const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";
      const html = newsletterEmail({ articles, siteUrl });

      if (emails.length > 0) {
        newsletterResult = await sendBulkEmail(env, {
          recipients: emails,
          subject: `New from The Catalyst: ${articles[0].title}`,
          html,
        });
      } else {
        newsletterResult = { skipped: true, reason: "no subscribers" };
      }
    }

    return json({
      ok: true,
      storyId,
      totalPublished,
      newsletterSent: Boolean(shouldSendNewsletter && newsletterResult && !newsletterResult.skipped),
      newsletter: newsletterResult,
    });
  } catch (err) {
    return serverError(err);
  }
};
