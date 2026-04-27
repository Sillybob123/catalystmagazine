// POST /api/guidance-email
// Body: { uid?, email?, templateId }
// Admin-only helper for sending role/workflow guidance emails from Advanced tools.

import { json, badRequest, serverError, isValidEmail } from "../_utils/http.js";
import {
  firestoreGet,
  firestoreUpdate,
  firestoreRunQuery,
} from "../_utils/firebase.js";
import { sendEmail } from "../_utils/resend.js";
import { requireRole } from "../_utils/auth.js";
import {
  buildGuidanceEmail,
  buildGuidanceText,
  getGuidanceTemplate,
  listGuidanceTemplates,
} from "../_utils/guidance-email-templates.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"]);
    if (auth instanceof Response) return auth;
    return json({ ok: true, templates: listGuidanceTemplates() });
  } catch (err) {
    return serverError(err);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"]);
    if (auth instanceof Response) return auth;

    let body;
    try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }

    const templateId = String(body.templateId || "").trim();
    const template = getGuidanceTemplate(templateId);
    if (!template) return badRequest("Unknown guidance email template.");

    const uidIn = String(body.uid || "").trim();
    const emailIn = String(body.email || "").trim().toLowerCase();
    if (!uidIn && !emailIn) return badRequest("Provide either uid or email.");
    if (emailIn && !isValidEmail(emailIn)) return badRequest("Invalid email.");

    const resolved = await resolveUser(env, { uid: uidIn, email: emailIn });
    if (!resolved) return badRequest("User not found.");
    if (!resolved.email || !isValidEmail(resolved.email)) {
      return badRequest("Stored user has no usable email.");
    }

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const recipientName = resolved.name || resolved.email;

    await sendEmail(env, {
      to: resolved.email,
      subject: template.subject,
      html: buildGuidanceEmail({ template, recipientName, siteUrl }),
      text: buildGuidanceText({ template, recipientName, siteUrl }),
      replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });

    try {
      await firestoreUpdate(env, `users/${resolved.uid}`, {
        lastGuidanceEmailSentAt: new Date().toISOString(),
        lastGuidanceEmailTemplate: templateId,
        lastGuidanceEmailSentBy: auth.uid,
      });
    } catch (err) {
      console.error("guidance-email: failed to stamp user doc", err.message);
    }

    return json({
      ok: true,
      sentTo: resolved.email,
      templateId,
      templateTitle: template.title,
    });
  } catch (err) {
    return serverError(err);
  }
};

async function resolveUser(env, { uid, email }) {
  if (uid) {
    const doc = await firestoreGet(env, `users/${uid}`);
    if (!doc) return null;
    const data = unwrapFields(doc.fields || {});
    return { uid, ...data, email: String(data.email || email || "").trim() };
  }

  const rows = await firestoreRunQuery(env, {
    from: [{ collectionId: "users" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "email" },
        op: "EQUAL",
        value: { stringValue: email },
      },
    },
    limit: 1,
  });
  if (!rows.length) return null;
  return {
    uid: rows[0].id,
    ...rows[0].data,
    email: String(rows[0].data.email || email || "").trim(),
  };
}

function unwrapFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if ("stringValue" in v) out[k] = v.stringValue;
    else if ("integerValue" in v) out[k] = Number(v.integerValue);
    else if ("doubleValue" in v) out[k] = v.doubleValue;
    else if ("booleanValue" in v) out[k] = v.booleanValue;
    else if ("timestampValue" in v) out[k] = v.timestampValue;
    else if ("arrayValue" in v) out[k] = (v.arrayValue.values || []).map((item) => item.stringValue).filter(Boolean);
    else out[k] = null;
  }
  return out;
}
