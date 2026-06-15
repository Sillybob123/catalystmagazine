// /api/calendar/notify
//
// Called by the dashboard right after a calendar task is created (or its
// people/date change meaningfully). Sends an immediate "task scheduled"
// email via Resend to EVERY participant — including the creator — so the
// whole group knows the task exists and what day it's set for. The daily
// bot (/api/bot/run, mode "calendar") separately handles the reminder-day
// and day-of emails; this endpoint is only the instant announcement.
//
// Body:
//   { taskId, title, notes?, date (YYYY-MM-DD), reminderDate?,
//     createdByName, createdByEmail?, participants: [{ name?, email }] }
//
// Auth: any logged-in staff member (same policy as /api/tasks/notify).

import { json, badRequest, serverError, isValidEmail } from "../../_utils/http.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { notifyByEmail } from "../../_utils/notifications.js";

const MAX_PARTICIPANTS = 25;

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

    const title = String(body.title || "").trim();
    const date = String(body.date || "").trim();
    if (!title) return badRequest("title is required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest("date must be YYYY-MM-DD");

    const notes = String(body.notes || "").trim().slice(0, 600);
    const reminderDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.reminderDate || "")) ? body.reminderDate : null;
    const createdByName = String(body.createdByName || "A teammate").trim().slice(0, 80);
    const createdByEmail = String(body.createdByEmail || "").trim().toLowerCase();

    const participants = (Array.isArray(body.participants) ? body.participants : [])
      .map((p) => ({
        name: String(p?.name || "").trim().slice(0, 80),
        email: String(p?.email || "").trim().toLowerCase(),
      }))
      .filter((p) => isValidEmail(p.email))
      .slice(0, MAX_PARTICIPANTS);

    // Dedupe by email so nobody gets the announcement twice.
    const seen = new Set();
    const recipients = participants.filter((p) => {
      if (seen.has(p.email)) return false;
      seen.add(p.email);
      return true;
    });

    if (!recipients.length) return badRequest("participants must include at least one valid email");

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const niceDate = humanDate(date);
    const names = recipients.map((p) => p.name || p.email);
    const shared = recipients.length > 1;

    const result = { ok: true, sent: 0, errors: [] };
    const notifCache = new Map();

    for (const person of recipients) {
      const isCreator = createdByEmail && person.email === createdByEmail;
      const { subject, html } = taskScheduledEmail({
        title, notes, niceDate, reminderDate, createdByName,
        recipientName: person.name || "there",
        isCreator, shared, names, siteUrl,
      });
      try {
        await sendEmail(env, {
          to: person.email,
          subject,
          html,
          replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
        });
        // Mirror to the participant's bell (skip the creator — they made it).
        if (!isCreator) {
          await notifyByEmail(env, [person.email], {
            type: "event",
            eventType: "calendar",
            title: `${createdByName} added you to: ${title}`,
            body: `Scheduled for ${niceDate}.`,
            actionHash: "#/overview",
          }, { dedupeKey: `notif_calsched_${body.taskId || title}_${date}`, cache: notifCache });
        }
        result.sent++;
      } catch (err) {
        result.errors.push({ email: person.email, error: err?.message || String(err) });
      }
    }

    return json(result);
  } catch (err) {
    return serverError(err);
  }
};

function taskScheduledEmail({ title, notes, niceDate, reminderDate, createdByName, recipientName, isCreator, shared, names, siteUrl }) {
  const subject = isCreator
    ? `Task scheduled: ${title} — ${niceDate}`
    : `${createdByName} added you to a task: ${title} — ${niceDate}`;

  const intro = isCreator
    ? (shared
        ? `your new ${"task"} is on the calendar for <strong>${esc(niceDate)}</strong> and everyone on it has been notified.`
        : `your new task is on the calendar for <strong>${esc(niceDate)}</strong>.`)
    : `<strong>${esc(createdByName)}</strong> added you to a ${shared ? "shared " : ""}task scheduled for <strong>${esc(niceDate)}</strong>. It now shows on your editorial calendar too.`;

  const html = `
  <div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;color:#0b1220;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#0f766e;margin-bottom:14px;">Catalyst calendar</div>
    <h1 style="font-size:20px;margin:0 0 6px;letter-spacing:-0.01em;">New task scheduled</h1>
    <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 16px;">Hi ${esc(recipientName)} — ${intro}</p>
    <div style="border:1px solid #e5e7eb;border-left:4px solid #0f766e;border-radius:10px;padding:14px 16px;margin:0 0 16px;">
      <div style="font-weight:700;font-size:15px;">${esc(title)}</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px;">${esc(niceDate)} · created by ${esc(createdByName)}</div>
      ${notes ? `<div style="font-size:13.5px;color:#374151;line-height:1.55;margin-top:8px;white-space:pre-wrap;">${esc(notes)}</div>` : ""}
      ${shared ? `<div style="font-size:12.5px;color:#64748b;margin-top:8px;">On this task: <strong>${names.map(esc).join(", ")}</strong></div>` : ""}
      ${reminderDate ? `<div style="font-size:12.5px;color:#64748b;margin-top:6px;">Reminder email: <strong>${esc(humanDate(reminderDate))}</strong>, plus one on the day.</div>` : `<div style="font-size:12.5px;color:#64748b;margin-top:6px;">You'll get one reminder email on the day.</div>`}
    </div>
    <a href="${siteUrl}/admin/#/overview" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:11px 18px;border-radius:9px;">Open the calendar</a>
    <p style="font-size:11.5px;color:#94a3b8;margin:20px 0 0;line-height:1.5;">
      You're receiving this because you're on this calendar task. Mark it done on the dashboard to stop day-of reminders.
    </p>
  </div>`;

  return { subject, html };
}

function humanDate(ymd) {
  if (!ymd) return "";
  const d = new Date(`${ymd}T12:00:00Z`);
  if (isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
