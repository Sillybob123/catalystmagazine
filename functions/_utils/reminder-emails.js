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

export function writerReminderEmail({ kind, writer, project, deadline, daysUntilDeadline, daysInactive, interviewDate, daysUntilInterview, daysSinceInterview, daysSinceApproval, daysSinceContactDeadline, siteUrl }) {
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
      `If you need a deadline extension, request it from the tracker before the due date — not after. Reply to this email if you're running into a blocker we should know about.`,
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
      `"${projectTitle}" has had no updates on the tracker for ${daysInactive} days. Please post a progress note in the activity feed or reply here so we know where things stand.`,
      `If you're stuck — sourcing, structure, scheduling — tell us and we'll help. If you need to step back from the piece, let us know so we can plan accordingly.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Last activity", value: `${daysInactive} days ago` },
      deadline ? { label: "Deadline", value: fmtDate(deadline) } : null,
    ].filter(Boolean);
    statusTone = "alert";
    cta = { text: "Post an update", url: projectUrl };
  } else if (kind === "proposal-no-schedule") {
    const dText = `${daysSinceApproval} day${daysSinceApproval === 1 ? "" : "s"}`;
    headline = `Quick check-in on your story — where are things?`;
    paragraphs = [
      `We approved your pitch for "${projectTitle}" ${dText} ago and we're checking in because you haven't scheduled your interview yet. That's the first big step, and we want to make sure you're not stuck.`,
      `If you've already reached out to your source and are just waiting to hear back — great, let us know in the activity feed or reply here so we know where you're at.`,
      `If you haven't reached out yet, now is the time. The longer you wait, the harder it gets to schedule. And if you're not sure who your source should be, or you're running into trouble making contact — text Aidan and Yair right now and we'll help you work it out together. Don't sit on it.`,
      `Once you have a date locked in, open the tracker, mark "Interview Scheduled", and enter the interview date so we can plan around it.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Proposal approved", value: `${dText} ago` },
      { label: "Status", value: "Interview not yet scheduled" },
    ];
    statusTone = "alert";
    cta = { text: "Open your story", url: projectUrl };
  } else if (kind === "interview-not-scheduled") {
    const dText = `${daysSinceContactDeadline} day${daysSinceContactDeadline === 1 ? "" : "s"}`;
    headline = `Have you heard back from your source?`;
    paragraphs = [
      `Your "Contact Professor" deadline for "${projectTitle}" passed ${dText} ago, and we still don't see an interview scheduled on the tracker. That usually means one of two things — and either way, we want to help you get unstuck.`,
      `If you DID hear back and the interview is on the calendar — please open the tracker right now and check off "Interview Scheduled" + enter the interview date. The tracker is how Aidan and Yair know who needs help and who's on track, so keeping it current matters.`,
      `If you didn't hear back: that happens, and it's not on you. The professional move is to follow up once more (a short, polite nudge) and then pivot. There are usually 2–3 other people who could speak to your topic just as well — sometimes better. Reply to this email and we'll brainstorm new sources together. We can also help you re-pitch the angle if you'd rather change direction entirely.`,
      `What we don't want is for the story to quietly stall. Tell us where you're at — even a one-line "still waiting, will follow up Friday" is enough.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Contact deadline", value: project.deadlines?.contact ? `${fmtDate(project.deadlines.contact)} (${dText} ago)` : `${dText} ago` },
      { label: "Status", value: "Interview not yet scheduled" },
    ];
    statusTone = "alert";
    cta = { text: "Open your story", url: projectUrl };
  } else if (kind === "interview-followup") {
    const whenText = daysSinceInterview === 1 ? "yesterday" : `${daysSinceInterview} days ago`;
    headline = `How did the interview go?`;
    paragraphs = [
      `We saw your interview for "${projectTitle}" was scheduled for ${whenText} (${fmtDate(interviewDate)}), and wanted to check in. "Interview Complete" still isn't ticked on the tracker, so we're not sure where things landed.`,
      `If the interview happened and went well: please check off "Interview Complete" on the tracker so we know it's done — and start drafting today while the conversation is still fresh in your head. The longer you wait, the more you'll forget the small details (a phrase, a pause, a side comment) that make a story actually feel alive.`,
      `If the interview didn't actually happen — they pushed it, you pushed it, schedules slipped — please go into the tracker right now and update the interview date to whenever it's now happening. This is really important. The interview date on the tracker is how Aidan and Yair stay on top of every story, so if it changes and the tracker doesn't, we're flying blind. Same goes for any future reschedule: if the date moves, change it on the tracker.`,
      `If something else went sideways — they cancelled outright, the recording failed, you didn't get what you needed — that's fine, just tell us. Reply to this email or message Aidan and Yair and we'll figure out the next move together. Don't sit on it.`,
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

  const subject = subjectForWriterReminder({ kind, projectTitle, daysUntilDeadline, daysInactive, daysUntilInterview, daysSinceInterview, daysSinceApproval, daysSinceContactDeadline });
  const preheader = preheaderForWriterReminder({ kind, projectTitle, daysUntilDeadline, daysInactive, daysUntilInterview, daysSinceInterview, daysSinceApproval, daysSinceContactDeadline });
  return {
    subject,
    html: shell({ title: subject, preheader, body, siteUrl }),
  };
}

function subjectForWriterReminder({ kind, projectTitle, daysUntilDeadline, daysInactive, daysUntilInterview, daysSinceInterview, daysSinceApproval, daysSinceContactDeadline }) {
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
  if (kind === "interview-followup") return `How did the interview go? — "${t}"`;
  if (kind === "proposal-no-schedule") return `Checking in: interview not yet scheduled — "${t}"`;
  if (kind === "interview-not-scheduled") return `Heard back from your source? — "${t}"`;
  return `Catalyst: update on "${t}"`;
}

function preheaderForWriterReminder({ kind, daysUntilDeadline, daysInactive, daysUntilInterview, daysSinceInterview, daysSinceApproval, daysSinceContactDeadline }) {
  if (kind === "deadline-1d") return "Deadline tomorrow. Please submit on time.";
  if (kind === "deadline-3d") return `Deadline in ${daysUntilDeadline} days.`;
  if (kind === "deadline-overdue") return "Response required within 48 hours.";
  if (kind === "idle") return `${daysInactive} days without activity — please update us.`;
  if (kind === "interview-prep") {
    const when = daysUntilInterview <= 1 ? "tomorrow" : `in ${daysUntilInterview} days`;
    return `Your interview is ${when}. Prep checklist inside.`;
  }
  if (kind === "interview-followup") return "Check off Interview Complete and start drafting while it's fresh.";
  if (kind === "proposal-no-schedule") return `${daysSinceApproval} days since approval — let us know where you're at.`;
  if (kind === "interview-not-scheduled") return `Contact deadline passed ${daysSinceContactDeadline} days ago — update the tracker or pivot.`;
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
        <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:13px;">Open the tracker</a>
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

// Sent to the writer the moment an admin approves their proposal.
// Congratulates them, tells them next steps (schedule the interview or reach
// out to Aidan and Yair), and gives tips on reaching out to their source.
export function proposalApprovedEmail({ project, author, siteUrl }) {
  const firstName = (author?.name || project.authorName || "there").split(/\s+/)[0];
  const projectTitle = project.title || "(untitled story)";
  const projectUrl = `${siteUrl}/admin/#/pipeline/mine`;
  const isInterview = (project.type || "Interview") === "Interview";

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "Type", value: project.type || "Interview" },
      { label: "Status", value: "Proposal approved — time to get to work" },
    ],
    tone: "info",
  });

  const nextStepsHtml = isInterview ? `
    <div style="margin:22px 0 0 0;">
      <div style="font-size:13px;font-weight:600;color:${COLORS.ink};margin-bottom:14px;letter-spacing:-0.01em;">Your next steps</div>

      <div style="padding:16px 18px;background:#fafafa;border:1px solid ${COLORS.hairline};border-radius:10px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:${COLORS.muted};text-transform:uppercase;margin-bottom:10px;">Reaching out to your source</div>
        <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.65;color:${COLORS.inkSoft};">
          <li style="margin:0 0 6px 0;">Email them through their official university or department address — not social media. Keep it short, respectful, and specific about who you are and what you're writing about.</li>
          <li style="margin:0 0 6px 0;">Mention that you write for <em>The Catalyst Magazine</em> — a STEM publication — and briefly explain your angle so they understand why you want to speak to them specifically.</li>
          <li style="margin:0 0 6px 0;">Suggest 2–3 concrete time slots that work for you. Make it easy for them to say yes.</li>
          <li style="margin:0 0 6px 0;">If you don't hear back within a week, follow up once. A short, polite nudge is professional — not pushy.</li>
        </ul>
      </div>

      <div style="padding:16px 18px;background:#fafafa;border:1px solid ${COLORS.hairline};border-radius:10px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:${COLORS.muted};text-transform:uppercase;margin-bottom:10px;">Before the interview</div>
        <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.65;color:${COLORS.inkSoft};">
          <li style="margin:0 0 6px 0;">Read their recent published work — at least one paper and anything public-facing like a talk or interview. Know what they've already said so you can push past it.</li>
          <li style="margin:0 0 6px 0;">Prepare 8–10 focused, open-ended questions. The goal is a conversation, not a Q&amp;A form.</li>
          <li style="margin:0 0 6px 0;">Test your recording setup the day before. A failed recording is not recoverable — always have a backup.</li>
          <li style="margin:0 0 6px 0;">You're representing The Catalyst Magazine. Be on time, be professional, and treat the interview like the serious journalistic work it is.</li>
        </ul>
      </div>

      <div style="padding:14px 18px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
        <div style="font-size:14px;line-height:1.6;color:#1e3a8a;">
          <strong>Don't have a source lined up yet?</strong> That's okay — reach out to Aidan and Yair before you do anything else. Text us and we'll work through the sourcing together. Don't try to figure it out alone.
        </div>
      </div>
    </div>
  ` : `
    <div style="margin:22px 0 0 0;padding:14px 18px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
      <div style="font-size:14px;line-height:1.6;color:#1e3a8a;">
        Head to the tracker, open your story, and start writing. If you have any questions about structure, angle, or anything else — reach out to Aidan and Yair. That's what we're here for.
      </div>
    </div>
  `;

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      Your proposal was approved — congratulations!
    </p>

    ${statusBlock}

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      We loved the idea and we're excited to see where you take it. Now it's time to get moving.${isInterview ? " Your first job is to lock in an interview with your source." : ""}
    </p>

    ${nextStepsHtml}

    <p style="margin:22px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      Any questions at all — about the source, the angle, the writing, anything — just ask us. We mean that. Reply to this email or text Aidan and Yair directly.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open your story</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Really excited about this one,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = `Your proposal was approved: "${truncate(projectTitle, 45)}"`;
  const preheader = isInterview
    ? "Congratulations! Time to reach out to your source and lock in the interview."
    : "Congratulations! Head to the tracker and start writing.";
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

// Sent to the author the moment an admin/editor publishes their story. CC'd to
// the admins (handled by the caller) so the team has a record of every send.
// `articleUrl` is the full public link to the live article.
export function articlePublishedEmail({ title, authorName, articleUrl, category, siteUrl }) {
  const firstName = String(authorName || "there").trim().split(/\s+/)[0] || "there";
  const storyTitle = title || "(untitled story)";

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: storyTitle },
      { label: "Category", value: category || "Feature" },
      { label: "Status", value: "Approved & published — it's live" },
    ],
    tone: "info",
  });

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      Congratulations — your story has been approved and published!
    </p>

    ${statusBlock}

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      Your piece is now live on The Catalyst Magazine for the world to read. Thank you for
      all the work you put into it — we're proud to have it on the site.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(articleUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Read your published article</a>
    </div>

    <p style="margin:18px 0 0 0;font-size:13px;line-height:1.6;color:${COLORS.muted};">
      Direct link: <a href="${escapeAttr(articleUrl)}" style="color:${COLORS.inkSoft};">${escapeHtml(articleUrl)}</a>
    </p>

    <p style="margin:22px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      Share it widely — and if you spot anything that needs a fix, just reply to this email
      and we'll take care of it.
    </p>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Congratulations again,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = `Published: "${truncate(storyTitle, 45)}" is now live 🎉`;
  const preheader = "Congratulations! Your story has been approved and published — read it here.";
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

// Sent to admins after a writer or editor makes activity on a project — a
// timeline step toggle, draft submit, etc. Coalesces multiple activities that
// happened in a short window (server-side 45s cooldown queue) into one email,
// and shows on-track / behind status computed from project.deadlines.
//
// `activities`: ordered array of { text, actorName, timestamp, kind }
// `health`: { state: "on-track"|"behind"|"unknown", note: string }
export function adminActivityUpdateEmail({ project, actor, activities, health, siteUrl }) {
  const projectTitle = project.title || "(untitled story)";
  const actorName = actor?.name || actor?.email || "Someone";
  const actorRole = actor?.role || project.actorRole || "team member";
  const projectUrl = `${siteUrl}/admin/#/pipeline/all`;

  const tone = health?.state === "behind" ? "overdue" : health?.state === "on-track" ? "info" : "alert";
  const statusLabel =
    health?.state === "behind" ? "Behind schedule" :
    health?.state === "on-track" ? "On track" :
    "No deadline set";

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "Actor", value: `${actorName} (${actorRole})` },
      { label: "Status", value: health?.note ? `${statusLabel} — ${health.note}` : statusLabel },
      project.deadlines?.publication || project.deadline
        ? { label: "Publication", value: fmtDate(project.deadlines?.publication || project.deadline) }
        : null,
    ].filter(Boolean),
    tone,
  });

  const itemsHtml = (activities || []).map((a) => {
    const when = a.timestamp ? fmtTime(a.timestamp) : "";
    return `
      <li style="margin:0 0 8px 0;padding:0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
        <span style="color:${COLORS.ink};font-weight:600;">${escapeHtml(a.text || "(activity)")}</span>
        ${when ? `<span style="color:${COLORS.muted};font-size:12px;"> — ${escapeHtml(when)}</span>` : ""}
      </li>
    `;
  }).join("");

  const headline = activities.length === 1
    ? `${actorName} just updated "${truncate(projectTitle, 50)}"`
    : `${actorName} made ${activities.length} updates on "${truncate(projectTitle, 50)}"`;

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi team,
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      ${escapeHtml(headline)}
    </p>

    ${statusBlock}

    <div style="margin:0 0 18px 0;border:1px solid ${COLORS.hairline};border-radius:6px;padding:14px 16px;background:#fafafa;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.22em;color:${COLORS.muted};text-transform:uppercase;margin-bottom:10px;">What changed</div>
      <ul style="margin:0;padding-left:18px;">${itemsHtml}</ul>
    </div>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open the tracker</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = activities.length === 1
    ? `Update on "${truncate(projectTitle, 45)}" — ${statusLabel}`
    : `${activities.length} updates on "${truncate(projectTitle, 40)}" — ${statusLabel}`;
  const preheader = `${actorName}: ${truncate(activities.map(a => a.text).join(" · "), 110)}`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

function fmtTime(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Daily nudge to admins about a single unresolved admin task. One email per
// task per cycle — sent every 3 days (3, 6, 9, 12...) until the underlying
// state changes (e.g. proposal approved, editor assigned, deadline request
// resolved). Per-flag copy tells admins what specifically they need to do.
//
// `task`: { projectId, title, writerName, flag: { kind, days? }, ageDays }
export function adminTaskReminderEmail({ task, siteUrl }) {
  const projectTitle = task.title || "(untitled story)";
  const projectUrl = `${siteUrl}/admin/#/pipeline/all`;
  const writerName = task.writerName || "Unknown writer";
  const ageDays = task.ageDays;
  const flag = task.flag || {};

  const copy = adminTaskCopy(flag.kind);
  const ageNote = ageDays != null
    ? `This has been waiting ${ageDays} day${ageDays === 1 ? "" : "s"}.`
    : "This has been waiting a few days.";

  const tone = ageDays != null && ageDays >= 7 ? "overdue" : "alert";
  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "Writer", value: writerName },
      { label: "Waiting on", value: copy.shortLabel },
      ageDays != null ? { label: "Age", value: `${ageDays} day${ageDays === 1 ? "" : "s"}` } : null,
    ].filter(Boolean),
    tone,
  });

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi team,
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      ${escapeHtml(copy.headline)}
    </p>

    ${statusBlock}

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      ${escapeHtml(copy.bodyLine)} ${escapeHtml(ageNote)}
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">${escapeHtml(copy.cta)}</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = ageDays != null
    ? `${copy.subjectPrefix} (${ageDays}d): "${truncate(projectTitle, 45)}"`
    : `${copy.subjectPrefix}: "${truncate(projectTitle, 45)}"`;
  const preheader = `${copy.shortLabel} — ${writerName} · ${projectTitle}`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

function adminTaskCopy(kind) {
  if (kind === "proposal-pending") {
    return {
      headline: "A proposal is still waiting for review.",
      shortLabel: "Proposal review",
      bodyLine: "The writer can't move on until you approve or reject the proposal.",
      cta: "Review proposal",
      subjectPrefix: "Reminder — proposal needs review",
    };
  }
  if (kind === "needs-editor") {
    return {
      headline: "A finished draft is still waiting on an editor.",
      shortLabel: "Assign editor",
      bodyLine: "The writer marked their article complete but no editor is assigned, so the review clock hasn't started.",
      cta: "Assign an editor",
      subjectPrefix: "Reminder — draft needs an editor",
    };
  }
  if (kind === "deadline-request-pending") {
    return {
      headline: "A deadline-change request is still open.",
      shortLabel: "Deadline request",
      bodyLine: "The writer asked for one or more deadline changes and needs an approve/reject decision so they know where they stand.",
      cta: "Review request",
      subjectPrefix: "Reminder — deadline change pending",
    };
  }
  return {
    headline: "An admin action is overdue.",
    shortLabel: kind || "Action needed",
    bodyLine: "The project needs an admin to take action before the writer can continue.",
    cta: "Open the tracker",
    subjectPrefix: "Reminder — admin action needed",
  };
}

// Sent to the editor the moment they're assigned to a story.
export function editorAssignedEmail({ project, editor, author, siteUrl }) {
  const firstName = (editor.name || editor.email || "there").split(/\s+/)[0];
  const projectTitle = project.title || "(untitled story)";
  const authorName = author?.name || project.authorName || "the writer";
  const projectUrl = `${siteUrl}/admin/#/pipeline/mine`;
  const deadline = project.deadlines?.publication || project.deadline || null;
  // The dashboard auto-sets deadlines.review to assignedAt + 7 days at the
  // moment of assignment. Surface that here so the editor knows their clock
  // started and when the review is due.
  const reviewDeadline = project.deadlines?.review || null;

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "Type", value: project.type || "—" },
      { label: "Writer", value: authorName },
      reviewDeadline ? { label: "Your review is due", value: fmtDate(reviewDeadline) } : null,
      deadline ? { label: "Publication deadline", value: fmtDate(deadline) } : null,
    ].filter(Boolean),
    tone: "info",
  });

  const reviewLine = reviewDeadline
    ? `You have one week to review — your edits are due by <strong>${escapeHtml(fmtDate(reviewDeadline))}</strong>.`
    : `You have about a week to review and leave feedback.`;

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      You've been assigned to edit a story.
    </p>

    ${statusBlock}

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      You're the editor for "${escapeHtml(projectTitle)}" by ${escapeHtml(authorName)}. The draft is on the tracker — please open it, read through, and leave your edits and comments.
    </p>
    <p style="margin:14px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      ${reviewLine} When you're done, tick <strong>Review Complete</strong> so ${escapeHtml(authorName.split(/\s+/)[0])} knows to look at your feedback. If you can't make that timeline, reply to this email and we'll work it out.
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
  const preheader = reviewDeadline
    ? `New editing assignment — review due ${fmtDate(reviewDeadline)}.`
    : `New editing assignment from The Catalyst.`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

// ─── Review complete → notify the writer ────────────────────────────────────
//
// Fired the moment an editor checks "Review Complete" on the tracker. The
// writer gets one week (deadlines.edits = completedAt + 7d, set by
// auto-deadlines) to read through the edits and tick "Suggestions Reviewed".

export function writerReviewCompleteEmail({ project, author, editor, siteUrl }) {
  const firstName = (author?.name || project.authorName || "there").split(/\s+/)[0];
  const editorName = editor?.name || project.editorName || "Your editor";
  const editorFirst = editorName.split(/\s+/)[0];
  const projectTitle = project.title || "(untitled story)";
  const projectUrl = `${siteUrl}/admin/#/pipeline/mine`;
  const editsDeadline = project.deadlines?.edits || null;
  const pubDeadline = project.deadlines?.publication || project.deadline || null;

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "Editor", value: editorName },
      editsDeadline ? { label: "Address edits by", value: fmtDate(editsDeadline) } : null,
      pubDeadline ? { label: "Publication deadline", value: fmtDate(pubDeadline) } : null,
    ].filter(Boolean),
    tone: "info",
  });

  const dueLine = editsDeadline
    ? `You have one week — please address ${escapeHtml(editorFirst)}'s feedback by <strong>${escapeHtml(fmtDate(editsDeadline))}</strong>.`
    : `You have about a week to read through and address the feedback.`;

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      Your review is complete — ${escapeHtml(editorFirst)} has left their notes.
    </p>

    ${statusBlock}

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      ${escapeHtml(editorName)} just finished editing "${escapeHtml(projectTitle)}" and left their comments and suggestions on your draft. Open the tracker, read through every comment carefully, and work each suggestion into the piece.
    </p>
    <p style="margin:14px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      ${dueLine} Don't just accept everything blindly — if there's a note you disagree with, leave a reply explaining your reasoning. Editing is a conversation. The goal is the strongest possible final draft, not just the fastest path to "done."
    </p>
    <p style="margin:14px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      Once you've worked through everything and the piece is ready, tick <strong>Suggestions Reviewed</strong> on the tracker. If anything in the feedback is unclear, reply to ${escapeHtml(editorFirst)} directly in the activity feed — or to this email — and we'll sort it out.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open the tracker</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = `Edits ready on "${truncate(projectTitle, 50)}" — your turn`;
  const preheader = editsDeadline
    ? `${editorName} finished editing — please address by ${fmtDate(editsDeadline)}.`
    : `${editorName} finished editing — please address the feedback.`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

// ─── Date-change requests (writer ↔ admin) ──────────────────────────────────
//
// Writers can ask for any of their dates to move (publication, interview,
// draft, etc.). The dashboard writes a `deadlineChangeRequest` doc and fires
// `deadline-change-requested` so admins get this email immediately. When the
// admin approves or rejects, `deadline-change-resolved` fires the writer
// email below.

export function adminDeadlineChangeRequestedEmail({ project, author, request, siteUrl }) {
  const projectTitle = project.title || "(untitled story)";
  const authorName = author?.name || project.authorName || request?.requestedBy || "Unknown writer";
  const projectUrl = `${siteUrl}/admin/#/pipeline/all`;
  const reason = String(request?.reason || "(no reason provided)").trim();

  // The dashboard precomputes `changesSummary` as an array of human-readable
  // diffs ("Publication: Jan 1 → Jan 8"). If that's missing — older clients,
  // direct API calls — fall back to rendering the raw requestedDeadlines map.
  let changesHtml;
  if (Array.isArray(request?.changesSummary) && request.changesSummary.length) {
    changesHtml = request.changesSummary
      .map((line) => `<li style="margin:0 0 6px 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">${escapeHtml(line)}</li>`)
      .join("");
  } else {
    const labelMap = {
      publication: "Publication",
      contact: "Contact Professor",
      interview: "Interview",
      draft: "Draft",
      review: "Editor Review",
      edits: "Review Edits",
    };
    const items = Object.entries(request?.requestedDeadlines || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `<li style="margin:0 0 6px 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};"><strong>${escapeHtml(labelMap[k] || k)}:</strong> ${escapeHtml(fmtDate(v))}</li>`);
    changesHtml = items.length ? items.join("") : `<li style="margin:0;font-size:14px;color:${COLORS.muted};">(no specific dates listed)</li>`;
  }

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "Type", value: project.type || "—" },
      { label: "Writer", value: authorName },
      { label: "Current deadline", value: project.deadline ? fmtDate(project.deadline) : "—" },
    ],
    tone: "alert",
  });

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi team,
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      ${escapeHtml(authorName.split(/\s+/)[0])} has requested a date change.
    </p>

    ${statusBlock}

    <div style="margin:0 0 18px 0;border:1px solid ${COLORS.hairline};border-radius:6px;padding:14px 16px;background:#fafafa;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.22em;color:${COLORS.muted};text-transform:uppercase;margin-bottom:10px;">Requested changes</div>
      <ul style="margin:0;padding-left:18px;">${changesHtml}</ul>
    </div>

    <div style="margin:0 0 18px 0;border:1px solid ${COLORS.hairline};border-radius:6px;padding:14px 16px;background:#fafafa;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.22em;color:${COLORS.muted};text-transform:uppercase;margin-bottom:8px;">Reason</div>
      <div style="font-size:14px;line-height:1.6;color:${COLORS.inkSoft};white-space:pre-wrap;">${escapeHtml(reason)}</div>
    </div>

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      Open the project on the tracker to approve or reject this request.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Review request</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = `Date change requested: "${truncate(projectTitle, 50)}"`;
  const preheader = `${authorName} asked to move one or more dates. Approve or reject on the tracker.`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

export function writerDeadlineChangeResolvedEmail({ project, author, outcome, request, siteUrl }) {
  const firstName = (author?.name || project.authorName || "there").split(/\s+/)[0];
  const projectTitle = project.title || "(untitled story)";
  const projectUrl = `${siteUrl}/admin/#/pipeline/mine`;
  const wasApproved = outcome === "approved";

  const headline = wasApproved
    ? "Your date change was approved."
    : outcome === "rejected"
      ? "Your date change wasn't approved."
      : "Your date change request was reviewed.";

  const tone = wasApproved ? "info" : "alert";
  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "Outcome", value: wasApproved ? "Approved — dates updated" : (outcome === "rejected" ? "Rejected — dates unchanged" : "Reviewed") },
      { label: "Current deadline", value: project.deadline ? fmtDate(project.deadline) : "—" },
    ],
    tone,
  });

  // Same diff list we sent the admins, so the writer can confirm what was
  // actually applied (or what they had asked for, in the rejection case).
  let changesHtml = "";
  if (Array.isArray(request?.changesSummary) && request.changesSummary.length) {
    const items = request.changesSummary
      .map((line) => `<li style="margin:0 0 6px 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">${escapeHtml(line)}</li>`)
      .join("");
    changesHtml = `
      <div style="margin:0 0 18px 0;border:1px solid ${COLORS.hairline};border-radius:6px;padding:14px 16px;background:#fafafa;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.22em;color:${COLORS.muted};text-transform:uppercase;margin-bottom:10px;">${wasApproved ? "Updated dates" : "Dates you requested"}</div>
        <ul style="margin:0;padding-left:18px;">${items}</ul>
      </div>
    `;
  }

  const followUp = wasApproved
    ? `Your timeline has been updated in the dashboard. No further action needed.`
    : outcome === "rejected"
      ? `Your existing dates remain in place. Reach out to Aidan or Yair if you'd like to discuss — sometimes the answer is "yes, but with a different timeline."`
      : `Open the project to see the latest state.`;

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      ${escapeHtml(headline)}
    </p>

    ${statusBlock}

    ${changesHtml}

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">${escapeHtml(followUp)}</p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open project</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = wasApproved
    ? `Date change approved: "${truncate(projectTitle, 50)}"`
    : outcome === "rejected"
      ? `Date change not approved: "${truncate(projectTitle, 50)}"`
      : `Date change reviewed: "${truncate(projectTitle, 50)}"`;
  const preheader = wasApproved
    ? `Your dates have been updated.`
    : `Your existing dates remain in place.`;
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
  if (kind === "editor-review-overdue") {
    // Fired 7+ days after the editor was assigned, when "Review Complete"
    // still isn't ticked. Tone is firm but not hostile — the goal is to get
    // the draft moving, not to scold.
    const dText = daysSinceAssigned == null
      ? "more than a week"
      : `${daysSinceAssigned} day${daysSinceAssigned === 1 ? "" : "s"}`;
    const reviewDeadline = project?.deadlines?.review || null;
    headline = `Your editor review is past due.`;
    paragraphs = [
      `You were assigned to edit "${projectTitle}" ${dText} ago, and "Review Complete" still isn't checked off on the tracker. ${authorName} is waiting on your notes before they can move the piece forward.`,
      `Please open the draft today, leave your edits and comments, and tick "Review Complete" when you're done. If you need a deadline extension or you're blocked on something specific, reply to this email so we can sort it out.`,
      `If you can't take this assignment anymore, that's fine — just let us know and we'll reassign it. The worst outcome is silence; the writer's work stalls and the publication date slips.`,
    ];
    statusRows = [
      { label: "Story", value: projectTitle },
      { label: "Writer", value: authorName },
      { label: "Assigned", value: `${dText} ago` },
      reviewDeadline ? { label: "Review deadline", value: fmtDate(reviewDeadline) } : null,
      deadline ? { label: "Publication deadline", value: fmtDate(deadline) } : null,
    ].filter(Boolean);
    statusTone = "overdue";
  } else if (kind === "editor-idle") {
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

  let subject, preheader;
  if (kind === "editor-review-overdue") {
    const dText = daysSinceAssigned == null ? "1+ week" : `${daysSinceAssigned}d`;
    subject = `Editor review past due (${dText}): "${truncate(projectTitle, 40)}"`;
    preheader = `Assigned ${daysSinceAssigned == null ? "over a week" : `${daysSinceAssigned} days`} ago — Review Complete still not checked.`;
  } else if (kind === "editor-idle") {
    subject = `${daysInactive}d no activity (editor): "${truncate(projectTitle, 40)}"`;
    preheader = `${daysInactive} days of editor inactivity. Please review.`;
  } else {
    subject = `Edit due soon: "${truncate(projectTitle, 50)}"`;
    preheader = `Editor review needed before deadline.`;
  }
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
      Open the tracker to update each story. Reply to this email if anything's blocking you.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open the tracker</a>
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
  const preheader = `${count} item${count === 1 ? "" : "s"} from The Catalyst editorial tracker.`;
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
  if (item.kind === "proposal-no-schedule") {
    return `Proposal approved ${item.daysSinceApproval || 5}+ days ago — interview not yet scheduled`;
  }
  if (item.kind === "interview-not-scheduled") {
    const d = item.daysSinceContactDeadline || 10;
    return `Contact deadline passed ${d}+ days ago — update tracker or pivot to a new source`;
  }
  if (item.kind === "editor-idle") return `Editor: ${item.daysInactive} days idle, awaiting your review`;
  if (item.kind === "editor-deadline-soon") return `Editor: deadline approaching`;
  if (item.kind === "editor-review-overdue") {
    const d = item.daysSinceAssigned || 7;
    return `Editor: ${d}+ days since assignment, "Review Complete" not yet checked`;
  }
  return item.kind;
}

// ─── Direct comment (project chat → email) ──────────────────────────────────
// Sent to a teammate when someone posts a comment addressed to them on a
// project — e.g. the social media team asking the author a question from the
// Planner. The comment also lives in the project's activity chat; this email
// is the "you have a message" copy so nothing gets missed.
export function directCommentEmail({ project, senderName, senderRole, message, recipientName, siteUrl }) {
  const projectTitle = project.title || "(untitled story)";
  const firstName = String(recipientName || "there").trim().split(/\s+/)[0] || "there";
  const fromName = senderName || "A teammate";
  const roleLine = senderRole ? ` (${senderRole})` : "";
  const projectUrl = `${siteUrl}/admin/#/pipeline/mine`;

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: projectTitle },
      { label: "From", value: `${fromName}${roleLine}` },
      project.deadlines?.publication
        ? { label: "Publication", value: fmtDate(project.deadlines.publication) }
        : null,
    ].filter(Boolean),
    tone: "info",
  });

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      ${escapeHtml(fromName)} left you a comment on "${escapeHtml(projectTitle)}."
    </p>

    ${statusBlock}

    <div style="margin:18px 0 0 0;border-left:3px solid ${COLORS.hairline};padding:4px 0 4px 16px;">
      <p style="margin:0;font-size:15px;line-height:1.65;color:${COLORS.inkSoft};white-space:pre-wrap;">${escapeHtml(message)}</p>
    </div>

    <p style="margin:18px 0 0 0;font-size:14px;line-height:1.6;color:${COLORS.muted};">
      This message is also saved in the story's comment feed. You can reply
      there from your dashboard — or reply to this email to reach
      ${escapeHtml(fromName)} directly.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(projectUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open the story &amp; reply</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">The Catalyst dashboard</span>
    </p>
  `;

  const subject = `${truncate(fromName, 30)} commented on "${truncate(projectTitle, 40)}"`;
  const preheader = truncate(message, 90);
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

// ─── Social team publish alert ───────────────────────────────────────────────
// Sent to every social_media user the moment a story is published, so they
// can get the announcement posts out while the piece is fresh.
export function socialPublishedEmail({ title, authorName, articleUrl, category, siteUrl }) {
  const storyTitle = title || "(untitled story)";
  const plannerUrl = `${siteUrl}/admin/#/planner`;

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Story", value: storyTitle },
      { label: "Author", value: authorName || "—" },
      { label: "Category", value: category || "Feature" },
      { label: "Status", value: "Just published — live now" },
    ],
    tone: "alert",
  });

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi team,
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      A story just went live — time to share it.
    </p>

    ${statusBlock}

    <p style="margin:0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      "${escapeHtml(storyTitle)}" by ${escapeHtml(authorName || "the Catalyst team")} is now
      on the site. The first 24&ndash;48 hours matter most for reach — draft the
      announcement post, tag the author, and schedule it for LinkedIn and Instagram.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(articleUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;margin-right:10px;">Read the article</a>
      <a href="${escapeAttr(plannerUrl)}" style="display:inline-block;background:#ffffff;color:${COLORS.ink};text-decoration:none;padding:10px 22px;border-radius:6px;font-weight:600;font-size:14px;border:1px solid ${COLORS.hairline};">Open the Planner</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">The Catalyst dashboard</span>
    </p>
  `;

  const subject = `Just published: "${truncate(storyTitle, 45)}" — ready to share`;
  const preheader = "A new story is live. Draft the social posts while it's fresh.";
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
}

// ─── Social post assignment ──────────────────────────────────────────────────
// Sent to the assignee when an admin (or a granted user, e.g. the marketing
// lead) assigns them a social post for a specific article with a deadline.
export function socialAssignmentEmail({ assignment, assignerName, siteUrl }) {
  const articleTitle = assignment.articleTitle || "(untitled article)";
  const firstName = String(assignment.assigneeName || "there").trim().split(/\s+/)[0] || "there";
  const plannerUrl = `${siteUrl}/admin/#/planner`;

  const statusBlock = buildStatusBlock({
    rows: [
      { label: "Article", value: articleTitle },
      assignment.platform && assignment.platform !== "any"
        ? { label: "Platform", value: assignment.platform }
        : { label: "Platform", value: "Your call (any)" },
      { label: "Due", value: fmtDate(assignment.deadline) },
      { label: "Assigned by", value: assignerName || "—" },
    ].filter(Boolean),
    tone: "alert",
  });

  const body = `
    <p style="margin:0 0 4px 0;font-size:15px;line-height:1.5;color:${COLORS.ink};">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="margin:14px 0 0 0;font-size:17px;line-height:1.4;color:${COLORS.ink};font-weight:600;letter-spacing:-0.01em;">
      You've been assigned a social post.
    </p>

    ${statusBlock}

    ${assignment.notes ? `
    <div style="margin:18px 0 0 0;border-left:3px solid ${COLORS.hairline};padding:4px 0 4px 16px;">
      <p style="margin:0;font-size:14px;line-height:1.65;color:${COLORS.inkSoft};white-space:pre-wrap;">${escapeHtml(assignment.notes)}</p>
    </div>` : ""}

    <p style="margin:18px 0 0 0;font-size:14px;line-height:1.6;color:${COLORS.muted};">
      The Planner has the story's details, the proposal, and a direct line to the
      writer if you have questions. Mark the assignment done there when the post ships.
    </p>

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(plannerUrl)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open the Planner</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">The Catalyst dashboard</span>
    </p>
  `;

  const subject = `Social post assignment: "${truncate(articleTitle, 42)}" — due ${fmtDate(assignment.deadline)}`;
  const preheader = `${assignerName || "The team"} assigned you a post for "${truncate(articleTitle, 50)}".`;
  return { subject, html: shell({ title: subject, preheader, body, siteUrl }) };
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
