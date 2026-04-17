// POST /api/users/presence
// Records "last seen" for the currently-authenticated user so admins can see
// who is active. Writes to users/{uid}.lastSeenAt + user_presence/{uid}.

import { json, serverError } from "../../_utils/http.js";
import { firestoreUpdate, firestoreCreate, firestoreGet } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, [
      "admin", "editor", "writer", "newsletter_builder", "marketing",
    ]);
    if (auth instanceof Response) return auth;

    const now = new Date().toISOString();
    try {
      await firestoreUpdate(env, `users/${auth.uid}`, { lastSeenAt: now });
    } catch (err) {
      // If users doc isn't fully formed, ignore; presence doc still writes below.
      console.warn("users doc update failed:", err.message);
    }

    // user_presence/{uid} is a lightweight mirror — admins can read this even
    // when they don't have read access to the full user doc.
    const existing = await firestoreGet(env, `user_presence/${auth.uid}`);
    if (existing) {
      await firestoreUpdate(env, `user_presence/${auth.uid}`, {
        lastSeenAt: now,
        name: auth.name || "",
        email: auth.email || "",
        role: auth.role,
      });
    } else {
      await firestoreCreate(
        env,
        "user_presence",
        { lastSeenAt: now, name: auth.name || "", email: auth.email || "", role: auth.role },
        auth.uid
      );
    }

    return json({ ok: true, lastSeenAt: now });
  } catch (err) {
    return serverError(err);
  }
};
