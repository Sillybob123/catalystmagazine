// POST /api/notify/announcement
//
// Emails a staff announcement to the whole team. Fired from Admin → Advanced
// tools → Announcements when the admin ticks "also email the team". The
// announcement also lives in the `announcements` collection and shows as a
// red banner on everyone's dashboard Overview — this is the email copy.
//
// Body: { announcementId?, title, message?, link? }
//   - announcementId is optional but, when present, used to stamp a one-time
//     "emailed" guard so the same announcement can't be blasted twice.
//
// Auth: admin only. Reply-To is the sending admin so staff can respond.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreCreate, firestoreRunQuery } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { announcementEmail } from "../../_utils/reminder-emails.js";

const MAX_TITLE = 160;
const MAX_MESSAGE = 4000;

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"]);
    if (auth instanceof Response) return auth;

    let body = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch {
      return badRequest("Invalid JSON body");
    }

    const announcementId = String(body.announcementId || "").trim();
    const title = String(body.title || "").trim().slice(0, MAX_TITLE);
    const message = String(body.message || "").trim().slice(0, MAX_MESSAGE);
    const link = String(body.link || "").trim().slice(0, 600);
    if (!title && !message) return badRequest("Announcement needs a title or message");

    // One-time email guard per announcement (best-effort).
    if (announcementId) {
      const logPath = `bot_event_notify_log/announcement_${sanitizeId(announcementId)}`;
      const existing = await firestoreGet(env, logPath);
      if (existing) {
        return json({ ok: true, sent: false, deduped: true, reason: "already emailed" });
      }
    }

    // Every active staff member, de-duplicated by email.
    const emails = await collectStaffEmails(env);
    if (!emails.length) {
      return json({ ok: true, sent: false, skipped: true, reason: "no staff emails on file" });
    }

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const { subject, html } = announcementEmail({
      title,
      message,
      link,
      senderName: auth.name || "The Catalyst admins",
      siteUrl,
    });

    await sendEmail(env, {
      to: emails,
      subject,
      html,
      replyTo: auth.email || env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });

    if (announcementId) {
      await firestoreCreate(env, "bot_event_notify_log", {
        type: "announcement",
        announcementId,
        firedBy: auth.email || auth.uid,
        firedAt: new Date().toISOString(),
        recipientCount: emails.length,
      }, `announcement_${sanitizeId(announcementId)}`).catch(() => {});
    }

    return json({ ok: true, sent: true, recipientCount: emails.length });
  } catch (err) {
    return serverError(err);
  }
};

// Pull every staff user's email. Staff roles only (no readers — they're the
// newsletter audience, not the team). De-duplicated, lowercased.
async function collectStaffEmails(env) {
  const STAFF_ROLES = ["admin", "editor", "writer", "newsletter_builder", "marketing", "social_media"];
  const seen = new Set();
  for (const role of STAFF_ROLES) {
    let rows = [];
    try {
      rows = await firestoreRunQuery(env, {
        from: [{ collectionId: "users" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "role" },
            op: "EQUAL",
            value: { stringValue: role },
          },
        },
        select: { fields: [{ fieldPath: "email" }, { fieldPath: "status" }] },
        limit: 300,
      });
    } catch (err) {
      console.warn(`[notify/announcement] query for role ${role} failed:`, err?.message || err);
      continue;
    }
    for (const r of rows || []) {
      if (String(r.data?.status || "active") === "inactive") continue;
      const email = String(r.data?.email || "").trim().toLowerCase();
      if (email) seen.add(email);
    }
  }
  return Array.from(seen);
}

function sanitizeId(s) {
  return String(s || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}
