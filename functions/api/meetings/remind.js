// POST /api/meetings/remind  { meetingId, message? }
//
// Sends a reminder about a published meeting right now (Suite → Meeting →
// Remind everyone → Send now): an email and a bell to everyone it's for,
// with an optional line from the admin. Scheduled reminders are saved on the
// meeting by the Suite and sent by the cron (functions/_utils/meeting-reminders.js).
// Admins only.

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
    if (meeting.status !== "published") return badRequest("Publish the meeting first.");
    if (Date.parse(meeting.endsAt || "") < Date.now()) return badRequest("That meeting is over.");
    const now = new Date().toISOString();
    const message = String(body.message || "").trim().slice(0, 600);
    const result = await emailMeeting(env, meeting, "reminder", { actorId: auth.uid, actorName: auth.name || "", tag: now, message });
    await firestoreUpdate(env, `meetings/${meetingId}`, { lastReminderAt: now }).catch(() => {});
    return json({ ok: true, ...result });
  } catch (err) {
    return serverError(err);
  }
};
