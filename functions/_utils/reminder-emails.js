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
                The Catalyst Magazine &middot; Automated editorial note. Reply to reach the editors.
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

export function writerReminderEmail({ kind, writer, project, deadline, daysUntilDeadline, daysInactive, siteUrl }) {
  const firstName = (writer.name || writer.email || "there").split(/\s+/)[0];
  const projectTitle = project.title || "(untitled story)";
  const projectUrl = `${siteUrl}/admin/#/pipeline/mine`;

  let headline, paragraphs, statusRows, statusTone, cta;

  if (kind === "deadline-3d" || kind === "deadline-1d") {
    const dText = daysUntilDeadline <= 0
      ? "today"
      : daysUntilDeadline === 1
        ? "tomorrow"
        : `in ${daysUntilDeadline} days`;
    headline = `Your story is due ${dText}.`;
    paragraphs = [
      `This is a reminder that the publication deadline for "${projectTitle}" is ${dText}. Please make sure your draft is submitted on time.`,
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

    <div style="margin:22px 0 0 0;">
      <a href="${escapeAttr(cta.url)}" style="display:inline-block;background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">${escapeHtml(cta.text)}</a>
    </div>

    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:${COLORS.inkSoft};">
      Thanks,<br>
      <span style="color:${COLORS.ink};font-weight:600;">Aidan and Yair</span><br>
      <span style="color:${COLORS.muted};">The Catalyst Magazine</span>
    </p>
  `;

  const subject = subjectForWriterReminder({ kind, projectTitle, daysUntilDeadline, daysInactive });
  const preheader = preheaderForWriterReminder({ kind, projectTitle, daysUntilDeadline, daysInactive });
  return {
    subject,
    html: shell({ title: subject, preheader, body, siteUrl }),
  };
}

function subjectForWriterReminder({ kind, projectTitle, daysUntilDeadline, daysInactive }) {
  const t = truncate(projectTitle, 40);
  if (kind === "deadline-1d") return `Due tomorrow: "${t}"`;
  if (kind === "deadline-3d") return `Due in ${daysUntilDeadline} days: "${t}"`;
  if (kind === "deadline-overdue") {
    const d = Math.abs(daysUntilDeadline);
    return `Past due (${d}d): "${t}" — response needed`;
  }
  if (kind === "idle") return `${daysInactive}d no activity: "${t}"`;
  return `Catalyst: update on "${t}"`;
}

function preheaderForWriterReminder({ kind, daysUntilDeadline, daysInactive }) {
  if (kind === "deadline-1d") return "Deadline tomorrow. Please submit on time.";
  if (kind === "deadline-3d") return `Deadline in ${daysUntilDeadline} days.`;
  if (kind === "deadline-overdue") return "Response required within 48 hours.";
  if (kind === "idle") return `${daysInactive} days without activity — please update us.`;
  return "Update from The Catalyst editorial team.";
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

export function adminDigestEmail({ rows, now, siteUrl }) {
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const totalProjects = rows.reduce((n, r) => n + r.projects.length, 0);
  const flaggedWriters = rows.filter((r) => r.projects.some((p) => p.flags.length)).length;
  const flaggedProjects = rows.reduce((n, r) => n + r.projects.filter((p) => p.flags.length).length, 0);

  const writerBlocks = rows.map((row) => renderWriterBlock(row, siteUrl)).join("");

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
      </tr>
    </table>

    <div style="margin:32px 0 0 0;">
      ${writerBlocks || `<p style="color:${COLORS.muted};font-size:15px;">No active projects. Nice empty desk.</p>`}
    </div>

    <p style="margin:40px 0 0 0;font-size:14px;line-height:1.6;color:${COLORS.muted};">
      Generated automatically every Saturday by the Catalyst editorial bot. To stop these, ask an admin to disable the cron trigger.
    </p>
  `;

  const subject = `Catalyst editorial briefing — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${flaggedWriters} writer${flaggedWriters === 1 ? "" : "s"} to nudge)`;
  const preheader = flaggedProjects
    ? `${flaggedProjects} stor${flaggedProjects === 1 ? "y" : "ies"} need attention. Copy-paste messages inside.`
    : `All ${totalProjects} stor${totalProjects === 1 ? "y is" : "ies are"} on track.`;

  return {
    subject,
    html: shell({ title: subject, preheader, body, siteUrl }),
  };
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
