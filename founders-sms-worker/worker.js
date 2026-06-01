// founders-sms-worker/worker.js
// Tiny Cloudflare Worker that fires the founders SMS digest on a schedule.
// Calls POST /api/bot/founders-sms with a shared secret; that endpoint builds
// the short update text and sends it to the founders' phones via email-to-SMS
// gateways (number@vtext.com).
//
// Why a separate Worker? Cloudflare Pages Functions can't be cron-triggered —
// Workers can. Same pattern as catalyst-newsletter-cron and catalyst-bot-cron.
//
// The founders' phone numbers are NOT here and NOT on this Worker. They live
// only in the Pages project's FOUNDERS_SMS_TO secret, which the endpoint reads.

export default {
  async scheduled(controller, env, ctx) {
    const target = env.FOUNDERS_SMS_ENDPOINT || "https://www.catalyst-magazine.com/api/bot/founders-sms";
    const secret = env.FOUNDERS_SMS_SECRET;

    if (!secret) {
      console.error("FOUNDERS_SMS_SECRET is not set on this Worker.");
      return;
    }

    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": secret },
        body: JSON.stringify({}),
      });
      const text = await res.text();
      console.log(`[catalyst-founders-sms] ${res.status} — ${text.slice(0, 500)}`);
    } catch (err) {
      console.error("[catalyst-founders-sms] fetch failed:", err.message);
    }
  },

  // GET is a manual trigger for testing. Requires the secret in x-cron-secret.
  // Add ?dryRun=1 to build the message and return it WITHOUT texting anyone.
  async fetch(request, env) {
    const secret = request.headers.get("x-cron-secret") || "";
    if (!env.FOUNDERS_SMS_SECRET || secret !== env.FOUNDERS_SMS_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const target = env.FOUNDERS_SMS_ENDPOINT || "https://www.catalyst-magazine.com/api/bot/founders-sms";
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": env.FOUNDERS_SMS_SECRET },
      body: JSON.stringify({ dryRun }),
    });
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  },
};
