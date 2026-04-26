// functions/_utils/newsletter-send.js
// Shared newsletter-send logic. Used by both:
//   • POST /api/newsletter/send       — admin clicks "Send to all"
//   • POST /api/newsletter/dispatch-due — cron worker fires due campaigns
//
// Centralizing this means scheduled and immediate sends produce identical
// emails (same per-recipient personalization, same plain-text fallback,
// same campaign-status updates) and there's only one place to change.

import { firestoreRunQuery, firestoreUpdate } from "./firebase.js";
import { sendBulkEmail, sendEmail } from "./resend.js";
import {
  buildInboxNewsletter,
  buildInboxNewsletterText,
  buildNewsletterText,
} from "./newsletter-template.js";

// Title-cases a single first name. Handles compound names ("mary-jane",
// "o'brien") by capitalizing each segment. Returns "" for empty/garbage
// input so the template falls through to its "Hi there," fallback.
export function titleCaseName(s) {
  const v = String(s || "").trim();
  if (!v || v.length > 60) return "";
  return v
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((tok) => (/^\s+$|^[-']$/.test(tok) ? tok : tok.charAt(0).toUpperCase() + tok.slice(1)))
    .join("");
}

// Send a test email to a single address. Used for the "Send a test" button.
// Builds personalized HTML+text using "Reader" as the fallback first name.
export async function sendNewsletterTest(env, { subject, html, theme, inboxParams, testEmail, siteUrl }) {
  const isInbox = theme === "inbox";
  const testHtml = isInbox
    ? buildInboxNewsletter({ ...inboxParams, subject, siteUrl, recipientFirstName: "Reader", recipientEmail: testEmail })
    : html;
  const testText = isInbox
    ? buildInboxNewsletterText({ ...inboxParams, siteUrl, recipientFirstName: "Reader", recipientEmail: testEmail })
    : buildNewsletterText({
        headline: inboxParams?.headline,
        intro: inboxParams?.intro,
        articles: inboxParams?.articles || [],
        siteUrl,
        recipientEmail: testEmail,
      });
  await sendEmail(env, {
    to: testEmail,
    subject,
    html: testHtml,
    text: testText,
    unsubscribeEmail: testEmail,
  });
}

// Build per-recipient HTML and text builders for a campaign. Inbox theme uses
// the personalized template; classic theme reuses the same pre-built HTML for
// every recipient (the unsubscribe link is the only per-recipient change).
function buildBuilders({ theme, html, inboxParams, subject, siteUrl }) {
  if (theme === "inbox") {
    const htmlBuilder = (r) =>
      buildInboxNewsletter({
        ...inboxParams,
        subject,
        siteUrl,
        recipientEmail: r.email,
        recipientFirstName: r.firstName || null,
      });
    const textBuilder = (r) =>
      buildInboxNewsletterText({
        ...inboxParams,
        siteUrl,
        recipientEmail: r.email,
        recipientFirstName: r.firstName || null,
      });
    return { htmlBuilder, textBuilder, classicText: null };
  }
  // Classic theme — pre-built HTML, generic text fallback.
  const classicText = buildNewsletterText({
    headline: inboxParams?.headline,
    intro: inboxParams?.intro,
    articles: inboxParams?.articles || [],
    siteUrl,
  });
  return { htmlBuilder: null, textBuilder: null, classicText };
}

// Load all active subscribers and normalize them into { email, firstName }
// recipient objects. Filters out malformed or empty email addresses.
async function loadActiveRecipients(env) {
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

  return subs
    .map((d) => {
      const data = d.data || {};
      const rawFirst =
        (data.firstName || "").trim() ||
        ((data.fullName || "").trim().split(/\s+/)[0] || "") ||
        ((data.name || "").trim().split(/\s+/)[0] || "");
      return { email: data.email, firstName: titleCaseName(rawFirst) };
    })
    .filter((r) => typeof r.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
}

// Dispatch a campaign to all active subscribers and update the campaign
// document with the result. Updates `status` from "sending" → "sent" or
// "failed" and records sentAt/sentCount/error. Throws only on truly
// unexpected errors; Resend failures are caught and recorded on the doc.
export async function dispatchCampaign(env, campaignId, campaign) {
  const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
  const subject = campaign.subject;
  const html = campaign.html;
  const theme = campaign.theme === "inbox" ? "inbox" : "classic";
  const inboxParams = campaign.inboxParams || null;

  const recipients = await loadActiveRecipients(env);
  if (!recipients.length) {
    await firestoreUpdate(env, `newsletter_campaigns/${campaignId}`, {
      status: "failed",
      error: "No active subscribers at dispatch time.",
      sentAt: new Date().toISOString(),
      sentCount: 0,
    });
    return { ok: false, sentCount: 0, error: "No active subscribers." };
  }

  const { htmlBuilder, textBuilder, classicText } = buildBuilders({
    theme, html, inboxParams, subject, siteUrl,
  });

  let sentCount = 0;
  let failureMessage = null;
  try {
    const results = await sendBulkEmail(env, {
      recipients,
      subject,
      html,
      text: classicText,
      htmlBuilder,
      textBuilder,
    });
    sentCount = results.reduce(
      (sum, batch) => sum + (Array.isArray(batch?.data) ? batch.data.length : 0),
      0
    );
  } catch (err) {
    failureMessage = err.message;
  }

  await firestoreUpdate(env, `newsletter_campaigns/${campaignId}`, {
    status: failureMessage ? "failed" : "sent",
    sentAt: new Date().toISOString(),
    sentCount,
    error: failureMessage || null,
  });

  return {
    ok: !failureMessage,
    sentCount,
    recipientCount: recipients.length,
    error: failureMessage,
  };
}
