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
import { firestoreGet, firestoreCreate, firestoreUpdate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { createNotification, getAdminUsers } from "../../_utils/notifications.js";
import { sendEmail } from "../../_utils/resend.js";
import {
  adminProposalPendingEmail,
  adminWritingCompleteEmail,
  editorAssignedEmail,
  proposalApprovedEmail,
  adminDeadlineChangeRequestedEmail,
  writerDeadlineChangeResolvedEmail,
  writerReviewCompleteEmail,
  adminActivityUpdateEmail,
} from "../../_utils/reminder-emails.js";

// activity-update cooldown: rapid-fire ticks within this window get coalesced
// into one email. Picked short enough that admins still see updates in near
// real-time, long enough to absorb "check 4 boxes in a row" bursts.
const ACTIVITY_COOLDOWN_MS = 45 * 1000;

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
  // Any writer/editor activity worth a real-time admin ping (timeline tick,
  // draft submit, checklist confirmation). Coalesced server-side.
  "activity-update",
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

    // activity-update has its own queue-based coalescing (45s cooldown). It
    // doesn't use bot_event_notify_log at all — each activity has its own
    // timestamp, and a single email can ship multiple queued activities.
    if (type === "activity-update") {
      const result = await handleActivityUpdate({
        env, project, projectId, auth, body, siteUrl,
      });
      return json({ ok: true, type, projectId, ...result });
    }

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

    // In-app notification (the topbar bell) for the person-targeted events —
    // the "something needs me" set. Admin-broadcast types (proposal-pending,
    // writing-complete, deadline-change-requested) are intentionally skipped
    // here: admins already have the Overview pipeline widget + activity feed +
    // email, and fanning out to every admin uid isn't worth it for v1.
    // Best-effort and deduped on the same key as the email log.
    await createEventNotification(env, { type, project, auth, logId });

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

// Mint an in-app notification for the person-targeted editorial events. Maps
// each type to its recipient uid (author or editor on the project), a title,
// and the dashboard hash to open. Best-effort; deduped on the email log id.
async function createEventNotification(env, { type, project, auth, logId }) {
  const title = project?.title || "your project";
  let recipientId = "";
  let actionHash = "";
  let text = "";

  if (type === "editor-assigned") {
    recipientId = project?.editorId || "";
    actionHash = "#/editor/queue";
    text = `You've been assigned to edit "${title}"`;
  } else if (type === "proposal-approved") {
    recipientId = project?.authorId || "";
    actionHash = "#/writer/mine";
    text = `Your proposal "${title}" was approved`;
  } else if (type === "review-complete") {
    recipientId = project?.authorId || "";
    actionHash = "#/writer/mine";
    text = `Editor feedback is ready on "${title}"`;
  } else if (type === "deadline-change-resolved") {
    recipientId = project?.authorId || "";
    actionHash = "#/pipeline/mine";
    text = `Your deadline-change request on "${title}" was reviewed`;
  } else if (type === "proposal-pending" || type === "writing-complete" || type === "deadline-change-requested") {
    // Admin-broadcast events — notify every admin's bell (mirrors the email
    // that already goes to the admin list). This is the "admins get a
    // notification when someone updates their story" case.
    const adminTitle = {
      "proposal-pending": `New proposal needs review: "${title}"`,
      "writing-complete": `Writing complete on "${title}"`,
      "deadline-change-requested": `Deadline-change requested on "${title}"`,
    }[type];
    const adminHash = type === "deadline-change-requested" ? "#/admin/tasks" : "#/admin/articles";
    const admins = await getAdminUsers(env);
    for (const a of admins) {
      if (!a.uid || a.uid === auth?.uid) continue;
      await createNotification(env, {
        recipientId: a.uid,
        type: "event",
        eventType: type,
        title: adminTitle,
        actorId: auth?.uid || "",
        actorName: auth?.name || auth?.email || "",
        actionHash: adminHash,
      }, `notif_${logId}_${a.uid}`);
    }
    return;
  } else {
    return; // activity-update etc. — handled separately, no bell
  }

  if (!recipientId) return;
  await createNotification(env, {
    recipientId,
    type: "event",
    eventType: type,
    title: text,
    actorId: auth?.uid || "",
    actorName: auth?.name || auth?.email || "",
    actionHash,
  }, `notif_${logId}`);
}

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

// ─── activity-update: queue + cooldown ───────────────────────────────────────
//
// Queue model: bot_activity_pending/{projectId} holds the list of pending
// activities + lastSentAt. Every event call:
//   1. Reads the queue.
//   2. Appends the incoming activity.
//   3. If (now - lastSentAt) >= 45s OR no lastSentAt yet → ship everything.
//   4. Otherwise persist the queue and return { deferred: true }.
//
// Stranded queue risk: if a writer does one burst and never touches the
// project again, items 2..N sit in pending. The next activity event on this
// project (could be hours later) will flush them. Admins still see the first
// event in the burst. We accept this in exchange for not running a separate
// cron worker.

async function handleActivityUpdate({ env, project, projectId, auth, body, siteUrl }) {
  const activity = body.activity || {};
  const text = String(activity.text || "").trim();
  if (!text) {
    return { recipients: [], errors: ["Missing activity.text"], deferred: false };
  }

  const incoming = {
    text,
    kind: String(activity.kind || "update").slice(0, 40),
    actorName: String(activity.actorName || auth.email || "Someone").slice(0, 120),
    actorRole: String(auth.role || "team member"),
    actorId: auth.uid || null,
    actorEmail: auth.email || null,
    timestamp: new Date().toISOString(),
  };

  const queuePath = `bot_activity_pending/${projectId}`;
  const existing = await firestoreGet(env, queuePath);
  const queue = existing ? unwrapPendingDoc(existing) : { activities: [], lastSentAt: null };

  queue.activities.push(incoming);

  const now = Date.now();
  const lastSentMs = queue.lastSentAt ? Date.parse(queue.lastSentAt) : 0;
  const cooledDown = !lastSentMs || (now - lastSentMs) >= ACTIVITY_COOLDOWN_MS;

  if (!cooledDown) {
    // Persist the queue and bail — next event after cooldown will flush.
    await firestoreUpsertPending(env, projectId, queue);
    return {
      recipients: [],
      errors: [],
      deferred: true,
      queueDepth: queue.activities.length,
      nextEligibleInMs: ACTIVITY_COOLDOWN_MS - (now - lastSentMs),
    };
  }

  // Cooldown elapsed — ship the whole queue.
  const author = await loadUserByIdOrEmail(env, project.authorId, project.authorEmail);
  const actorForEmail = {
    name: incoming.actorName,
    email: incoming.actorEmail,
    role: incoming.actorRole,
  };
  const health = computeProjectHealth(project, new Date(now));

  const { subject, html } = adminActivityUpdateEmail({
    project,
    actor: actorForEmail,
    activities: queue.activities,
    health,
    siteUrl,
  });

  const sendResult = await sendToAdmins(env, { subject, html });

  // Clear queue + stamp lastSentAt regardless of send errors so we don't
  // retry-spam admins with the same items.
  await firestoreUpsertPending(env, projectId, {
    activities: [],
    lastSentAt: new Date(now).toISOString(),
  });

  return {
    recipients: sendResult.recipients,
    errors: sendResult.errors,
    deferred: false,
    sentCount: queue.activities.length,
  };
}

async function firestoreUpsertPending(env, projectId, queue) {
  const path = `bot_activity_pending/${projectId}`;
  const payload = {
    activities: queue.activities,
    lastSentAt: queue.lastSentAt,
    updatedAt: new Date().toISOString(),
  };
  try {
    await firestoreUpdate(env, path, payload, { mergeFields: true });
  } catch (err) {
    if (err?.status === 404) {
      await firestoreCreate(env, "bot_activity_pending", payload, projectId);
    } else {
      throw err;
    }
  }
}

function unwrapPendingDoc(doc) {
  const fields = doc.fields || {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = unwrap(v);
  return {
    activities: Array.isArray(out.activities) ? out.activities : [],
    lastSentAt: out.lastSentAt || null,
  };
}

// Compute on-track / behind state from project.deadlines vs today. Picks the
// earliest unmet deadline among the canonical milestone keys; if today is past
// that date and the matching timeline step isn't checked, we flag "behind".
function computeProjectHealth(project, now) {
  const deadlines = project.deadlines || {};
  const timeline = project.timeline || {};

  // Mapping deadline key → timeline step it gates. If the step is checked,
  // that deadline is considered satisfied and we don't penalize for it.
  const checkpoints = [
    { key: "contact", step: "Contact Professor" },
    { key: "interview", step: "Interview Scheduled" },
    { key: "draft", step: "Article Writing Complete" },
    { key: "review", step: "Review Complete" },
    { key: "edits", step: "Edits Addressed" },
    { key: "publication", step: "Published" },
  ];

  let nearestOverdue = null;
  let nearestUpcoming = null;

  for (const c of checkpoints) {
    const dateStr = deadlines[c.key];
    if (!dateStr) continue;
    const dueMs = Date.parse(dateStr);
    if (isNaN(dueMs)) continue;
    if (timeline[c.step] === true) continue; // already completed → satisfied

    const daysFromNow = Math.round((dueMs - now.getTime()) / 86400000);
    if (daysFromNow < 0) {
      if (!nearestOverdue || daysFromNow < nearestOverdue.daysFromNow) {
        nearestOverdue = { ...c, daysFromNow };
      }
    } else if (!nearestUpcoming || daysFromNow < nearestUpcoming.daysFromNow) {
      nearestUpcoming = { ...c, daysFromNow };
    }
  }

  if (nearestOverdue) {
    const days = Math.abs(nearestOverdue.daysFromNow);
    return {
      state: "behind",
      note: `${days} day${days === 1 ? "" : "s"} past ${nearestOverdue.step} deadline`,
    };
  }
  if (nearestUpcoming) {
    return {
      state: "on-track",
      note: `next: ${nearestUpcoming.step} in ${nearestUpcoming.daysFromNow} day${nearestUpcoming.daysFromNow === 1 ? "" : "s"}`,
    };
  }
  return { state: "unknown", note: "" };
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
