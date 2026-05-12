// POST /api/book-reviews/submit
// Public endpoint — readers ("The Catalyzers") submit a STEM book review for
// admin review. We store the submission in `bookReviewSubmissions` (separate
// from the editorial `stories` pipeline) and email the admin team.
//
// Body: { submitterName, submitterEmail, bookTitle, bookAuthor, isbn?,
//         rating?, reviewText }
//
// Approval lives in /api/book-reviews/decide (admin-only). Approved
// submissions are copied into `stories` with category=book-review and
// communityPick=true so they appear in the "From the Catalyzers" rail on
// /book-reviews.
//
// ─── Security model ───────────────────────────────────────────────────────
// • Method-restricted: only POST reaches this handler (Pages Functions
//   routes onRequestPost only for POST; other methods 405).
// • Body-size capped at 16 KB. The form max-lengths sum to <8 KB.
// • Content-Type must be application/json — blocks naïve cross-origin form
//   POSTs and most "simple" CSRF attempts (browsers preflight JSON POSTs).
// • Rate-limited by IP via Cloudflare KV. Hard-fails closed if KV isn't
//   configured (the existing helper silently no-ops; we explicitly check).
// • Honeypot field ("website") must be empty. Bots that auto-fill every
//   field get caught here.
// • Every text field is trimmed, bounded, and CRLF-stripped before going
//   into Firestore or any email header.
// • Cover URLs from the public are NOT accepted. The published cover (if
//   any) is set later by an admin on approval — preventing SSRF / tracking
//   pixels / phishing-host links from ever reaching the admin's mail client.
// • Subject + reply-to are stripped of \r and \n to block header injection.
// • Disposable-email domains rejected (small server-side list).

import { json, badRequest, serverError, isValidEmail, rateLimit } from "../../_utils/http.js";
import { firestoreCreate } from "../../_utils/firebase.js";
import { sendEmail } from "../../_utils/resend.js";

const ADMIN_INBOX = "stemcatalystmagazine@gmail.com";
const ADMIN_CC    = "helloman696@gmail.com";

const MAX_FIELD  = 200;
const MAX_REVIEW = 4000;
const MAX_BODY_BYTES = 16 * 1024; // 16 KB hard cap on request payload

// Common disposable-email roots. Not exhaustive — defense in depth against
// "post a review without giving us a real way to contact you."
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "throwawaymail.com", "yopmail.com", "trashmail.com", "fakeinbox.com",
  "getnada.com", "discard.email", "sharklasers.com", "maildrop.cc",
  "tempinbox.com", "spamgourmet.com",
]);

export const onRequestPost = async ({ request, env }) => {
  try {
    // 1) Content-Type guard. Browsers send JSON content-type only after a
    //    preflight, so a cross-origin form attack can't slip through.
    const ctype = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!ctype.startsWith("application/json")) {
      return badRequest("Content-Type must be application/json");
    }

    // 2) Body-size guard. Refuse anything over 16 KB before we parse JSON.
    const lenHeader = request.headers.get("Content-Length");
    if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
      return json({ ok: false, error: "Payload too large" }, { status: 413 });
    }

    // 3) IP rate-limit (best-effort). If RATE_LIMIT_KV isn't bound (local
    //    dev, fresh Pages project) we log and continue — Turnstile + the
    //    honeypot + body/email validation are the real anti-spam line.
    //    Locking the form out when KV is missing means legitimate readers
    //    can't submit at all.
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await rateLimit(env, `book-review-submit:${ip}`, { limit: 6, windowSeconds: 600 });
    if (rl.skipped) {
      console.warn("RATE_LIMIT_KV not configured — proceeding without IP rate limit");
    } else if (!rl.ok) {
      return json({ ok: false, error: "Too many submissions. Please try again later." }, { status: 429 });
    }

    // 4) Parse JSON. Length-cap the raw text too in case Content-Length lied.
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: "Payload too large" }, { status: 413 });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return badRequest("Invalid JSON"); }
    if (body == null || typeof body !== "object" || Array.isArray(body)) {
      return badRequest("Invalid body shape");
    }

    // 5) Honeypot. Real users never fill an off-screen field named "website".
    //    Treat as success so bots get no signal; just drop the request.
    const honeypot = String(body.website || "").trim();
    if (honeypot) return json({ ok: true });

    // 5b) Cloudflare Turnstile verification. Token is set by the widget
    //     on the public submission form. If the secret isn't configured
    //     (local dev / fresh project) we log and skip so the form still
    //     works — same fail-open posture as the rate limit.
    if (env.TURNSTILE_SECRET_KEY) {
      const token = String(body.turnstileToken || "").trim();
      if (!token) {
        return badRequest("Please complete the human-verification check and try again.");
      }
      const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, ip);
      if (!ok) {
        return badRequest("Human-verification check failed. Please try again.");
      }
    } else {
      console.warn("TURNSTILE_SECRET_KEY not configured — skipping bot check");
    }

    // 6) Trim + bound + strip CRLF on every text field. CRLF stripping is
    //    critical for fields that will end up in email headers (name, email,
    //    title) so attackers can't inject extra headers.
    const submitterName  = sanitize(body.submitterName,  MAX_FIELD);
    const submitterEmail = sanitize(body.submitterEmail, MAX_FIELD).toLowerCase();
    const bookTitle      = sanitize(body.bookTitle,      MAX_FIELD);
    const bookAuthor     = sanitize(body.bookAuthor,     MAX_FIELD);
    const isbn           = sanitize(body.isbn, 32).replace(/[^0-9Xx-]/g, "");
    const reviewText     = sanitize(body.reviewText, MAX_REVIEW, /* allowNewlines */ true);
    const deck           = sanitize(body.deck, 220);
    const genreRaw       = sanitize(body.genre, 40).toLowerCase();
    const ratingRaw      = body.rating;

    // Closed set of disciplines — anything else is dropped to "stem".
    // Mirrors GENRE_MAP keys in js/book-reviews.js so the pill filter on
    // /book-reviews shelves community picks the same way as writer picks.
    const ALLOWED_GENRES = new Set([
      "astronomy","biology","chemistry","computer-science","physics",
      "mathematics","climate","memoir","stem",
    ]);
    const genre = ALLOWED_GENRES.has(genreRaw) ? genreRaw : "";

    // 7) Validate required fields.
    if (!submitterName || submitterName.length < 2)
      return badRequest("Your name is required.");
    if (!isValidEmail(submitterEmail))
      return badRequest("A valid email is required.");
    if (isDisposableEmail(submitterEmail))
      return badRequest("Please use a real email address we can reach you at.");
    if (!bookTitle)
      return badRequest("Book title is required.");
    if (!bookAuthor)
      return badRequest("Book author is required.");
    if (!genre)
      return badRequest("Please pick a discipline so we can shelve it right.");
    if (!deck || deck.length < 10)
      return badRequest("Please add a one-sentence summary of the book.");
    if (!reviewText || reviewText.length < 40)
      return badRequest("Please share at least a few sentences about the book.");

    // 8) Rating is optional. Cast safely and snap to one decimal place so
    //    users can land on any value the slider supports (e.g. 4.2, 3.7).
    //    The previous behavior snapped to nearest 0.5 which was too coarse
    //    once we moved off the fixed-step dropdown.
    let rating = null;
    if (ratingRaw != null && ratingRaw !== "") {
      const n = Number(ratingRaw);
      if (Number.isFinite(n) && n >= 0.5 && n <= 5) rating = Math.round(n * 10) / 10;
    }

    // 9) Persist. The submission is server-only; rules deny direct reads.
    //    We deliberately do NOT accept a cover URL from the public — admins
    //    add covers during/after approval to prevent SSRF + tracking-pixel
    //    abuse via the admin's mail client.
    const now = new Date().toISOString();
    const created = await firestoreCreate(env, "bookReviewSubmissions", {
      submitterName,
      submitterEmail,
      bookTitle,
      bookAuthor,
      isbn,
      rating,
      genre,
      deck,
      reviewText,
      coverImageUrl: "",     // sealed: only admins can set this
      status: "pending",
      publishedStoryId: null,
      createdAt: now,
      decidedAt: null,
      decidedBy: null,
      ip,
      userAgent: sanitize(request.headers.get("User-Agent") || "", 500),
    });

    // 10) Notify admins. Subject + reply-to scrubbed of CRLF (done by
    //     sanitize() above for the inputs; we also re-clean here to be
    //     defense-in-depth in case sendEmail's caller is ever bypassed).
    try {
      await sendEmail(env, {
        to:      ADMIN_INBOX,
        cc:      ADMIN_CC,
        replyTo: scrubHeader(submitterEmail),
        subject: scrubHeader(`[Book Review Submission] "${bookTitle}" — ${submitterName}`).slice(0, 200),
        html:    buildAdminEmail({
          submitterName, submitterEmail,
          bookTitle, bookAuthor, isbn, rating, genre, deck, reviewText,
          createdAt: now,
          adminUrl: `${env.SITE_URL || "https://www.catalyst-magazine.com"}/admin/#/admin/book-reviews`,
        }),
      });
    } catch (err) {
      // The submission already saved — surface the email error to logs but
      // don't fail the user's request, the admin can still see it in the tab.
      console.error("Book-review admin notification failed:", err.message);
    }

    // 11) Response surface is intentionally minimal — never return the
    //     full Firestore doc shape, never echo the IP back, never reveal
    //     internal IDs in a way the caller couldn't already correlate.
    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
};

// ─── helpers ────────────────────────────────────────────────────────────────

function sanitize(val, max, allowNewlines = false) {
  let s = String(val ?? "");
  // Always strip C0 control chars except optional \n.
  s = s.replace(allowNewlines ? /[\x00-\x09\x0B-\x1F\x7F]/g : /[\x00-\x1F\x7F]/g, "");
  // Strip any \r entirely; collapse repeated whitespace down to single spaces
  // for single-line fields.
  s = s.replace(/\r/g, "");
  if (!allowNewlines) s = s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

// Belt-and-suspenders for email headers: refuse anything past the first \r
// or \n. sanitize() already strips these, but headers are the worst place
// to get this wrong so double-check.
function scrubHeader(s) {
  return String(s ?? "").replace(/[\r\n]/g, " ").trim();
}

function isDisposableEmail(email) {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1);
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

function buildAdminEmail({
  submitterName, submitterEmail,
  bookTitle, bookAuthor, isbn, rating, genre, deck, reviewText,
  createdAt, adminUrl,
}) {
  const ratingLabel = rating != null ? `${rating}/5` : "—";
  const genreLabel = genre
    ? genre.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/-/g, " ")
    : "—";
  const rows = [
    ["Submitter",   `${esc(submitterName)} &lt;${esc(submitterEmail)}&gt;`],
    ["Book",        `${esc(bookTitle)} — ${esc(bookAuthor)}`],
    ["ISBN",        isbn ? esc(isbn) : "—"],
    ["Rating",      esc(ratingLabel)],
    ["Discipline",  esc(genreLabel)],
    ["Summary",     deck ? esc(deck) : "—"],
    ["Submitted",   esc(createdAt)],
  ];

  const tableRows = rows.map(([k, v]) =>
    `<tr>
      <td style="padding:6px 16px 6px 0;color:#6e6e73;font-size:0.85rem;vertical-align:top;white-space:nowrap;font-weight:600;">${esc(k)}</td>
      <td style="padding:6px 0;color:#1d1d1f;font-size:0.95rem;">${v}</td>
    </tr>`
  ).join("");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.25rem;color:#1d1d1f;">New book review submission</h2>
      <p style="margin:0 0 20px;color:#6e6e73;font-size:0.95rem;">
        A reader just submitted a book review for The Catalyst Reviews. Approve or reject it from the admin dashboard.
      </p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:8px;">${tableRows}</table>
      <div style="border-top:1px solid #e5e5e7;padding-top:16px;margin-top:20px;">
        <p style="margin:0 0 8px;color:#6e6e73;font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">Review</p>
        <div style="white-space:pre-wrap;color:#1d1d1f;font-size:0.95rem;line-height:1.65;">${esc(reviewText)}</div>
      </div>
      <div style="margin-top:24px;">
        <a href="${esc(adminUrl)}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:0.9rem;">
          Review in dashboard
        </a>
      </div>
      <p style="margin:18px 0 0;color:#86868b;font-size:0.8rem;">
        Reply to this email to contact ${esc(submitterName)} directly.
      </p>
    </div>
  `;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Verify a Cloudflare Turnstile token. Returns true if Cloudflare says the
// token is valid for this secret + (optionally) this IP. Any network or
// parse error returns false — fail closed so a flaky CF response doesn't
// become a way around the bot check. Docs:
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
async function verifyTurnstile(secret, token, remoteIp) {
  try {
    const form = new FormData();
    form.append("secret",   secret);
    form.append("response", token);
    if (remoteIp && remoteIp !== "unknown") form.append("remoteip", remoteIp);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return !!(data && data.success === true);
  } catch (err) {
    console.error("Turnstile verify failed:", err.message);
    return false;
  }
}
