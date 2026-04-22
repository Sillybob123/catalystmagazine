// /api/unsubscribe/<email>
//
// Path-based unsubscribe endpoint. Using the email as a path segment (rather
// than a ?email= query param) is resilient against URL rewriters and
// click-tracking middleware that strip or re-encode query strings.

import { firestoreGet, firestoreUpdate } from "../../_utils/firebase.js";
import { isValidEmail } from "../../_utils/http.js";

export const onRequestGet = async (ctx) => handle(ctx, "redirect");
export const onRequestPost = async (ctx) => handle(ctx, "one-click");

async function handle({ request, env, params }, mode) {
  const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";
  const raw = (params?.email || "").toString();
  // Path param comes in URL-encoded; decode once.
  let email = "";
  try {
    email = decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    email = raw.trim().toLowerCase();
  }

  if (!isValidEmail(email)) {
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
