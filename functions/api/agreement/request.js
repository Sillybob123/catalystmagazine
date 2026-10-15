// POST /api/agreement/request
//
// An admin asks people to read and sign the Contributor Agreement (Advanced
// tools → Contributor agreement). Sets users/{uid}.agreementRequestedAt, which
// makes the Suite show the agreement on their next visit even if they signed
// an earlier version, and sends each person an email and a bell notification.
//
// Body: { uids: string[] }
// Auth: admin (and not blocked from Advanced tools).

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreUpdate, fromFirestoreDoc } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { agreementRequestEmail } from "../../_utils/reminder-emails.js";
import { createNotification } from "../../_utils/notifications.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"], ["#/admin/advanced"]);
    if (auth instanceof Response) return auth;
    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }
    const uids = [...new Set((Array.isArray(body.uids) ? body.uids : []).filter((u) => /^[A-Za-z0-9_-]{1,128}$/.test(String(u))))].slice(0, 200);
    if (!uids.length) return badRequest("Who should get the agreement?");

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const now = new Date().toISOString();
    const sender = auth.name || auth.email || "An admin";
    let sent = 0, emailed = 0;
    for (const uid of uids) {
      const raw = await firestoreGet(env, `users/${uid}`).catch(() => null);
      if (!raw) continue;
      const u = fromFirestoreDoc(raw).data;
      await firestoreUpdate(env, `users/${uid}`, { agreementRequestedAt: now });
      sent++;
      await createNotification(env, {
        recipientId: uid, type: "event", eventType: "agreement-request",
        title: "Please read and sign the Contributor Agreement",
        body: "It opens when you next visit the Editorial Suite.", actorId: auth.uid, actorName: sender, actionHash: "#/overview",
      }, `agreement_${uid}_${now.slice(0, 16)}`).catch(() => {});
      if (u.email) {
        const { subject, html } = agreementRequestEmail({ name: u.name || "", senderName: sender, siteUrl });
        const ok = await sendEmail(env, { to: u.email, subject, html, replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com" }).then(() => true).catch((e) => { console.warn("[agreement] email", e?.message); return false; });
        if (ok) emailed++;
      }
    }
    return json({ ok: true, sent, emailed });
  } catch (err) {
    return serverError(err);
  }
};
