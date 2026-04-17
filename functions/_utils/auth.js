// functions/_utils/auth.js
// Verifies Firebase ID tokens on incoming requests and resolves the caller's
// role from the users/{uid} Firestore document.

import { verifyIdToken, firestoreGet, getProjectId } from "./firebase.js";
import { getBearerToken, unauthorized } from "./http.js";

/**
 * Requires an authenticated caller whose role is in the allowed list.
 * Returns { uid, email, role, claims } on success, or a Response on failure
 * which the handler can short-circuit with: if (auth instanceof Response) return auth;
 */
export async function requireRole(request, env, allowedRoles = []) {
  const token = getBearerToken(request);
  if (!token) return unauthorized("Missing bearer token");

  let claims;
  try {
    claims = await verifyIdToken(token, getProjectId(env));
  } catch (err) {
    return unauthorized(`Invalid token: ${err.message}`);
  }

  const uid = claims.sub;
  const userDoc = await firestoreGet(env, `users/${uid}`);
  if (!userDoc) return unauthorized("User profile not found");

  const role = pickString(userDoc, "role") || "reader";

  if (allowedRoles.length && !allowedRoles.includes(role) && role !== "admin") {
    return new Response(
      JSON.stringify({ ok: false, error: `Role '${role}' is not permitted here.` }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return {
    uid,
    email: claims.email || pickString(userDoc, "email") || null,
    name: claims.name || pickString(userDoc, "name") || null,
    role,
    claims,
  };
}

function pickString(doc, key) {
  const v = doc?.fields?.[key];
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  return null;
}
