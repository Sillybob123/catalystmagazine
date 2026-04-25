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

// Role-specific onboarding copy. `steps` is the numbered "Getting started"
// list. `extraSections` is an optional array of { heading, body } blocks
// rendered after the steps — used to walk writers and editors through the
// tracker / proposal / review workflow in detail.
function roleGuide(role) {
  const r = (role || "").toLowerCase();
  const common = [
    "Sign in at <a href=\"https://www.catalyst-magazine.com/admin/login\">catalyst-magazine.com/admin/login</a> using the credentials in the box above. You can also reach the suite anytime from the <strong>public site footer</strong> — scroll to the very bottom and look for the small <strong>Staff</strong> link sitting just to the right of <em>Terms of Service</em>. It's intentionally subtle, but it's always there.",
    "On your first sign-in, open <strong>Change password</strong> in the sidebar and replace the default <code>123456</code> with something only you know. This is required before you do anything else.",
    "Use the <strong>Public site</strong> link in the top-right of the dashboard to preview articles the way a reader sees them.",
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
      blurb: "You're the second pair of eyes on every Catalyst piece. Writers send their drafts to you, you leave notes, and you sign off when the piece is publication-ready.",
      steps: [
        ...common,
        "Open the <strong>Pipeline</strong> in the sidebar — that's the master tracker for every article in flight. You'll spend most of your time here.",
        "When a writer finishes a draft, the article moves into the <strong>In Review</strong> column on the tracker. Click into the article card to start reviewing.",
        "Leave inline notes directly in the article editor — writers see them immediately. Be specific and kind: point at the sentence, suggest the fix.",
        "When you've finished reviewing, open the article's <strong>Timeline</strong> panel and tick <strong>Review Complete</strong>. You'll be asked to confirm a 12-item editorial checklist before it'll let you mark it complete — this is the Catalyst editorial standards gate.",
        "After the writer addresses your notes, they'll resubmit. Once you're satisfied, an admin will move it to publish.",
        "If a writer goes quiet for more than 5 days on a piece you're reviewing, the bot will nudge you. Don't let drafts stall in your queue — turn them around quickly.",
      ],
      extraSections: [
        {
          heading: "How the tracker works (please read carefully)",
          body: `
            <p style="margin:0 0 10px;">Every article on The Catalyst lives as a <strong>project</strong> on the Pipeline tracker. A project moves through five columns, left to right:</p>
            <ol style="margin:0 0 12px;padding-left:22px;color:#1d1d1f;font-size:0.93rem;line-height:1.65;">
              <li><strong>Topic Proposal</strong> — the writer has pitched the piece and is waiting for admin approval. You don't need to act here, but feel free to leave a comment if the angle could be sharpened.</li>
              <li><strong>Writing</strong> — proposal is approved; the writer is drafting. Hands-off for editors at this stage.</li>
              <li><strong>In Review</strong> — the writer has marked the draft complete and it's on your desk. <em>This is your queue.</em></li>
              <li><strong>Reviewing Suggestions</strong> — you've left notes; the writer is addressing them.</li>
              <li><strong>Completed</strong> — fully reviewed and ready for an admin to publish.</li>
            </ol>
            <p style="margin:0 0 10px;">Each project also has a <strong>Timeline</strong> — six checkboxes that map the lifecycle of the piece:</p>
            <ul style="margin:0 0 12px;padding-left:22px;color:#1d1d1f;font-size:0.93rem;line-height:1.65;">
              <li><strong>Topic Proposal Complete</strong> — set automatically when a proposal is approved.</li>
              <li><strong>Interview Scheduled</strong> · <strong>Interview Complete</strong> — checked by the writer.</li>
              <li><strong>Article Writing Complete</strong> — checked by the writer (gated by the writer self-review checklist).</li>
              <li><strong>Review Complete</strong> — <em>your job.</em> Gated by the 12-item Editor Review Checklist.</li>
              <li><strong>Suggestions Reviewed</strong> — checked by the writer once they've addressed your notes. After this, the piece is done editorially.</li>
            </ul>
            <p style="margin:0;">A piece is only ready to publish when every box on the Timeline is ticked.</p>`,
        },
        {
          heading: "Reviewing proposals",
          body: `
            <p style="margin:0 0 10px;">Writers can't start drafting until an admin <strong>approves</strong> their proposal. Approval lives with admins, but you'll often see proposals show up in the <em>Topic Proposal</em> column with status <strong>pending</strong>. You're welcome to leave a comment on a proposal — sharper angles upstream save everyone time downstream.</p>
            <p style="margin:0;">If a proposal isn't strong enough, an admin will mark it <strong>rejected</strong> with a reason. Writers can revise and resubmit.</p>`,
        },
        {
          heading: "Deadlines &amp; the bot",
          body: `
            <p style="margin:0 0 10px;">Every project has up to five deadlines: <em>Contact Professor, Conduct Interview, Write Draft, Editor Review, Review Edits.</em> The <em>Editor Review</em> deadline is yours.</p>
            <p style="margin:0;">The Catalyst bot sends a friendly reminder 3 days and 1 day before a deadline, and again if a piece in your queue has been idle for more than 5 days. If you need an exemption (vacation, exam week), an admin can pause your bot reminders.</p>`,
        },
      ],
    };
  }

  if (r === "writer") {
    return {
      title: "Your role: Writer",
      blurb: "You pitch ideas, draft articles, and shepherd them through review until they're ready to publish. Here's exactly how that works at The Catalyst.",
      steps: [
        ...common,
        "Open the <strong>Pipeline</strong> in the sidebar. This is the tracker — every piece you'll work on lives here. The columns show you exactly where each of your projects stands.",
        "Click <strong>+ New proposal</strong> to pitch an idea. Your pitch needs a working title, a clear angle (not just a topic), and a paragraph or two on why this story matters now.",
        "Wait for admin approval. You'll see your project sitting in the <strong>Topic Proposal</strong> column with status <em>pending</em>. Approval typically comes within a few days. If it's <em>rejected</em>, read the note, revise, and resubmit — rejection isn't the end, it's a redirect.",
        "Once approved, the project moves to the <strong>Writing</strong> column. Open it, fill in your interview details and deadlines, then start drafting in the article editor. Your work auto-saves; you don't need to hit a save button.",
        "When your draft is finished, open the project's <strong>Timeline</strong> panel and tick <strong>Article Writing Complete</strong>. You'll be asked to confirm an 8-item self-review checklist (lead, angle, headline, sources, etc.) before it'll let you mark it complete. This is intentional — please take it seriously.",
        "Your editor reviews the piece and leaves inline notes. You'll see their notes in the article editor itself. Address each one, reply where helpful, and re-save.",
        "When you've worked through every editor note, tick <strong>Suggestions Reviewed</strong> on the Timeline. The piece is now editorially complete — an admin will publish it from there.",
        "Watch your deadlines. The bot will gently remind you 3 days and 1 day before a deadline, and again if a piece sits idle for more than 10 days. Don't ignore the nudges.",
      ],
      extraSections: [
        {
          heading: "How the tracker works (please read carefully)",
          body: `
            <p style="margin:0 0 10px;">Every article you work on is a <strong>project</strong> on the Pipeline. Your project moves through five columns, left to right — this is how you always know where it stands:</p>
            <ol style="margin:0 0 12px;padding-left:22px;color:#1d1d1f;font-size:0.93rem;line-height:1.65;">
              <li><strong>Topic Proposal</strong> — you've pitched it; an admin will mark it <em>approved</em> or <em>rejected</em>.</li>
              <li><strong>Writing</strong> — approved! You're drafting. This is where you'll spend most of your time.</li>
              <li><strong>In Review</strong> — you've finished a draft and an editor is reading it. Hands-off; wait for notes.</li>
              <li><strong>Reviewing Suggestions</strong> — your editor left notes; you're addressing them.</li>
              <li><strong>Completed</strong> — done editorially, queued for an admin to publish.</li>
            </ol>
            <p style="margin:0 0 10px;">Each project also has a <strong>Timeline</strong> with six milestone checkboxes. You're responsible for ticking five of them; your editor handles one:</p>
            <ul style="margin:0 0 12px;padding-left:22px;color:#1d1d1f;font-size:0.93rem;line-height:1.65;">
              <li><strong>Topic Proposal Complete</strong> — set automatically when your proposal is approved.</li>
              <li><strong>Interview Scheduled</strong> — you, after you've locked in a time with your source.</li>
              <li><strong>Interview Complete</strong> — you, after the interview happens.</li>
              <li><strong>Article Writing Complete</strong> — you, after you finish drafting (gated by the 8-item self-review checklist).</li>
              <li><strong>Review Complete</strong> — your editor.</li>
              <li><strong>Suggestions Reviewed</strong> — you, after you've addressed every editor note.</li>
            </ul>
            <p style="margin:0;">Keep these boxes honest and current. They're how editors and admins know the piece is moving — and how the bot knows when not to bug you.</p>`,
        },
        {
          heading: "What gets a proposal approved",
          body: `
            <p style="margin:0 0 10px;">Strong Catalyst pitches share three things:</p>
            <ul style="margin:0 0 10px;padding-left:22px;color:#1d1d1f;font-size:0.93rem;line-height:1.65;">
              <li><strong>A specific angle.</strong> "AI in healthcare" is a topic. "How a Tufts radiologist trained an LLM on 200,000 anonymized chest X-rays" is an angle.</li>
              <li><strong>A reason it matters now.</strong> What changed? What's at stake? Why this month, not last year?</li>
              <li><strong>A real source.</strong> A scientist you can interview, a paper just published, a primary document. Not just secondary reporting.</li>
            </ul>
            <p style="margin:0;">If your proposal is rejected, the admin will leave a note. Common fixes are <em>narrow the angle</em>, <em>find a primary source</em>, and <em>show why it's timely</em>. You can always revise and resubmit.</p>`,
        },
        {
          heading: "Working with your editor",
          body: `
            <p style="margin:0 0 10px;">Editors leave notes inline — right on the sentences they're reacting to — inside the article editor. Open your draft, look for highlighted spans and side comments, and respond to each. You can reply to a note, accept a suggestion, or push back with reasoning. All of this happens in the editor itself.</p>
            <p style="margin:0;">When every note is addressed, tick <strong>Suggestions Reviewed</strong> on the Timeline. That's your signal that the piece is ready for an admin to publish.</p>`,
        },
        {
          heading: "Deadlines &amp; the bot",
          body: `
            <p style="margin:0 0 10px;">Each project carries up to five deadlines: <em>Contact Professor, Conduct Interview, Write Draft, Editor Review, Review Edits.</em> Three of those are yours.</p>
            <p style="margin:0;">The Catalyst bot will email you a friendly reminder 3 days and 1 day before a deadline, and again if a project goes silent for 10 days. If you genuinely need more time, just tell your editor — we'd much rather extend a deadline than rush a piece.</p>`,
        },
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

  // Long-form, role-specific walkthroughs (tracker, proposals, deadlines, etc.).
  // Headings are pre-escaped here; bodies are author-controlled HTML.
  const extraSectionsHtml = (guide.extraSections || [])
    .map(
      (section) => `
        <div style="margin:22px 0 0;padding:18px 20px;border:1px solid #e5e5e7;border-radius:10px;background:#fafafa;">
          <h3 style="font-size:1rem;color:#1d1d1f;margin:0 0 10px;font-weight:700;">${esc(section.heading)}</h3>
          <div style="font-size:0.93rem;color:#1d1d1f;line-height:1.6;">${section.body}</div>
        </div>`,
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

      ${extraSectionsHtml}

      <div style="background:#f5f5f7;border-radius:10px;padding:16px 18px;margin:22px 0 12px;font-size:0.9rem;color:#3c3c43;line-height:1.55;">
        <strong style="color:#1d1d1f;">One more thing — finding the editorial suite later.</strong>
        Bookmark <a href="${esc(siteUrl)}/admin/login" style="color:#a8843a;">${esc(siteUrl.replace(/^https?:\/\//, ""))}/admin/login</a>, but if you ever lose it, scroll to the very bottom of the public site (<a href="${esc(siteUrl)}" style="color:#a8843a;">${esc(siteUrl.replace(/^https?:\/\//, ""))}</a>). In the footer, just to the right of <em>Terms of Service</em>, you'll see a small link that says <strong>Staff</strong>. It's intentionally understated — but it's always there, and it'll bring you straight back here.
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
