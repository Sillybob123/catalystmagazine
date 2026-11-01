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
export async function emailMeeting(env, meeting, kind, { actorId = "", actorName = "" } = {}) {
  const uids = meeting.audience === "people" && Array.isArray(meeting.invitedUids) ? meeting.invitedUids : null;
  const { people, ids } = await staffRecipients(env, { uids });
  const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
  let emailed = 0, failed = 0;
  for (const p of people) {
    if (!p.emails.length) continue;
    try {
      const { subject, html } = meetingEmail({ meeting, kind, recipientName: p.name, siteUrl });
      await sendEmail(env, { to: p.emails, subject, html, text: `${meeting.title || "Team meeting"}: ${meetingWhenText(meeting)}${meeting.link ? `\nJoin: ${meeting.link}` : ""}\n\nDetails: ${siteUrl}/admin/#/meeting`, fromName: "The Catalyst" });
      emailed++;
    } catch (e) { failed++; console.warn("[meetings] email failed", p.name, e?.message); }
  }
  const title = { scheduled: "Team meeting scheduled", updated: "Team meeting updated", reminder: "Team meeting reminder" }[kind] || "Team meeting";
  const notified = await createNotifications(env, ids, {
    type: "event", title, body: `${meeting.title || "Team meeting"} · ${meetingWhenText(meeting)}`,
    actorId, actorName, actionHash: "#/meeting",
  }, (rid) => `meeting_${meeting.id}_${kind}_${String(meeting.startsAt || "").slice(0, 16)}_${rid}`).catch(() => 0);
  return { emailed, failed, notified, people: people.length };
}


export async function sendDueMeetingReminders(env) {
  const rows = await firestoreRunQuery(env, {
    from: [{ collectionId: "meetings" }],
    where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "published" } } },
    limit: 50,
  }).catch(() => []);
  const now = Date.now();
  const sent = [];
  for (const r of rows) {
    const m = r.data || {};
    const t = Date.parse(m.startsAt || "");
    if (!t || t <= now || t - now > 24 * 3600 * 1000) continue;
    if (m.remindedFor === m.startsAt) continue;
    // Claim it first (updateTime precondition), so two cron ticks can't both send.
    const fresh = await firestoreGet(env, `meetings/${r.id}`);
    if (!fresh) continue;
    const doc = fromFirestoreDoc(fresh).data;
    if (doc.remindedFor === doc.startsAt || doc.status !== "published") continue;
    // Published or updated within about a day of the start? That email
    // already told them, so don't send a second one; just mark it reminded.
    const justEmailed = Date.parse(doc.emailedAt || "") > Date.parse(doc.startsAt) - 30 * 3600 * 1000;
    try {
      await firestoreUpdate(env, `meetings/${r.id}`, { remindedFor: doc.startsAt, reminderSentAt: justEmailed ? "" : new Date().toISOString() }, { precondition: { updateTime: fresh.updateTime } });
    } catch { continue; }
    if (justEmailed) continue;
    const result = await emailMeeting(env, { id: r.id, ...doc }, "reminder");
    sent.push({ id: r.id, ...result });
  }
  return sent;
}
