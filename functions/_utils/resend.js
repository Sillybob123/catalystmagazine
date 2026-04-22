// functions/_utils/resend.js
// Minimal Resend client (https://resend.com/docs/api-reference/emails/send-email)
// Only dependency: fetch, which is built into Cloudflare Workers.

export async function sendEmail(env, { to, subject, html, replyTo, cc }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || "Catalyst Magazine <onboarding@resend.dev>";
  const replyToAddr = env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com";
  const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const toList = Array.isArray(to) ? to : [to];
  const payload = {
    from,
    to: toList,
    subject,
    html,
    reply_to: replyTo || replyToAddr,
    headers: {
      // Tells Gmail this is a newsletter the recipient asked for → Primary inbox
      "List-Unsubscribe": `<${siteUrl}/api/unsubscribe?email=${encodeURIComponent(toList[0] || "")}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "Precedence": "bulk",
    },
  };
  if (cc) payload.cc = Array.isArray(cc) ? cc : [cc];

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

// Resend allows up to 50 "to" recipients per call. Chunk a larger list
// and send one BCC'd email per chunk so subscribers don't see each other.
export async function sendBulkEmail(env, { recipients, subject, html }) {
  const chunks = [];
  for (let i = 0; i < recipients.length; i += 45) {
    chunks.push(recipients.slice(i, i + 45));
  }

  const from = env.MAIL_FROM || "Catalyst Magazine <onboarding@resend.dev>";
  const replyToAddr = env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com";
  const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";

  const results = [];
  for (const chunk of chunks) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [from.match(/<(.+?)>/)?.[1] || from],
        bcc: chunk,
        subject,
        html,
        reply_to: replyToAddr,
        headers: {
          "List-Unsubscribe": `<${siteUrl}/api/unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "Precedence": "bulk",
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Resend bulk error ${res.status}: ${text}`);
    }
    results.push(await res.json());
  }
  return results;
}
