// functions/_utils/resend.js
// Minimal Resend client (https://resend.com/docs/api-reference/emails/send-email)
// Only dependency: fetch, which is built into Cloudflare Workers.

export async function sendEmail(env, { to, subject, html, replyTo }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || "Catalyst Magazine <hello@catalyst-magazine.com>";

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (replyTo) payload.reply_to = replyTo;

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

  const results = [];
  for (const chunk of chunks) {
    // Send one message, BCC the chunk. The visible "to" is the from address
    // so that subscribers don't see each other's emails.
    const from = env.MAIL_FROM || "Catalyst Magazine <hello@catalyst-magazine.com>";
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
