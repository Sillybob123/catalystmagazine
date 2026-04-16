// POST /api/signup
// Body: {} (auth data comes from the Firebase ID token)
// Headers: Authorization: Bearer <firebase-id-token>
//
// Call this *after* the browser has already called createUserWithEmailAndPassword().
// We verify the token, upsert a users/{uid} doc, and send a welcome email.

import {
  json,
  badRequest,
  unauthorized,
  serverError,
  getBearerToken,
  rateLimit,
} from "../_utils/http.js";
import {
  verifyIdToken,
  firestoreGet,
  firestoreCreate,
  firestoreUpdate,
} from "../_utils/firebase.js";
import { sendEmail } from "../_utils/resend.js";
import { welcomeEmail } from "../_utils/emails.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const limit = await rateLimit(env, `signup:${ip}`, { limit: 5, windowSeconds: 60 });
    if (!limit.ok) return json({ ok: false, error: "Too many requests" }, { status: 429 });

    const token = getBearerToken(request);
    if (!token) return unauthorized("Missing Bearer token");

    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) return serverError(new Error("FIREBASE_PROJECT_ID missing"));

    let claims;
    try {
      claims = await verifyIdToken(token, projectId);
    } catch (e) {
      return unauthorized(`Invalid token: ${e.message}`);
    }

    const uid = claims.sub;
    const email = claims.email;
    const name = claims.name || "";
    if (!email) return badRequest("Token has no email claim");

    // Upsert users/{uid}.
    const existing = await firestoreGet(env, `users/${uid}`);
    const now = new Date().toISOString();
    const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";

    if (existing) {
      await firestoreUpdate(env, `users/${uid}`, {
        email,
        name,
        lastLoginAt: now,
      });
      return json({ ok: true, alreadyRegistered: true });
    }

    await firestoreCreate(
      env,
      "users",
      {
        email,
        name,
        role: "reader", // admins/editors/writers must be elevated manually
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      uid
    );

    // Welcome email. If this throws, we still return 500 so the UI
    // can show an error — the user record was already written.
    await sendEmail(env, {
      to: email,
      subject: "Welcome to The Catalyst Magazine",
      html: welcomeEmail({ name, siteUrl }),
    });

    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
};
