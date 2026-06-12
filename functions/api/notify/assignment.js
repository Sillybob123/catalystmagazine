// POST /api/notify/assignment
//
// Emails the assignee of a freshly created social-post assignment. Fired
// best-effort by the Planner right after the social_assignments doc is
// written — the assignment doc is the source of truth; this is the heads-up.
//
// Body: { assignmentId }
// Auth: admin, or a user granted '#/planner/assign' (the same people the
// Firestore rules allow to create assignments).
//
// Idempotency: one email per assignment, keyed on
// bot_event_notify_log/assignment_{assignmentId}.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreCreate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { socialAssignmentEmail } from "../../_utils/reminder-emails.js";

const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"], ["#/planner/assign"]);
    if (auth instanceof Response) return auth;

    let body = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch {
      return badRequest("Invalid JSON body");
    }
    const assignmentId = String(body.assignmentId || "").trim();
    if (!ID_RE.test(assignmentId)) return badRequest("Invalid assignmentId");

    const docResp = await firestoreGet(env, `social_assignments/${assignmentId}`);
    if (!docResp) return badRequest("Assignment not found");
    const assignment = unwrapDoc(docResp, assignmentId);

    // Owner set: the multi-owner array when present, legacy single assignee
    // otherwise. Dedupe per assignment AND owner set, so adding someone to a
    // shared task emails the new set once without endless re-sends.
    const ownerIds = (Array.isArray(assignment.assigneeIds) && assignment.assigneeIds.length
      ? assignment.assigneeIds
      : [assignment.assigneeId].filter(Boolean));
    const logId = `assignment_${assignmentId}_${sanitizeId(ownerIds.slice().sort().join("-") || "none")}`;
    const existing = await firestoreGet(env, `bot_event_notify_log/${logId}`);
    if (existing) return json({ ok: true, sent: false, deduped: true });

    // Resolve each owner's email — prefer the live user doc over whatever
    // was snapshotted onto the assignment.
    const emails = [];
    for (const ownerId of ownerIds) {
      const userDoc = await firestoreGet(env, `users/${ownerId}`).catch(() => null);
      const fromDoc = userDoc?.fields?.email?.stringValue?.trim() || "";
      const fromSnapshot = (assignment.assignees || []).find((o) => o?.id === ownerId)?.email || "";
      const email = fromDoc || String(fromSnapshot || "").trim()
        || (ownerId === assignment.assigneeId ? String(assignment.assigneeEmail || "").trim() : "");
      if (email && !emails.includes(email)) emails.push(email);
    }
    if (!emails.length) {
      return json({ ok: true, sent: false, skipped: true, reason: "no owner emails on file" });
    }

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const { subject, html } = socialAssignmentEmail({
      assignment,
      assignerName: assignment.createdByName || auth.name || auth.email || "The team",
      siteUrl,
    });

    await sendEmail(env, {
      to: emails,
      subject,
      html,
      // Reply-to the assigner so questions go to the right person.
      replyTo: auth.email || env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });

    await firestoreCreate(env, "bot_event_notify_log", {
      type: "social-assignment",
      assignmentId,
      firedBy: auth.email || auth.uid,
      firedAt: new Date().toISOString(),
      recipients: emails,
    }, logId).catch(() => {});

    return json({ ok: true, sent: true, to: emails });
  } catch (err) {
    return serverError(err);
  }
};

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
