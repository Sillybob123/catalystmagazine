// POST /api/agreement/accept
//
// Records that the signed-in person agreed to the Contributor Agreement
// (shown on first sign-in to the Editorial Suite, js/dashboard/agreement.js).
// The record is written here, on the server, so its time and details can't be
// set by the browser: agreement_acceptances/{uid}__{version} holds who, when,
// which version, a SHA-256 of the exact agreement file they were shown, and
// their IP address, country and browser. users/{uid} gets
// agreementVersion / agreementAcceptedAt so the Suite stops asking.
//
// Body: { version }
// Auth: any signed-in account with a profile.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreCreate, firestoreUpdate, fromFirestoreDoc } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";

// Keep in sync with AGREEMENT_VERSION in js/dashboard/agreement.js.
const CURRENT_VERSION = "2026-10-15";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, []);
    if (auth instanceof Response) return auth;

    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }
    if (body.version !== CURRENT_VERSION) return badRequest("That version of the agreement is out of date. Reload the page.");

    // The exact text they were shown, fingerprinted.
    const origin = new URL(request.url).origin;
    const docPath = `/legal/contributor-agreement-${CURRENT_VERSION}.html`;
    const res = await fetch(origin + docPath);
    if (!res.ok) return serverError(new Error(`Agreement file missing (${res.status})`));
    const text = await res.text();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const textSha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

    const userRaw = await firestoreGet(env, `users/${auth.uid}`);
    const user = userRaw ? fromFirestoreDoc(userRaw).data : {};
    const now = new Date().toISOString();
    const record = {
      uid: auth.uid,
      name: String(user.name || auth.name || ""),
      email: String(user.email || auth.email || ""),
      role: String(user.role || auth.role || ""),
      version: CURRENT_VERSION,
      documentUrl: `https://www.catalyst-magazine.com${docPath.replace(/\.html$/, "")}`,
      textSha256,
      acceptedAt: now,
      ip: request.headers.get("CF-Connecting-IP") || "",
      country: String(request.cf?.country || ""),
      userAgent: (request.headers.get("User-Agent") || "").slice(0, 400),
      method: "Clicked \"I agree\" after scrolling through the full agreement in the Editorial Suite",
    };
    try {
      await firestoreCreate(env, "agreement_acceptances", record, `${auth.uid}__${CURRENT_VERSION}`);
    } catch (err) {
      // Already recorded for this version: keep the first record as it was.
      if (!/\b409\b|ALREADY_EXISTS/i.test(String(err?.message || err))) throw err;
    }
    await firestoreUpdate(env, `users/${auth.uid}`, { agreementVersion: CURRENT_VERSION, agreementAcceptedAt: now });
    return json({ ok: true, acceptedAt: now });
  } catch (err) {
    return serverError(err);
  }
};
