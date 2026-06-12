// POST /api/notify/dm
//
// Emails a teammate the private message that was just posted to their
// Directory chat thread, so messages reach people who aren't watching the
// dashboard. Fired best-effort by the dashboard right after the Firestore
// dm_threads write — the chat is the source of truth; this is the "you have
// a message" copy.
//
// Body: { toUserId, message }
//
// Auth: any staff role. Replies go straight to the sender (Reply-To is the
// sender's email), so a conversation can continue over email.
//
// Anti-spam: per-sender-per-recipient cooldown of 60s. Within the window the
// email is skipped (the message is still in the chat); this blunts rapid-fire
// chat bursts turning into inbox floods, not real conversations.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreCreate, firestoreUpdate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { directMessageEmail } from "../../_utils/reminder-emails.js";

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

    const toUserId = String(body.toUserId || "").trim();
    const message = String(body.message || "").trim().slice(0, MAX_MESSAGE_CHARS);
    if (!toUserId) return badRequest("Missing toUserId");
    if (!message) return badRequest("Missing message");
    if (toUserId === auth.uid) {
      return json({ ok: true, sent: false, skipped: true, reason: "sender is the recipient" });
    }

    const recipientDoc = await firestoreGet(env, `users/${toUserId}`);
    const recipient = recipientDoc ? unwrapDoc(recipientDoc, toUserId) : null;
    if (!recipient) return badRequest("Recipient not found");
    if (!recipient.email) {
      return json({ ok: true, sent: false, skipped: true, reason: "recipient has no email on file" });
    }

    // Cooldown — one email per sender+recipient per minute. The chat itself
    // is unthrottled; rapid follow-up messages still land in the thread.
    const cooldownId = `dm_${sanitizeId(auth.uid)}_${sanitizeId(toUserId)}`;
    const cooldownPath = `bot_event_notify_log/${cooldownId}`;
    const prior = await firestoreGet(env, cooldownPath);
    const lastAt = prior?.fields?.firedAt?.stringValue || null;
    if (lastAt && Date.now() - Date.parse(lastAt) < COOLDOWN_MS) {
      return json({ ok: true, sent: false, deduped: true, reason: "cooldown" });
    }

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const { subject, html } = directMessageEmail({
      senderName: auth.name || auth.email || "A teammate",
      senderRole: roleLabel(auth.role),
      message,
      recipientName: recipient.name || recipient.email,
      siteUrl,
    });

    await sendEmail(env, {
      to: recipient.email,
      subject,
      html,
      // Reply-to the sender so the conversation can continue over email.
      replyTo: auth.email || env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });

    const stamp = {
      type: "direct-message",
      firedBy: auth.email || auth.uid,
      firedAt: new Date().toISOString(),
      recipients: [recipient.email],
    };
    // Stamp the cooldown best-effort — a logging failure must not turn an
    // already-sent email into a 500.
    try {
      await firestoreUpdate(env, cooldownPath, stamp, { mergeFields: true });
    } catch (err) {
      if (err?.status === 404) {
        await firestoreCreate(env, "bot_event_notify_log", stamp, cooldownId).catch(() => {});
      } else {
        console.warn("[notify/dm] cooldown stamp failed:", err?.message || err);
      }
    }

    return json({ ok: true, sent: true, to: recipient.email });
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
