// POST /api/newsletter/dispatch-due
// Called by the newsletter cron worker every 5 minutes. Finds campaigns
// whose status is "scheduled" and whose scheduledAt has passed, then sends
// each one. Gated by a shared secret (NEWSLETTER_CRON_SECRET) — not by user
// auth — because the caller is a Worker, not a logged-in admin.
//
// Concurrency safety: each campaign is "claimed" via an updateTime
// precondition before sending. If two cron invocations race, only one will
// succeed in flipping status to "sending"; the other gets a 412
// (Failed Precondition) and silently skips that campaign. Either way,
// each campaign sends at most once.

import { json, serverError } from "../../_utils/http.js";
import {
  firestoreRunQuery,
  firestoreGet,
  firestoreUpdate,
  fromFirestoreDoc,
} from "../../_utils/firebase.js";
import { dispatchCampaign } from "../../_utils/newsletter-send.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const provided = request.headers.get("x-cron-secret") || "";
    if (!env.NEWSLETTER_CRON_SECRET || provided !== env.NEWSLETTER_CRON_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    const nowIso = new Date().toISOString();

    // Find scheduled campaigns whose time has come. Combining two field
    // filters in Firestore REST requires a `compositeFilter` with op AND.
    const due = await firestoreRunQuery(env, {
      from: [{ collectionId: "newsletter_campaigns" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: "status" },
                op: "EQUAL",
                value: { stringValue: "scheduled" },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: "scheduledAt" },
                op: "LESS_THAN_OR_EQUAL",
                value: { stringValue: nowIso },
              },
            },
          ],
        },
      },
      // Cap how many we'll process in one cron tick. If 50+ campaigns
      // somehow pile up, the next tick (5 min later) picks up the rest.
      limit: 50,
    });

    const dispatched = [];
    const skipped = [];
    for (const row of due) {
      const campaignId = row.id;
      // Re-fetch to get the doc's updateTime for the precondition. This also
      // protects against acting on a stale list (e.g. someone canceled
      // between query and dispatch).
      const fresh = await firestoreGet(env, `newsletter_campaigns/${campaignId}`);
      if (!fresh) { skipped.push({ campaignId, reason: "not-found" }); continue; }
      const { data } = fromFirestoreDoc(fresh);
      if (data.status !== "scheduled") {
        skipped.push({ campaignId, reason: `status=${data.status}` });
        continue;
      }

      // Atomically claim the campaign. If two cron runs race, the loser's
      // PATCH fails the precondition and we skip — no double send.
      try {
        await firestoreUpdate(env, `newsletter_campaigns/${campaignId}`, {
          status: "sending",
          dispatchStartedAt: new Date().toISOString(),
        }, { precondition: { updateTime: fresh.updateTime } });
      } catch (err) {
        if (err.status === 412 || err.status === 409) {
          skipped.push({ campaignId, reason: "claim-lost" });
          continue;
        }
        throw err;
      }

      // Reconstruct the campaign payload from the stored fields.
      const campaign = {
        subject: data.subject || "",
        html: data.html || "",
        theme: data.theme || "classic",
        inboxParams: data.inboxParams || null,
      };

      try {
        const result = await dispatchCampaign(env, campaignId, campaign);
        dispatched.push({ campaignId, ok: result.ok, sentCount: result.sentCount, error: result.error || null });
      } catch (err) {
        // dispatchCampaign normally records its own failure on the doc, but
        // if it threw before getting there, mark it failed so we don't
        // re-send on the next tick (status is already "sending").
        await firestoreUpdate(env, `newsletter_campaigns/${campaignId}`, {
          status: "failed",
          sentAt: new Date().toISOString(),
          error: `Dispatch threw: ${err.message}`,
        });
        dispatched.push({ campaignId, ok: false, error: err.message });
      }
    }

    return json({ ok: true, dispatched, skipped, processed: dispatched.length });
  } catch (err) {
    return serverError(err);
  }
};
