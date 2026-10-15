// POST /api/agreement/accept
//
// Records that the signed-in person agreed to the Contributor Agreement
// (shown on first sign-in to the Editorial Suite, js/dashboard/agreement.js).
// The record is written here, on the server, so its time and details can't be
// set by the browser: agreement_acceptances/{uid}__{time} holds who, when,
// which version, a SHA-256 of the exact agreement file they were shown, and
// their IP address, country and browser. users/{uid} gets
// agreementVersion / agreementAcceptedAt so the Suite stops asking.
//
// Body: { version }   (or { warm: true } to get ready without recording)
// Auth: any signed-in account with a profile.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreCreate, firestoreUpdate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";

// Keep in sync with AGREEMENT_VERSION in js/dashboard/agreement.js.
const CURRENT_VERSION = "2026-10-15b";

const hashes = new Map();   // version file URL → SHA-256, kept while the instance lives
async function agreementHash(url) {
  if (hashes.has(url)) return hashes.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Agreement file missing (${res.status})`);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(await res.text()));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  hashes.set(url, hex);
  return hex;
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, []);
    if (auth instanceof Response) return auth;

    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }
    // Sent when the agreement opens, while they read: gets the sign-in check and
    // the text hash ready so the real save is quick. Records nothing.
    if (body.warm) {
      await agreementHash(`${new URL(request.url).origin}/legal/contributor-agreement-${CURRENT_VERSION}.html`).catch(() => {});
      return json({ ok: true, warm: true });
    }
    if (body.version !== CURRENT_VERSION) return badRequest("That version of the agreement is out of date. Reload the page.");

    // The exact text they were shown, fingerprinted (once per server instance).
    const docPath = `/legal/contributor-agreement-${CURRENT_VERSION}.html`;
    const textSha256 = await agreementHash(new URL(request.url).origin + docPath);
    const now = new Date().toISOString();
    const record = {
      uid: auth.uid,
      name: String(auth.name || ""),
      email: String(auth.email || ""),
      role: String(auth.role || ""),
      version: CURRENT_VERSION,
      documentUrl: `https://www.catalyst-magazine.com${docPath.replace(/\.html$/, "")}`,
      textSha256,
      acceptedAt: now,
      ip: request.headers.get("CF-Connecting-IP") || "",
      country: String(request.cf?.country || ""),
      userAgent: (request.headers.get("User-Agent") || "").slice(0, 400),
      method: "Clicked \"I agree\" after scrolling through the full agreement in the Editorial Suite",
    };
    // The record and the profile flag, side by side.
    await Promise.all([
      // A new record every time they sign (e.g. again when an admin asks), so the history is complete.
      firestoreCreate(env, "agreement_acceptances", record, `${auth.uid}__${now.replace(/[^0-9]/g, "")}`),
      firestoreUpdate(env, `users/${auth.uid}`, { agreementVersion: CURRENT_VERSION, agreementAcceptedAt: now }),
    ]);
    return json({ ok: true, acceptedAt: now });
  } catch (err) {
    return serverError(err);
  }
};
