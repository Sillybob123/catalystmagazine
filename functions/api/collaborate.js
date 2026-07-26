// POST /api/collaborate
// Captures submissions from the "Collaborate with us" forms (Join the Team / Send a Proposal).
// Stored in Firestore `collaboration_requests` AND emailed to the team for review.

import { json, badRequest, serverError, isValidEmail, rateLimit } from "../_utils/http.js";
import { firestoreCreate } from "../_utils/firebase.js";
import { sendEmail } from "../_utils/resend.js";
import {
  applicationReceivedEmail,
  applicationReceivedText,
  founderResumeRequestEmail,
  founderResumeRequestText,
} from "../_utils/application-emails.js";

const TEAM_INBOX = "stemcatalystmagazine@gmail.com";
const TEAM_CC = "helloman696@gmail.com";

// Join-team applicants get a second, personal-sounding email from the
// co-founders asking for a resume. It is deliberately delayed so it doesn't
// land next to the automated confirmation — an instant "personal" note reads
// as a bot. Scheduled through Resend rather than a queue we run ourselves.
const FOUNDER_FOLLOWUP_DELAY_MS = (60 + 2) * 60 * 1000; // 1h 02m

export const onRequestPost = async ({ request, env }) => {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await rateLimit(env, `collab:${ip}`, { limit: 3, windowSeconds: 60 });
    if (!rl.ok) return json({ ok: false, error: "Too many requests" }, { status: 429 });

    let body;
    try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }

    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    const selectedRole = (body.role || body.interest || body.position || "").trim();
    const otherRole = (body.otherRole || "").trim();
    const role = selectedRole === "Other" ? (otherRole || "Other") : selectedRole;
    const message = (body.message || "").trim();
    const phone = (body.phone || "").trim();
    const portfolio = (body.portfolio || body.link || "").trim();
    const articleTitle = (body.articleTitle || body.title || "").trim();
    const source = (body.source || "collaborate-form").trim();

    if (!isValidEmail(email)) return badRequest("Valid email required");
    if (!name) return badRequest("Name is required");
    if (!message) return badRequest("Message is required");

    const now = new Date().toISOString();
    const isJoinTeam = source === "join-team";

    if (isJoinTeam && selectedRole === "Other" && !otherRole) {
      return badRequest("Please tell us what role you'd like to do");
    }

    await firestoreCreate(env, "collaboration_requests", {
      email, name, role, selectedRole, otherRole, message, phone, portfolio, articleTitle,
      status: "new",
      source,
      createdAt: now,
      ip,
    });

    const subjectLabel = isJoinTeam ? "Team Application" : "Article/Proposal Submission";

    // Notify the team. This is the important one — replyTo so they can respond
    // directly to the applicant without copy/pasting the address.
    try {
      await sendEmail(env, {
        to: TEAM_INBOX,
        cc: TEAM_CC,
        replyTo: email,
        subject: `[${subjectLabel}] ${name}`,
        html: buildTeamEmail({
          name, email, role, selectedRole, otherRole, message, phone, portfolio, articleTitle,
          source, subjectLabel, ip, createdAt: now,
        }),
      });
    } catch (err) {
      console.error("Collaborate team notification failed:", err.message);
    }

    // Confirmation to the submitter. Join-team applicants get a dedicated
    // acknowledgement that asks for nothing — the resume request arrives
    // separately, later, from the founders.
    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    try {
      if (isJoinTeam) {
        await sendEmail(env, {
          to: email,
          replyTo: TEAM_INBOX,
          subject: "We received your application — The Catalyst",
          html: applicationReceivedEmail({ name, role, siteUrl }),
          text: applicationReceivedText({ name, role, siteUrl }),
        });
      } else {
        await sendEmail(env, {
          to: email,
          replyTo: TEAM_INBOX,
          subject: "Thanks for reaching out to The Catalyst",
          html: buildConfirmationEmail({ name }),
        });
      }
    } catch (err) {
      console.error("Collaborate confirmation email failed:", err.message);
    }

    // Hand the founder resume request to Resend with a future send time.
    // Resend holds it and delivers at 1h02m — no queue, no cron, and no
    // risk of a Worker restart dropping it.
    if (isJoinTeam) {
      try {
        await sendEmail(env, {
          to: email,
          replyTo: TEAM_INBOX,
          subject: "Following up on your application",
          html: founderResumeRequestEmail({ name, role, siteUrl }),
          text: founderResumeRequestText({ name, role, siteUrl }),
          scheduledAt: new Date(Date.now() + FOUNDER_FOLLOWUP_DELAY_MS).toISOString(),
        });
      } catch (err) {
        // Non-fatal: the applicant still got their confirmation, and the
        // team inbox has the application either way.
        console.error("Founder follow-up scheduling failed:", err.message);
      }
    }

    return json({ ok: true });
  } catch (err) {
    return serverError(err);
  }
};

function buildTeamEmail({ name, email, role, selectedRole, otherRole, message, phone, portfolio, articleTitle, source, subjectLabel, ip, createdAt }) {
  const rows = [
    ["Submission type", subjectLabel],
    ["Name", name],
    ["Email", email],
    ["Phone", phone],
    ["Position / Interest", role],
    ["Selected role", selectedRole === "Other" ? "Other" : ""],
    ["Custom role", otherRole],
    ["Article title", articleTitle],
    ["Portfolio / link", portfolio ? `<a href="${escapeAttr(portfolio)}">${escapeHtml(portfolio)}</a>` : ""],
    ["Source", source],
    ["Submitted", createdAt],
    ["IP", ip],
  ].filter(([, v]) => v);

  const tableRows = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#6e6e73;font-size:0.85rem;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:6px 0;color:#1d1d1f;font-size:0.95rem;">${k === "Portfolio / link" ? v : escapeHtml(v)}</td></tr>`
  ).join("");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 8px;font-size:1.25rem;color:#1d1d1f;">New ${escapeHtml(subjectLabel)}</h2>
      <p style="margin:0 0 20px;color:#6e6e73;font-size:0.95rem;">Someone just submitted the collaborate form on catalyst-magazine.com. Reply to this email to contact them directly.</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;">${tableRows}</table>
      <div style="border-top:1px solid #e5e5e7;padding-top:16px;">
        <p style="margin:0 0 6px;color:#6e6e73;font-size:0.85rem;font-weight:600;">Message</p>
        <div style="white-space:pre-wrap;color:#1d1d1f;font-size:0.95rem;line-height:1.6;">${escapeHtml(message)}</div>
      </div>
    </div>
  `;
}

// Non-join-team submissions (article pitches, proposals). Join-team
// applicants get applicationReceivedEmail instead.
function buildConfirmationEmail({ name }) {
  return `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Thanks for your interest in collaborating with The Catalyst. Our team will review your submission and be in touch soon.</p>
    <p>&mdash; The Catalyst Editorial Team</p>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function escapeAttr(s) {
  return escapeHtml(s);
}
