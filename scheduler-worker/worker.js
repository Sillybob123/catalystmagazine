// scheduler-worker/worker.js
// A standalone Cloudflare Worker whose only job is to fire the Catalyst
// editorial bot on a cron schedule. It calls the Pages Function endpoint
// `POST /api/bot/run` with a shared secret.
//
// Why a separate Worker? Cloudflare Pages Functions don't expose cron
// triggers directly — Workers do. Keeping it tiny and self-contained means
// we never need to touch it again.

export default {
  async scheduled(controller, env, ctx) {
    const target = env.BOT_ENDPOINT || "https://catalyst-magazine.com/api/bot/run";
    const secret = env.BOT_CRON_SECRET;

    if (!secret) {
      console.error("BOT_CRON_SECRET is not set on this Worker.");
      return;
    }

    try {
      const res = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bot-secret": secret,
        },
        // "auto" mode runs writer reminders daily, and the digest only on
        // Saturday (bot checks weekday internally in America/New_York).
        body: JSON.stringify({ mode: "auto" }),
      });
      const text = await res.text();
      console.log(`[catalyst-bot-cron] ${res.status} — ${text.slice(0, 500)}`);
    } catch (err) {
      console.error("[catalyst-bot-cron] fetch failed:", err.message);
    }
  },

  // A GET to the worker is a manual trigger for testing. Requires the secret
  // in the `x-bot-secret` header — same one the scheduled path uses.
  async fetch(request, env) {
    const secret = request.headers.get("x-bot-secret") || "";
    if (!env.BOT_CRON_SECRET || secret !== env.BOT_CRON_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const target = env.BOT_ENDPOINT || "https://catalyst-magazine.com/api/bot/run";
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-secret": env.BOT_CRON_SECRET },
      body: JSON.stringify({ mode: "auto", forceDigest: new URL(request.url).searchParams.get("digest") === "1" }),
    });
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  },
};
