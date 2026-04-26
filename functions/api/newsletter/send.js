// POST /api/newsletter/send
// Either sends a newsletter immediately, schedules it for a future time, or
// fires a single test email. Creates a campaign record in
// `newsletter_campaigns` for history + audit.
//
// Body: { subject, html, testEmail?, theme?, inboxParams?, scheduledAt? }
//  - testEmail   → send only to that one address (pre-flight; no campaign).
//  - scheduledAt → ISO 8601 UTC string. Stores the campaign with
//                  status="scheduled" instead of sending. The newsletter
//                  cron worker dispatches it at the requested time.
//  - theme       → "inbox" uses buildInboxNewsletter() per-recipient.
//  - inboxParams → { headline, intro, articles, siteUrl } needed to rebuild
//                  per-recipient HTML at send time.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreCreate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import {
  dispatchCampaign,
  sendNewsletterTest,
} from "../../_utils/newsletter-send.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin", "newsletter_builder"]);
    if (auth instanceof Response) return auth;

    let body;
    try { body = await request.json(); } catch { return badRequest("Invalid JSON body"); }

    const subject = (body.subject || "").trim();
    const html = body.html || "";
    const theme = body.theme === "inbox" ? "inbox" : "classic";
    const inboxParams = body.inboxParams || null;
    if (!subject) return badRequest("subject is required");
    if (!html || html.length < 50) return badRequest("html body is required");
    if (theme === "inbox" && !inboxParams) return badRequest("inboxParams required for inbox theme");

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";

    // ---- Test-send path (single recipient, no campaign record) -----------
    if (body.testEmail) {
      await sendNewsletterTest(env, { subject, html, theme, inboxParams, testEmail: body.testEmail, siteUrl });
      return json({ ok: true, test: true, sentTo: body.testEmail });
    }

    // ---- Scheduled-send path ---------------------------------------------
    // Validate scheduledAt: must be a parseable date at least 60s in the
    // future (guards against clock skew + accidental "send now" via past
    // timestamp). The cron worker fires every 5 minutes, so anything sooner
    // than ~5min may slip into the next tick — that's still acceptable.
    if (body.scheduledAt) {
      const scheduledAt = new Date(body.scheduledAt);
      if (isNaN(scheduledAt.getTime())) return badRequest("scheduledAt is not a valid date");
      if (scheduledAt.getTime() < Date.now() + 60_000) {
        return badRequest("scheduledAt must be at least 1 minute in the future");
      }
      const now = new Date().toISOString();
      const campaign = await firestoreCreate(env, "newsletter_campaigns", {
        subject,
        html,
        theme,
        // Store the inboxParams blob so the cron worker can re-render
        // per-recipient HTML at dispatch time without the caller re-posting it.
        inboxParams,
        status: "scheduled",
        scheduledAt: scheduledAt.toISOString(),
        recipientCount: 0, // populated at dispatch time
        createdBy: auth.uid,
        createdByName: auth.name || auth.email,
        createdAt: now,
      });
      return json({
        ok: true,
        scheduled: true,
        campaignId: campaign.id,
        scheduledAt: scheduledAt.toISOString(),
      });
    }

    // ---- Immediate full-send path ----------------------------------------
    // Create campaign record FIRST so we have a paper trail even if send fails mid-way.
    const now = new Date().toISOString();
    const campaign = await firestoreCreate(env, "newsletter_campaigns", {
      subject,
      html,
      theme,
      inboxParams,
      status: "sending",
      createdBy: auth.uid,
      createdByName: auth.name || auth.email,
      createdAt: now,
    });

    const result = await dispatchCampaign(env, campaign.id, {
      subject, html, theme, inboxParams,
    });

    if (!result.ok) {
      return json({ ok: false, error: result.error, campaignId: campaign.id }, { status: 500 });
    }
    return json({
      ok: true,
      campaignId: campaign.id,
      recipientCount: result.recipientCount,
      sentCount: result.sentCount,
    });
  } catch (err) {
    return serverError(err);
  }
};
