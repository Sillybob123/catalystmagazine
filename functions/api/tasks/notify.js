// /api/tasks/notify
//
// Single endpoint that the dashboard calls whenever a task changes state
// in a way that affects email reminders. Two reasons to use one endpoint
// instead of three: (1) all three actions share the same shape and the
// same auth check; (2) we always want to keep the `task_reminders/<id>`
// mirror doc and the catalystmonday `tasks/<id>` doc in sync — one
// endpoint makes that easier to reason about.
//
// Why a mirror doc at all? Tasks live in the secondary (`catalystmonday`)
// Firestore project. The cron-triggered bot that fires reminder emails
// runs in Cloudflare Pages with a service account scoped to the primary
// (`catalystwriters-5ce43`) project — it can't read tasks from
// catalystmonday without a second service account. A small mirror doc
// in the primary DB is much cheaper than provisioning new credentials
// and keeps all reminder state (logs, mirrors, scheduled campaigns) in
// one place.
//
// Body shape:
//   { action: "assigned",
//     taskId, title, description?, deadline?, priority?, creatorName?,
//     assignees: [{ email, name }] }
//   { action: "completed" | "deleted", taskId }
//
// Auth: any logged-in staff member (admin / editor / writer / marketing /
// newsletter_builder). The dashboard only calls this from authenticated
// JS; we still require a bearer token server-side.

import { json, badRequest, serverError, isValidEmail } from "../../_utils/http.js";
import { firestoreCreate, firestoreGet, firestoreUpdate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { taskAssignedEmail } from "../../_utils/task-emails.js";

const ALLOWED_ACTIONS = new Set(["assigned", "completed", "deleted"]);

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, [
      "admin",
      "editor",
      "writer",
      "marketing",
      "newsletter_builder",
      "social_media",
    ]);
    if (auth instanceof Response) return auth;

    let body;
    try { body = await request.json(); }
    catch { return badRequest("Invalid JSON body"); }

    const action = String(body.action || "").trim();
    if (!ALLOWED_ACTIONS.has(action)) {
      return badRequest(`action must be one of: ${[...ALLOWED_ACTIONS].join(", ")}`);
    }

    const taskId = String(body.taskId || "").trim();
    if (!taskId) return badRequest("taskId is required");
    // Defensive: Firestore doc IDs cannot contain `/`. Anything fancier (eg.
    // path traversal) would have been caught by `firestoreUpdate` server-side
    // but a clean rejection here makes the failure mode obvious.
    if (taskId.includes("/")) return badRequest("taskId cannot contain '/'");

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";

    if (action === "assigned") {
      return handleAssigned({ env, body, taskId, siteUrl });
    }
    if (action === "completed" || action === "deleted") {
      return handleClose({ env, taskId, action });
    }
    return badRequest("Unknown action");
  } catch (err) {
    return serverError(err);
  }
};

// ─── action: "assigned" ─────────────────────────────────────────────────────

async function handleAssigned({ env, body, taskId, siteUrl }) {
  const title = String(body.title || "").trim();
  if (!title) return badRequest("title is required for action=assigned");

  const rawAssignees = Array.isArray(body.assignees) ? body.assignees : [];
  const assignees = rawAssignees
    .map((a) => ({
      email: String(a?.email || "").trim().toLowerCase(),
      name: String(a?.name || "").trim() || "there",
    }))
    .filter((a) => isValidEmail(a.email));
  // No valid recipients → still upsert the mirror so future updates
  // (status sync, etc.) work; just skip the email send.
  // Trim down to a reasonable cap so a runaway client can't fan out.
  const validAssignees = assignees.slice(0, 20);

  const deadline = normalizeDeadline(body.deadline);
  const description = String(body.description || "").trim().slice(0, 5000);
  const priority = ["low", "medium", "high", "urgent"].includes(body.priority)
    ? body.priority
    : "medium";
  const creatorName = String(body.creatorName || "").trim().slice(0, 200);

  const taskRecord = {
    title,
    description,
    deadline,
    priority,
    creatorName,
    assignees: validAssignees,
    status: "active",
    updatedAt: new Date().toISOString(),
  };

  // Upsert the mirror doc. firestoreCreate with a known docId acts as a
  // create; if the doc already exists, the create call returns 409 and we
  // fall through to update.
  await upsertReminderDoc(env, taskId, taskRecord);

  // Email each assignee in parallel. Individual failures are logged but
  // don't fail the whole request — the mirror is the source of truth for
  // the cron reminders, and the assignee can also see the task in the
  // dashboard. If we'd hard-failed on a single bad address, the mirror
  // would still be created (above) and the rest of the assignment would
  // silently lose its first-touch email.
  const emailResults = await Promise.all(
    validAssignees.map(async (a) => {
      try {
        const { subject, html, text } = taskAssignedEmail({
          assigneeName: a.name,
          task: { title, description, deadline, priority, creatorName },
          siteUrl,
        });
        await sendEmail(env, { to: a.email, subject, html, text });
        return { email: a.email, ok: true };
      } catch (err) {
        console.error(`[tasks/notify] assigned email to ${a.email} failed:`, err.message);
        return { email: a.email, ok: false, error: err.message };
      }
    })
  );

  return json({
    ok: true,
    action: "assigned",
    taskId,
    notified: emailResults.filter((r) => r.ok).length,
    failed: emailResults.filter((r) => !r.ok),
    assignees: validAssignees.length,
    skipped: assignees.length - validAssignees.length,
  });
}

// ─── action: "completed" | "deleted" ────────────────────────────────────────
//
// Mark the mirror so the cron skips future reminders. We don't delete the
// mirror doc — admins may want to audit "this task was completed late" or
// "deleted on X by Y", and the cost of keeping a row is negligible.

async function handleClose({ env, taskId, action }) {
  const status = action === "completed" ? "completed" : "deleted";
  const closedAt = new Date().toISOString();
  // If the mirror doesn't exist (eg. older tasks predate this endpoint),
  // create a stub so the field is present for any future reporting. We
  // know the taskId but nothing else about the task.
  const existing = await firestoreGet(env, `task_reminders/${taskId}`).catch(() => null);
  if (!existing) {
    await firestoreCreate(
      env,
      "task_reminders",
      { status, closedAt, updatedAt: closedAt },
      taskId
    ).catch((err) => {
      // Race against another caller creating the same doc — fine, just
      // fall through to update below.
      if (!/409|already exists/i.test(err?.message || "")) throw err;
    });
  }
  await firestoreUpdate(env, `task_reminders/${taskId}`, {
    status,
    closedAt,
    updatedAt: closedAt,
  });
  return json({ ok: true, action, taskId, status });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Try create; on conflict (doc already exists), update. The Firestore REST
// API doesn't have a true upsert, so this two-step is the standard pattern.
async function upsertReminderDoc(env, taskId, fields) {
  try {
    await firestoreCreate(env, "task_reminders", { ...fields, createdAt: fields.updatedAt }, taskId);
    return;
  } catch (err) {
    if (!/409|already exists/i.test(err?.message || "")) throw err;
  }
  await firestoreUpdate(env, `task_reminders/${taskId}`, fields);
}

// Tasks store deadlines as YYYY-MM-DD strings (date-input native format).
// Anything else gets dropped — the cron only knows how to compare against
// midnight on a calendar day.
function normalizeDeadline(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}
