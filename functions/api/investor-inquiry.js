// POST /api/investor-inquiry
// Captures submissions from the Investors page form.
// Stores in Firestore `investor_inquiries` AND emails the team via Resend.

import { json, badRequest, serverError, isValidEmail, rateLimit } from "../_utils/http.js";
import { firestoreCreate } from "../_utils/firebase.js";
import { sendEmail } from "../_utils/resend.js";

const TEAM_INBOX = "stemcatalystmagazine@gmail.com";
const TEAM_CC    = "helloman696@gmail.com";

const ALLOWED_INTEREST = new Set([
  "exploratory",
  "ad-partnership",
  "angel-check",
  "strategic-partner",
  "other",
]);

const ALLOWED_RANGE = new Set([
  "under-1k",
  "1k-5k",
  "5k-25k",
  "25k-100k",
  "100k-plus",
  "advisory",
  "undecided",
]);

const ALLOWED_TIMELINE = new Set([
  "now",
  "30-days",
  "90-days",
  "exploring",
]);

export const onRequestPost = async ({ request, env }) => {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await rateLimit(env, `investor:${ip}`, { limit: 4, windowSeconds: 120 });
    if (!rl.ok) return json({ ok: false, error: "Too many requests. Try again in a moment." }, { status: 429 });

    let body;
    try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }

    const firstName    = trimStr(body.firstName, 80);
    const lastName     = trimStr(body.lastName, 80);
    const email        = String(body.email || "").trim().toLowerCase();
    const phone        = trimStr(body.phone, 40);
    const company      = trimStr(body.company, 120);
    const role         = trimStr(body.role, 120);
    const website      = trimStr(body.website, 200);
    const linkedin     = trimStr(body.linkedin, 200);
    const interestType = String(body.interestType || "exploratory").trim();
    const range        = String(body.range || "undecided").trim();
    const timeline     = String(body.timeline || "exploring").trim();
    const message      = trimStr(body.message, 4000);

    // Validation
    if (!firstName) return badRequest("First name is required.");
    if (!lastName)  return badRequest("Last name is required.");
    if (!isValidEmail(email)) return badRequest("Please provide a valid email.");
    if (!message)   return badRequest("Please tell us a bit about your interest.");
    if (!ALLOWED_INTEREST.has(interestType)) return badRequest("Invalid interest type.");
    if (!ALLOWED_RANGE.has(range))           return badRequest("Invalid range.");
    if (!ALLOWED_TIMELINE.has(timeline))     return badRequest("Invalid timeline.");

    const fullName = `${firstName} ${lastName}`.trim();
    const now = new Date().toISOString();

    const record = {
      firstName, lastName, fullName,
      email, phone,
      company, role, website, linkedin,
      interestType, range, timeline, message,
      status: "new",
      createdAt: now,
      ip,
      userAgent: (request.headers.get("User-Agent") || "").slice(0, 400),
    };

    await firestoreCreate(env, "investor_inquiries", record);

    // Notify the team — replyTo so they can respond directly.
    let emailSent = false;
    try {
      await sendEmail(env, {
        to:      TEAM_INBOX,
        cc:      TEAM_CC,
        replyTo: email,
        subject: `[Investor inquiry] ${labelInterest(interestType)} — ${fullName}${company ? ` (${company})` : ""}`,
        html:    buildTeamEmail({ ...record, createdAt: now }),
      });
      emailSent = true;
    } catch (err) {
      console.error("Investor team notification failed:", err.message);
    }

    return json({ ok: true, emailSent });
  } catch (err) {
    return serverError(err);
  }
};

function trimStr(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function labelInterest(v) {
  switch (v) {
    case "exploratory":       return "Exploratory chat";
    case "ad-partnership":    return "Ad partnership";
    case "angel-check":       return "Angel/seed check";
    case "strategic-partner": return "Strategic partner";
    case "other":             return "Other";
    default:                  return v;
  }
}

function labelRange(v) {
  switch (v) {
    case "under-1k":   return "Under $1,000";
    case "1k-5k":      return "$1,000 – $5,000";
    case "5k-25k":     return "$5,000 – $25,000";
    case "25k-100k":   return "$25,000 – $100,000";
    case "100k-plus":  return "$100,000+";
    case "advisory":   return "Non-cash / advisory";
    case "undecided":  return "Undecided";
    default:           return v;
  }
}

function labelTimeline(v) {
  switch (v) {
    case "now":       return "Ready to talk now";
    case "30-days":   return "Within 30 days";
    case "90-days":   return "Within 90 days";
    case "exploring": return "Just exploring";
    default:           return v;
  }
}

function buildTeamEmail(d) {
  const rows = [
    ["Submission type", "Investor Inquiry"],
    ["Name",            d.fullName],
    ["Email",           d.email],
    ["Phone",           d.phone],
    ["Company",         d.company],
    ["Role",            d.role],
    ["Website",         d.website],
    ["LinkedIn",        d.linkedin],
    ["Interest",        labelInterest(d.interestType)],
    ["Range",           labelRange(d.range)],
    ["Timeline",        labelTimeline(d.timeline)],
    ["Submitted",       d.createdAt],
    ["IP",              d.ip],
  ].filter(([, v]) => v);

  const tableRows = rows.map(([k, v]) =>
    `<tr>
      <td style="padding:6px 16px 6px 0;color:#6e6e73;font-size:0.85rem;vertical-align:top;white-space:nowrap;font-weight:600;">${esc(k)}</td>
      <td style="padding:6px 0;color:#1d1d1f;font-size:0.95rem;">${esc(v)}</td>
    </tr>`
  ).join("");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.3rem;color:#0f172a;">New Investor Inquiry</h2>
      <p style="margin:0 0 20px;color:#6e6e73;font-size:0.95rem;">A potential investor or partner just submitted the form on catalyst-magazine.com/investors. Reply to this email to contact them directly.</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;">${tableRows}</table>
      <div style="border-top:1px solid #e5e5e7;padding-top:16px;">
        <p style="margin:0 0 8px;color:#6e6e73;font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">Their message</p>
        <div style="white-space:pre-wrap;color:#1d1d1f;font-size:0.95rem;line-height:1.65;">${esc(d.message)}</div>
      </div>
      <p style="margin:24px 0 0;color:#6e6e73;font-size:0.8rem;">Stored in Firestore: <code>investor_inquiries</code></p>
    </div>
  `;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
