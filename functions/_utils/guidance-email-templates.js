const COLORS = {
  pageBg: "#f5f7f5",
  surface: "#ffffff",
  ink: "#17201a",
  inkSoft: "#334139",
  muted: "#66756b",
  hairline: "#dce7df",
  greenBg: "#f0fdf4",
  greenBorder: "#b7e4c7",
  greenInk: "#14532d",
  accent: "#15803d",
  warmBg: "#fbf6ec",
  warmBorder: "#e8dbb6",
};

const base = {
  tracker: {
    title: "Using the Story Tracker",
    audience: "Writers and editors",
    subject: "A quick guide to using the Catalyst Story Tracker",
    intro: "The Story Tracker is the main place to understand where every story stands. Use it as the source of truth for proposals, drafts, reviews, and completed work.",
    sections: [
      {
        heading: "Where to go first",
        bullets: [
          "Open the dashboard: catalyst-magazine.com/admin/login.",
          "In the sidebar, use Catalyst in the Capital for interview/reporting stories.",
          "In the sidebar, use Op-Eds for opinion pieces.",
          "In the sidebar, use My assignments when you want to see only work connected to you.",
          "To propose a new story, open Catalyst in the Capital or Op-Eds, then click Propose a new story in the top-right corner.",
        ],
      },
      {
        heading: "What the columns mean",
        bullets: [
          "Topic Proposal means the story idea is waiting for admin approval.",
          "Writing means the proposal is approved and the writer should be drafting.",
          "In Review means the writer is done drafting and an editor should review it.",
          "Reviewing Suggestions means the editor has left notes and the writer is addressing them.",
          "Completed means the editorial work is done and admins can move it toward publication.",
        ],
      },
      {
        heading: "How to use the timeline checkboxes",
        bullets: [
          "Only check a box after the milestone has actually happened.",
          "Writers check Interview Scheduled, Interview Complete, Article Writing Complete, and Suggestions Reviewed.",
          "Editors check Review Complete only after they have read the draft, left notes, and completed the editor checklist.",
          "A story is not ready to publish until all required timeline boxes are complete.",
        ],
      },
    ],
  },
  draft: {
    title: "Writing a Draft in the Article Editor",
    audience: "Writers and editors writing their own pieces",
    subject: "How to write your Catalyst draft in the dashboard",
    intro: "Your draft should start only after the proposal is approved. Once it is approved, the article editor is where you build the piece, save your progress, and eventually submit for review.",
    sections: [
      {
        heading: "Before you start writing",
        bullets: [
          "Open My assignments and choose the approved story.",
          "Confirm the story is in Writing, not Topic Proposal.",
          "Review the approved proposal so your draft stays aligned with the angle.",
          "Gather your sources, interview notes, links, and images before writing long sections.",
        ],
      },
      {
        heading: "Building the draft",
        bullets: [
          "Use a strong opening that starts with a specific scene, question, finding, or person.",
          "Keep the angle narrow. The draft should answer the proposal's central question, not cover the entire topic.",
          "Use clear section breaks if the story is long.",
          "Add links, names, affiliations, and source details while writing so fact-checking is easier later.",
        ],
      },
      {
        heading: "Submitting for review",
        bullets: [
          "Read the draft from top to bottom before submitting.",
          "Check that names, titles, dates, and scientific claims are accurate.",
          "Use the Article Writing Complete checkbox only when the draft is ready for an editor.",
          "Complete the self-review checklist honestly. It exists to catch problems before the editor sees them.",
        ],
      },
    ],
  },
  proposal: {
    title: "Creating a Strong Proposal",
    audience: "Writers and editors",
    subject: "How to create a Catalyst proposal",
    intro: "A proposal creates the project in the dashboard. Do not start in the article editor. Start by pitching the story in the correct Story Tracker view.",
    sections: [
      {
        heading: "Where to create it",
        bullets: [
          "Open the dashboard: catalyst-magazine.com/admin/login.",
          "In the sidebar, click Catalyst in the Capital for interview/reporting stories.",
          "In the sidebar, click Op-Eds for opinion pieces.",
          "Click Propose a new story in the top-right corner.",
          "If you are in My assignments, switch back to Catalyst in the Capital or Op-Eds first. My assignments is for tracking existing work, not creating a proposal.",
        ],
      },
      {
        heading: "What to include",
        bullets: [
          "A working title that makes the subject clear.",
          "A specific angle, not just a general topic.",
          "Why the story matters now.",
          "The person, paper, organization, dataset, or primary document you plan to use.",
          "A realistic publication deadline.",
        ],
      },
      {
        heading: "After submitting",
        bullets: [
          "The proposal appears in Topic Proposal as pending.",
          "Wait for admin approval before drafting.",
          "If it is rejected, read the note, narrow the angle, strengthen the source plan, and resubmit.",
        ],
      },
    ],
  },
  editor_review: {
    title: "Reviewing a Draft as an Editor",
    audience: "Editors",
    subject: "How to review a Catalyst draft",
    intro: "Editing is not just proofreading. Your job is to help the writer make the story clearer, more accurate, more readable, and ready for publication.",
    sections: [
      {
        heading: "Start the review",
        bullets: [
          "Open My assignments or the relevant Story Tracker page and find the story in In Review.",
          "Open the story and read it once all the way through before making heavy edits.",
          "Identify the main angle, the evidence, and any parts that feel unclear or unsupported.",
        ],
      },
      {
        heading: "Leave useful notes",
        bullets: [
          "Comment on the exact sentence or paragraph that needs attention.",
          "Be specific about the fix: clarify the claim, add a source, explain the mechanism, shorten the paragraph, or restructure the section.",
          "Separate major issues from minor wording suggestions.",
          "Keep the tone direct and kind. The goal is a stronger story, not a defensive writer.",
        ],
      },
      {
        heading: "Finish the review",
        bullets: [
          "Do not check Review Complete until all major notes are left.",
          "Complete the editor checklist carefully.",
          "After Review Complete is checked, the writer should address your suggestions and then check Suggestions Reviewed.",
        ],
      },
    ],
  },
  responding_edits: {
    title: "Responding to Editor Suggestions",
    audience: "Writers",
    subject: "How to work through editor notes",
    intro: "Editor notes are part of the normal Catalyst workflow. Treat them as a roadmap for making the piece publishable.",
    sections: [
      {
        heading: "Read before changing",
        bullets: [
          "Read every comment before editing the first one.",
          "Look for patterns: unclear angle, weak sourcing, missing context, structure problems, or sentence-level issues.",
          "Ask questions if a note is confusing instead of guessing.",
        ],
      },
      {
        heading: "Make the revisions",
        bullets: [
          "Address major factual, structural, and source issues first.",
          "Then handle sentence-level edits and wording.",
          "If an editor's suggestion changes a scientific claim, re-check the source before accepting it.",
          "Reply where useful so the editor knows what changed.",
        ],
      },
      {
        heading: "Mark it complete",
        bullets: [
          "Only check Suggestions Reviewed after every editor note has been handled.",
          "If you disagree with a suggestion, explain why respectfully in a reply.",
          "Once Suggestions Reviewed is checked, admins can treat the story as editorially complete.",
        ],
      },
    ],
  },
  images: {
    title: "Images, Covers, and Uploads",
    audience: "Writers and editors",
    subject: "How to handle images in Catalyst drafts",
    intro: "Images make articles feel finished, but they also need to be clear, relevant, and usable. Use the dashboard upload tools so files are stored correctly.",
    sections: [
      {
        heading: "Cover images",
        bullets: [
          "Choose a cover that directly represents the article's subject, place, person, or research area.",
          "Avoid vague stock-style images when a real lab, object, chart, or location would be clearer.",
          "If the cover is very bright or white, mark it as a light cover so the title remains readable.",
        ],
      },
      {
        heading: "Inside the draft",
        bullets: [
          "Upload images through the dashboard instead of pasting temporary local file paths.",
          "Place images near the section they support.",
          "Add captions or context when the image is not self-explanatory.",
          "Use charts or diagrams only when they clarify the story.",
        ],
      },
      {
        heading: "Reliability tips",
        bullets: [
          "If an image does not come through from a Google Doc, export the document as .docx and upload that.",
          "Check the preview before submitting so broken images are caught early.",
          "Do not use images you do not have permission to use.",
        ],
      },
    ],
  },
  deadlines: {
    title: "Deadlines and Follow-Ups",
    audience: "Writers and editors",
    subject: "How Catalyst deadlines work",
    intro: "Deadlines keep the whole Story Tracker moving. The dashboard helps admins and editors see where things stand, but the checkboxes only work if people keep them accurate.",
    sections: [
      {
        heading: "The usual deadlines",
        bullets: [
          "Contact Professor or Source is when outreach should be started.",
          "Conduct Interview is when the interview or main reporting should be finished.",
          "Write Draft is when the writer should have a review-ready draft.",
          "Editor Review is when the editor should finish comments.",
          "Review Edits is when the writer should finish addressing notes.",
        ],
      },
      {
        heading: "What to update",
        bullets: [
          "Keep timeline checkboxes accurate as work happens.",
          "If a date is no longer realistic, tell your editor or an admin early.",
          "Do not wait until the deadline has already passed to ask for more time.",
        ],
      },
      {
        heading: "If you get a follow-up",
        bullets: [
          "Reply with a specific status update.",
          "Say what is complete, what is blocked, and when the next step will happen.",
          "Short, honest updates are better than silence.",
        ],
      },
    ],
  },
  marketing: {
    title: "Using the Marketing Dashboard",
    audience: "Marketing team",
    subject: "How to use the Catalyst marketing dashboard",
    intro: "The marketing dashboard helps turn published stories into social posts and keeps the team organized across channels.",
    sections: [
      {
        heading: "Where to work",
        bullets: [
          "Open Marketing from the sidebar.",
          "Use Social media posts to review drafts connected to recent published stories.",
          "Use Subscribers & growth to understand newsletter and audience movement if you have access.",
          "Use Campaign history only when you need to review previous sends or results.",
        ],
      },
      {
        heading: "Editing captions",
        bullets: [
          "Make sure the caption reflects the article accurately.",
          "Keep the hook clear and specific.",
          "Avoid overstating the science or making claims stronger than the article supports.",
          "Match the tone to the platform while keeping Catalyst's voice credible.",
        ],
      },
      {
        heading: "Marking posts",
        bullets: [
          "Only mark a post as Posted after it is actually live.",
          "If a caption needs approval, leave it unposted and ask an admin.",
          "Do not delete drafts just because they are not ready yet.",
        ],
      },
    ],
  },
  newsletter: {
    title: "Using the Newsletter Builder",
    audience: "Newsletter builders",
    subject: "How to build a Catalyst newsletter",
    intro: "The newsletter builder turns recently published articles into an email for subscribers. Treat it as a final publishing surface: review carefully before sending.",
    sections: [
      {
        heading: "Build the issue",
        bullets: [
          "Open Newsletter builder from the sidebar.",
          "Choose recently published articles that belong in the issue.",
          "Check the subject line, preview text, article order, bylines, cover images, and excerpts.",
          "Make sure every article link opens correctly.",
        ],
      },
      {
        heading: "Preview before sending",
        bullets: [
          "Use the preview to read the email like a subscriber would.",
          "Check mobile readability: short paragraphs, clean hierarchy, and no broken images.",
          "Send only when the issue is final. A live send cannot be undone.",
        ],
      },
      {
        heading: "After sending",
        bullets: [
          "Use Campaign history to confirm the send and review past issues.",
          "If something looks wrong after sending, tell an admin immediately so the team can decide whether a correction is needed.",
        ],
      },
    ],
  },
  login_navigation: {
    title: "Finding the Dashboard and Signing In",
    audience: "All staff",
    subject: "How to find and sign in to the Catalyst dashboard",
    intro: "If you lose the dashboard link or are unsure where to start, use this guide to get back into the editorial suite.",
    sections: [
      {
        heading: "Direct link",
        bullets: [
          "Go to catalyst-magazine.com/admin/login.",
          "Sign in with the email connected to your Catalyst account.",
          "If you were given a temporary password, change it after the first sign-in.",
        ],
      },
      {
        heading: "From the public website",
        bullets: [
          "Go to catalyst-magazine.com.",
          "Scroll to the footer at the bottom of the page.",
          "Click the small Staff link near Terms of Service.",
        ],
      },
      {
        heading: "If access looks wrong",
        bullets: [
          "If you can sign in but do not see the right dashboard sections, your role may need to be updated.",
          "Reply to this email with what you expected to see.",
          "Include a screenshot if possible so we can identify the issue faster.",
        ],
      },
    ],
  },
};

export const guidanceTemplates = Object.freeze(base);

export function getGuidanceTemplate(id) {
  return guidanceTemplates[id] || null;
}

export function listGuidanceTemplates() {
  return Object.entries(guidanceTemplates).map(([id, t]) => ({
    id,
    title: t.title,
    audience: t.audience,
    subject: t.subject,
    intro: t.intro,
  }));
}

export function buildGuidanceEmail({ template, recipientName, siteUrl }) {
  const firstName = firstNameFrom(recipientName);
  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <h1 style="margin:12px 0 12px 0;font-size:28px;line-height:1.12;color:${COLORS.ink};letter-spacing:-0.03em;">
      ${escapeHtml(template.title)}
    </h1>
    <p style="margin:0;font-size:16px;line-height:1.6;color:${COLORS.inkSoft};">
      ${escapeHtml(template.intro)}
    </p>

    <div style="margin:22px 0 0 0;padding:16px 18px;border:1px solid ${COLORS.greenBorder};border-left:4px solid ${COLORS.accent};border-radius:12px;background:${COLORS.greenBg};">
      <div style="font-size:12px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:${COLORS.greenInk};margin-bottom:8px;">Start here</div>
      <p style="margin:0;font-size:14px;line-height:1.6;color:${COLORS.inkSoft};">
        The dashboard is easiest when you update it as work happens. Open the editorial suite, find the right page in the sidebar, and use the instructions below as a checklist.
      </p>
      <div style="margin-top:12px;">
        <a href="${escapeAttr(siteUrl)}/admin/login" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700;font-size:13px;">Open the dashboard</a>
      </div>
    </div>

    ${template.sections.map(renderSection).join("")}

    <div style="margin:24px 0 0 0;padding:16px 18px;border:1px solid ${COLORS.warmBorder};border-radius:12px;background:${COLORS.warmBg};">
      <div style="font-weight:700;color:${COLORS.ink};font-size:15px;margin-bottom:6px;">Need us to look at something specific?</div>
      <p style="margin:0;font-size:14px;line-height:1.6;color:${COLORS.inkSoft};">
        Reply with the story title, what page you are on, and what you are trying to do. A screenshot helps if the issue is visual.
      </p>
    </div>

    <div style="margin:24px 0 0 0;">
      <a href="${escapeAttr(siteUrl)}/admin/login" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;font-size:14px;">Open the dashboard</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      Thanks,<br>
      <strong style="color:${COLORS.ink};">Aidan and Yair</strong><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  return shell({
    title: template.subject,
    preheader: `${template.title} — guidance from Aidan and Yair.`,
    body,
    siteUrl,
  });
}

export function buildGuidanceText({ template, recipientName, siteUrl }) {
  const firstName = firstNameFrom(recipientName);
  const lines = [
    `Hi ${firstName},`,
    "",
    template.title,
    "",
    template.intro,
    "",
    "Start here",
    `Dashboard: ${siteUrl}/admin/login`,
    "The dashboard is easiest when you update it as work happens. Open the editorial suite, find the right page in the sidebar, and use the instructions below as a checklist.",
    "",
  ];
  for (const section of template.sections) {
    lines.push(section.heading, "");
    for (const item of section.bullets) lines.push(`- ${item}`);
    lines.push("");
  }
  lines.push(
    "Need us to look at something specific?",
    "Reply with the story title, what page you are on, and what you are trying to do. A screenshot helps if the issue is visual.",
    "",
    `Dashboard: ${siteUrl}/admin/login`,
    "",
    "Thanks,",
    "Aidan and Yair",
    "The Catalyst Magazine",
  );
  return lines.join("\n");
}

function shell({ title, preheader = "", body, siteUrl }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLORS.ink};">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.pageBg};padding:32px 12px 44px;">
    <tr>
      <td align="center">
        <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:620px;max-width:100%;background:${COLORS.surface};border-radius:18px;overflow:hidden;border:1px solid ${COLORS.hairline};">
          <tr>
            <td style="padding:26px 32px 18px;text-align:center;border-bottom:1px solid ${COLORS.hairline};">
              <div style="font-weight:800;font-size:24px;letter-spacing:-0.03em;color:${COLORS.ink};">The Catalyst</div>
              <div style="margin-top:4px;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${COLORS.muted};">Editorial Guidance</div>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 34px 34px;">${body}</td>
          </tr>
          <tr>
            <td style="padding:22px 34px 28px;background:#fafafa;border-top:1px solid ${COLORS.hairline};text-align:center;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:${COLORS.muted};">
                The Catalyst Magazine · <a href="${escapeAttr(siteUrl)}" style="color:${COLORS.muted};">${escapeHtml(siteUrl.replace(/^https?:\/\//, ""))}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderSection(section) {
  return `
    <div style="margin:22px 0 0 0;padding:18px 20px;border:1px solid ${COLORS.hairline};border-radius:12px;background:#ffffff;">
      <h2 style="font-size:17px;line-height:1.3;color:${COLORS.ink};margin:0 0 10px;font-weight:800;">${escapeHtml(section.heading)}</h2>
      <ul style="margin:0;padding-left:20px;color:${COLORS.inkSoft};font-size:14px;line-height:1.7;">
        ${section.bullets.map((b) => `<li style="margin:0 0 7px 0;">${escapeHtml(b)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function firstNameFrom(name) {
  const clean = String(name || "there").trim();
  return clean ? clean.split(/\s+/)[0] : "there";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
  return escapeHtml(s);
}
