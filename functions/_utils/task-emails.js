// functions/_utils/task-emails.js
//
// Email templates for the editorial task system. Three trigger points:
//   1. taskAssignedEmail        — fires the moment a task is assigned to
//      a writer (or when an admin approves a writer-proposed task).
//   2. taskDeadlineSoonEmail    — fires 2 calendar days before deadline.
//   3. taskDeadlineTodayEmail   — fires on the day of the deadline.
//
// Tone matches the existing writer-reminder emails (reminder-emails.js)
// — direct, editor-voice, no marketing fluff. All three are
// plain-text first; the HTML wrapper is the same minimal Apple-style
// envelope used elsewhere so emails feel consistent across the
// product.

const PRIORITY_LABEL = {
  urgent: "Urgent",
  high:   "High priority",
  medium: "Medium priority",
  low:    "Low priority",
};

// ─── Public helpers ──────────────────────────────────────────────────────────

export function taskAssignedEmail({ assigneeName, task, siteUrl }) {
  const subject = `New task assigned: "${task.title}"`;
  const headline = `You've been assigned a new task.`;
  const lines = [
    `${task.creatorName ? `${task.creatorName} just assigned you` : "You've just been assigned"} a new task on the editorial board: "${task.title}".`,
    task.description
      ? `Quick brief: ${task.description}`
      : `No extra description was attached — open the dashboard for the full context.`,
    task.deadline
      ? `The deadline is ${fmtDate(task.deadline)}. We'll send you a heads-up two days before the deadline and another note on the day itself, so you have built-in checkpoints.`
      : `No deadline is set on this task yet — feel free to reach out if you want to negotiate one.`,
  ];
  const cta = { label: "Open the task", url: `${siteUrl}/admin/#/tasks` };
  const meta = [
    task.deadline ? { label: "Deadline", value: fmtDate(task.deadline) } : null,
    task.priority ? { label: "Priority", value: PRIORITY_LABEL[task.priority] || task.priority } : null,
    task.creatorName ? { label: "Assigned by", value: task.creatorName } : null,
  ].filter(Boolean);
  return {
    subject,
    text: textBody({ greeting: assigneeName, headline, lines, cta, meta }),
    html: htmlBody({ greeting: assigneeName, headline, lines, cta, meta, accent: "#0f172a" }),
  };
}

export function taskDeadlineSoonEmail({ assigneeName, task, daysUntil, siteUrl }) {
  const subject = `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}: "${task.title}"`;
  const headline = `Your task is due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`;
  const lines = [
    `Just a heads-up: "${task.title}" is due on ${fmtDate(task.deadline)}.`,
    `If you're on track, ignore this — it's an automated nudge so nothing slips. If you're not, reply now so we can adjust together. Last-minute extension requests after the deadline don't land well.`,
  ];
  const cta = { label: "Open the task", url: `${siteUrl}/admin/#/tasks` };
  const meta = [
    { label: "Deadline", value: `${fmtDate(task.deadline)} (in ${daysUntil} day${daysUntil === 1 ? "" : "s"})` },
    task.priority ? { label: "Priority", value: PRIORITY_LABEL[task.priority] || task.priority } : null,
  ].filter(Boolean);
  return {
    subject,
    text: textBody({ greeting: assigneeName, headline, lines, cta, meta }),
    html: htmlBody({ greeting: assigneeName, headline, lines, cta, meta, accent: "#b45309" }),
  };
}

export function taskDeadlineTodayEmail({ assigneeName, task, siteUrl }) {
  const subject = `Due today: "${task.title}"`;
  const headline = `Your task is due today.`;
  const lines = [
    `Today's the day for "${task.title}". The deadline you agreed to is ${fmtDate(task.deadline)}.`,
    `If it's done, take 5 seconds and mark it complete in the dashboard so we can clear it from the board. If you're going to miss it, please reply now — we'd rather know before the day ends than chase you for it tomorrow.`,
  ];
  const cta = { label: "Mark this task complete", url: `${siteUrl}/admin/#/tasks` };
  const meta = [
    { label: "Deadline", value: `${fmtDate(task.deadline)} (today)` },
    task.priority ? { label: "Priority", value: PRIORITY_LABEL[task.priority] || task.priority } : null,
  ].filter(Boolean);
  return {
    subject,
    text: textBody({ greeting: assigneeName, headline, lines, cta, meta }),
    html: htmlBody({ greeting: assigneeName, headline, lines, cta, meta, accent: "#b91c1c" }),
  };
}

// ─── Templating internals ────────────────────────────────────────────────────

// Plain-text body. Required for deliverability — Gmail/Outlook treat
// HTML-only mail as a spam signal. Mirrors htmlBody() structurally so
// the two renderings carry identical content.
function textBody({ greeting, headline, lines, cta, meta }) {
  const out = [];
  out.push(`Hi ${greeting || "there"},`);
  out.push("");
  out.push(headline);
  out.push("=".repeat(Math.min(headline.length, 60)));
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
  out.push("— The Catalyst editorial bot");
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
            <td style="padding:14px 32px 26px 32px;border-top:1px solid #e5e5e7;">
              <p style="margin:0;font-size:12px;color:#6e6e73;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;">
                Sent by the Catalyst editorial bot. Reply to this email if you want to talk to the team — it goes straight to a real person.
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
