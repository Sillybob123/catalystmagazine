// POST /api/collaborate
// Captures submissions from the "Collaborate with us" / contact form.
// Stored in Firestore `collaboration_requests` so marketing can review them.

import { json, badRequest, serverError, isValidEmail, rateLimit } from "../_utils/http.js";
import { firestoreCreate } from "../_utils/firebase.js";
import { sendEmail } from "../_utils/resend.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await rateLimit(env, `collab:${ip}`, { limit: 3, windowSeconds: 60 });
    if (!rl.ok) return json({ ok: false, error: "Too many requests" }, { status: 429 });

    let body;
    try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }

    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    const role = (body.role || body.interest || "").trim();
    const message = (body.message || "").trim();

    if (!isValidEmail(email)) return badRequest("Valid email required");
    if (!name) return badRequest("Name is required");

    const now = new Date().toISOString();
    await firestoreCreate(env, "collaboration_requests", {
      email, name, role, message,
      status: "new",
      source: body.source || "collaborate-form",
      createdAt: now,
      ip,
    });

    // Optional confirmation email.
    try {
      await sendEmail(env, {
        to: email,
        subject: "Thanks for reaching out to The Catalyst",
        html: `<p>Hi ${escapeHtml(name)},</p><p>Thanks for your interest in collaborating with The Catalyst. Our team will be in touch soon.</p><p>&mdash; The Catalyst Editorial Team</p>`,
      });
    } catch (err) {
      console.error("Collaborate confirmation email failed:", err.message);
    }

    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
