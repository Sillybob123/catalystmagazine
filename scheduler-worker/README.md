# Catalyst bot cron worker

Tiny Cloudflare Worker that fires the editorial bot on a daily schedule.

## What it does

- Every day at **10:00 AM America/New_York** (14:00 UTC), calls `POST https://catalyst-magazine.com/api/bot/run`.
- That endpoint:
  - Sends **writer reminders** (deadline 3-day + 1-day warnings, overdue notices, and 10-day idle check-ins).
  - On **Saturdays only**, also sends an **admin digest** email to the editorial team with a per-writer breakdown and copy-paste messages.
- Deduplication is handled server-side in Firestore (`bot_reminder_log/state`) with a 7-day per-kind cooldown, so running the cron more than once a day is harmless.

## One-time setup

1. **Set the shared secret on the Pages project** (this is what the endpoint checks):

   Cloudflare dashboard → Pages → `catalystmagazine` → Settings → Environment variables → **Production** → add:

   - `BOT_CRON_SECRET` = (generate a long random string, e.g. `openssl rand -hex 32`)

2. **Deploy this worker**:

   ```bash
   cd scheduler-worker
   npx wrangler secret put BOT_CRON_SECRET --config ./wrangler.toml
   # (paste the exact same value you set on the Pages project)

   npx wrangler deploy --config ./wrangler.toml
   ```

   > **Why `--config ./wrangler.toml`?** The parent directory has a
   > `wrangler.jsonc` for the Pages project. Without `--config`, Wrangler
   > walks upward, finds that one first, and errors with
   > `"Workers-specific command in a Pages project"`. Passing the flag
   > pins it to this worker's config.

3. **(Optional) Test it manually** — the worker's `fetch` handler lets you run the bot on demand:

   ```bash
   curl -H "x-bot-secret: <your-secret>" https://catalyst-bot-cron.<your-subdomain>.workers.dev/
   # Force a Saturday digest any day:
   curl -H "x-bot-secret: <your-secret>" "https://catalyst-bot-cron.<your-subdomain>.workers.dev/?digest=1"
   ```

## Changing the schedule

Edit `crons` in `wrangler.toml` and re-deploy. Format is standard cron (UTC).

## Admin manual triggers

Admins can also run the bot from the dashboard overview page — the "Catalyst editorial bot" card has Preview / Send digest / Run now buttons that authenticate with the admin's Firebase token (no cron secret needed).
