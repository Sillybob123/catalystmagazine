// functions/_utils/task-emails.js
//
// Email templates for the editorial task system. Three trigger points:
//   1. taskAssignedEmail        — fires the moment a task is assigned.
//   2. taskDeadlineSoonEmail    — fires N days before deadline (the cron
//      decides which day(s) to fire based on task.priority).
//   3. taskDeadlineTodayEmail   — fires on the day of the deadline.
//
// Voice: written as if Yair and Aidan are pinging the assignee directly.
// First-person plural, low ceremony, no marketing chrome. The footer
// signs as "Yair & Aidan · The Catalyst" with a real "reply to me" line
// — no robot phrasing, no "Catalyst editorial bot" attribution. The
// emails should feel like a teammate sent them, even though the cron
// fires them automatically. Keeping the visible accent bar + meta table
// preserves the polished look without the "automated" feel.

const PRIORITY_LABEL = {
  urgent: "Urgent",
  high:   "High priority",
  medium: "Medium priority",
  low:    "Low priority",
};

// Editorial signers — keep in one constant so we can adjust the names
// in one place later. The reply-to address on the outbound email is
// already MAIL_REPLY_TO (stemcatalystmagazine@gmail.com), which Yair &
// Aidan both monitor.
const SIGNERS = "Yair & Aidan";

// ─── Public helpers ──────────────────────────────────────────────────────────

export function taskAssignedEmail({ assigneeName, task, siteUrl }) {
  const isUrgent = task.priority === "urgent";
  const isHigh   = task.priority === "high";
  const subject = isUrgent
    ? `[Urgent] New task for you — "${task.title}"`
    : `New task for you: "${task.title}"`;
  const headline = isUrgent
    ? `Quick one — we need this one moving fast.`
    : `Hey, we just put a new task on your plate.`;

  // First-person plural so it reads like a real teammate ping. The
  // creator name only goes in the meta table, not the body, because
  // most assignments are admin → writer and the writer already knows
  // who runs the magazine.
  const lines = [
    `We just assigned you "${task.title}" on the editorial dashboard.${
      task.deadline
        ? ` The deadline we put on it is ${fmtDate(task.deadline)} — we'll ping you again as we get close so it doesn't slip past you.`
        : " No deadline set yet — open it and tell us what timeline works."
    }`,
  ];
  if (task.description) {
    lines.push(`Here's the brief: ${task.description}`);
  }
  if (isUrgent) {
    lines.push(`Flagging this as urgent because it can't wait — if there's any chance you can't take it on, hit reply right now and we'll find someone else. Better to know now than three days in.`);
  } else if (isHigh) {
    lines.push(`This one's marked high-priority, so if you've already got a full plate, let us know now and we'll figure something out.`);
  } else {
    lines.push(`Open it when you get a chance. If something about the brief is unclear or the deadline doesn't work, just reply to this email — it goes straight to us.`);
  }

  const cta = { label: "Open the task", url: `${siteUrl}/admin/#/tasks` };
  const meta = [
    task.deadline ? { label: "Deadline", value: fmtDate(task.deadline) } : null,
    task.priority ? { label: "Priority", value: PRIORITY_LABEL[task.priority] || task.priority } : null,
    task.creatorName ? { label: "From", value: task.creatorName } : null,
  ].filter(Boolean);
  return {
    subject,
    text: textBody({ greeting: assigneeName, lines, cta, meta }),
    html: htmlBody({ greeting: assigneeName, headline, lines, cta, meta, accent: isUrgent ? "#b91c1c" : "#0f172a" }),
  };
}

// Generic "due in N days" reminder — same voice as the assigned email,
// just with the days-out injected so we can use this for the 3-day,
// 2-day, and 1-day windows the urgency-aware schedule fires.
export function taskDeadlineSoonEmail({ assigneeName, task, daysUntil, siteUrl }) {
  const isUrgent = task.priority === "urgent";
  const dayWord = daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
  const subject = `Heads up — "${task.title}" is due ${dayWord}`;

  // Different opening line for tomorrow vs further-out — a 1-day note
  // should feel sharper than a 3-day "fyi".
  const headline = daysUntil === 1
    ? `Quick reminder: this one's due tomorrow.`
    : `Just a heads up — your task is due in ${daysUntil} days.`;

  const lines = [];
  lines.push(
    daysUntil === 1
      ? `"${task.title}" is due tomorrow (${fmtDate(task.deadline)}). Wanted to make sure it's on your radar.`
      : `"${task.title}" is due ${dayWord} — ${fmtDate(task.deadline)}. Sending you this now so you've got runway.`
  );

  if (daysUntil === 1) {
    lines.push(
      `If you're on track, no action needed — just keep going. If you're not going to make it, reply to this email today rather than tomorrow morning. We'd much rather hear "I need a day" now than after the deadline.`
    );
  } else {
    lines.push(
      `If you're on track, ignore this — it's just a checkpoint so nothing surprises you. If something's blocking you (interview not scheduled, source not responding, conflict with another piece), reply now and we'll help unstick it.`
    );
  }
  if (isUrgent) {
    lines.push(`Flagging again that this one's urgent — please don't let it slide.`);
  }

  const cta = { label: "Open the task", url: `${siteUrl}/admin/#/tasks` };
  const meta = [
    { label: "Deadline", value: `${fmtDate(task.deadline)} (${daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`})` },
    task.priority ? { label: "Priority", value: PRIORITY_LABEL[task.priority] || task.priority } : null,
  ].filter(Boolean);
  return {
    subject,
    text: textBody({ greeting: assigneeName, lines, cta, meta }),
    html: htmlBody({
      greeting: assigneeName,
      headline,
      lines,
      cta,
      meta,
      // Color escalates as we approach the deadline: 3d=slate, 2d=amber,
      // 1d=red. Visual cue admins themselves rely on when scanning their
      // inbox.
      accent: daysUntil === 1 ? "#b91c1c" : daysUntil === 2 ? "#b45309" : "#0f172a",
    }),
  };
}

export function taskDeadlineTodayEmail({ assigneeName, task, siteUrl }) {
  const subject = `Today's the day — "${task.title}" is due`;
  const headline = `This one's due today.`;
  const lines = [
    `"${task.title}" is on today's deadline — ${fmtDate(task.deadline)}. Just confirming you're tracking it.`,
    `If it's already done, take 5 seconds and mark it complete in the dashboard so we can move it off the board. If you're not going to make it today, reply now — we'd much rather hear from you before the day ends than chase it down tomorrow morning.`,
  ];
  if (task.priority === "urgent") {
    lines.push(`This one was flagged urgent from the jump, so the deadline really matters here.`);
  }
  const cta = { label: "Mark this task complete", url: `${siteUrl}/admin/#/tasks` };
  const meta = [
    { label: "Deadline", value: `${fmtDate(task.deadline)} (today)` },
    task.priority ? { label: "Priority", value: PRIORITY_LABEL[task.priority] || task.priority } : null,
  ].filter(Boolean);
  return {
    subject,
    text: textBody({ greeting: assigneeName, lines, cta, meta }),
    html: htmlBody({ greeting: assigneeName, headline, lines, cta, meta, accent: "#b91c1c" }),
  };
}

// ─── Templating internals ────────────────────────────────────────────────────

// Plain-text body. Required for deliverability — Gmail/Outlook treat
// HTML-only mail as a spam signal. Mirrors htmlBody() structurally so
// the two renderings carry identical content. Signed off as the
// editors so it reads like a teammate wrote it, not a robot.
function textBody({ greeting, lines, cta, meta }) {
  const out = [];
  out.push(`Hi ${greeting || "there"},`);
  out.push("");
  for (const line of lines) {
    out.push(line);
    out.push("");
  }
  if (meta.length) {
    for (const m of meta) out.push(`${m.label}: ${m.value}`);
    out.push("");
  }
  if (cta) {
    out.push(cta.label + ":");
    out.push(cta.url);
    out.push("");
  }
  out.push("Thanks,");
  out.push(SIGNERS);
  out.push("The Catalyst");
  return out.join("\n");
}

function htmlBody({ greeting, headline, lines, cta, meta, accent }) {
  const accentBar = accent || "#0f172a";
  const linesHtml = lines
    .map(
      (l) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;">${esc(
          l
        )}</p>`
    )
    .join("");
  const metaHtml = meta.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:0 0 22px;background:#f5f5f7;border-radius:10px;">
         ${meta
           .map(
             (m) => `
           <tr>
             <td style="padding:8px 14px 8px 16px;font-size:12px;color:#6e6e73;font-weight:600;width:38%;letter-spacing:0.04em;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;">${esc(m.label)}</td>
             <td style="padding:8px 16px 8px 0;font-size:14px;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;">${esc(m.value)}</td>
           </tr>`
           )
           .join("")}
       </table>`
    : "";
  const ctaHtml = cta
    ? `<p style="margin:0 0 22px;">
         <a href="${escAttr(cta.url)}" style="display:inline-block;padding:12px 22px;background:${accentBar};color:#ffffff;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;letter-spacing:0.01em;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;">${esc(cta.label)} →</a>
       </p>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(headline)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;color:#1d1d1f;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:28px 12px 36px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e5e7;">
          <tr>
            <td style="height:4px;background:${accentBar};line-height:0;font-size:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#1d1d1f;">Hi ${esc(greeting || "there")},</p>
              <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;font-weight:700;color:#1d1d1f;letter-spacing:-0.01em;">${esc(headline)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 4px 32px;">
              ${linesHtml}
              ${metaHtml}
              ${ctaHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 8px 32px;">
              <p style="margin:0;font-size:14px;line-height:1.6;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;">
                Thanks,<br>
                <strong style="color:#1d1d1f;">${esc(SIGNERS)}</strong><br>
                <span style="color:#6e6e73;font-size:13px;">The Catalyst</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 32px 26px 32px;border-top:1px solid #e5e5e7;">
              <p style="margin:0;font-size:12px;color:#6e6e73;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;">
                Reply directly to this email — it lands in our inbox.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`;
}

// Format an ISO date (YYYY-MM-DD) or an ISO datetime as "Mon DD, YYYY".
// Tasks store deadlines as YYYY-MM-DD strings (no time component).
function fmtDate(iso) {
  if (!iso) return "—";
  const s = typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? `${iso}T00:00:00`
    : iso;
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(s) {
  return esc(s);
}
