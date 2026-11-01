// functions/_utils/meeting-reminders.js
//
// Sends the "meeting is tomorrow" email for published team meetings that
// start within the next 24 hours. Called from the cron's dispatch-due tick
// (every 5 minutes). Each meeting is reminded once per start time
// (remindedFor = startsAt), so moving a meeting re-arms its reminder.

import { firestoreRunQuery, firestoreGet, firestoreUpdate, fromFirestoreDoc } from "./firebase.js";
import { sendEmail } from "./resend.js";
import { meetingEmail, meetingWhenText } from "./reminder-emails.js";
import { createNotifications } from "./notifications.js";
import { staffRecipients } from "./team-recipients.js";

// Email (and bell) everyone a meeting is for. kind: scheduled | updated | reminder.
// `tag` makes each send its own bell (one per publish, update or reminder);
// `message` is an optional line from the admin.
export async function emailMeeting(env, meeting, kind, { actorId = "", actorName = "", tag = "", message = "" } = {}) {
  const uids = meeting.audience === "people" && Array.isArray(meeting.invitedUids) ? meeting.invitedUids : null;
  const { people, ids } = await staffRecipients(env, { uids });
  const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
  let emailed = 0, failed = 0;
  for (const p of people) {
    if (!p.emails.length) continue;
    try {
      const { subject, html } = meetingEmail({ meeting, kind, recipientName: p.name, siteUrl, message });
      await sendEmail(env, { to: p.emails, subject, html, text: `${message ? `${message}\n\n` : ""}${meeting.title || "Team meeting"}: ${meetingWhenText(meeting)}${meeting.link ? `\nJoin: ${meeting.link}` : ""}\n\nDetails: ${siteUrl}/admin/#/meeting`, fromName: "The Catalyst" });
      emailed++;
    } catch (e) { failed++; console.warn("[meetings] email failed", p.name, e?.message); }
  }
  const title = { scheduled: "Team meeting scheduled", updated: "Team meeting updated", reminder: "Team meeting reminder" }[kind] || "Team meeting";
  const notified = await createNotifications(env, ids, {
    type: "event", title, body: `${meeting.title || "Team meeting"} · ${meetingWhenText(meeting)}`,
    actorId, actorName, actionHash: "#/meeting",
  }, (rid) => `meeting_${meeting.id}_${kind}_${String(tag || meeting.startsAt || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40)}_${rid}`).catch(() => 0);
  return { emailed, failed, notified, people: people.length };
}


// Each cron tick: (1) reminders an admin scheduled (meeting.reminders:
// [{ id, at, message, sentAt }]) whose time has come, and (2) the automatic
// reminder about a day before (unless autoReminder is false). A reminder is
// claimed with an updateTime precondition first, so two ticks can't both send.
export async function sendDueMeetingReminders(env) {
  const rows = await firestoreRunQuery(env, {
    from: [{ collectionId: "meetings" }],
    where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "published" } } },
    limit: 50,
  }).catch(() => []);
  const now = Date.now();
  const H = 3600 * 1000;
  const sent = [];
  for (const r of rows) {
    const m = r.data || {};
    const t = Date.parse(m.startsAt || "");
    if (!t || t <= now) continue;
    const scheduledDue = (Array.isArray(m.reminders) ? m.reminders : []).some((x) => x && !x.sentAt && Date.parse(x.at) <= now);
    const autoDue = m.autoReminder !== false && t - now <= 24 * H && m.remindedFor !== m.startsAt;
    if (!scheduledDue && !autoDue) continue;

    const fresh = await firestoreGet(env, `meetings/${r.id}`);
    if (!fresh) continue;
    const doc = fromFirestoreDoc(fresh).data;
    if (doc.status !== "published") continue;
    const stamp = new Date().toISOString();
    const list = Array.isArray(doc.reminders) ? doc.reminders : [];
    const due = list.filter((x) => x && !x.sentAt && Date.parse(x.at) <= now);
    const reminders = list.map((x) => (due.includes(x) ? { ...x, sentAt: stamp } : x));
    const lastCustom = Math.max(0, ...list.map((x) => Date.parse(x?.sentAt || "") || 0), Date.parse(doc.lastReminderAt || "") || 0);
    const wantAuto = doc.autoReminder !== false && t - now <= 24 * H && doc.remindedFor !== doc.startsAt;
    // Skip the automatic one when people just heard about the meeting: the
    // publish/update email went out within about a day of the start, or an
    // admin sent a reminder in the last 12 hours.
    const autoSends = wantAuto && !due.length
      && !(Date.parse(doc.emailedAt || "") > t - 30 * H)
      && !(lastCustom > now - 12 * H);
    const patch = {};
    if (due.length) { patch.reminders = reminders; patch.lastReminderAt = stamp; }
    if (wantAuto) { patch.remindedFor = doc.startsAt; if (autoSends) patch.reminderSentAt = stamp; }
    if (!Object.keys(patch).length) continue;
    try {
      await firestoreUpdate(env, `meetings/${r.id}`, patch, { precondition: { updateTime: fresh.updateTime } });
    } catch { continue; }
    if (due.length) {
      const last = due[due.length - 1];
      const result = await emailMeeting(env, { id: r.id, ...doc }, "reminder", { tag: last.id || stamp, message: String(last.message || "").slice(0, 600), actorName: last.byName || "" });
      sent.push({ id: r.id, scheduled: true, ...result });
    } else if (autoSends) {
      const result = await emailMeeting(env, { id: r.id, ...doc }, "reminder", { tag: `auto${doc.startsAt}` });
      sent.push({ id: r.id, ...result });
    }
  }
  return sent;
}
