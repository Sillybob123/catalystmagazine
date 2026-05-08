// POST /api/notify/event
//
// Event-driven editorial notifications. Fired by the dashboard the instant a
// user-initiated event happens — distinct from the daily cron-based bot which
// scans state. Three event types right now:
//
//   "proposal-pending"  — a writer submitted a new proposal → email admins.
//   "writing-complete"  — a writer marked Article Writing Complete → email admins.
//   "editor-assigned"   — admin assigned an editor to a project → email that editor.
//
// Body: { type, projectId }
// Auth: Firebase ID token (any signed-in author, editor, or admin can fire it).
//
// Idempotency: each (projectId, type) pair is logged to
// `bot_event_notify_log/{projectId}_{type}`. Re-firing the same event for the
// same project is a no-op. The dashboard's writing-complete checkbox can be
// toggled off/on, but we won't re-spam admins.
//
// No cooldown — these are single moments. Admins explicitly want them right
// away, and editors only get assigned once per project.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreCreate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import {
  adminProposalPendingEmail,
  adminWritingCompleteEmail,
  editorAssignedEmail,
  proposalApprovedEmail,
  adminDeadlineChangeRequestedEmail,
  writerDeadlineChangeResolvedEmail,
  writerReviewCompleteEmail,
} from "../../_utils/reminder-emails.js";

const DEFAULT_ADMIN_RECIPIENTS = [
  "bendoryair@gmail.com",
  "stemcatalystmagazine@gmail.com",
  "aidan.schurr@gwmail.gwu.edu",
];

const VALID_TYPES = new Set([
  "proposal-pending",
  "writing-complete",
  "editor-assigned",
  "proposal-approved",
  // Editor checked "Review Complete" → email the writer.
  "review-complete",
  // Writer requests one or more date changes → email admins.
  "deadline-change-requested",
  // Admin approved or rejected the request → email the writer.
  "deadline-change-resolved",
]);

export const onRequestPost = async ({ request, env }) => {
  try {
    // Any signed-in role can fire this. Authors fire proposal-pending and
    // writing-complete; admins fire editor-assigned. Lock down per-type below.
    const auth = await requireRole(request, env, ["author", "editor", "admin"]);
    if (auth instanceof Response) return auth;

    let body = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch {
      return badRequest("Invalid JSON body");
    }

    const type = String(body.type || "").trim();
    const projectId = String(body.projectId || "").trim();

    if (!VALID_TYPES.has(type)) {
      return badRequest(`Invalid event type. Must be one of: ${[...VALID_TYPES].join(", ")}`);
    }
    if (!projectId) return badRequest("Missing projectId");

    // Per-type role gate.
    if (type === "editor-assigned" && auth.role !== "admin") {
      return badRequest("Only admins can fire editor-assigned events");
    }

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";

    // Load the project first — for editor-assigned we need editorId in the
    // dedup key (otherwise a reassignment to a different editor would be
    // silently swallowed).
    const projectDoc = await firestoreGet(env, `projects/${projectId}`);
    if (!projectDoc) return badRequest("Project not found");
    const project = unwrapProject(projectDoc, projectId);

    // Dedup-key strategy:
    //   * editor-assigned varies per editor so reassignment doesn't get swallowed.
    //   * deadline-change-* events include the request's requestedAt timestamp
    //     so a project's second-ever request still emails admins (otherwise
    //     `${projectId}_deadline-change-requested` would dedupe forever).
    let logId;
    if (type === "editor-assigned" && project.editorId) {
      logId = `${projectId}_${type}_${sanitizeId(project.editorId)}`;
    } else if (type === "deadline-change-requested") {
      const stamp = sanitizeId(project.deadlineChangeRequest?.requestedAt || project.deadlineRequest?.requestedAt || "no-stamp");
      logId = `${projectId}_${type}_${stamp}`;
    } else if (type === "deadline-change-resolved") {
      // The request doc has been deleted by approve/reject by the time we run,
      // so we key by current time bucket — admins resolve at most once per
      // request, and the bot_event_notify_log just prevents accidental spam
      // from button double-clicks within the same minute.
      const minuteBucket = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
      logId = `${projectId}_${type}_${sanitizeId(minuteBucket)}`;
    } else if (type === "review-complete") {
      // An editor can uncheck → recheck "Review Complete" if they want to
      // make another pass. The minute bucket lets a same-minute fat-finger
      // dedup, but a real second send (after the editor revised the notes
      // and re-marked it) goes through.
      const minuteBucket = new Date().toISOString().slice(0, 16);
      logId = `${projectId}_${type}_${sanitizeId(minuteBucket)}`;
    } else {
      logId = `${projectId}_${type}`;
    }

    // Idempotency: if we already sent this exact event, bail. Re-checking the
    // "Article Writing Complete" box, or hitting the assign button twice for
    // the same editor, will both no-op here.
    const existing = await firestoreGet(env, `bot_event_notify_log/${logId}`);
    if (existing) {
      return json({ ok: true, deduped: true, type, projectId });
    }

    let result;
    if (type === "proposal-pending") {
      result = await sendProposalPending(env, project, siteUrl);
    } else if (type === "writing-complete") {
      result = await sendWritingComplete(env, project, siteUrl);
    } else if (type === "editor-assigned") {
      result = await sendEditorAssigned(env, project, siteUrl);
    } else if (type === "proposal-approved") {
      result = await sendProposalApproved(env, project, siteUrl);
    } else if (type === "review-complete") {
      result = await sendReviewComplete(env, project, siteUrl);
    } else if (type === "deadline-change-requested") {
      result = await sendDeadlineChangeRequested(env, project, siteUrl);
    } else if (type === "deadline-change-resolved") {
      result = await sendDeadlineChangeResolved(env, project, siteUrl, body);
    }

    // Log even on partial-send so we don't retry-spam. The log records what we
    // attempted — actual failures come back in `result.errors`.
    await firestoreCreate(
      env,
      "bot_event_notify_log",
      {
        type,
        projectId,
        firedBy: auth.email || auth.uid,
        firedAt: new Date().toISOString(),
        recipients: result.recipients || [],
        errors: (result.errors || []).map((e) => String(e)),
      },
      logId,
    );

    return json({ ok: true, type, projectId, ...result });
  } catch (err) {
    return serverError(err);
  }
};

// Allow GET for a quick health check without exposing data.
export const onRequestGet = async () =>
  json({ ok: true, service: "catalyst-notify", hint: "POST { type, projectId } with bearer token." });

// ─── Handlers ────────────────────────────────────────────────────────────────

async function sendProposalPending(env, project, siteUrl) {
  const author = await loadUserByIdOrEmail(env, project.authorId, project.authorEmail);
  const { subject, html } = adminProposalPendingEmail({ project, author, siteUrl });
  return sendToAdmins(env, { subject, html });
}

async function sendWritingComplete(env, project, siteUrl) {
  const author = await loadUserByIdOrEmail(env, project.authorId, project.authorEmail);
  const { subject, html } = adminWritingCompleteEmail({ project, author, siteUrl });
  return sendToAdmins(env, { subject, html });
}

async function sendEditorAssigned(env, project, siteUrl) {
  if (!project.editorId) {
    return { recipients: [], errors: ["Project has no editorId"] };
  }
  const editor = await loadUserByIdOrEmail(env, project.editorId, null);
  if (!editor || !editor.email) {
    return { recipients: [], errors: ["Editor has no email on file"] };
  }
  const author = await loadUserByIdOrEmail(env, project.authorId, project.authorEmail);
  const { subject, html } = editorAssignedEmail({ project, editor, author, siteUrl });

  const recipients = [editor.email];
  const errors = [];
  try {
    await sendEmail(env, {
      to: recipients,
      subject,
      html,
      replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });
  } catch (err) {
    errors.push(err?.message || String(err));
  }
  return { recipients, errors };
}

async function sendProposalApproved(env, project, siteUrl) {
  const author = await loadUserByIdOrEmail(env, project.authorId, project.authorEmail);
  if (!author || !author.email) {
    return { recipients: [], errors: ["Author has no email on file"] };
  }
  const { subject, html } = proposalApprovedEmail({ project, author, siteUrl });
  const recipients = [author.email];
  const errors = [];
  try {
    await sendEmail(env, {
      to: recipients,
      subject,
      html,
      replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });
  } catch (err) {
    errors.push(err?.message || String(err));
  }
  return { recipients, errors };
}

// Editor just checked "Review Complete" → tell the writer their feedback is
// ready and they have one week (deadlines.edits, auto-set on the same write)
// to address it.
async function sendReviewComplete(env, project, siteUrl) {
  const author = await loadUserByIdOrEmail(env, project.authorId, project.authorEmail);
  if (!author || !author.email) {
    return { recipients: [], errors: ["Author has no email on file"] };
  }
  const editor = project.editorId
    ? await loadUserByIdOrEmail(env, project.editorId, null)
    : null;

  const { subject, html } = writerReviewCompleteEmail({ project, author, editor, siteUrl });
  const recipients = [author.email];
  const errors = [];
  try {
    await sendEmail(env, {
      to: recipients,
      subject,
      html,
      replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });
  } catch (err) {
    errors.push(err?.message || String(err));
  }
  return { recipients, errors };
}

// Writer just asked for one or more date changes → notify admins so they can
// review and approve/reject from the tracker.
async function sendDeadlineChangeRequested(env, project, siteUrl) {
  const author = await loadUserByIdOrEmail(env, project.authorId, project.authorEmail);
  const request = project.deadlineChangeRequest || project.deadlineRequest || {};
  const { subject, html } = adminDeadlineChangeRequestedEmail({ project, author, request, siteUrl });
  return sendToAdmins(env, { subject, html });
}

// Admin approved or rejected the date-change request → tell the writer the
// outcome. The dashboard sends the resolution status in the request body so
// we don't have to read the request doc back from Firestore (it's been
// deleted by this point as part of the approve/reject Firestore update).
async function sendDeadlineChangeResolved(env, project, siteUrl, body) {
  const author = await loadUserByIdOrEmail(env, project.authorId, project.authorEmail);
  if (!author || !author.email) {
    return { recipients: [], errors: ["Author has no email on file"] };
  }
  // The dashboard may pass `outcome: "approved" | "rejected"` and the request
  // payload it had locally. Both are optional — the email gracefully renders
  // a generic "your request was reviewed" body if they're missing.
  const outcome = String(body?.outcome || "reviewed").toLowerCase();
  const requestSnapshot = body?.request || project.deadlineChangeRequest || project.deadlineRequest || null;
  const { subject, html } = writerDeadlineChangeResolvedEmail({
    project,
    author,
    outcome,
    request: requestSnapshot,
    siteUrl,
  });

  const recipients = [author.email];
  const errors = [];
  try {
    await sendEmail(env, {
      to: recipients,
      subject,
      html,
      replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });
  } catch (err) {
    errors.push(err?.message || String(err));
  }
  return { recipients, errors };
}

async function sendToAdmins(env, { subject, html }) {
  const recipients = DEFAULT_ADMIN_RECIPIENTS;
  const errors = [];
  try {
    await sendEmail(env, {
      to: recipients,
      subject,
      html,
      replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
    });
  } catch (err) {
    errors.push(err?.message || String(err));
  }
  return { recipients, errors };
}

// ─── Firestore unwrap helpers ────────────────────────────────────────────────

function unwrapProject(doc, id) {
  const fields = doc.fields || {};
  const out = { id };
  for (const [k, v] of Object.entries(fields)) out[k] = unwrap(v);
  return out;
}

async function loadUserByIdOrEmail(env, uid, email) {
  if (uid) {
    const doc = await firestoreGet(env, `users/${uid}`);
    if (doc) {
      const fields = doc.fields || {};
      const out = { id: uid };
      for (const [k, v] of Object.entries(fields)) out[k] = unwrap(v);
      if (out.email) return out;
      // Fall through to email-based lookup if uid row has no email.
    }
  }
  if (email) {
    return { id: null, name: null, email };
  }
  return null;
}

function sanitizeId(s) {
  return String(s || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
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
    const fields = v.mapValue.fields || {};
    for (const [k, vv] of Object.entries(fields)) out[k] = unwrap(vv);
    return out;
  }
  if ("arrayValue" in v) {
    return (v.arrayValue.values || []).map(unwrap);
  }
  return null;
}
