# Catalyst Magazine — Backend Deployment Guide

You are migrating from Wix to a self-hosted stack:

- **Cloudflare Pages** hosts your static site AND your serverless API.
- **Firebase Auth + Firestore** is your database and user manager.
- **Resend** is your email sender.

This doc walks you through every step, in order, with exact commands. Allow ~60–90 minutes end-to-end.

> **GitHub vs Cloudflare Pages — quick clarification.**
> GitHub *stores your code*. It does not run the backend. Cloudflare Pages *pulls* from your GitHub repo, runs the build, and serves the site + the `/api/*` functions. You do not have to switch hosts — Cloudflare Pages does both. (GitHub Pages on its own can't run Cloudflare Functions, so if you tried to "host on GitHub Pages" the `/api/subscribe`, `/api/signup`, `/api/publish` endpoints would 404.)

---

## 0. Testing phase (before you move `catalyst-magazine.com` off Wix)

You asked to try everything first without touching the live domain. Good call. Here's what changes compared to the production setup below:

| | Testing phase | Production (later) |
| --- | --- | --- |
| Site URL | `https://catalystmagazine.pages.dev` (Cloudflare auto-assigns it) | `https://catalyst-magazine.com` |
| Where DNS points | Wix still owns the domain — leave it alone | Cloudflare serves the domain |
| Env var `SITE_URL` | `https://catalystmagazine.pages.dev` | `https://catalyst-magazine.com` |
| Resend sender (`MAIL_FROM`) | `Catalyst Magazine <onboarding@resend.dev>` (sandbox) | `Catalyst Magazine <hello@catalyst-magazine.com>` (verified domain) |
| Who gets email? | **Only the email address you signed up to Resend with.** The sandbox rejects everyone else, which is perfect for testing without spamming real people. | Anyone on your subscriber list. |
| Custom domain setup in Cloudflare | **Skip §3.5.** | Do §3.5 when you're ready to cut over. |
| Resend DNS records on your domain | **Skip §2 step 3.** | Do §2 step 3 when you're ready to cut over. |

In testing, the whole flow works the same way — you'll be able to hit `https://catalystmagazine.pages.dev/api/health`, fill out the newsletter form, publish stories, and see the "every 3 stories" newsletter fire. It just sends to your personal inbox instead of your real subscribers, because Resend's sandbox is locked down.

**When you're ready to go live** (maybe weeks from now), do exactly three things:

1. In Resend, add `catalyst-magazine.com` and verify the DNS records (§2).
2. In Cloudflare Pages env vars, change `SITE_URL` to `https://catalyst-magazine.com` and `MAIL_FROM` to `Catalyst Magazine <hello@catalyst-magazine.com>`.
3. In Cloudflare Pages, add `catalyst-magazine.com` as a custom domain (§3.5). Move the nameservers off Wix.

No code changes. Everything else stays identical.

---

---

## What I built for you

```
functions/
  _middleware.js              # CORS for every /api call
  _utils/
    http.js                   # json(), badRequest(), rate-limiting helpers
    firebase.js               # Verify Firebase ID tokens + Firestore REST client
    resend.js                 # Send single + bulk email via Resend
    emails.js                 # HTML email templates (welcome, newsletter, confirm)
  api/
    health.js                 # GET  /api/health  — sanity check
    subscribe.js              # POST /api/subscribe — newsletter signup
    signup.js                 # POST /api/signup    — welcome email after Firebase signup
    publish.js                # POST /api/publish   — publish a story + 3-post newsletter trigger

js/
  newsletter-handler.js       # Replaces mailchimp-handler.js on the front-end
  admin-publish-bridge.js     # Calls /api/publish from the admin dashboard

firestore.rules               # Security rules
firestore.indexes.json        # Composite indexes
.dev.vars.example             # Environment-variable template
wrangler.jsonc                # Cloudflare Pages config (updated)
package.json                  # Added pages:dev + pages:deploy scripts
```

The **only part that counts articles** is `functions/api/publish.js`. It runs this check every time an editor approves a story:

```js
const totalPublished = (await firestoreRunQuery(...)).length;
const shouldSendNewsletter = totalPublished > 0 && totalPublished % 3 === 0;
```

If that is `true`, it pulls the three most recent `published` stories, pulls all `active` subscribers, and BCCs them one Resend email.

---

## 1. Firebase

### 1.1. Pick which project to use

You already have two Firebase projects floating around:

- `catalystwriters-5ce43` — used by the existing site. **All your real data is here.**
- `catalystmagazinenew` — the fresh project you created.

**My recommendation: keep using `catalystwriters-5ce43`.** Nothing in this codebase needs a fresh project, and moving would mean re-uploading every story. `js/firebase-config.js` is unchanged and still points there.

If you really want to switch, (a) export stories from the old project and re-import them into the new one, (b) replace the config values in `js/firebase-config.js`, and (c) update `FIREBASE_PROJECT_ID` in your Cloudflare env vars.

### 1.2. Generate a service-account key

The Cloudflare Functions need a Firebase service account so they can write to Firestore on behalf of the server.

1. Open the Firebase console → your project → **Project settings** → **Service accounts**.
2. Click **Generate new private key**. A JSON file downloads.
3. Open the file in a text editor and **copy the entire contents** to the clipboard. You'll paste this into Cloudflare in §3.

### 1.3. Deploy the security rules

Install the Firebase CLI if you haven't:

```bash
npm install -g firebase-tools
firebase login
```

From the project folder:

```bash
firebase use catalystwriters-5ce43     # or catalystmagazinenew
firebase deploy --only firestore:rules,firestore:indexes
```

The rules are in `firestore.rules`. They enforce:
- public can read only **published** stories;
- writers can edit their own drafts;
- only `admin` / `editor` users can flip a story to `published`;
- `subscribers` can only be read by staff.

### 1.4. Promote yourself to admin

In Firebase console → **Firestore** → open collection `users` → find your UID → set field `role` to `admin`. Without this, `/api/publish` will reject your requests.

---

## 2. Resend (email sender)

1. Go to <https://resend.com>, sign up with your personal email (free tier = 3,000 emails/month, 100/day).
2. **API Keys** → **Create API Key** → name it `catalyst-pages-prod` → copy it (starts with `re_...`). You'll paste this into Cloudflare in §3. **You can stop here during testing.**
3. **(Production only — skip during testing.)** **Domains** → **Add Domain** → enter `catalyst-magazine.com`. Resend shows you 3–4 DNS records (SPF, DKIM, optional MX). You'll add them in Cloudflare DNS *after* you move the domain off Wix.

During testing, use `MAIL_FROM=Catalyst Magazine <onboarding@resend.dev>`. Resend will only deliver those sandbox messages to the address you signed up with — so any email you fire off during testing lands in your own inbox. That's the exact behavior we want while you're building.

---

## 3. GitHub → Cloudflare Pages

### 3.1. Push the repo

```bash
cd /path/to/CatalystMagazine
git add .
git commit -m "Introduce Cloudflare Functions backend"
git push origin main
```

Your remote is already set to `https://github.com/Sillybob123/catalystmagazine.git`.

### 3.2. Create the Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Pick the `catalystmagazine` repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build:cloudflare`
   - **Build output directory:** `cloudflare-dist`
   - **Root directory:** (leave blank)
4. Click **Save and Deploy**.

The first deploy will fail health checks because env vars aren't set yet — that's fine. Stop the build if needed.

### 3.3. Add environment variables

In the Pages project → **Settings** → **Environment variables** → **Production** → **Edit variables**:

| Variable | Type | Testing-phase value | Production value |
| --- | --- | --- | --- |
| `FIREBASE_PROJECT_ID` | Plaintext | `catalystwriters-5ce43` | same |
| `FIREBASE_SERVICE_ACCOUNT` | **Secret** | Paste the entire service-account JSON as one line | same |
| `RESEND_API_KEY` | **Secret** | The `re_…` key from Resend | same |
| `MAIL_FROM` | Plaintext | `Catalyst Magazine <onboarding@resend.dev>` | `Catalyst Magazine <hello@catalyst-magazine.com>` |
| `SITE_URL` | Plaintext | `https://catalystmagazine.pages.dev` | `https://catalyst-magazine.com` |

Redeploy. When it finishes, visit `https://catalystmagazine.pages.dev/api/health` — you should see JSON with `ok: true` and all three config flags `true`.

### 3.4. (Optional but recommended) KV for rate limiting

1. Pages project → **Settings** → **Functions** → **KV namespace bindings** → **Add binding**.
2. Variable name: `RATE_LIMIT_KV`.
3. Create a new KV namespace called `catalyst-rate-limit` and bind it.

With this in place, subscribe and signup endpoints rate-limit by IP (5 requests / 60 s). Without the binding everything still works — rate limiting just becomes a no-op.

### 3.5. Custom domain — **skip this during testing**

Only do this when you are ready to cut over from Wix.

1. Pages project → **Custom domains** → **Set up a custom domain** → enter `catalyst-magazine.com`.
2. Cloudflare will tell you to change your nameservers to Cloudflare's (do this in your registrar, i.e. wherever you originally bought the domain — may be Wix). Once nameservers propagate, the CNAME is created automatically.
3. Do the same for `www.catalyst-magazine.com` and set it to redirect to the apex.
4. Go back to **Settings → Environment variables** and switch `SITE_URL` to `https://catalyst-magazine.com` and `MAIL_FROM` to `Catalyst Magazine <hello@catalyst-magazine.com>`. Redeploy.

---

## 4. Local development

```bash
cp .dev.vars.example .dev.vars
# Fill in the four secrets in .dev.vars

npm install
npm run pages:dev
```

Now your site runs at `http://localhost:8788` with live functions. Hit `http://localhost:8788/api/health` to confirm.

---

## 5. Rewiring the front-end

Open each HTML page that currently loads `mailchimp-handler.js` and swap the script src:

```html
<!-- before -->
<script src="/js/mailchimp-handler.js"></script>
<!-- after -->
<script src="/js/newsletter-handler.js"></script>
```

Files to update (search across the repo):

- `index.html`
- `header.html`
- `articles.html`
- `about.html`
- any article template under `posts/published/`

The existing `<form id="mc-embedded-subscribe-form-modal">` markup does not need to change — the new handler reads the same `FNAME` / `LNAME` / `EMAIL` fields and posts them to `/api/subscribe`.

### Admin "Approve & Publish" button

In `admin-dashboard.html` (or wherever the approve button lives), add:

```html
<script type="module" src="/js/admin-publish-bridge.js"></script>
```

Then, where you currently set a story's status to `published`, replace that code with:

```js
try {
  const result = await window.catalystPublish(storyId);
  if (result.newsletterSent) {
    alert(`Story published! Newsletter sent to subscribers ` +
          `(total published: ${result.totalPublished}).`);
  } else {
    alert(`Story published. ${3 - (result.totalPublished % 3)} more until the next newsletter.`);
  }
} catch (err) {
  alert(`Publish failed: ${err.message}`);
}
```

The bridge takes care of the Firebase ID token and the /api/publish call.

---

## 6. Decommissioning Wix and `server.js`

- `server.js` was an Express dev server — you no longer need it in production. Keep it if you like running locally, but it's never deployed to Cloudflare (the build script excludes it).
- In Wix, disable your current site so Google doesn't see two copies.
- Wait ~48 hours, then in Wix → **Settings → Domains**, disconnect `catalyst-magazine.com` and point its nameservers at Cloudflare (if they aren't already). Cloudflare Pages is now serving the domain.

---

## 7. How to verify everything works

1. **Health:** `curl https://catalyst-magazine.com/api/health` → `{ok:true, resendConfigured:true, serviceAccountConfigured:true}`.
2. **Subscribe:**
   ```bash
   curl -X POST https://catalyst-magazine.com/api/subscribe \
     -H 'Content-Type: application/json' \
     -d '{"email":"you@gmail.com","firstName":"John"}'
   ```
   Expect `{ok:true}` and a welcome email in your inbox.
3. **Publish test:** Create 3 test stories in the editorial studio (any status). Approve them one by one from the admin dashboard. The third approval should trigger a newsletter email to all `active` subscribers.

---

## 8. Cost math (why this stays free)

| Service | Free allowance | What you'll use |
| --- | --- | --- |
| Cloudflare Pages requests | 100k / day | Probably <1k / day |
| Cloudflare Pages Functions CPU | 10 ms / request | Our routes run <3 ms |
| Firestore reads | 50k / day | ~a few per visitor |
| Firestore writes | 20k / day | ~1 per signup + 1 per publish |
| Resend | 3,000 / month, 100 / day | Newsletters only when you post 3 stories |

You can run the whole thing on $0/mo until you cross ~3,000 emails in a month. At that point, Resend's first paid tier is $20/mo for 50k emails — and you can still downgrade or move providers without touching the front-end.

---

## 9. Where to edit what later

- **Email look & feel:** `functions/_utils/emails.js` — pure HTML strings.
- **Newsletter trigger rule:** `functions/api/publish.js`, line with `totalPublished % 3 === 0`. Change the `3` to `5` if you want fewer newsletters.
- **Who can publish:** `functions/api/publish.js` — the `role` check.
- **Newsletter subject/preview:** `functions/_utils/emails.js` → `newsletterEmail()`.
- **Unsubscribe link:** the `shell()` function in `emails.js`. To add unsubscribe, create `functions/api/unsubscribe.js` that flips `status` to `unsubscribed` for the given email, then link to it from the email footer.

---

If anything breaks during setup, check the function logs: Cloudflare dashboard → Pages project → **Functions** tab → **Real-time logs**. Every error is printed there with the exception message.
