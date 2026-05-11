// POST /api/book-reviews/decide
// Admin-only endpoint. Approves or rejects a community-submitted book review.
//
// Body: { submissionId, action: "approve" | "reject", editorialNote? }
//
// ─── Security model ───────────────────────────────────────────────────────
// • requireRole(request, env, ["admin"]) — verifies Firebase ID token (via
//   Google's JWKS), then reads users/{uid} to confirm role === "admin".
//   Anything else returns a 401/403 Response which we pass through.
// • submissionId is strictly validated as a Firestore doc ID (alphanumeric +
//   _ or -, max 80 chars). Blocks path-traversal like "../stories/X".
// • Body-size capped at 8 KB (matches the writer note + action shape).
// • Approval is concurrency-safe: we re-PATCH the submission with a
//   precondition on its updateTime so two admins clicking Approve at the
//   same instant can't both create a duplicate story.
// • On approve, the story body is built server-side from the trusted
//   submission text via paragraphsToHtml — which escapes &, <, > so the
//   admin's decision can't be smuggled into producing arbitrary HTML.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { requireRole } from "../../_utils/auth.js";
import {
  firestoreGet, firestoreUpdate, firestoreCreate,
} from "../../_utils/firebase.js";
import { titleToSlug } from "../../_utils/article-meta.js";

const MAX_BODY_BYTES = 8 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export const onRequestPost = async ({ request, env }) => {
  try {
    // ─── auth gate ───────────────────────────────────────────────────────
    const caller = await requireRole(request, env, ["admin"]);
    if (caller instanceof Response) return caller;

    // ─── content-type + body-size guard ──────────────────────────────────
    const ctype = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!ctype.startsWith("application/json")) return badRequest("Content-Type must be application/json");

    const lenHeader = request.headers.get("Content-Length");
    if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
      return json({ ok: false, error: "Payload too large" }, { status: 413 });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: "Payload too large" }, { status: 413 });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return badRequest("Invalid JSON"); }
    if (body == null || typeof body !== "object" || Array.isArray(body)) {
      return badRequest("Invalid body shape");
    }

    // ─── input validation ────────────────────────────────────────────────
    const submissionId = String(body.submissionId || "").trim();
    const action       = String(body.action || "").trim().toLowerCase();
    const editorialNote = String(body.editorialNote || "")
      .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, "")
      .trim()
      .slice(0, 1000);

    if (!ID_RE.test(submissionId)) return badRequest("Invalid submissionId");
    if (!["approve", "reject"].includes(action)) {
      return badRequest("action must be 'approve' or 'reject'");
    }

    // ─── load submission ─────────────────────────────────────────────────
    const subPath = `bookReviewSubmissions/${submissionId}`;
    const subRaw = await firestoreGet(env, subPath);
    if (!subRaw) return json({ ok: false, error: "Submission not found" }, { status: 404 });
    const sub = unpackDoc(subRaw);
    if (sub.status && sub.status !== "pending") {
      return json({ ok: false, error: `Submission already ${sub.status}` }, { status: 409 });
    }

    const now = new Date().toISOString();
    const decidedBy = caller.email || caller.uid;

    // ─── reject branch ───────────────────────────────────────────────────
    if (action === "reject") {
      try {
        await firestoreUpdate(env, subPath, {
          status: "rejected",
          decidedAt: now,
          decidedBy,
          editorialNote: editorialNote || null,
        }, {
          // Optimistic concurrency: refuse if the submission has changed
          // since we read it (another admin already decided it).
          precondition: { updateTime: subRaw.updateTime },
        });
      } catch (err) {
        if (err.status === 412) {
          return json({ ok: false, error: "Submission was just updated by someone else. Please refresh." }, { status: 409 });
        }
        throw err;
      }
      return json({ ok: true, status: "rejected" });
    }

    // ─── approve branch ──────────────────────────────────────────────────
    // Build a story doc from the trusted submission text. content is HTML
    // but produced entirely server-side from paragraphsToHtml(), which
    // escapes & < > — no user-controlled HTML reaches the renderer.
    const reviewBodyHtml = paragraphsToHtml(sub.reviewText);
    // Prefer the submitter's own one-sentence pitch (the deck they filled
    // in on the submission form). Fall back to the legacy heuristic for
    // older submissions that pre-date the deck field.
    const dek = (typeof sub.deck === "string" && sub.deck.trim().length >= 10)
      ? String(sub.deck).slice(0, 220)
      : buildDek(sub);
    const slugBase = titleToSlug(`${sub.bookTitle} review by ${sub.submitterName}`) || "book-review";
    const slug = `${slugBase}-${shortHash(submissionId)}`;

    // Same closed set as submit.js — anything else falls back to empty
    // (the public renderer auto-detects "stem" when no genre is set).
    const ALLOWED_GENRES = new Set([
      "astronomy","biology","computer-science","physics",
      "mathematics","climate","memoir","stem",
    ]);
    const genre = (typeof sub.genre === "string" && ALLOWED_GENRES.has(sub.genre))
      ? sub.genre
      : "";

    const storyFields = {
      title: String(sub.bookTitle || "").slice(0, 300),
      slug,
      authorId: caller.uid,
      authorName: String(sub.submitterName || "").slice(0, 200),
      author: String(sub.submitterName || "").slice(0, 200),
      submitterEmail: String(sub.submitterEmail || "").slice(0, 200),
      category: "book-review",
      status: "published",
      communityPick: true,
      coverImage: "",           // never trust a public-supplied URL
      image: "",
      excerpt: dek,
      deck: dek,
      dek,
      content: reviewBodyHtml,
      rating: (typeof sub.rating === "number" && sub.rating >= 1 && sub.rating <= 5) ? sub.rating : null,
      isbn: String(sub.isbn || "").slice(0, 32),
      bookAuthor: String(sub.bookAuthor || "").slice(0, 200),
      genre,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
      publishedBy: decidedBy,
      sourceSubmissionId: submissionId,
    };

    const created = await firestoreCreate(env, "stories", storyFields);
    const storyId = (created.id || (created.name || "").split("/").pop() || "").trim();

    try {
      await firestoreUpdate(env, subPath, {
        status: "approved",
        decidedAt: now,
        decidedBy,
        publishedStoryId: storyId,
        editorialNote: editorialNote || null,
      }, {
        // Same concurrency guard as the reject branch. If we lose the race,
        // the story doc we just created is orphaned — log and surface so the
        // admin can clean up, but don't auto-delete (which could clobber a
        // legitimately-created doc).
        precondition: { updateTime: subRaw.updateTime },
      });
    } catch (err) {
      if (err.status === 412) {
        console.error("approve race: submission updated between read and write", { submissionId, storyId });
        return json({
          ok: false,
          error: "Submission was just updated by someone else. A story doc was created — please review the queue.",
          orphanStoryId: storyId,
        }, { status: 409 });
      }
      throw err;
    }

    return json({ ok: true, status: "approved", storyId });
  } catch (err) {
    return serverError(err);
  }
};

// ─── helpers ────────────────────────────────────────────────────────────────

// Firestore REST returns fields wrapped by type — unwrap into a plain object
// for the small set of types we care about here.
function unpackDoc(doc) {
  const out = {};
  const fields = doc?.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    if      ("stringValue"    in v) out[k] = v.stringValue;
    else if ("integerValue"   in v) out[k] = parseInt(v.integerValue, 10);
    else if ("doubleValue"    in v) out[k] = Number(v.doubleValue);
    else if ("booleanValue"   in v) out[k] = v.booleanValue;
    else if ("nullValue"      in v) out[k] = null;
    else if ("timestampValue" in v) out[k] = v.timestampValue;
  }
  return out;
}

// Convert a multi-paragraph review into safe HTML. Escapes the three chars
// that can break out of a <p> body context. The output is consumed by the
// public article renderer (no attribute interpolation), so " and ' don't
// need to be escaped here.
//
// Standalone quoted paragraphs — a single line of body text that begins
// and ends with a quotation mark — get auto-promoted to <blockquote> so
// they render as proper pullquotes in the published review. Quotation
// marks the form accepts include straight ", smart "/", and «/».
function paragraphsToHtml(text) {
  const safe = (s) => String(s).replace(/[&<>]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])
  );
  const OPEN_Q  = /^["“”«]/;
  const CLOSE_Q = /["“”»]$/;
  return String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const oneLine = !/\n/.test(p);
      const isQuote = oneLine && OPEN_Q.test(p) && CLOSE_Q.test(p) && p.length > 12;
      if (isQuote) {
        // Strip the wrapping quote marks so the visual quote treatment
        // (oversized open-quote, italic) doesn't double-up on a literal ".
        const stripped = p.replace(/^["“”«]\s*/, "").replace(/\s*["“”»]$/, "");
        return `<blockquote>${safe(stripped)}</blockquote>`;
      }
      return `<p>${safe(p).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

// First sentence of the review (clipped) → the card excerpt.
function buildDek(sub) {
  const txt = String(sub.reviewText || "").replace(/\s+/g, " ").trim();
  const first = txt.split(/(?<=[.!?])\s/)[0] || txt;
  const clipped = first.length > 220 ? first.slice(0, 217) + "…" : first;
  return clipped || `${sub.bookTitle} — ${sub.bookAuthor}`;
}

// Deterministic 6-char hash so slugs are stable per submission.
function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6);
}
