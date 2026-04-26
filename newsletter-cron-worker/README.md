# catalyst-newsletter-cron

Tiny Cloudflare Worker that polls `POST /api/newsletter/dispatch-due` every 5 minutes so scheduled newsletters fire at their requested time.

## Setup (one time)

1. Pick a long random string and save it somewhere — we'll call it `<SECRET>`.

2. Set it on the Worker:
   ```
   cd newsletter-cron-worker
   npx wrangler secret put NEWSLETTER_CRON_SECRET
   # paste <SECRET> when prompted
   ```

3. Set the same value on the Pages project:
   - Cloudflare Dashboard → Pages → catalystmagazine → Settings → Environment variables
   - Add `NEWSLETTER_CRON_SECRET` = `<SECRET>` (Production)

4. Deploy the worker:
   ```
   npx wrangler deploy
   ```

5. (Optional) Test it manually:
   ```
   curl -H "x-cron-secret: <SECRET>" https://catalyst-newsletter-cron.<your-account>.workers.dev/
   ```
   Should return JSON like `{"ok":true,"dispatched":[],"skipped":[],"processed":0}` when there are no scheduled sends.

## What it does

- Every 5 minutes, sends an authenticated POST to the Pages function endpoint.
- The endpoint queries `newsletter_campaigns` for `status == "scheduled"` and `scheduledAt <= now`.
- Each due campaign is atomically claimed (Firestore `updateTime` precondition) before being dispatched, so duplicate cron runs cannot double-send.
- Cancellation works as long as the cron has not yet claimed the campaign — admins have up to ~5 minutes between scheduling and dispatch to abort.
