// POST /api/newsletter/send
// Sends a previously-built newsletter to every active subscriber via Resend.
// Creates a campaign record in `newsletter_campaigns` for history + audit.
//
// Body: { subject, html, testEmail? }
//  - If testEmail is set, sends only to that single address (for pre-flight).

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreRunQuery, firestoreCreate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendBulkEmail, sendEmail } from "../../_utils/resend.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin", "newsletter_builder"]);
    if (auth instanceof Response) return auth;

    let body;
    try { body = await request.json(); } catch { return badRequest("Invalid JSON body"); }

    const subject = (body.subject || "").trim();
    const html = body.html || "";
    if (!subject) return badRequest("subject is required");
    if (!html || html.length < 50) return badRequest("html body is required");

    // ---- Test-send path (single recipient) --------------------------------
    if (body.testEmail) {
      await sendEmail(env, { to: body.testEmail, subject, html });
      return json({ ok: true, test: true, sentTo: body.testEmail });
    }

    // ---- Full send path ---------------------------------------------------
    // Query active subscribers.
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
      .map((d) => d.data?.email)
      .filter((e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    if (!recipients.length) {
      return badRequest("No active subscribers to send to.");
    }

    // Create campaign record FIRST so we have a paper trail even if send fails mid-way.
    const now = new Date().toISOString();
    const campaign = await firestoreCreate(env, "newsletter_campaigns", {
      subject,
      html,
      recipientCount: recipients.length,
      status: "sending",
      createdBy: auth.uid,
      createdByName: auth.name || auth.email,
      createdAt: now,
    });

    // Send in BCC chunks via Resend.
    let sentCount = 0;
    let failureMessage = null;
    try {
      const results = await sendBulkEmail(env, { recipients, subject, html });
      sentCount = results.length * 45; // approx; each chunk is up to 45 BCCs
      if (sentCount > recipients.length) sentCount = recipients.length;
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
