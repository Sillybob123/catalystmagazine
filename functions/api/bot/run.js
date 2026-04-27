// POST /api/bot/run
//
// The Catalyst editorial bot. Fires writer reminders (deadline + idle) every
// day, and the admin digest every Saturday. Callable two ways:
//
//   1. Cron trigger — a scheduled Cloudflare Worker hits this with the shared
//      secret in `x-bot-secret` header. Configure the secret as `BOT_CRON_SECRET`.
//   2. Manual admin button — sends the Firebase ID token via Authorization: Bearer.
//      Requires role=admin.
//
// Body (all optional): {
//   mode: "auto" | "writers" | "digest" | "ping"
//                                           // default "auto" (writers every day,
//                                             digest additionally on Saturday)
//                                           // "ping" sends a test email to BOT_PING_EMAIL
//                                             (or bendoryair@gmail.com) — no cooldown,
//                                             no project data, just proves the pipeline works
//   dryRun: true                            // compute plan but don't send emails
//   adminEmails: [email, email, ...]        // overrides the default digest list
//   forceDigest: true                       // send digest regardless of weekday
// }

import { json, badRequest, serverError, unauthorized } from "../../_utils/http.js";
import {
  firestoreRunQuery,
  firestoreGet,
  firestoreCreate,
  firestoreUpdate,
} from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import {
  computeWriterReminders,
  computeEditorReminders,
  computeAdminDigest,
  computeAdminTasks,
  groupRemindersByRecipient,
} from "../../_utils/bot-logic.js";
import {
  writerReminderEmail,
  editorReminderEmail,
  bundledReminderEmail,
  adminDigestEmail,
} from "../../_utils/reminder-emails.js";

const DEFAULT_ADMIN_RECIPIENTS = [
  "bendoryair@gmail.com",
  "stemcatalystmagazine@gmail.com",
  "aidan.schurr@gwmail.gwu.edu",
];

// Eastern time. Saturday === weekday 6 in en-US locale.
const DIGEST_WEEKDAY = 6;
const DIGEST_TIMEZONE = "America/New_York";

export const onRequestPost = async ({ request, env }) => {
  try {
    const authResult = await authorizeBotCaller(request, env);
    if (authResult instanceof Response) return authResult;
    const { caller } = authResult;

    let body = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch {
      return badRequest("Invalid JSON body");
    }

    const now = new Date();
    const mode = body.mode || "auto";
    const dryRun = !!body.dryRun;
    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";

    // ── Ping mode — no project data, just proves cron→Resend pipeline works ──
    if (mode === "ping") {
      const pingTo = env.BOT_PING_EMAIL || "bendoryair@gmail.com";
      const sentAt = now.toISOString();
      const pingResult = { ok: true, mode: "ping", calledBy: caller, sentAt, to: pingTo, sent: false, error: null };
      if (!dryRun) {
        try {
          await sendEmail(env, {
            to: pingTo,
            subject: `Catalyst Bot ping — ${sentAt}`,
            html: `<p>The Catalyst Bot cron fired successfully at <strong>${sentAt}</strong>.</p><p>Caller: ${caller}</p>`,
            replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
          });
          pingResult.sent = true;
        } catch (err) {
          pingResult.error = err?.message || String(err);
        }
      }
      return json(pingResult);
    }

    // ── Load data ────────────────────────────────────────────────────────────
    const [projects, users] = await Promise.all([
      loadAllProjects(env),
      loadAllUsers(env),
    ]);
    const reminderLog = await loadReminderLog(env);

    const result = {
      ok: true,
      calledBy: caller,
      now: now.toISOString(),
      mode,
      dryRun,
      projectsScanned: projects.length,
      usersScanned: users.length,
      writerReminders: { planned: 0, sent: 0, skipped: 0, errors: [] },
      editorReminders: { planned: 0, sent: 0, skipped: 0, errors: [] },
      bundled:         { planned: 0, sent: 0, errors: [] },
      adminDigest:     { sent: false, recipientCount: 0, skipped: null, error: null },
    };

    // ── Writer + Editor reminders ────────────────────────────────────────────
    //
    // Compute writer and editor reminders separately, then group by recipient
    // so a single person never gets more than one bundled email per day.
    if (mode === "auto" || mode === "writers") {
      const writerOut = computeWriterReminders({ projects, users, reminderLog, now });
      const editorOut = computeEditorReminders({ projects, users, reminderLog, now });

      result.writerReminders.planned = writerOut.reminders.length;
      result.writerReminders.skippedCount = writerOut.skipped.length;
      result.writerReminders.skipped = writerOut.skipped;
      result.editorReminders.planned = editorOut.reminders.length;
      result.editorReminders.skippedCount = editorOut.skipped.length;
      result.editorReminders.skipped = editorOut.skipped;

      // Per-recipient bundling: anyone with 2+ items gets one bundled email.
      const allReminders = [...writerOut.reminders, ...editorOut.reminders];
      const { single, bundled } = groupRemindersByRecipient(allReminders);
      result.bundled.planned = bundled.length;

      // Build singles (one project per email).
      const builtSingles = single.map((r) => {
        const { subject, html } = r.editor
          ? editorReminderEmail({
              kind: r.kind,
              editor: r.editor,
              project: r.project,
              deadline: r.deadline,
              daysSinceAssigned: r.daysSinceAssigned,
              daysInactive: r.daysInactive,
              siteUrl,
            })
          : writerReminderEmail({
              kind: r.kind,
              writer: r.writer,
              project: r.project,
              deadline: r.deadline,
              daysUntilDeadline: r.daysUntilDeadline,
              daysInactive: r.daysInactive,
              interviewDate: r.interviewDate,
              daysUntilInterview: r.daysUntilInterview,
              daysSinceInterview: r.daysSinceInterview,
              siteUrl,
            });
        return { ...r, subject, html };
      });

      // Build bundled emails (2+ items, one email per recipient).
      const builtBundled = bundled.map((b) => {
        const { subject, html } = bundledReminderEmail({
          recipient: b.recipient,
          role: b.role,
          items: b.items,
          siteUrl,
        });
        return { ...b, subject, html };
      });

      // Preview metadata for the admin UI.
      result.writerReminders.items = builtSingles.filter((r) => r.writer).map((r) => ({
        kind: r.kind,
        projectId: r.projectId,
        projectTitle: r.project.title,
        writerEmail: r.writer.email,
        writerName: r.writer.name,
        daysUntilDeadline: r.daysUntilDeadline,
        daysInactive: r.daysInactive,
        daysUntilInterview: r.daysUntilInterview,
        daysSinceInterview: r.daysSinceInterview,
        interviewDate: r.interviewDate ? r.interviewDate.toISOString().slice(0, 10) : null,
        subject: r.subject,
        preview: htmlToPlainPreview(r.html, 600),
        html: r.html,
      }));
      result.editorReminders.items = builtSingles.filter((r) => r.editor).map((r) => ({
        kind: r.kind,
        projectId: r.projectId,
        projectTitle: r.project.title,
        editorEmail: r.editor.email,
        editorName: r.editor.name,
        daysSinceAssigned: r.daysSinceAssigned,
        daysInactive: r.daysInactive,
        subject: r.subject,
        preview: htmlToPlainPreview(r.html, 600),
        html: r.html,
      }));
      result.bundled.items = builtBundled.map((b) => ({
        recipientEmail: b.recipient.email,
        recipientName: b.recipient.name,
        role: b.role,
        itemCount: b.items.length,
        subject: b.subject,
        preview: htmlToPlainPreview(b.html, 800),
        html: b.html,
      }));

      if (!dryRun) {
        // Send singles.
        for (const r of builtSingles) {
          const recipient = r.editor || r.writer;
          const extraEmails = Array.isArray(recipient.extraEmails)
            ? recipient.extraEmails.filter(Boolean)
            : [];
          const allRecipients = [recipient.email, ...extraEmails].filter(Boolean);
          try {
            await sendEmail(env, {
              to: allRecipients,
              subject: r.subject,
              html: r.html,
              replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
            });
            await recordReminderSent(env, r.key, {
              projectId: r.projectId,
              kind: r.kind,
              recipientEmail: recipient.email,
              sentAt: now.toISOString(),
            });
            if (r.editor) result.editorReminders.sent++;
            else result.writerReminders.sent++;
          } catch (err) {
            const target = r.editor ? result.editorReminders : result.writerReminders;
            target.errors.push({
              projectId: r.projectId,
              recipientEmail: recipient.email,
              error: err?.message || String(err),
            });
          }
        }

        // Send bundled. Each bundled email represents 2+ keys; stamp them all
        // as sent so the cooldown applies per-(project, kind) the same way.
        for (const b of builtBundled) {
          try {
            await sendEmail(env, {
              to: [b.recipient.email],
              subject: b.subject,
              html: b.html,
              replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
            });
            for (const key of b.keys) {
              await recordReminderSent(env, key, {
                bundledFor: b.recipient.email,
                sentAt: now.toISOString(),
              });
            }
            result.bundled.sent++;
          } catch (err) {
            result.bundled.errors.push({
              recipientEmail: b.recipient.email,
              error: err?.message || String(err),
            });
          }
        }
      }
    }

    // ── Admin digest ─────────────────────────────────────────────────────────
    //
    // Four ways the digest runs:
    //   mode === "digest"            → send to DEFAULT_ADMIN_RECIPIENTS
    //   mode === "digest-to-admins"  → same, but ignores dryRun (explicit "send it now")
    //   body.forceDigest === true    → force regardless of weekday
    //   mode === "auto" on Saturday  → the normal cron-triggered path
    const forceDigestNow = mode === "digest-to-admins";
    const shouldRunDigest =
      mode === "digest" ||
      forceDigestNow ||
      body.forceDigest === true ||
      (mode === "auto" && isSaturdayIn(DIGEST_TIMEZONE, now));

    if (shouldRunDigest) {
      const rows = computeAdminDigest({ projects, users, now });
      const adminTasks = computeAdminTasks({ projects, users, now });
      const { subject, html } = adminDigestEmail({ rows, adminTasks, now, siteUrl });
      result.adminDigest.adminTasks = adminTasks;
      const adminRecipients = Array.isArray(body.adminEmails) && body.adminEmails.length
        ? body.adminEmails
        : DEFAULT_ADMIN_RECIPIENTS;

      result.adminDigest.recipientCount = adminRecipients.length;
      result.adminDigest.recipients = adminRecipients;
      result.adminDigest.subject = subject;
      result.adminDigest.rowsCount = rows.length;
      result.adminDigest.flaggedRows = rows.filter((r) => r.projects.some((p) => p.flags.length)).length;
      result.adminDigest.html = html;
      result.adminDigest.preview = htmlToPlainPreview(html, 1200);
      // Per-writer roll-up so the admin can see what's in the digest at a glance.
      result.adminDigest.rows = rows.map((row) => ({
        writerName: row.writerName,
        writerEmail: row.writerEmail,
        exemption: row.exemption ? {
          untilDate: row.exemption.untilDate || null,
          reason: row.exemption.reason || null,
          updatedAt: row.exemption.updatedAt || null,
          updatedById: row.exemption.updatedById || null,
          updatedByName: row.exemption.updatedByName || null,
        } : null,
        projectCount: row.projects.length,
        flaggedCount: row.projects.filter((p) => p.flags.length).length,
        copyPasteMessage: row.copyPasteMessage,
        projects: row.projects.map((p) => ({
          title: p.title,
          stage: p.stage,
          deadline: p.deadline ? p.deadline.toISOString() : null,
          daysInactive: p.daysInactive,
          flags: p.flags.map((f) => f.kind + (f.days ? `:${f.days}` : "")),
        })),
      }));

      // "digest-to-admins" explicitly means "send it right now", so ignore dryRun.
      const actuallySend = forceDigestNow ? true : !dryRun;

      if (actuallySend) {
        try {
          await sendEmail(env, {
            to: adminRecipients,
            subject,
            html,
            replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
          });
          result.adminDigest.sent = true;
        } catch (err) {
          result.adminDigest.error = err?.message || String(err);
        }
      }
    } else if (mode === "auto") {
      result.adminDigest.skipped = `Not Saturday in ${DIGEST_TIMEZONE}.`;
    }

    return json(result);
  } catch (err) {
    return serverError(err);
  }
};

// Allow a GET as a no-op health check.
export const onRequestGet = async () =>
  json({ ok: true, service: "catalyst-bot", hint: "POST to run." });

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function authorizeBotCaller(request, env) {
  const cronSecret = request.headers.get("x-bot-secret") || "";
  if (cronSecret && env.BOT_CRON_SECRET && cronSecret === env.BOT_CRON_SECRET) {
    return { caller: "cron" };
  }

  // Fall back to admin bearer token.
  const auth = await requireRole(request, env, ["admin"]);
  if (auth instanceof Response) {
    return unauthorized("Bot requires cron secret or admin bearer token.");
  }
  return { caller: `admin:${auth.email || auth.uid}` };
}

// ─── Firestore I/O ────────────────────────────────────────────────────────────

async function loadAllProjects(env) {
  // No server-side filter — we need every active project so we can compute
  // idle days, and the collection is small (<500 docs expected).
  const rows = await firestoreRunQuery(env, {
    from: [{ collectionId: "projects" }],
    limit: 2000,
  });
  return rows.map((r) => ({ id: r.id, ...r.data }));
}

async function loadAllUsers(env) {
  const rows = await firestoreRunQuery(env, {
    from: [{ collectionId: "users" }],
    limit: 2000,
  });
  return rows.map((r) => ({ id: r.id, ...r.data }));
}

// The reminder log lives at `bot_reminder_log/state` as a single doc whose
// `entries` field is a map of { [key]: lastSentISO }. One doc keeps
// reads/writes cheap and avoids needing a Firestore index.
const LOG_PATH = "bot_reminder_log/state";

async function loadReminderLog(env) {
  try {
    const doc = await firestoreGet(env, LOG_PATH);
    if (!doc || !doc.fields || !doc.fields.entries) return {};
    const entriesField = doc.fields.entries;
    // mapValue -> fields -> { [key]: { stringValue } }
    const rawFields = entriesField.mapValue?.fields || {};
    const out = {};
    for (const [k, v] of Object.entries(rawFields)) {
      if (v && typeof v === "object" && "stringValue" in v) {
        out[k] = v.stringValue;
      }
    }
    return out;
  } catch (err) {
    console.warn("Failed to load reminder log:", err.message);
    return {};
  }
}

// Cache one read + merge across the run to avoid reading the doc N times.
let _runLogCache = null;
async function recordReminderSent(env, key, meta) {
  if (_runLogCache === null) {
    _runLogCache = await loadReminderLog(env);
  }
  _runLogCache[key] = meta.sentAt;
  try {
    await firestoreUpdate(
      env,
      LOG_PATH,
      { entries: _runLogCache, updatedAt: meta.sentAt },
      { mergeFields: true }
    );
  } catch (err) {
    // If the doc doesn't exist yet, create it.
    if ((err.message || "").includes("404") || (err.message || "").includes("NOT_FOUND")) {
      await firestoreCreate(
        env,
        "bot_reminder_log",
        { entries: _runLogCache, updatedAt: meta.sentAt },
        "state"
      );
    } else {
      throw err;
    }
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function isSaturdayIn(timeZone, now) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(now);
  return weekday === "Sat";
}

// Strip HTML → readable plain-text preview for the admin UI. Not a full parser;
// just good enough to show what an email says without rendering it.
function htmlToPlainPreview(html, maxLen = 600) {
  if (!html) return "";
  let s = String(html);
  // Drop head/style/script blocks entirely.
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  // Turn block-level boundaries into newlines before stripping tags.
  s = s.replace(/<\/(p|div|tr|td|h[1-6]|li|section|article)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  // Decode the handful of entities our templates actually emit.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&rarr;/g, "→")
    .replace(/&middot;/g, "·")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&copy;/g, "©");
  // Collapse whitespace.
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 1).trimEnd() + "…";
  return s;
}
