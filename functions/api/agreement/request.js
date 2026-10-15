// POST /api/agreement/request
//
// An admin asks people to read and sign the Contributor Agreement (Advanced
// tools → Contributor agreement). Sets users/{uid}.agreementRequestedAt, which
// makes the agreement open the next time they visit the Editorial Suite, even
// if they signed before. Nothing else is sent: no email, no notification.
//
// Body: { uids: string[] }
// Auth: admin (and not blocked from Advanced tools).

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreUpdate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"], ["#/admin/advanced"]);
    if (auth instanceof Response) return auth;
    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }
    const uids = [...new Set((Array.isArray(body.uids) ? body.uids : []).filter((u) => /^[A-Za-z0-9_-]{1,128}$/.test(String(u))))].slice(0, 200);
    if (!uids.length) return badRequest("Who should get the agreement?");

    const now = new Date().toISOString();
    const results = await Promise.all(uids.map(async (uid) => {
      if (!(await firestoreGet(env, `users/${uid}`).catch(() => null))) return false;
      await firestoreUpdate(env, `users/${uid}`, { agreementRequestedAt: now });
      return true;
    }));
    return json({ ok: true, sent: results.filter(Boolean).length });
  } catch (err) {
    return serverError(err);
  }
};
