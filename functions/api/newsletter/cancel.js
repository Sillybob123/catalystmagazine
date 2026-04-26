// POST /api/newsletter/cancel
// Cancels a scheduled (not-yet-dispatched) newsletter campaign.
// Body: { campaignId }
//
// Only succeeds if the campaign is currently in "scheduled" status. Once a
// cron tick has flipped it to "sending", cancellation is no longer possible
// — Resend has already started accepting the batches and we have no way to
// recall them.

import { json, badRequest, serverError } from "../../_utils/http.js";
import {
  firestoreGet,
  firestoreUpdate,
  fromFirestoreDoc,
} from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin", "newsletter_builder"]);
    if (auth instanceof Response) return auth;

    let body;
    try { body = await request.json(); } catch { return badRequest("Invalid JSON body"); }
    const campaignId = (body.campaignId || "").trim();
    if (!campaignId) return badRequest("campaignId is required");

    const raw = await firestoreGet(env, `newsletter_campaigns/${campaignId}`);
    if (!raw) return json({ ok: false, error: "Campaign not found" }, { status: 404 });
    const { data } = fromFirestoreDoc(raw);
    if (data.status !== "scheduled") {
      return json({
        ok: false,
        error: `Cannot cancel a campaign in status "${data.status}". Only scheduled campaigns can be canceled.`,
      }, { status: 409 });
    }

    // Use updateTime precondition so we don't accidentally cancel a campaign
    // that the cron worker just claimed mid-request.
    try {
      await firestoreUpdate(env, `newsletter_campaigns/${campaignId}`, {
        status: "canceled",
        canceledAt: new Date().toISOString(),
        canceledBy: auth.uid,
        canceledByName: auth.name || auth.email,
      }, { precondition: { updateTime: raw.updateTime } });
    } catch (err) {
      if (err.status === 412 || err.status === 409) {
        return json({
          ok: false,
          error: "Campaign was just dispatched — cancel arrived too late.",
        }, { status: 409 });
      }
      throw err;
    }

    return json({ ok: true, campaignId });
  } catch (err) {
    return serverError(err);
  }
};
