// functions/_utils/resend.js
// Minimal Resend client (https://resend.com/docs/api-reference/emails/send-email)
// Only dependency: fetch, which is built into Cloudflare Workers.

// MAIL_FROM should ideally be a subdomain address (e.g.
// "The Catalyst <newsletter@news.catalyst-magazine.com>") so newsletter
// reputation is segmented from transactional mail. Set in Cloudflare Pages
// env vars. The fallback below uses Resend's onboarding domain only as a
// last-resort dev default — never use it for real sends.
export async function sendEmail(env, { to, subject, html, text, replyTo, cc, unsubscribeEmail = null }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || "Catalyst Magazine <onboarding@resend.dev>";
  const replyToAddr = env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com";
  const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const toList = Array.isArray(to) ? to : [to];
  const recipient = unsubscribeEmail || toList[0] || "";
  const personalizedHtml = unsubscribeEmail
    ? personalizeUnsubscribeLinks(html, recipient, siteUrl)
    : html;
  const personalizedText = unsubscribeEmail && text
    ? personalizeUnsubscribeLinks(text, recipient, siteUrl)
    : text;
  const payload = {
    from,
    to: toList,
    subject,
    html: personalizedHtml,
    reply_to: replyTo || replyToAddr,
    // Disable Resend click-tracking wrapper. When enabled, Resend rewrites
    // every href to route through its own redirect domain, which (a) mangles
    // our ?email= param and (b) makes Gmail's List-Unsubscribe header refer
    // to a URL that doesn't match the body link — so Gmail won't render its
    // native unsubscribe button. Opening URLs must match the header.
    track: { click: false, open: false },
  };
  // Plain-text alternative — Resend's #1 deliverability recommendation.
  // Without this, Gmail/Outlook flag HTML-only mail as a spam signal.
  if (personalizedText) payload.text = personalizedText;
  if (cc) payload.cc = Array.isArray(cc) ? cc : [cc];
  if (unsubscribeEmail) {
    payload.headers = {
      // Gmail requires both a mailto: and an https: URL to show its native
      // unsubscribe button. The mailto: is the legacy fallback; the https:
      // is the RFC 8058 one-click endpoint. Both must be present.
      "List-Unsubscribe": `<mailto:unsubscribe@catalyst-magazine.com?subject=unsubscribe>, <${siteUrl}/api/unsubscribe/${encodeURIComponent(recipient)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend error ${res.status}: ${text}`);
  }
  return res.json();
}

// Send newsletters in per-recipient batches so each message can carry a
// recipient-specific one-click unsubscribe URL instead of a shared BCC header.
//
// recipients can be either strings (email) or objects { email, firstName? }.
// When objects are passed, htmlBuilder(recipient) is called per-recipient so
// the inbox template can embed a personalized greeting. textBuilder mirrors
// htmlBuilder for the plain-text alternative — strongly recommended for
// deliverability, optional for backwards compatibility.
export async function sendBulkEmail(env, { recipients, subject, html, text, htmlBuilder, textBuilder }) {
  const chunks = [];
  for (let i = 0; i < recipients.length; i += 100) {
    chunks.push(recipients.slice(i, i + 100));
  }

  const from = env.MAIL_FROM || "Catalyst Magazine <onboarding@resend.dev>";
  const replyToAddr = env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com";
  const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";

  const results = [];
  for (const chunk of chunks) {
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        chunk.map((recipient) => {
          const email = typeof recipient === "string" ? recipient : recipient.email;
          const recipientHtml = htmlBuilder
            ? htmlBuilder(recipient)
            : personalizeUnsubscribeLinks(html, email, siteUrl);
          const recipientText = textBuilder
            ? textBuilder(recipient)
            : (text ? personalizeUnsubscribeLinks(text, email, siteUrl) : null);
          const message = {
            from,
            to: [email],
            subject,
            html: recipientHtml,
            reply_to: replyToAddr,
            track: { click: false, open: false },
            headers: {
              "List-Unsubscribe": `<mailto:unsubscribe@catalyst-magazine.com?subject=unsubscribe>, <${siteUrl}/api/unsubscribe/${encodeURIComponent(email)}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          };
          if (recipientText) message.text = recipientText;
          return message;
        })
      ),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Resend batch error ${res.status}: ${text}`);
    }
    results.push(await res.json());
  }
  return results;
}

function personalizeUnsubscribeLinks(html, recipient, siteUrl) {
  const content = String(html || "");
  if (!content || !recipient) return content;

  const encoded = encodeURIComponent(recipient);

  // Templates embed a literal __RECIPIENT__ token in the path. Swap it for
  // the encoded email. Also rewrites legacy ?email= query-based URLs and
  // normalizes the origin so template / env.SITE_URL mismatches don't leave
  // the email blank.
  return content
    .replace(
      /https?:\/\/[^"']*\/api\/unsubscribe\/__RECIPIENT__/g,
      `${siteUrl}/api/unsubscribe/${encoded}`
    )
    .replace(
      /https?:\/\/[^"']*\/api\/unsubscribe\?email=[^"'&]*/g,
      `${siteUrl}/api/unsubscribe/${encoded}`
    );
}
