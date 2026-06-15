// POST /api/notify/comment
//
// Emails a teammate the comment that was just posted to a project's activity
// chat, so messages reach people who aren't watching the dashboard. Fired
// best-effort by the dashboard right after the Firestore arrayUnion write —
// the chat is the source of truth; this is the "you have a message" copy.
//
// Body: { projectId, message, toUserId? }
//   - toUserId defaults to the project's author (the person working on the
//     story) — the common case is the social media team asking the author a
//     question from the Planner.
//
// Auth: any staff role. Replies go straight to the sender (Reply-To is the
// sender's email), so a thread can continue over email without the dashboard.
//
// Anti-spam: per-sender-per-project cooldown of 60s. Within the window the
// email is skipped (the comment is still in the chat); this only blunts
// accidental double-sends and runaway loops, not real conversations.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreCreate, firestoreUpdate, collectUserEmails } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { directCommentEmail } from "../../_utils/reminder-emails.js";
import { createNotification } from "../../_utils/notifications.js";

const STAFF_ROLES = ["admin", "editor", "writer", "newsletter_builder", "marketing", "social_media"];
const MAX_MESSAGE_CHARS = 2000;
const COOLDOWN_MS = 60 * 1000;

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, STAFF_ROLES);
    if (auth instanceof Response) return auth;

    let body = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch {
      return badRequest("Invalid JSON body");
    }

    const projectId = String(body.projectId || "").trim();
    const message = String(body.message || "").trim().slice(0, MAX_MESSAGE_CHARS);
    const toUserId = String(body.toUserId || "").trim();
    if (!projectId) return badRequest("Missing projectId");
    if (!message) return badRequest("Missing message");

    const projectDoc = await firestoreGet(env, `projects/${projectId}`);
    if (!projectDoc) return badRequest("Project not found");
    const project = unwrapDoc(projectDoc, projectId);

    const recipientId = toUserId || project.authorId || "";
    if (!recipientId) {
      return json({ ok: true, sent: false, skipped: true, reason: "no recipient on project" });
    }
    if (recipientId === auth.uid) {
      return json({ ok: true, sent: false, skipped: true, reason: "sender is the recipient" });
    }

    const recipientDoc = await firestoreGet(env, `users/${recipientId}`);
    const recipient = recipientDoc ? unwrapDoc(recipientDoc, recipientId) : null;
    if (!recipient) {
      return json({ ok: true, sent: false, skipped: true, reason: "recipient not found" });
    }
    // Reach every inbox on file (extraEmails + duplicate-doc emails), not just
    // the primary.
    const recipientEmails = await collectUserEmails(env, recipient);
    if (!recipientEmails.length) {
      return json({ ok: true, sent: false, skipped: true, reason: "recipient has no email on file" });
    }

    // Cooldown — one email per sender+project per minute. The chat itself is
    // unthrottled; this only stops double-clicks from double-emailing.
    const cooldownId = `comment_${sanitizeId(projectId)}_${sanitizeId(auth.uid)}`;
    const cooldownPath = `bot_event_notify_log/${cooldownId}`;
    const prior = await firestoreGet(env, cooldownPath);
    const lastAt = prior?.fields?.firedAt?.stringValue || null;
    if (lastAt && Date.now() - Date.parse(lastAt) < COOLDOWN_MS) {
      return json({ ok: true, sent: false, deduped: true, reason: "cooldown" });
    }

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const { subject, html } = directCommentEmail({
      project,
      senderName: auth.name || auth.email || "A teammate",
      senderRole: roleLabel(auth.role),
      message,
      recipientName: recipient.name || recipient.email,
      siteUrl,
    });

    await sendEmail(env, {
      to: recipientEmails,
      subject,
      html,
      // Reply-to the sender so the conversation can continue over email.
      replyTo: auth.email || env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });

    // In-app notification (the topbar bell). Best-effort — never blocks the
    // email. Each comment is distinct, so no dedupeId (auto-id).
    await createNotification(env, {
      recipientId,
      type: "comment",
      title: `${auth.name || auth.email || "A teammate"} commented on ${project.title || "your project"}`,
      body: message.slice(0, 140),
      actorId: auth.uid,
      actorName: auth.name || auth.email || "",
      actionHash: "#/pipeline/mine",
    });

    const stamp = {
      type: "direct-comment",
      projectId,
      firedBy: auth.email || auth.uid,
      firedAt: new Date().toISOString(),
      recipients: recipientEmails,
    };
    // Stamp the cooldown best-effort — a logging failure must not turn an
    // already-sent email into a 500.
    try {
      await firestoreUpdate(env, cooldownPath, stamp, { mergeFields: true });
    } catch (err) {
      if (err?.status === 404) {
        await firestoreCreate(env, "bot_event_notify_log", stamp, cooldownId).catch(() => {});
      } else {
        console.warn("[notify/comment] cooldown stamp failed:", err?.message || err);
      }
    }

    return json({ ok: true, sent: true, to: recipientEmails });
  } catch (err) {
    return serverError(err);
  }
};

function roleLabel(role) {
  return {
    admin: "Admin",
    editor: "Editor",
    writer: "Writer",
    newsletter_builder: "Newsletter Builder",
    marketing: "Marketing",
    social_media: "Social Media",
  }[role] || role || "";
}

function sanitizeId(s) {
  return String(s || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function unwrapDoc(doc, id) {
  const fields = doc.fields || {};
  const out = { id };
  for (const [k, v] of Object.entries(fields)) out[k] = unwrap(v);
  return out;
}

function unwrap(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) {
    const out = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) out[k] = unwrap(vv);
    return out;
  }
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(unwrap);
  return null;
}
