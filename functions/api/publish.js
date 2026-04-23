// POST /api/publish
// Body: { storyId }
// Headers: Authorization: Bearer <firebase-id-token>
//
// 1. Verifies the caller is an authenticated admin or editor.
// 2. Loads the story, validates it, and marks it published (status=published,
//    publishedAt=now).
// 3. Counts published stories. If the total is a multiple of 3, fetches the
//    3 most recent published stories and emails the full subscriber list.
// 4. Always creates Instagram + LinkedIn draft social posts in social_posts.
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
  firestoreCreate,
  getProjectId,
} from "../_utils/firebase.js";
import { titleToSlug, buildArticlePath, buildArticleUrl } from "../_utils/article-meta.js";
import { sendBulkEmail } from "../_utils/resend.js";
import { buildNewsletter } from "../_utils/newsletter-template.js";
import { notifyArticlePublished } from "../_utils/seo-notify.js";

// Return a square-cropped version of the cover image for Instagram.
// Wix CDN images support path-based transforms; everything else is returned as-is.
function resolveSquareImage(src) {
  if (!src) return src;
  try {
    const u = new URL(src);
    if (u.hostname.includes("static.wixstatic.com")) {
      const v1Idx = u.pathname.indexOf("/v1/");
      const assetPath = v1Idx >= 0 ? u.pathname.slice(0, v1Idx) : u.pathname;
      const filename = assetPath.split("/").filter(Boolean).pop();
      return `${u.origin}${assetPath}/v1/fill/w_1080,h_1080,al_c,q_90,usm_0.66_1.00_0.01,enc_auto/${filename}`;
    }
  } catch {
    // not a Wix URL — return as-is
  }
  return src;
}

async function createSocialDrafts(env, { title, slug, author, coverImage, category, deck, siteUrl, publishedBy, publisherName }) {
  const articleUrl = buildArticleUrl({ title, slug }, siteUrl);
  const squareImage = resolveSquareImage(coverImage);
  const deadlineDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const now = new Date().toISOString();

  const categoryTag = `#${(category || "Feature").replace(/\s+/g, "")}`;

  const igCaption =
    `"${title}"\n\n` +
    `${deck ? deck + "\n\n" : ""}` +
    `Written by ${author} — link in bio to read the full article!\n\n` +
    `${categoryTag} #TheCatalyst #STEMJournalism #ScienceWriting #CatalystMagazine`;

  const linkedInCaption =
    `We just published a new article on The Catalyst Magazine!\n\n` +
    `"${title}"\n\n` +
    `${deck ? deck + "\n\n" : ""}` +
    `Big shoutout to ${author} for writing this piece. Check it out here:\n` +
    `${articleUrl}\n\n` +
    `#TheCatalyst #STEMJournalism #ScienceWriting #CatalystMagazine ${categoryTag}`;

  const basePost = {
    status: "proposed",
    proposerId: publishedBy,
    proposerName: publisherName,
    assigneeId: null,
    assigneeName: null,
    deadline: deadlineDate,
    createdAt: now,
    activity: [{ text: "auto-created on article publish", authorName: publisherName, timestamp: now }],
  };

  const [igPost, liPost] = await Promise.all([
    firestoreCreate(env, "social_posts", {
      ...basePost,
      title: `Instagram: ${title}`,
      platform: "instagram",
      content: igCaption,
      notes: squareImage
        ? `Cover image (square crop): ${squareImage}\n\nDownload this image and post alongside the caption above.`
        : "No cover image found — create a square graphic manually.",
    }),
    firestoreCreate(env, "social_posts", {
      ...basePost,
      title: `LinkedIn: ${title}`,
      platform: "linkedin",
      content: linkedInCaption,
      notes: `Article URL: ${articleUrl}\nAuthor: ${author}`,
    }),
  ]);

  return { instagram: igPost.id, linkedin: liPost.id };
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const token = getBearerToken(request);
    if (!token) return unauthorized("Missing Bearer token");

    const projectId = getProjectId(env);

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
    const existingSlug = storyFields.slug?.stringValue || "";
    const slug = existingSlug || titleToSlug(title);
    await firestoreUpdate(env, `stories/${storyId}`, {
      status: "published",
      publishedAt: now,
      publishedBy: claims.sub,
      slug,
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
        slug: row.data.slug || "",
        url: buildArticlePath(row.data),
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
      });

      const seen = new Set();
      const recipients = subscribers
        .map((s) => ({ email: s.data?.email, firstName: s.data?.firstName || "" }))
        .filter(({ email }) => {
          if (!email || seen.has(email)) return false;
          seen.add(email);
          return true;
        });

      const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
      const newsletterSubject = `New from The Catalyst: ${articles[0].title}`;
      const html = buildNewsletter({
        subject: newsletterSubject,
        preheader: `${articles[0].title} — and more inside.`,
        articles,
        siteUrl,
      });

      if (recipients.length > 0) {
        newsletterResult = await sendBulkEmail(env, {
          recipients,
          subject: newsletterSubject,
          html,
        });
      } else {
        newsletterResult = { skipped: true, reason: "no subscribers" };
      }
    }

    // Best-effort SEO notification: IndexNow + Cloudflare cache purge for
    // /sitemap.xml so Google sees the new article on its next sitemap crawl.
    // Failures here must not fail the publish response.
    const publishedSiteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const articlePath = buildArticlePath({ title, slug });
    const seoResult = await notifyArticlePublished(env, publishedSiteUrl, articlePath).catch(
      (e) => ({ error: String(e?.message || e) })
    );

    // --- Auto-create Instagram + LinkedIn social post drafts ----------------
    const socialResult = await createSocialDrafts(env, {
      title,
      slug,
      author: storyFields.authorName?.stringValue || storyFields.author?.stringValue || "The Catalyst",
      coverImage: storyFields.coverImage?.stringValue || storyFields.image?.stringValue || "",
      category: storyFields.category?.stringValue || "Feature",
      deck: storyFields.deck?.stringValue || storyFields.excerpt?.stringValue || "",
      siteUrl: publishedSiteUrl,
      publishedBy: claims.sub,
      publisherName: userDoc.fields?.displayName?.stringValue || userDoc.fields?.name?.stringValue || "The Catalyst",
    }).catch((e) => ({ error: String(e?.message || e) }));

    return json({
      ok: true,
      storyId,
      totalPublished,
      newsletterSent: Boolean(shouldSendNewsletter && newsletterResult && !newsletterResult.skipped),
      newsletter: newsletterResult,
      seo: seoResult,
      social: socialResult,
    });
  } catch (err) {
    return serverError(err);
  }
};
