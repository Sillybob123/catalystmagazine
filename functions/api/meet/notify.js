// POST /api/meet/notify  { pollId }
//
// Invites people to a When-to-meet poll (Advanced tools → When to meet). The
// Suite writes the poll (meet_polls/{id}, admins only), then calls this: each
// invitee gets an email and a bell notification that opens #/meet?poll=<id>.
// Admins only. Idempotent per poll and person (dedupe ids on the bell; the
// email is skipped for anyone already emailed for this poll).

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreUpdate, fromFirestoreDoc } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { meetPollInviteEmail } from "../../_utils/reminder-emails.js";
import { createNotifications } from "../../_utils/notifications.js";
import { staffRecipients } from "../../_utils/team-recipients.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"]);
    if (auth instanceof Response) return auth;
    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }
    const pollId = String(body.pollId || "");
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(pollId)) return badRequest("Missing poll.");

    const raw = await firestoreGet(env, `meet_polls/${pollId}`);
    if (!raw) return badRequest("That poll doesn't exist.");
    const poll = { id: pollId, ...fromFirestoreDoc(raw).data };
    const invited = Array.isArray(poll.invitedUids) ? poll.invitedUids : [];
    if (!invited.length) return badRequest("No one is invited.");

    const { people, ids } = await staffRecipients(env, { uids: invited });
    const already = new Set(Array.isArray(poll.emailedNames) ? poll.emailedNames : []);
    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const inviterName = auth.name || "The Catalyst";
    let emailed = 0, failed = 0;
    const emailedNames = [...already];
    for (const p of people) {
      if (already.has(p.name) || !p.emails.length) continue;
      try {
        const { subject, html } = meetPollInviteEmail({ poll, recipientName: p.name, inviterName, siteUrl });
        await sendEmail(env, { to: p.emails, subject, html, text: `${inviterName} is finding a time to meet: ${poll.title}. Mark when you're free: ${siteUrl}/admin/#/meet?poll=${pollId}`, fromName: "The Catalyst" });
        emailed++; emailedNames.push(p.name);
      } catch (e) { failed++; console.warn("[meet/notify] email failed", p.name, e?.message); }
    }
    const belled = await createNotifications(env, ids.filter((x) => invited.includes(x)), {
      type: "event",
      title: `When can you meet? ${poll.title || ""}`.trim(),
      body: "Drag over the times you're free (8 AM–9 PM ET).",
      actorId: auth.uid,
      actorName: inviterName,
      actionHash: `#/meet?poll=${pollId}`,
    }, (rid) => `meet_${pollId}_${rid}`).catch(() => 0);
    await firestoreUpdate(env, `meet_polls/${pollId}`, { emailedNames, notifiedAt: new Date().toISOString() }).catch(() => {});
    return json({ ok: true, emailed, failed, notified: belled, people: people.length });
  } catch (err) {
    return serverError(err);
  }
};
