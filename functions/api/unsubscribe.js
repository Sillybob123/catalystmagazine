// GET /api/unsubscribe?email=<email>
//
// Called when a reader clicks the unsubscribe link in a newsletter.
// Sets status = "unsubscribed" in Firestore and redirects to the
// unsubscribe confirmation page.

import { firestoreGet, firestoreUpdate } from "../_utils/firebase.js";
import { isValidEmail } from "../_utils/http.js";

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const siteUrl = env.SITE_URL || "https://catalyst-magazine.com";

  if (!isValidEmail(email)) {
    return Response.redirect(`${siteUrl}/unsubscribe?error=invalid`, 302);
  }

  const docId = email.replace(/[^a-z0-9@._-]/g, "_");

  try {
    const existing = await firestoreGet(env, `subscribers/${docId}`);

    if (!existing) {
      return Response.redirect(
        `${siteUrl}/unsubscribe?status=not_found&email=${encodeURIComponent(email)}`,
        302
      );
    }

    if (existing.data?.status === "unsubscribed") {
      return Response.redirect(
        `${siteUrl}/unsubscribe?status=already&email=${encodeURIComponent(email)}`,
        302
      );
    }

    await firestoreUpdate(env, `subscribers/${docId}`, {
      status: "unsubscribed",
      unsubscribedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return Response.redirect(
      `${siteUrl}/unsubscribe?status=done&email=${encodeURIComponent(email)}`,
      302
    );
  } catch (err) {
    console.error("Unsubscribe error:", err);
    return Response.redirect(`${siteUrl}/unsubscribe?error=server`, 302);
  }
};
