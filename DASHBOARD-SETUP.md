# Catalyst Editorial Dashboard — Setup Guide

A complete rewrite of the employee / admin dashboard.
One unified dashboard at **`/dashboard.html`** with a role-gated sidebar for:

- **Writers** – submit drafts, track their own articles, see what the newsroom is working on, and read editor feedback threads.
- **Editors** – inline article editing, paragraph-level comments/suggestions, and the 12-item **Editor Review Checklist** that must be fully completed before an article can be marked "review complete".
- **Newsletter Builders** – one-click generation of Gmail-safe newsletters from the 1, 2, or 3 most recent published articles; inline edit of subject, headline, intro; test-send to any email; full send via Resend with a campaign history.
- **Marketing** – live subscriber counts, 7- and 30-day growth, 30-day sparkline, unsubscribe count, and the full collaboration-requests pipeline.
- **Admins** – everything above, plus approve/deny/publish any article, assign editors to stories, manage user roles, and see every teammate's *last seen* timestamp.

Every signed-in role also sees the shared **Catalyst in the Capital** pipeline (powered by the scheduler database) on the Overview page and on its own dedicated page.

---

## New files

```
dashboard.html                              # single entry point for all roles

css/dashboard.css                           # premium sidebar-shell UI

js/dashboard/app.js                         # auth, role detection, sidebar, router
js/dashboard/ui.js                          # toast, modal, helpers
js/dashboard/overview.js                    # landing page for every role
js/dashboard/pipeline.js                    # shared workflow pipeline widget
js/dashboard/writer.js                      # writer module (draft / mine / feed)
js/dashboard/editor.js                      # editor module (queue / review + checklist)
js/dashboard/newsletter.js                  # newsletter builder + history
js/dashboard/marketing.js                   # subscriber analytics + collab list
js/dashboard/admin.js                       # all-articles, users directory

functions/_utils/auth.js                    # Firebase ID-token verification + role gating
functions/_utils/newsletter-template.js     # Gmail-safe HTML template
functions/api/newsletter/preview.js         # POST  /api/newsletter/preview
functions/api/newsletter/send.js            # POST  /api/newsletter/send
functions/api/newsletter/history.js         # GET   /api/newsletter/history
functions/api/subscribers/stats.js          # GET   /api/subscribers/stats
functions/api/collaborate.js                # POST  /api/collaborate
functions/api/users/presence.js             # POST  /api/users/presence

firestore.rules                             # extended for new roles + collections
```

## Modified files

- `writer-login.html` – now redirects all staff to `dashboard.html`; accepts new roles
- `admin-users.html` – role dropdown extended with `newsletter_builder` and `marketing`

Old `admin-dashboard.html` and `writer-dashboard.html` are untouched and still work as a fallback (admin can open them directly if ever needed).

---

## Data model additions

New Firestore collections (rules already published in `firestore.rules`):

| Collection | What it stores | Who can read / write |
|---|---|---|
| `stories/{id}/comments/{id}` | Editor comments (optional `paragraph` number + `body`) | staff read; editor/admin write |
| `stories/{id}/checklist/{editorUid}` | Which of the 12 checklist items this editor has confirmed | staff read; editor/admin write |
| `assignments` | (optional) future editor-assignment index | staff read; editor/admin write |
| `newsletter_campaigns` | Every send: subject, html, recipientCount, status, createdBy | newsletter_builder / marketing / admin |
| `collaboration_requests` | Contact-form submissions | marketing / admin read |
| `user_presence/{uid}` | Mirror of `lastSeenAt` for fast admin queries | self-write, admin/editor read |

New role names: `newsletter_builder`, `marketing`. Existing `admin`, `editor`, `writer`, `reader` are unchanged.

---

## Deployment steps

### 1. Deploy the updated Firestore rules

```bash
firebase deploy --only firestore:rules
```

### 2. Ensure required environment variables exist in Cloudflare Pages

Already present in your `.dev.vars.example` — copy the same keys into the Cloudflare dashboard (Pages → Settings → Environment Variables):

| Variable | Used by | Notes |
|---|---|---|
| `RESEND_API_KEY` | Newsletter send, subscribe confirmation | Get one at [resend.com](https://resend.com) |
| `MAIL_FROM` | Same | Something like `Catalyst Magazine <newsletter@yourdomain.com>` — domain must be verified in Resend |
| `FIREBASE_SERVICE_ACCOUNT` | All `/api/*` routes that hit Firestore | Full JSON of a service-account key (your existing one is fine) |
| `FIREBASE_PROJECT_ID` | Same | `catalystwriters-5ce43` |
| `SITE_URL` | Email template URLs | `https://catalyst-magazine.com` |

Cloudflare will pick these up on the next `pages:deploy`.

### 3. Deploy

```bash
npm run pages:deploy
```

The new dashboard will be live at `https://<your-cloudflare-pages-domain>/dashboard.html`.

### 4. First sign-in as admin

You already have admin(s) configured. Any existing admin can:

1. Sign in → automatically routed to `/dashboard.html`.
2. Open **Admin → Users & roles** from the sidebar.
3. Change any user's role to `newsletter_builder` or `marketing` to unlock those modules for them.

### 5. Optional: wire the existing collaborate form

If `collaborate.html` currently posts somewhere else, point its submit handler to `POST /api/collaborate` with JSON body `{ name, email, role, message }` and submissions will flow into the new Marketing pipeline automatically.

---

## Editor Review Checklist (the 12 items, full-gate behaviour)

On the editor's review surface (accessed via #/editor/queue → "Open review"), every item below must be checked before the **"Confirm review complete"** button unlocks. Each checkbox state is saved per-editor to `stories/{id}/checklist/{editorUid}` with a timestamp.

1. Does the lead earn the reader's attention — surprising, specific, not a summary?
2. Does the piece have a clear, concrete angle — not just a broad topic?
3. Is the headline active, specific, and honest about the stakes?
4. Has the writer avoided prescriptive or editorial opinion language?
5. Are all technical claims accurate and verified against primary sources?
6. Has every flagged uncertainty been addressed or resolved?
7. Does the piece read like a story, not a literature review?
8. Is the writer's voice consistent and credible throughout?
9. Are all quotes properly attributed and placed in context?
10. Is all scientific terminology defined for a college-level audience?
11. Does the ending resonate — quote, callback, or forward-looking implication?
12. Has the piece been reviewed for grammar, clarity, and overall flow?

When all 12 are checked and "Confirm review complete" is pressed, the story's `status` is flipped from `pending` → `reviewing`, and the editor's name + timestamp are recorded. Admins see this in their approval queue.

---

## How the newsletter builder works

1. **Open** the builder from the sidebar (Newsletter → Newsletter builder).
2. **Choose** how many recent articles to include (1, 2, or 3). The 3 most recent **published** articles are pulled from Firestore `stories` where `status == 'published'`, ordered by `publishedAt DESC`.
3. **Edit** the subject, headline, and intro copy. The preview iframe updates automatically (debounced).
4. **Test** by clicking "Send a test" and entering your own email — Resend sends one copy.
5. **Send** by clicking "Send to all subscribers". The server-side function queries active subscribers, batches them into BCC chunks of 45 (the documented Resend limit), and records a `newsletter_campaigns` row with `status: sent`.

Template details that keep emails out of Gmail's spam box:

- Table-based layout (no flexbox / grid), inline styles.
- Explicit `color-scheme: light only` to stop Gmail's dark mode from mangling colours.
- Preheader text in a hidden span for inbox previews.
- No tracking pixels, no external CSS files, no JavaScript.
- From-address must match a Resend-verified domain (e.g. `newsletter@catalyst-magazine.com`).

---

## Subscriber storage

Subscribers stay in the Firestore `subscribers` collection (you already had the `/api/subscribe` endpoint and it still works). Read access is extended to `marketing` and `newsletter_builder` so those roles can see counts and send newsletters. The public write path remains rate-limited and server-validated as before.

If you ever want to move subscribers to Cloudflare D1 for heavier analytics, the `/api/subscribers/stats` and `/api/newsletter/send` endpoints are the only two places that read the subscribers collection — point them at a different backing store and everything else keeps working.

---

## Troubleshooting

**"Failed to load workflow data"** on the pipeline widget — means the secondary workflow Firebase project (`catalystmonday`) isn't reachable. `firebase-dual-config.js` initializes both projects; check browser console for the exact error.

**"RESEND_API_KEY is not configured"** when sending a newsletter — the Cloudflare Pages environment variable isn't set for the environment you're hitting. Check Production vs. Preview in the dashboard.

**Users can't see the dashboard after signing in** — they either don't have a `users/{uid}` doc or their `role` is still `reader`. Either log in briefly as them so the dashboard bootstraps the doc, or create it manually via admin → users.

**"You don't have access to that page"** — a user clicked a hash route that isn't in their allowed list. The sidebar only shows routes they can access; manually-typed URLs are still gated.
