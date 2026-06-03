// functions/_utils/auth.js
// Verifies Firebase ID tokens on incoming requests and resolves the caller's
// role from the users/{uid} Firestore document.

import { verifyIdToken, firestoreGet, getProjectId } from "./firebase.js";
import { getBearerToken, unauthorized } from "./http.js";

/**
 * Requires an authenticated caller whose role is in the allowed list.
 *
 * Beyond the base role check, a caller also passes if their user doc holds an
 * `extraAccess` grant listed in `allowedGrants`. This mirrors the per-user
 * "Extra access" grants an admin assigns in Users & roles (stored as
 * users/{uid}.extraAccess: string[] of route hashes). Pass the route hash the
 * endpoint backs — e.g.
 *   requireRole(request, env, ["admin"], ["#/admin/submissions"])
 * lets an admin-granted (non-admin) user reach the Submissions inbox API.
 * Keep grant hashes in sync with GRANTABLE_ROUTES (js/dashboard/admin.js) and
 * the hasGrant() helpers in firestore.rules.
 *
 * Returns { uid, email, role, grants, claims } on success, or a Response on
 * failure which the handler can short-circuit with:
 *   if (auth instanceof Response) return auth;
 */
export async function requireRole(request, env, allowedRoles = [], allowedGrants = []) {
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
  const grants = pickStringArray(userDoc, "extraAccess");

  const roleOk = allowedRoles.length === 0
    || allowedRoles.includes(role)
    || role === "admin";
  const grantOk = allowedGrants.length > 0
    && allowedGrants.some((g) => grants.includes(g));

  if (!roleOk && !grantOk) {
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
    grants,
    claims,
  };
}

function pickString(doc, key) {
  const v = doc?.fields?.[key];
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  return null;
}

function pickStringArray(doc, key) {
  const v = doc?.fields?.[key];
  const values = v?.arrayValue?.values;
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => ("stringValue" in item ? item.stringValue : null))
    .filter((s) => typeof s === "string");
}
