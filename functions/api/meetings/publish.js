// POST /api/meetings/publish  { meetingId }
//
// Publishes a team meeting (Suite → Meeting): marks it published and emails
// everyone it's for (the whole team, or the people picked), with a bell
// notification too. Publishing again after a change sends an "updated" email.
// The reminder about a day before goes out from the cron
// (functions/_utils/meeting-reminders.js). Admins only.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreUpdate, fromFirestoreDoc } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { emailMeeting } from "../../_utils/meeting-reminders.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"]);
    if (auth instanceof Response) return auth;
    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }
    const meetingId = String(body.meetingId || "");
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(meetingId)) return badRequest("Missing meeting.");
    const raw = await firestoreGet(env, `meetings/${meetingId}`);
    if (!raw) return badRequest("That meeting doesn't exist.");
    const meeting = { id: meetingId, ...fromFirestoreDoc(raw).data };
    if (!meeting.date || !meeting.start || !meeting.end || !meeting.startsAt) return badRequest("The meeting needs a date and times.");
    const kind = meeting.emailedAt ? "updated" : "scheduled";   // published quietly before? Still the first email
    const now = new Date().toISOString();
    await firestoreUpdate(env, `meetings/${meetingId}`, { status: "published", publishedAt: meeting.publishedAt || now, emailedAt: now });
    const result = await emailMeeting(env, meeting, kind, { actorId: auth.uid, actorName: auth.name || "", tag: now });
    await firestoreUpdate(env, `meetings/${meetingId}`, { emailedCount: result.emailed }).catch(() => {});
    return json({ ok: true, kind, ...result });
  } catch (err) {
    return serverError(err);
  }
};
