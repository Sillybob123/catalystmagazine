// POST /api/welcome-email
// Body: { uid?, email?, role?, name?, password? }
// Headers: Authorization: Bearer <firebase-id-token>  (admin only)
//
// Sends a "Welcome to the Catalyst Editorial Suite" onboarding email to a
// user. Triggered manually by an admin from the Advanced tools dashboard
// (Welcome Bot). The email tells the recipient their username (their email),
// their starting password (default "123456" — admin can override), and walks
// them through the editorial suite based on their role.
//
// Looks the user up in Firestore by uid first, then by email. Stamps
// welcomeEmailSentAt / welcomeEmailSentBy on the user doc on success so the
// dashboard can show "already sent" state.
//
// We send via Resend (same client used elsewhere in the app).
import { json, badRequest, serverError, isValidEmail } from "../_utils/http.js";
import {
  firestoreGet,
  firestoreUpdate,
  firestoreRunQuery,
} from "../_utils/firebase.js";
import { sendEmail } from "../_utils/resend.js";
import { requireRole } from "../_utils/auth.js";

const DEFAULT_PASSWORD = "123456";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"]);
    if (auth instanceof Response) return auth;

    let body;
    try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }

    const uidIn   = (body.uid || "").trim();
    const emailIn = (body.email || "").trim().toLowerCase();
    const passwordOverride = (body.password || "").trim();

    if (!uidIn && !emailIn) {
      return badRequest("Provide either uid or email.");
    }
    if (emailIn && !isValidEmail(emailIn)) {
      return badRequest("Invalid email.");
    }

    // Resolve the user. uid first (cheaper, exact); else look up by email.
    let userId = uidIn;
    let userData = null;

    if (uidIn) {
      const doc = await firestoreGet(env, `users/${uidIn}`);
      if (!doc) return badRequest("User not found by uid.");
      userData = unwrapFields(doc.fields || {});
    } else {
      const rows = await firestoreRunQuery(env, {
        from: [{ collectionId: "users" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "email" },
            op: "EQUAL",
            value: { stringValue: emailIn },
          },
        },
        limit: 1,
      });
      if (!rows.length) return badRequest("User not found by email.");
      userId = rows[0].id;
      userData = rows[0].data;
    }

    const recipientEmail = (userData.email || emailIn || "").trim();
    if (!recipientEmail || !isValidEmail(recipientEmail)) {
      return badRequest("Stored user has no usable email.");
    }
    const recipientName = (body.name || userData.name || "").trim();
    const role = (body.role || userData.role || "reader").trim();
    const password = passwordOverride || DEFAULT_PASSWORD;

    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";

    await sendEmail(env, {
      to: recipientEmail,
      subject: "Welcome to the Catalyst Editorial Suite",
      html: buildWelcomeEmail({
        name: recipientName,
        email: recipientEmail,
        password,
        role,
        siteUrl,
        senderName: auth.name || "The Catalyst team",
      }),
    });

    // Stamp the user doc so the dashboard can show "sent on …".
    try {
      await firestoreUpdate(env, `users/${userId}`, {
        welcomeEmailSentAt: new Date().toISOString(),
        welcomeEmailSentBy: auth.uid,
      });
    } catch (err) {
      console.error("welcome-email: failed to stamp user doc", err.message);
    }

    return json({ ok: true, sentTo: recipientEmail });
  } catch (err) {
    return serverError(err);
  }
};

function unwrapFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if ("stringValue" in v) out[k] = v.stringValue;
    else if ("integerValue" in v) out[k] = Number(v.integerValue);
    else if ("doubleValue" in v) out[k] = v.doubleValue;
    else if ("booleanValue" in v) out[k] = v.booleanValue;
    else if ("timestampValue" in v) out[k] = v.timestampValue;
    else out[k] = null;
  }
  return out;
}

// Role-specific onboarding copy. Each entry returns an array of <li> items
// that get joined into a checklist in the email body.
function roleGuide(role) {
  const r = (role || "").toLowerCase();
  const common = [
    "Sign in at <a href=\"https://www.catalyst-magazine.com/admin/login\">catalyst-magazine.com/admin/login</a> using the credentials above.",
    "On your first login, open <strong>Change password</strong> in the sidebar and replace the default password with something only you know.",
    "Use the <strong>Public site</strong> link in the top-right of the dashboard to preview articles as a reader sees them.",
  ];
  if (r === "admin") {
    return {
      title: "Your role: Admin",
      blurb: "You have full access to every part of the suite — publishing, user management, the bot, and the newsletter.",
      steps: [
        ...common,
        "Open <strong>All articles &amp; approvals</strong> to review pending pieces, edit metadata, and publish.",
        "Use <strong>Users &amp; roles</strong> to add new contributors and assign their role.",
        "<strong>Advanced tools</strong> is where you'll find the Wix CSV importer, the article export, and the Welcome Bot.",
      ],
    };
  }
  if (r === "editor") {
    return {
      title: "Your role: Editor",
      blurb: "You review writers' drafts, leave inline comments, and approve pieces for publication.",
      steps: [
        ...common,
        "Open the <strong>Editing queue</strong> to see drafts waiting on your review.",
        "Leave inline notes inside the article editor — writers see them immediately and can resolve.",
        "When a piece is ready, mark <strong>Suggestions Reviewed</strong> in the timeline so an admin can publish.",
      ],
    };
  }
  if (r === "writer") {
    return {
      title: "Your role: Writer",
      blurb: "You pitch, draft, and revise articles for The Catalyst.",
      steps: [
        ...common,
        "Open <strong>My articles</strong> to start a new draft or continue an in-progress one.",
        "Save your work often — drafts auto-save, and the editor preserves your formatting.",
        "When your draft is ready for review, change its status to <strong>Pending</strong>. An editor will leave notes; address them and resubmit.",
        "Watch your <strong>deadlines</strong> — the bot will gently remind you 3 days and 1 day before a publication date.",
      ],
    };
  }
  if (r === "newsletter_builder") {
    return {
      title: "Your role: Newsletter Builder",
      blurb: "You assemble and send the Catalyst newsletter to subscribers.",
      steps: [
        ...common,
        "Open <strong>Newsletter</strong> to choose which recently-published articles to include.",
        "Preview the rendered email before sending — the template uses the cover image, dek, and byline from each article.",
        "Send to the live subscriber list when you're confident; there is no undo.",
      ],
    };
  }
  if (r === "marketing") {
    return {
      title: "Your role: Marketing",
      blurb: "You manage the social-media drafts auto-generated when articles publish.",
      steps: [
        ...common,
        "Open <strong>Marketing</strong> to see Instagram and LinkedIn drafts for every recent publish.",
        "Edit captions in-place, then mark them <strong>Posted</strong> after they go live on the channel.",
      ],
    };
  }
  return {
    title: "Your role: Reader",
    blurb: "You have a Catalyst account but aren't on the editorial side yet.",
    steps: [
      ...common,
      "If you should have writer or editor access, reply to this email and we'll update your role.",
    ],
  };
}

function buildWelcomeEmail({ name, email, password, role, siteUrl, senderName }) {
  const guide = roleGuide(role);
  const greeting = name ? `Hi ${esc(name.split(" ")[0])},` : "Hi there,";

  const stepsHtml = guide.steps
    .map(
      (s, i) => `
        <li style="margin:0 0 10px;padding-left:6px;color:#1d1d1f;font-size:0.95rem;line-height:1.55;">
          <span style="display:inline-block;min-width:22px;font-weight:700;color:#a8843a;">${i + 1}.</span> ${s}
        </li>`,
    )
    .join("");

  const credBlock = `
    <div style="background:#fbf6ec;border:1px solid #e8dbb6;border-radius:10px;padding:18px 20px;margin:18px 0 22px;">
      <div style="font-weight:700;color:#1d1d1f;font-size:1rem;margin-bottom:10px;">Your sign-in details</div>
      <table style="border-collapse:collapse;font-size:0.95rem;">
        <tr>
          <td style="padding:4px 14px 4px 0;color:#6e6e73;font-weight:600;">Username</td>
          <td style="padding:4px 0;color:#1d1d1f;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(email)}</td>
        </tr>
        <tr>
          <td style="padding:4px 14px 4px 0;color:#6e6e73;font-weight:600;">Password</td>
          <td style="padding:4px 0;color:#1d1d1f;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(password)}</td>
        </tr>
        <tr>
          <td style="padding:4px 14px 4px 0;color:#6e6e73;font-weight:600;">Sign-in URL</td>
          <td style="padding:4px 0;"><a href="${esc(siteUrl)}/admin/login" style="color:#a8843a;">${esc(siteUrl)}/admin/login</a></td>
        </tr>
      </table>
      <div style="margin-top:12px;font-size:0.85rem;color:#6e6e73;">
        Please change your password after your first sign-in (Sidebar → <strong>Change password</strong>).
      </div>
    </div>`;

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f7;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;margin:0 auto;padding:32px 24px;background:#ffffff;">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-family:'Poppins','Inter',sans-serif;font-weight:800;font-size:1.6rem;letter-spacing:-0.02em;color:#1d1d1f;">The Catalyst</div>
        <div style="font-size:0.8rem;color:#6e6e73;letter-spacing:0.12em;text-transform:uppercase;margin-top:4px;">Editorial Suite</div>
      </div>

      <h1 style="font-size:1.5rem;color:#1d1d1f;margin:0 0 12px;">Welcome to The Catalyst</h1>
      <p style="font-size:1rem;color:#1d1d1f;line-height:1.6;margin:0 0 14px;">
        ${greeting}
      </p>
      <p style="font-size:1rem;color:#1d1d1f;line-height:1.6;margin:0 0 14px;">
        We're thrilled to have you on the team. Your account for the Catalyst Editorial Suite — the dashboard where we draft, review, and publish every article — is ready.
      </p>

      ${credBlock}

      <h2 style="font-size:1.1rem;color:#1d1d1f;margin:24px 0 6px;">${esc(guide.title)}</h2>
      <p style="font-size:0.95rem;color:#3c3c43;line-height:1.55;margin:0 0 14px;">${esc(guide.blurb)}</p>

      <h3 style="font-size:0.95rem;color:#1d1d1f;margin:18px 0 10px;text-transform:uppercase;letter-spacing:0.08em;">Getting started</h3>
      <ol style="margin:0 0 18px;padding:0;list-style:none;">${stepsHtml}</ol>

      <div style="background:#f5f5f7;border-radius:10px;padding:16px 18px;margin:22px 0 12px;font-size:0.9rem;color:#3c3c43;line-height:1.55;">
        <strong style="color:#1d1d1f;">A quick note on deadlines.</strong>
        Articles move through four stages: <em>Draft → Pending → Approved → Published</em>. Update your article's status as you progress so editors know it's ready for them. The Catalyst bot will nudge you with friendly reminders if a deadline is approaching or if a piece has gone quiet for a while.
      </div>

      <p style="font-size:0.95rem;color:#1d1d1f;line-height:1.55;margin:18px 0 6px;">
        If anything looks off or you have questions, just reply to this email — it goes straight to ${esc(senderName)}.
      </p>
      <p style="font-size:0.95rem;color:#1d1d1f;line-height:1.55;margin:0 0 24px;">
        Welcome aboard,<br/>
        <strong>${esc(senderName)}</strong>
      </p>

      <hr style="border:none;border-top:1px solid #e5e5e7;margin:24px 0 16px;">
      <div style="font-size:0.78rem;color:#6e6e73;text-align:center;line-height:1.5;">
        The Catalyst Magazine · <a href="${esc(siteUrl)}" style="color:#6e6e73;">${esc(siteUrl.replace(/^https?:\/\//, ""))}</a><br/>
        You're receiving this because an admin created an editorial account for you.
      </div>
    </div></body></html>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
