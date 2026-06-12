// POST /api/notify/published
// Body: { storyId }
// Auth: Firebase ID token for an admin or editor.
//
// Sends the "your story has been approved and published" congratulations email
// to the story's author (CC'ing the admins), with a link to the live article.
//
// Why this exists separately from /api/publish:
//   The admin dashboard's publish actions (final-review "Publish now", the
//   admin status dropdown, and the admin "publish now" override) write
//   status:"published" straight to Firestore via the client SDK — they never
//   call /api/publish. So the author email wired into that endpoint never
//   fired. The dashboard now calls THIS endpoint, best-effort, right after a
//   successful publish write.
//
// Idempotency:
//   Keyed on bot_event_notify_log/{storyId}_published so a double-click, a
//   re-save, or both the dashboard AND /api/publish firing for the same story
//   only ever sends one email.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { requireRole } from "../../_utils/auth.js";
import { firestoreGet, firestoreCreate, firestoreRunQuery } from "../../_utils/firebase.js";
import { buildArticleUrl } from "../../_utils/article-meta.js";
import { sendEmail } from "../../_utils/resend.js";
import { articlePublishedEmail, socialPublishedEmail } from "../../_utils/reminder-emails.js";

const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

// Admins CC'd on every author congratulations email. Mirrors the list used by
// the editorial notification system (notify/event.js) and /api/publish.
const ADMIN_CC_RECIPIENTS = [
  "bendoryair@gmail.com",
  "stemcatalystmagazine@gmail.com",
  "aidan.schurr@gwmail.gwu.edu",
];

function field(fields, key) {
  return fields?.[key]?.stringValue || "";
}

// Resolve the primary author's email from the story's authorId. Stories store
// one authorId plus a (possibly comma-joined) authorName; co-authors are not
// separately addressable, so we email the primary author only. Returns null
// when there's no authorId or the user record carries no email.
async function resolveAuthorEmail(env, authorId) {
  if (!authorId) return null;
  const userDoc = await firestoreGet(env, `users/${authorId}`);
  const email = userDoc?.fields?.email?.stringValue || "";
  return email.trim() || null;
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin", "editor"]);
    if (auth instanceof Response) return auth;

    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body");
    }
    const storyId = String(body.storyId || "").trim();
    if (!ID_RE.test(storyId)) return badRequest("Invalid storyId");

    // Load the story and confirm it's actually published — we never want to
    // congratulate someone for a story that isn't live.
    const storyResp = await firestoreGet(env, `stories/${storyId}`);
    if (!storyResp) return badRequest("Story not found");
    const fields = storyResp.fields || {};

    const status = field(fields, "status");
    if (status !== "published") {
      return json({ ok: true, sent: false, skipped: true, reason: `story status is '${status || "unknown"}', not published` });
    }

    // Idempotency guard: one email per published story, ever.
    const logPath = `bot_event_notify_log/${storyId}_published`;
    const existing = await firestoreGet(env, logPath);
    if (existing) {
      return json({ ok: true, sent: false, deduped: true });
    }

    const title = field(fields, "title");
    if (!title.trim()) return badRequest("Story has no title");

    const authorId = field(fields, "authorId");
    const authorEmail = await resolveAuthorEmail(env, authorId);

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const category = field(fields, "category") || "Feature";
    const slug = field(fields, "slug");
    const authorName = field(fields, "authorName") || field(fields, "author") || "there";
    const articleUrl = buildArticleUrl({ title, slug, category }, siteUrl);

    // Tell the social media team a story just went live — they plan the
    // announcement posts from the Planner. Best-effort: a social-send failure
    // never blocks the author's congratulations email, and the shared
    // {storyId}_published log already prevents repeats.
    const socialRecipients = await notifySocialTeam(env, {
      title, authorName, articleUrl, category, siteUrl,
    });

    if (!authorEmail) {
      // Record the attempt so we don't re-scan on every dashboard re-save, but
      // mark it skipped so it's clear no mail went out.
      await firestoreCreate(env, "bot_event_notify_log", {
        storyId,
        type: "published",
        sent: false,
        reason: "no author email on record",
        socialTeam: socialRecipients.join(", "),
        createdAt: new Date().toISOString(),
      }, `${storyId}_published`).catch(() => {});
      return json({ ok: true, sent: false, skipped: true, reason: "no author email on record", socialTeam: socialRecipients });
    }

    const { subject, html } = articlePublishedEmail({
      title,
      authorName,
      articleUrl,
      category,
      siteUrl,
    });

    // CC the admins, but drop the author if they're an admin themselves.
    const cc = ADMIN_CC_RECIPIENTS.filter(
      (addr) => addr.toLowerCase() !== authorEmail.toLowerCase()
    );

    await sendEmail(env, {
      to: authorEmail,
      cc,
      subject,
      html,
      replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });

    // Log AFTER a successful send so a transient mail failure can be retried by
    // the next dashboard re-save rather than being permanently deduped away.
    await firestoreCreate(env, "bot_event_notify_log", {
      storyId,
      type: "published",
      sent: true,
      to: authorEmail,
      cc: cc.join(", "),
      socialTeam: socialRecipients.join(", "),
      createdAt: new Date().toISOString(),
    }, `${storyId}_published`).catch(() => {});

    return json({ ok: true, sent: true, to: authorEmail, cc, socialTeam: socialRecipients });
  } catch (err) {
    return serverError(err);
  }
};

// Email every user with the social_media role that the story is live.
// Returns the list of addresses we attempted (empty when the team is empty
// or the send failed) — callers record it in the notify log for audit.
async function notifySocialTeam(env, { title, authorName, articleUrl, category, siteUrl }) {
  try {
    const rows = await firestoreRunQuery(env, {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "role" },
          op: "EQUAL",
          value: { stringValue: "social_media" },
        },
      },
      select: { fields: [{ fieldPath: "email" }, { fieldPath: "name" }] },
      limit: 50,
    });
    const emails = (rows || [])
      .map((r) => String(r.data?.email || "").trim())
      .filter(Boolean);
    if (!emails.length) return [];

    const { subject, html } = socialPublishedEmail({
      title, authorName, articleUrl, category, siteUrl,
    });
    await sendEmail(env, {
      to: emails,
      subject,
      html,
      replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });
    return emails;
  } catch (err) {
    console.warn("[notify/published] social team email failed:", err?.message || err);
    return [];
  }
}
