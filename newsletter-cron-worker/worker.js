// newsletter-cron-worker/worker.js
// Tiny Cloudflare Worker whose only job is to fire the newsletter dispatcher
// on a cron schedule. Calls POST /api/newsletter/dispatch-due with a shared
// secret. The endpoint finds any campaigns whose scheduledAt has passed and
// sends them.
//
// Why a separate Worker? Cloudflare Pages Functions don't expose cron
// triggers — Workers do. Keeping it tiny and self-contained means we never
// need to touch it again. We run every 5 minutes; that's cheap (288
// invocations/day, well within the free tier) and gives admins ~5 minutes
// of warning to cancel a scheduled send before it fires.

export default {
  async scheduled(controller, env, ctx) {
    const target = env.DISPATCH_ENDPOINT || "https://www.catalyst-magazine.com/api/newsletter/dispatch-due";
    const secret = env.NEWSLETTER_CRON_SECRET;

    if (!secret) {
      console.error("NEWSLETTER_CRON_SECRET is not set on this Worker.");
      return;
    }

    try {
      const res = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": secret,
        },
      });
      const text = await res.text();
      console.log(`[catalyst-newsletter-cron] ${res.status} — ${text.slice(0, 500)}`);
    } catch (err) {
      console.error("[catalyst-newsletter-cron] fetch failed:", err.message);
    }
  },

  // GET to the worker is a manual trigger for testing. Requires the secret
  // in the `x-cron-secret` header — same one the scheduled path uses.
  async fetch(request, env) {
    const secret = request.headers.get("x-cron-secret") || "";
    if (!env.NEWSLETTER_CRON_SECRET || secret !== env.NEWSLETTER_CRON_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const target = env.DISPATCH_ENDPOINT || "https://www.catalyst-magazine.com/api/newsletter/dispatch-due";
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": env.NEWSLETTER_CRON_SECRET },
    });
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  },
};
