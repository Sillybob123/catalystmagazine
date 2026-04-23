// /api/unsubscribe/<email>          ← path-based (resilient to URL rewriters)
// /api/unsubscribe?email=<email>     ← legacy query-param form
// /api/unsubscribe                   ← no email → redirect to entry form
//
// GET: click-through from a newsletter.
// POST: RFC 8058 one-click unsubscribe from mailbox providers.
//
// The path form survives Resend click-tracking, email client safebrowsing
// redirects, and other middleware that strips or re-encodes query strings.

import { firestoreGet, firestoreUpdate } from "../../_utils/firebase.js";
import { isValidEmail } from "../../_utils/http.js";

export const onRequestGet = async (ctx) => handle(ctx, "redirect");
export const onRequestPost = async (ctx) => handle(ctx, "one-click");

async function handle({ request, env, params }, mode) {
  const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
  const url = new URL(request.url);

  // Prefer the path segment, fall back to ?email=.
  const pathParts = params?.path;
  const pathEmail = Array.isArray(pathParts) ? pathParts[0] : pathParts;
  const rawEmail = pathEmail || url.searchParams.get("email") || "";

  let email = "";
  try {
    email = decodeURIComponent(rawEmail).trim().toLowerCase();
  } catch {
    email = rawEmail.trim().toLowerCase();
  }

  if (!isValidEmail(email)) {
    // Missing/malformed email from a click-through: redirect to the
    // unsubscribe form so the user can still remove themselves.
    return mode === "one-click"
      ? new Response("", { status: 400 })
      : Response.redirect(`${siteUrl}/unsubscribe`, 302);
  }

  const docId = email.replace(/[^a-z0-9@._-]/g, "_");

  try {
    const existing = await firestoreGet(env, `subscribers/${docId}`);

    if (!existing) {
      return mode === "one-click"
        ? new Response("", { status: 200 })
        : Response.redirect(
            `${siteUrl}/unsubscribe?status=not_found&email=${encodeURIComponent(email)}`,
            302
          );
    }

    if (existing.fields?.status?.stringValue === "unsubscribed") {
      return mode === "one-click"
        ? new Response("", { status: 200 })
        : Response.redirect(
            `${siteUrl}/unsubscribe?status=already&email=${encodeURIComponent(email)}`,
            302
          );
    }

    await firestoreUpdate(env, `subscribers/${docId}`, {
      status: "unsubscribed",
      unsubscribedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return mode === "one-click"
      ? new Response("", { status: 200 })
      : Response.redirect(
          `${siteUrl}/unsubscribe?status=done&email=${encodeURIComponent(email)}`,
          302
        );
  } catch (err) {
    console.error("Unsubscribe error:", err);
    return mode === "one-click"
      ? new Response("", { status: 500 })
      : Response.redirect(`${siteUrl}/unsubscribe?error=server`, 302);
  }
}
