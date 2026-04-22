// /api/unsubscribe?email=<email>
//
// GET: called when a reader clicks the unsubscribe link in a newsletter.
// POST: handles RFC 8058 one-click unsubscribe requests from mailbox providers.

import { firestoreGet, firestoreUpdate } from "../_utils/firebase.js";
import { isValidEmail } from "../_utils/http.js";

export const onRequestGet = async ({ request, env }) => {
  return handleUnsubscribe({ request, env, mode: "redirect" });
};

export const onRequestPost = async ({ request, env }) => {
  return handleUnsubscribe({ request, env, mode: "one-click" });
};

async function handleUnsubscribe({ request, env, mode }) {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";

  if (!isValidEmail(email)) {
    return mode === "one-click"
      ? new Response("", { status: 400 })
      : Response.redirect(`${siteUrl}/unsubscribe?error=invalid`, 302);
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
