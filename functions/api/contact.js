// POST /api/contact
// Captures submissions from the Contact Us page form.
// Stores in Firestore `contact_messages` AND emails the team via Resend.

import { json, badRequest, serverError, isValidEmail, rateLimit } from "../_utils/http.js";
import { firestoreCreate } from "../_utils/firebase.js";
import { sendEmail } from "../_utils/resend.js";

const TEAM_INBOX = "stemcatalystmagazine@gmail.com";
const TEAM_CC    = "helloman696@gmail.com";

export const onRequestPost = async ({ request, env }) => {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await rateLimit(env, `contact:${ip}`, { limit: 5, windowSeconds: 60 });
    if (!rl.ok) return json({ ok: false, error: "Too many requests" }, { status: 429 });

    let body;
    try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }

    const firstName = (body.firstName || body.first_name || "").trim();
    const lastName  = (body.lastName  || body.last_name  || "").trim();
    const email     = (body.email     || "").trim().toLowerCase();
    const topic     = (body.topic     || "General question").trim();
    const message   = (body.message   || "").trim();
    const name      = firstName ? `${firstName} ${lastName}`.trim() : lastName;

    if (!isValidEmail(email)) return badRequest("Valid email required.");
    if (!firstName)           return badRequest("First name is required.");
    if (!message)             return badRequest("Message is required.");

    const now = new Date().toISOString();
    await firestoreCreate(env, "contact_messages", {
      firstName, lastName, name, email, topic, message,
      status: "new",
      createdAt: now,
      ip,
    });

    // Notify the team — replyTo so they can respond directly.
    try {
      await sendEmail(env, {
        to:      TEAM_INBOX,
        cc:      TEAM_CC,
        replyTo: email,
        subject: `[Contact] ${topic} — ${name}`,
        html:    buildTeamEmail({ name, email, topic, message, ip, createdAt: now }),
      });
    } catch (err) {
      console.error("Contact team notification failed:", err.message);
    }

    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
};

function buildTeamEmail({ name, email, topic, message, ip, createdAt }) {
  const rows = [
    ["Submission type", "Contact Form"],
    ["Name",            name],
    ["Email",           email],
    ["Topic",           topic],
    ["Submitted",       createdAt],
    ["IP",              ip],
  ].filter(([, v]) => v);

  const tableRows = rows.map(([k, v]) =>
    `<tr>
      <td style="padding:6px 16px 6px 0;color:#6e6e73;font-size:0.85rem;vertical-align:top;white-space:nowrap;font-weight:600;">${esc(k)}</td>
      <td style="padding:6px 0;color:#1d1d1f;font-size:0.95rem;">${esc(v)}</td>
    </tr>`
  ).join("");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.25rem;color:#1d1d1f;">New Contact Message</h2>
      <p style="margin:0 0 20px;color:#6e6e73;font-size:0.95rem;">Someone just submitted the contact form on catalyst-magazine.com. Reply to this email to contact them directly.</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;">${tableRows}</table>
      <div style="border-top:1px solid #e5e5e7;padding-top:16px;">
        <p style="margin:0 0 8px;color:#6e6e73;font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">Message</p>
        <div style="white-space:pre-wrap;color:#1d1d1f;font-size:0.95rem;line-height:1.65;">${esc(message)}</div>
      </div>
    </div>
  `;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
