// POST /api/subscribe
// Body: { email, firstName?, lastName? }
//
// 1. Validates input and rate-limits by IP.
// 2. Stores the subscriber in Firestore (collection: "subscribers", docId = lower-case email).
// 3. Sends a confirmation email via Resend.

import {
  json,
  badRequest,
  serverError,
  isValidEmail,
  rateLimit,
} from "../_utils/http.js";
import { firestoreCreate, firestoreGet, firestoreUpdate } from "../_utils/firebase.js";
import { sendEmail } from "../_utils/resend.js";
import { subscribeConfirmEmail } from "../_utils/emails.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const limit = await rateLimit(env, `subscribe:${ip}`, {
      limit: 5,
      windowSeconds: 60,
    });
    if (!limit.ok) {
      return json({ ok: false, error: "Too many requests" }, { status: 429 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const email = (body.email || "").trim().toLowerCase();
    const firstName = (body.firstName || body.FNAME || "").trim();
    const lastName = (body.lastName || body.LNAME || "").trim();

    if (!isValidEmail(email)) return badRequest("Please provide a valid email.");
    if (!firstName) return badRequest("First name is required.");

    const docId = email.replace(/[^a-z0-9@._-]/g, "_");
    const existing = await firestoreGet(env, `subscribers/${docId}`);

    const now = new Date().toISOString();
    const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";

    if (existing) {
      // Already subscribed — refresh name/timestamp but don't resend confirm.
      await firestoreUpdate(env, `subscribers/${docId}`, {
        firstName,
        lastName,
        updatedAt: now,
        status: "active",
      });
      return json({ ok: true, alreadySubscribed: true });
    }

    await firestoreCreate(
      env,
      "subscribers",
      {
        email,
        firstName,
        lastName,
        status: "active",
        source: "website-form",
        createdAt: now,
        updatedAt: now,
        ip,
      },
      docId
    );

    // Confirmation email — best-effort: if it fails, the subscriber record
    // is already stored, so we still return success.
    let emailSent = false;
    try {
      await sendEmail(env, {
        to: email,
        subject: "You're subscribed to The Catalyst",
        html: subscribeConfirmEmail({ firstName, siteUrl, email }),
      });
      emailSent = true;
    } catch (emailErr) {
      console.error("Confirmation email failed:", emailErr.message);
    }

    return json({ ok: true, emailSent });
  } catch (err) {
    return serverError(err);
  }
};
