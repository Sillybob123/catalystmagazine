// functions/_utils/reminder-emails.js
// HTML email templates for the Catalyst bot. Design matches the existing
// subscribe-confirm template in emails.js — same masthead, typography, and
// monochrome palette — so staff emails feel like part of the same family.

const COLORS = {
  pageBg:   "#f5f5f7",
  surface:  "#ffffff",
  ink:      "#1d1d1f",
  inkSoft:  "#424245",
  muted:    "#6e6e73",
  hairline: "#d2d2d7",
  footerBg: "#fafafa",
  accent:   "#0b0b0d",
  alertBg:  "#fff4e5",
  alertInk: "#92400e",
  overdueBg: "#fde8e8",
  overdueInk: "#9b1c1c",
};

const LOGO_URL = "https://www.catalyst-magazine.com/WebLogo.jpg";

function shell({ title, preheader = "", body, siteUrl }) {
  return `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(title)}</title>
<style>
  body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td { mso-table-lspace:0; mso-table-rspace:0; }
  img { -ms-interpolation-mode:bicubic; border:0; display:block; }
  body { margin:0 !important; padding:0 !important; width:100% !important; background:#ffffff; }
  a { color:${COLORS.ink}; }
  @media screen and (max-width:620px) {
    .container { width:100% !important; }
    .px-40 { padding-left:22px !important; padding-right:22px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;color:${COLORS.ink};">
  <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;padding:24px 12px 32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;">
          <tr><td class="px-40" style="padding:8px 32px 32px 32px;">${body}</td></tr>
          <tr>
            <td class="px-40" style="padding:18px 32px 8px 32px;border-top:1px solid ${COLORS.hairline};">
              <p style="margin:0;font-size:12px;line-height:1.55;color:${COLORS.muted};">
                The Catalyst Magazine &middot; A note from your editors. Reply any time.
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

// ─── Writer reminder ─────────────────────────────────────────────────────────

export function writerReminderEmail({ kind, writer, project, deadline, daysUntilDeadline, daysInactive, interviewDate, daysUntilInterview, daysSinceInterview, siteUrl }) {
  const firstName = (writer.name || writer.email || "there").split(/\s+/)[0];
  const projectTitle = project.title || "(untitled story)";
  const projectUrl = `${siteUrl}/admin/#/pipeline/mine`;

  let headline, paragraphs, statusRows, statusTone, cta, extraHtml = "";

  if (kind === "deadline-3d" || kind === "deadline-1d") {
    const dText = daysUntilDeadline <= 0
      ? "today"
      : daysUntilDeadline === 1
        ? "tomorrow"
        : `in ${daysUntilDeadline} days`;
    headline = `Your story is due ${dText}.`;
    paragraphs = [
      `Just checking in — the publication deadline for "${projectTitle}" is ${dText}, and we want to make sure you're on track. Please get your draft in on time.`,
      `If you need a deadline extension, request it from the pipeline page before the due date — not after. Reply to this email if you're running into a blocker we should know about.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Deadline", value: fmtDate(deadline) },
      { label: "Time remaining", value: dText },
    ];
    statusTone = daysUntilDeadline <= 1 ? "alert" : "info";
    cta = { text: "Open your story", url: projectUrl };
  } else if (kind === "deadline-overdue") {
    const overdueBy = Math.abs(daysUntilDeadline);
    const overdueText = `${overdueBy} day${overdueBy === 1 ? "" : "s"}`;
    headline = `Your deadline has passed.`;
    paragraphs = [
      `The publication deadline for "${projectTitle}" was ${overdueText} ago and we haven't received your draft. We need to hear from you.`,
      `Please reply to this email within 48 hours with either your draft, a clear status update, or a request for a new deadline. If we don't hear back, we may need to reassign or drop the piece.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Original deadline", value: fmtDate(deadline) },
      { label: "Overdue by", value: overdueText },
    ];
    statusTone = "overdue";
    cta = { text: "Update your story", url: projectUrl };
  } else if (kind === "idle") {
    headline = `We haven't seen activity on your story in ${daysInactive} days.`;
    paragraphs = [
      `"${projectTitle}" has had no updates in the pipeline for ${daysInactive} days. Please post a progress note in the activity feed or reply here so we know where things stand.`,
      `If you're stuck — sourcing, structure, scheduling — tell us and we'll help. If you need to step back from the piece, let us know so we can plan accordingly.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Last activity", value: `${daysInactive} days ago` },
      deadline ? { label: "Deadline", value: fmtDate(deadline) } : null,
    ].filter(Boolean);
    statusTone = "alert";
    cta = { text: "Post an update", url: projectUrl };
  } else if (kind === "interview-followup") {
    const whenText = daysSinceInterview === 1 ? "yesterday" : `${daysSinceInterview} days ago`;
    headline = `How did the interview go?`;
    paragraphs = [
      `We saw your interview for "${projectTitle}" was scheduled for ${whenText} (${fmtDate(interviewDate)}), and wanted to check in. "Interview Complete" still isn't ticked on the pipeline, so we're not sure where things landed.`,
      `If the interview happened and went well: please check off "Interview Complete" on the pipeline so we know it's done — and start drafting today while the conversation is still fresh in your head. The longer you wait, the more you'll forget the small details (a phrase, a pause, a side comment) that make a story actually feel alive.`,
      `If something went sideways — they cancelled, the recording failed, you didn't get what you needed — that's fine, just tell us. Reply to this email or message Aidan and Yair and we'll figure out the next move together. Don't sit on it.`,
      `Any questions about how to structure the piece, what to lead with, or which quotes to use — ask Aidan and Yair. That's literally what we're here for.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Interview was", value: `${fmtDate(interviewDate)} (${whenText})` },
      { label: "Status", value: "Interview Complete — not yet ticked" },
    ];
    statusTone = "alert";
    cta = { text: "Open your story", url: projectUrl };
  } else if (kind === "interview-prep") {
    const dText = daysUntilInterview <= 1 ? "tomorrow" : `in ${daysUntilInterview} days`;
    headline = `Your interview is ${dText} — here's how to nail it.`;
    paragraphs = [
      `Your interview for "${projectTitle}" is scheduled for ${fmtDate(interviewDate)}. A great interview is the difference between a story that quotes someone and a story that brings them to life — so spend a little time today getting ready.`,
      `Here's the prep we walk every Catalyst writer through before they sit down with a source. Skim it tonight, write your questions tomorrow, and you'll walk in confident.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Interview", value: fmtDate(interviewDate) },
      { label: "Time until", value: dText },
    ];
    statusTone = "info";
    cta = { text: "Open your story", url: projectUrl };
    extraHtml = buildInterviewPrepBlock();
  } else {
    headline = `A quick check-in on your story.`;
    paragraphs = [
      `See details below, and reply to this email with an update.`,
    ];
    statusRows = [{ label: "Story", value: projectTitle }];
    statusTone = "info";
    cta = { text: "Open your story", url: projectUrl };
  }

  const statusBlock = buildStatusBlock({ rows: statusRows, tone: statusTone });

  const paragraphHtml = paragraphs.map((p, i) => `
    <p style="margin:${i === 0 ? "0" : "14"}px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      ${escapeHtml(p)}
    </p>
  `).join("");

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      ${escapeHtml(headline)}
    </p>

    ${statusBlock}

    ${paragraphHtml}

    ${extraHtml}

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(cta.url)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">${escapeHtml(cta.text)}</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = subjectForWriterReminder({ kind, projectTitle, daysUntilDeadline, daysInactive, daysUntilInterview, daysSinceInterview });
  const preheader = preheaderForWriterReminder({ kind, projectTitle, daysUntilDeadline, daysInactive, daysUntilInterview, daysSinceInterview });
  return {
    subject,
    html: shell({ title: subject, preheader, body, siteUrl }),
  };
}

function subjectForWriterReminder({ kind, projectTitle, daysUntilDeadline, daysInactive, daysUntilInterview, daysSinceInterview }) {
  const t = truncate(projectTitle, 40);
  if (kind === "deadline-1d") return `Due tomorrow: "${t}"`;
  if (kind === "deadline-3d") return `Due in ${daysUntilDeadline} days: "${t}"`;
  if (kind === "deadline-overdue") {
    const d = Math.abs(daysUntilDeadline);
    return `Past due (${d}d): "${t}" — response needed`;
  }
  if (kind === "idle") return `${daysInactive}d no activity: "${t}"`;
  if (kind === "interview-prep") {
    const when = daysUntilInterview <= 1 ? "tomorrow" : `in ${daysUntilInterview} days`;
    return `Interview ${when}: prep tips for "${t}"`;
  }
  if (kind === "interview-followup") {
    return `How did the interview go? — "${t}"`;
  }
  return `Catalyst: update on "${t}"`;
}

function preheaderForWriterReminder({ kind, daysUntilDeadline, daysInactive, daysUntilInterview, daysSinceInterview }) {
  if (kind === "deadline-1d") return "Deadline tomorrow. Please submit on time.";
  if (kind === "deadline-3d") return `Deadline in ${daysUntilDeadline} days.`;
  if (kind === "deadline-overdue") return "Response required within 48 hours.";
  if (kind === "idle") return `${daysInactive} days without activity — please update us.`;
  if (kind === "interview-prep") {
    const when = daysUntilInterview <= 1 ? "tomorrow" : `in ${daysUntilInterview} days`;
    return `Your interview is ${when}. Prep checklist inside.`;
  }
  if (kind === "interview-followup") {
    return "Check off Interview Complete and start drafting while it's fresh.";
  }
  return "Update from The Catalyst editorial team.";
}

// Prep tips block — included in interview-prep emails. Three short sections so
// writers can skim it the night before and still walk in prepared.
function buildInterviewPrepBlock() {
  const sections = [
    {
      title: "Research before you walk in",
      tips: [
        "Read the source's most recent paper, talk, or public writing — and three things they've written that are *not* the paper everyone cites.",
        "Skim their lab/department page and note the people they collaborate with. Knowing the landscape lets you ask sharper follow-ups.",
        "Identify the one claim or finding you don't fully understand yet. That's your most important question.",
        "Have a one-paragraph mental summary of who they are, what they study, and why a Catalyst reader should care.",
      ],
    },
    {
      title: "Write questions that earn good answers",
      tips: [
        "Open-ended beats yes/no. \"Walk me through how you came to that conclusion\" pulls a story; \"Did that surprise you?\" pulls one word.",
        "Lead with an easy, generous question — let them warm up. Save the harder, more specific ones for the middle.",
        "Prepare 8–10 questions but plan to ask 4–5. The best material always comes from following up on what they actually said, not what you scripted.",
        "Always include: \"What's the part of this that journalists keep getting wrong?\" and \"What should I have asked you that I didn't?\"",
      ],
    },
    {
      title: "Run the interview like a pro",
      tips: [
        "Test your recording setup the day before — phone app, laptop mic, backup. Then test it again 10 minutes before the call.",
        "Pick a quiet space with stable internet. If it's in person, scout the room for noise.",
        "Confirm on-the-record vs. on-background at the start. Don't assume.",
        "Take light notes by hand even if you're recording — note the timestamp when they say something quotable so you can find it fast later.",
        "End by asking who else you should talk to. Sources lead to sources.",
      ],
    },
  ];

  const blocks = sections.map((s) => `
    <div style="margin:18px 0 0 0;padding:16px 18px;background:#fafafa;border:1px solid ${COLORS.hairline};border-radius:10px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:${COLORS.muted};text-transform:uppercase;margin-bottom:10px;">${escapeHtml(s.title)}</div>
      <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.65;color:${COLORS.inkSoft};">
        ${s.tips.map((t) => `<li style="margin:0 0 6px 0;">${escapeHtml(t)}</li>`).join("")}
      </ul>
    </div>
  `).join("");

  return `
    <div style="margin:22px 0 0 0;">
      <div style="font-size:13px;font-weight:600;color:${COLORS.ink};letter-spacing:-0.01em;">Catalyst interview prep checklist</div>
      ${blocks}
    </div>
  `;
}

function buildStatusBlock({ rows, tone }) {
  const palette = {
    info:    { border: COLORS.hairline,   labelInk: COLORS.muted,    valueInk: COLORS.ink,        bg: "#fafafa" },
    alert:   { border: "#fcd9a8",         labelInk: COLORS.alertInk, valueInk: COLORS.alertInk,   bg: COLORS.alertBg },
    overdue: { border: "#f5b5b5",         labelInk: COLORS.overdueInk, valueInk: COLORS.overdueInk, bg: COLORS.overdueBg },
  }[tone] || { border: COLORS.hairline, labelInk: COLORS.muted, valueInk: COLORS.ink, bg: "#fafafa" };

  const rowHtml = rows.map((r, i) => `
    <tr>
      <td style="padding:${i === 0 ? "10" : "6"}px 12px 6px 0;font-size:12px;color:${palette.labelInk};white-space:nowrap;vertical-align:top;width:120px;">${escapeHtml(r.label)}</td>
      <td style="padding:${i === 0 ? "10" : "6"}px 0 6px 0;font-size:14px;color:${palette.valueInk};font-weight:600;vertical-align:top;">${escapeHtml(r.value)}</td>
    </tr>
  `).join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 20px 0;border:1px solid ${palette.border};background:${palette.bg};border-radius:6px;">
      <tr><td style="padding:6px 16px 10px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowHtml}</table>
      </td></tr>
    </table>
  `;
}

// ─── Admin Saturday digest ───────────────────────────────────────────────────

export function adminDigestEmail({ rows, adminTasks = [], now, siteUrl }) {
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const totalProjects = rows.reduce((n, r) => n + r.projects.length, 0);
  const flaggedWriters = rows.filter((r) => r.projects.some((p) => p.flags.length)).length;
  const flaggedProjects = rows.reduce((n, r) => n + r.projects.filter((p) => p.flags.length).length, 0);

  const writerBlocks = rows.map((row) => renderWriterBlock(row, siteUrl)).join("");
  const adminTasksBlock = renderAdminTasksBlock(adminTasks, siteUrl);

  const body = `
    <div style="text-align:left;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.28em;color:${COLORS.muted};margin-bottom:14px;text-transform:uppercase;">Weekly editorial digest</div>
      <h1 class="hero-h1" style="margin:0 0 14px 0;font-weight:700;font-size:34px;line-height:1.1;color:${COLORS.ink};letter-spacing:-0.03em;">
        Saturday briefing
      </h1>
      <p style="margin:0 0 6px 0;font-size:15px;color:${COLORS.muted};">${escapeHtml(dateLabel)}</p>
      <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;color:${COLORS.inkSoft};">
        Here's where every active story stands this week — and who needs a nudge. Copy-paste messages are ready under each writer who needs one.
      </p>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;border:1px solid ${COLORS.hairline};border-radius:14px;">
      <tr>
        ${renderStat("Writers", String(rows.length))}
        ${renderStat("Active stories", String(totalProjects))}
        ${renderStat("Need attention", String(flaggedProjects), flaggedProjects > 0)}
        ${renderStat("Admin tasks", String(adminTasks.length), adminTasks.length > 0)}
      </tr>
    </table>

    ${adminTasksBlock}

    <div style="margin:32px 0 0 0;">
      ${writerBlocks || `<p style="color:${COLORS.muted};font-size:15px;">No active projects. Nice empty desk.</p>`}
    </div>

    <p style="margin:40px 0 0 0;font-size:14px;line-height:1.6;color:${COLORS.muted};">
      Prepared for the Catalyst editorial team.
    </p>
  `;

  const subject = `Catalyst editorial briefing — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${flaggedWriters} writer${flaggedWriters === 1 ? "" : "s"} to nudge${adminTasks.length ? `, ${adminTasks.length} admin task${adminTasks.length === 1 ? "" : "s"}` : ""})`;
  const preheader = flaggedProjects
    ? `${flaggedProjects} stor${flaggedProjects === 1 ? "y" : "ies"} need attention. Copy-paste messages inside.`
    : `All ${totalProjects} stor${totalProjects === 1 ? "y is" : "ies are"} on track.`;

  return {
    subject,
    html: shell({ title: subject, preheader, body, siteUrl }),
  };
}

function renderAdminTasksBlock(tasks, siteUrl) {
  if (!tasks || !tasks.length) return "";
  const projectUrl = `${siteUrl}/admin/#/pipeline/all`;

  const taskRows = tasks.map((t) => {
    const flagText = t.flags.map((f) => adminFlagLabel(f)).join(" · ");
    return `
      <div style="padding:14px 0;border-bottom:1px solid ${COLORS.hairline};">
        <div style="font-size:15px;font-weight:600;color:${COLORS.ink};letter-spacing:-0.01em;line-height:1.4;">${escapeHtml(t.title)}</div>
        <div style="margin-top:6px;font-size:13px;color:${COLORS.muted};line-height:1.5;">
          <span>${escapeHtml(t.writerName)}</span>
          <span style="color:${COLORS.hairline};"> &middot; </span>
          <span>${escapeHtml(flagText)}</span>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="margin:32px 0 0 0;border:1px solid #fcd9a8;border-radius:16px;overflow:hidden;background:${COLORS.alertBg};">
      <div style="padding:14px 20px;border-bottom:1px solid #fcd9a8;">
        <div style="font-size:18px;font-weight:700;color:${COLORS.alertInk};letter-spacing:-0.01em;">
          ${tasks.length} task${tasks.length === 1 ? "" : "s"} for you
        </div>
        <div style="margin-top:4px;font-size:13px;color:${COLORS.alertInk};">
          Action required from an admin
        </div>
      </div>
      <div style="padding:4px 20px 8px 20px;background:#fff;">
        ${taskRows}
      </div>
      <div style="padding:14px 20px 18px 20px;background:#fff;">
        <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:13px;">Open the pipeline</a>
      </div>
    </div>
  `;
}

function adminFlagLabel(f) {
  if (f.kind === "proposal-pending") {
    return f.days != null ? `Proposal pending ${f.days}d` : "Proposal pending review";
  }
  if (f.kind === "needs-editor") return "Draft ready — needs editor";
  if (f.kind === "deadline-request-pending") return "Deadline change request open";
  return f.kind;
}

function renderStat(label, value, highlight = false) {
  const color = highlight ? COLORS.overdueInk : COLORS.ink;
  return `
    <td style="padding:18px 16px;text-align:center;border-right:1px solid ${COLORS.hairline};">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.22em;color:${COLORS.muted};text-transform:uppercase;margin-bottom:6px;">${escapeHtml(label)}</div>
      <div style="font-size:24px;font-weight:700;color:${color};letter-spacing:-0.02em;">${escapeHtml(value)}</div>
    </td>
  `;
}

function renderWriterBlock(row, siteUrl) {
  const flagged = row.projects.some((p) => p.flags.length);
  const headerBg = flagged ? COLORS.alertBg : "#f8fafc";
  const headerInk = flagged ? COLORS.alertInk : COLORS.ink;

  const emailLink = row.writerEmail
    ? `<a href="mailto:${escapeAttr(row.writerEmail)}" style="color:${COLORS.muted};text-decoration:underline;font-weight:500;">${escapeHtml(row.writerEmail)}</a>`
    : `<span style="color:${COLORS.muted};">no email on file</span>`;

  const projectRows = row.projects.map((p) => renderProjectRow(p)).join("");
  const copyPaste = row.copyPasteMessage ? renderCopyPasteBlock(row.copyPasteMessage, row.writerEmail) : "";

  return `
    <div style="margin:0 0 22px 0;border:1px solid ${COLORS.hairline};border-radius:16px;overflow:hidden;">
      <div style="padding:16px 20px;background:${headerBg};border-bottom:1px solid ${COLORS.hairline};">
        <div style="font-size:18px;font-weight:700;color:${headerInk};letter-spacing:-0.01em;">
          ${escapeHtml(row.writerName)} ${flagged ? `<span style="font-size:11px;font-weight:700;letter-spacing:0.22em;color:${COLORS.overdueInk};text-transform:uppercase;margin-left:10px;vertical-align:middle;">Needs attention</span>` : ""}
        </div>
        <div style="margin-top:4px;font-size:13px;color:${COLORS.muted};">${emailLink}</div>
      </div>
      <div style="padding:4px 20px 8px 20px;">
        ${projectRows}
      </div>
      ${copyPaste}
    </div>
  `;
}

function renderProjectRow(p) {
  const flagBadges = p.flags.map((f) => renderFlag(f)).join(" ");
  const deadlineText = p.deadline ? fmtDate(p.deadline) : "No deadline set";
  const inactiveText = p.daysInactive != null ? `${p.daysInactive}d idle` : "—";

  return `
    <div style="padding:14px 0;border-bottom:1px solid ${COLORS.hairline};">
      <div style="font-size:15px;font-weight:600;color:${COLORS.ink};letter-spacing:-0.01em;line-height:1.4;">${escapeHtml(p.title)}</div>
      <div style="margin-top:6px;font-size:13px;color:${COLORS.muted};line-height:1.5;">
        <span>${escapeHtml(p.stage)}</span>
        <span style="color:${COLORS.hairline};"> &middot; </span>
        <span>Deadline: ${escapeHtml(deadlineText)}</span>
        <span style="color:${COLORS.hairline};"> &middot; </span>
        <span>${escapeHtml(inactiveText)}</span>
      </div>
      ${flagBadges ? `<div style="margin-top:8px;">${flagBadges}</div>` : ""}
    </div>
  `;
}

function renderFlag(f) {
  const styles = {
    overdue:   { bg: COLORS.overdueBg, ink: COLORS.overdueInk, text: `Overdue ${f.days}d` },
    "deadline-soon": { bg: COLORS.alertBg, ink: COLORS.alertInk, text: `Due in ${f.days}d` },
    idle:      { bg: COLORS.alertBg, ink: COLORS.alertInk, text: `Idle ${f.days}d` },
    "proposal-pending": { bg: "#eef2ff", ink: "#3730a3", text: "Proposal pending" },
    "deadline-request-pending": { bg: "#eef2ff", ink: "#3730a3", text: "Deadline request" },
  }[f.kind];
  if (!styles) return "";
  return `<span style="display:inline-block;background:${styles.bg};color:${styles.ink};font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:4px 10px;border-radius:980px;margin-right:6px;">${escapeHtml(styles.text)}</span>`;
}

function renderCopyPasteBlock(msg, email) {
  const mailto = email
    ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Checking in from The Catalyst")}&body=${encodeURIComponent(msg)}`
    : null;

  return `
    <div style="margin:0;padding:16px 20px 20px 20px;background:#0b0b0d;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.22em;color:#a1a1a6;text-transform:uppercase;margin-bottom:10px;">Copy-paste message</div>
      <div style="background:#17171a;border-radius:12px;padding:16px 18px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;line-height:1.65;color:#f2f2f5;white-space:pre-wrap;">${escapeHtml(msg)}</div>
      ${mailto ? `<div style="margin-top:12px;"><a href="${escapeAttr(mailto)}" style="display:inline-block;background:#ffffff;color:#0b0b0d;text-decoration:none;padding:10px 20px;border-radius:980px;font-weight:600;font-size:13px;letter-spacing:-0.01em;">Open in email &rarr;</a></div>` : ""}
    </div>
  `;
}

// ─── Event-driven emails (instant, fired by dashboard actions) ───────────────

// Sent to admins the moment a writer submits a new proposal.
export function adminProposalPendingEmail({ project, author, siteUrl }) {
  const projectTitle = project.title || "(untitled story)";
  const authorName = author?.name || project.authorName || "Unknown writer";
  const projectUrl = `${siteUrl}/admin/#/pipeline/all`;
  const proposalText = String(project.proposal || "").trim();
  const proposalPreview = proposalText
    ? truncate(proposalText, 600)
    : "(no proposal text on file)";

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "Type", value: project.type || "—" },
      { label: "Writer", value: authorName },
      project.deadline ? { label: "Requested deadline", value: fmtDate(project.deadline) } : null,
    ].filter(Boolean),
    tone: "info",
  });

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi team,
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      A new proposal needs review.
    </p>

    ${statusBlock}

    <div style="margin:0 0 18px 0;border:1px solid ${COLORS.hairline};border-radius:6px;padding:14px 16px;background:#fafafa;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.22em;color:${COLORS.muted};text-transform:uppercase;margin-bottom:8px;">Proposal</div>
      <div style="font-size:14px;line-height:1.6;color:${COLORS.inkSoft};white-space:pre-wrap;">${escapeHtml(proposalPreview)}</div>
    </div>

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      Please review and approve or reject the proposal so ${escapeHtml(authorName.split(/\s+/)[0])} can get started.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Review proposal</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = `New proposal needs review: "${truncate(projectTitle, 50)}"`;
  const preheader = `${authorName} submitted a proposal for review.`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

// Sent to admins the moment a writer marks "Article Writing Complete" — admins
// need to assign an editor.
export function adminWritingCompleteEmail({ project, author, siteUrl }) {
  const projectTitle = project.title || "(untitled story)";
  const authorName = author?.name || project.authorName || "Unknown writer";
  const projectUrl = `${siteUrl}/admin/#/pipeline/all`;

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "Type", value: project.type || "—" },
      { label: "Writer", value: authorName },
      project.deadline ? { label: "Publication deadline", value: fmtDate(project.deadline) } : null,
    ].filter(Boolean),
    tone: "alert",
  });

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi team,
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      A draft is ready — please assign an editor.
    </p>

    ${statusBlock}

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      ${escapeHtml(authorName)} just marked their writing complete on "${escapeHtml(projectTitle)}." It needs an editor before review can start.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Assign an editor</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = `Draft ready, needs editor: "${truncate(projectTitle, 50)}"`;
  const preheader = `${authorName} finished writing — assign an editor.`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

// Sent to the editor the moment they're assigned to a story.
export function editorAssignedEmail({ project, editor, author, siteUrl }) {
  const firstName = (editor.name || editor.email || "there").split(/\s+/)[0];
  const projectTitle = project.title || "(untitled story)";
  const authorName = author?.name || project.authorName || "the writer";
  const projectUrl = `${siteUrl}/admin/#/pipeline/mine`;
  const deadline = project.deadlines?.publication || project.deadline || null;

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "Type", value: project.type || "—" },
      { label: "Writer", value: authorName },
      deadline ? { label: "Publication deadline", value: fmtDate(deadline) } : null,
    ].filter(Boolean),
    tone: "info",
  });

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      You've been assigned to edit a story.
    </p>

    ${statusBlock}

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      You're the editor for "${escapeHtml(projectTitle)}" by ${escapeHtml(authorName)}. The draft is in the pipeline — please open it, read through, and leave your edits and comments.
    </p>
    <p style="margin:14px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      When you're done, mark "Review Complete" so ${escapeHtml(authorName.split(/\s+/)[0])} knows to look at your feedback.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open the story</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = `You're the editor for "${truncate(projectTitle, 50)}"`;
  const preheader = `New editing assignment from The Catalyst.`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

// ─── Editor reminders (daily bot) ────────────────────────────────────────────
//
// Editors get nudged when a story they own has been sitting in their court
// without a "Review Complete" mark. Distinct from writer reminders because the
// thing they need to *do* is different.

export function editorReminderEmail({ kind, editor, project, deadline, daysSinceAssigned, daysInactive, siteUrl }) {
  const firstName = (editor.name || editor.email || "there").split(/\s+/)[0];
  const projectTitle = project.title || "(untitled story)";
  const authorName = project.authorName || "the writer";
  const projectUrl = `${siteUrl}/admin/#/pipeline/mine`;

  let headline, paragraphs, statusRows, statusTone;
  if (kind === "editor-idle") {
    headline = `Your edit on "${projectTitle}" is waiting.`;
    paragraphs = [
      `It's been ${daysInactive} days since there's been activity on "${projectTitle}" — and you're the assigned editor. ${authorName}'s draft needs your review.`,
      `Please open the story, leave your comments, and mark "Review Complete" when you're done. If something's blocking you, reply to this email.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Writer", value: authorName },
      { label: "Last activity", value: `${daysInactive} days ago` },
      deadline ? { label: "Publication deadline", value: fmtDate(deadline) } : null,
    ].filter(Boolean);
    statusTone = "alert";
  } else if (kind === "editor-deadline-soon") {
    const dText = daysSinceAssigned == null
      ? "soon"
      : `in ${daysSinceAssigned} day${daysSinceAssigned === 1 ? "" : "s"}`;
    headline = `Edit due ${dText}: "${projectTitle}"`;
    paragraphs = [
      `The publication deadline for "${projectTitle}" is ${dText}. As the editor, your review needs to be done before then.`,
      `Please get your edits in soon and mark "Review Complete" when finished.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Writer", value: authorName },
      { label: "Publication deadline", value: fmtDate(deadline) },
    ];
    statusTone = "alert";
  } else {
    headline = `Quick check-in on "${projectTitle}"`;
    paragraphs = [`See details below, and reply if anything's blocking you.`];
    statusRows = [{ label: "Story", value: projectTitle }];
    statusTone = "info";
  }

  const statusBlock = buildStatusBlock({ rows: statusRows, tone: statusTone });
  const paragraphHtml = paragraphs.map((p, i) => `
    <p style="margin:${i === 0 ? "0" : "14"}px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      ${escapeHtml(p)}
    </p>
  `).join("");

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      ${escapeHtml(headline)}
    </p>

    ${statusBlock}

    ${paragraphHtml}

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open the story</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = kind === "editor-idle"
    ? `${daysInactive}d no activity (editor): "${truncate(projectTitle, 40)}"`
    : `Edit due soon: "${truncate(projectTitle, 50)}"`;
  const preheader = kind === "editor-idle"
    ? `${daysInactive} days of editor inactivity. Please review.`
    : `Editor review needed before deadline.`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

// ─── Bundled multi-project reminder (daily cap) ──────────────────────────────
//
// When one person would receive multiple reminder emails on the same day,
// merge them into one to avoid spam. Used for both writers and editors.

export function bundledReminderEmail({ recipient, role, items, siteUrl }) {
  const firstName = (recipient.name || recipient.email || "there").split(/\s+/)[0];
  const projectUrl = `${siteUrl}/admin/#/pipeline/mine`;
  const count = items.length;

  const headline = role === "editor"
    ? `${count} stories need your editing attention.`
    : `${count} of your stories need an update.`;

  const itemRows = items.map((item) => {
    const label = bundledItemLabel(item);
    return `
      <div style="padding:14px 0;border-bottom:1px solid ${COLORS.hairline};">
        <div style="font-size:15px;font-weight:600;color:${COLORS.ink};letter-spacing:-0.01em;line-height:1.4;">${escapeHtml(item.projectTitle)}</div>
        <div style="margin-top:6px;font-size:13px;color:${COLORS.muted};line-height:1.5;">${escapeHtml(label)}</div>
      </div>
    `;
  }).join("");

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      ${escapeHtml(headline)}
    </p>

    <div style="margin:18px 0 0 0;border:1px solid ${COLORS.hairline};border-radius:6px;padding:4px 16px 8px 16px;">
      ${itemRows}
    </div>

    <p style="margin:18px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      Open the pipeline to update each story. Reply to this email if anything's blocking you.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open the pipeline</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = role === "editor"
    ? `${count} stories need editor review`
    : `${count} of your stories need an update`;
  const preheader = `${count} item${count === 1 ? "" : "s"} from The Catalyst editorial pipeline.`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

function bundledItemLabel(item) {
  if (item.kind === "deadline-overdue") {
    const d = Math.abs(item.daysUntilDeadline || 0);
    return `Past due by ${d} day${d === 1 ? "" : "s"}`;
  }
  if (item.kind === "deadline-1d") return `Due tomorrow`;
  if (item.kind === "deadline-3d") return `Due in ${item.daysUntilDeadline} days`;
  if (item.kind === "idle") return `${item.daysInactive} days with no activity`;
  if (item.kind === "interview-prep") {
    const d = item.daysUntilInterview;
    return d <= 1 ? "Interview tomorrow — prep tips inside" : `Interview in ${d} days — prep tips inside`;
  }
  if (item.kind === "interview-followup") {
    const d = item.daysSinceInterview || 1;
    return `Interview was ${d === 1 ? "yesterday" : `${d} days ago`} — check off "Interview Complete" and start drafting`;
  }
  if (item.kind === "editor-idle") return `Editor: ${item.daysInactive} days idle, awaiting your review`;
  if (item.kind === "editor-deadline-soon") return `Editor: deadline approaching`;
  return item.kind;
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s) { return escapeHtml(s); }
