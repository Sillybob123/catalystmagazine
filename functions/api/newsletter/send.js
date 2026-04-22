// POST /api/newsletter/send
// Sends a previously-built newsletter to every active subscriber via Resend.
// Creates a campaign record in `newsletter_campaigns` for history + audit.
//
// Body: { subject, html, testEmail?, theme?, inboxParams? }
//  - If testEmail is set, sends only to that single address (for pre-flight).
//  - theme: "inbox" uses buildInboxNewsletter() per-recipient with firstName.
//  - inboxParams: { headline, intro, articles, siteUrl } needed to rebuild per-recipient.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreRunQuery, firestoreCreate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendBulkEmail, sendEmail } from "../../_utils/resend.js";
import { buildInboxNewsletter } from "../../_utils/newsletter-template.js";

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

    const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";

    // ---- Test-send path (single recipient) --------------------------------
    if (body.testEmail) {
      const testHtml = theme === "inbox"
        ? buildInboxNewsletter({ ...inboxParams, subject, siteUrl, recipientFirstName: "Reader", recipientEmail: body.testEmail })
        : html;
      await sendEmail(env, {
        to: body.testEmail,
        subject,
        html: testHtml,
        unsubscribeEmail: body.testEmail,
      });
      return json({ ok: true, test: true, sentTo: body.testEmail });
    }

    // ---- Full send path ---------------------------------------------------
    // Query active subscribers — for inbox theme we also need firstName.
    const subs = await firestoreRunQuery(env, {
      from: [{ collectionId: "subscribers" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "status" },
          op: "EQUAL",
          value: { stringValue: "active" },
        },
      },
      limit: 5000,
    });

    const recipients = subs
      .map((d) => ({
        email: d.data?.email,
        firstName: d.data?.firstName || "",
      }))
      .filter((r) => typeof r.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));

    if (!recipients.length) {
      return badRequest("No active subscribers to send to.");
    }

    // Build the per-recipient HTML builder for the inbox theme.
    // Classic theme: pass pre-built html with unsubscribe link injection (legacy).
    let htmlBuilder = null;
    if (theme === "inbox") {
      htmlBuilder = (recipient) =>
        buildInboxNewsletter({
          ...inboxParams,
          subject,
          siteUrl,
          recipientEmail: recipient.email,
          recipientFirstName: recipient.firstName || null,
        });
    }

    // Create campaign record FIRST so we have a paper trail even if send fails mid-way.
    const now = new Date().toISOString();
    const campaign = await firestoreCreate(env, "newsletter_campaigns", {
      subject,
      html,
      theme,
      recipientCount: recipients.length,
      status: "sending",
      createdBy: auth.uid,
      createdByName: auth.name || auth.email,
      createdAt: now,
    });

    // Send in recipient-personalized batches via Resend.
    let sentCount = 0;
    let failureMessage = null;
    try {
      const results = await sendBulkEmail(env, { recipients, subject, html, htmlBuilder });
      sentCount = results.reduce(
        (sum, batch) => sum + (Array.isArray(batch?.data) ? batch.data.length : 0),
        0
      );
    } catch (err) {
      failureMessage = err.message;
    }

    // Update campaign status.
    const campaignId = campaign.id;
    try {
      const { firestoreUpdate } = await import("../../_utils/firebase.js");
      await firestoreUpdate(env, `newsletter_campaigns/${campaignId}`, {
        status: failureMessage ? "failed" : "sent",
        sentAt: new Date().toISOString(),
        sentCount,
        error: failureMessage || null,
      });
    } catch (err) {
      console.error("Failed to update campaign status:", err.message);
    }

    if (failureMessage) {
      return json({ ok: false, error: failureMessage, campaignId }, { status: 500 });
    }

    return json({
      ok: true,
      campaignId,
      recipientCount: recipients.length,
      sentCount,
    });
  } catch (err) {
    return serverError(err);
  }
};
