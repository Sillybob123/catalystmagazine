// functions/_utils/resend.js
// Minimal Resend client (https://resend.com/docs/api-reference/emails/send-email)
// Only dependency: fetch, which is built into Cloudflare Workers.

export async function sendEmail(env, { to, subject, html, replyTo, cc, unsubscribeEmail = null }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || "Catalyst Magazine <onboarding@resend.dev>";
  const replyToAddr = env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com";
  const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const toList = Array.isArray(to) ? to : [to];
  const recipient = unsubscribeEmail || toList[0] || "";
  const personalizedHtml = unsubscribeEmail
    ? personalizeUnsubscribeLinks(html, recipient, siteUrl)
    : html;
  const payload = {
    from,
    to: toList,
    subject,
    html: personalizedHtml,
    reply_to: replyTo || replyToAddr,
  };
  if (cc) payload.cc = Array.isArray(cc) ? cc : [cc];
  if (unsubscribeEmail) {
    payload.headers = {
      "List-Unsubscribe": `<${siteUrl}/api/unsubscribe?email=${encodeURIComponent(recipient)}>`,
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
// the inbox template can embed a personalized greeting.
export async function sendBulkEmail(env, { recipients, subject, html, htmlBuilder }) {
  const chunks = [];
  for (let i = 0; i < recipients.length; i += 100) {
    chunks.push(recipients.slice(i, i + 100));
  }

  const from = env.MAIL_FROM || "Catalyst Magazine <onboarding@resend.dev>";
  const replyToAddr = env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com";
  const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";

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
          return {
            from,
            to: [email],
            subject,
            html: recipientHtml,
            reply_to: replyToAddr,
            headers: {
              "List-Unsubscribe": `<${siteUrl}/api/unsubscribe?email=${encodeURIComponent(email)}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          };
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
  return content.replaceAll(
    `${siteUrl}/api/unsubscribe?email=`,
    `${siteUrl}/api/unsubscribe?email=${encoded}`
  );
}
