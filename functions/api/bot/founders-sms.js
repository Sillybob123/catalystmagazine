// POST /api/bot/founders-sms
//
// Sends a short, plain-text "founders update" to the CEOs as an SMS, every
// couple of days. Delivery is via email-to-SMS gateways (e.g. Verizon's
// number@vtext.com), using the same Resend sender the rest of the site uses —
// the carrier turns the email into a text on the phone.
//
// The message is deliberately tiny and skimmable on a lock screen:
//
//   Good Morning Awesome Founders!
//   Here are the catalyst updates:
//   • 2 proposals waiting on you
//   • Assign an editor to "…"
//   • Check on Yahav — "…" idle 16d
//   …
//
// It reuses the editorial bot's own signal computation (computeAdminDigest +
// computeAdminTasks) so the text says the same thing the Saturday email does,
// just compressed.
//
// PRIVACY: the founders' phone numbers (the vtext addresses) are NEVER in the
// source. They live only in the FOUNDERS_SMS_TO Cloudflare secret (a
// comma-separated list of gateway addresses). If it isn't set, this endpoint
// does nothing and says so — it never falls back to a hardcoded number.
//
// Auth: cron secret (x-cron-secret === FOUNDERS_SMS_SECRET) for the scheduled
// Worker, or an admin Firebase bearer token for manual "send me a test" runs.

import { json, serverError, unauthorized } from "../../_utils/http.js";
import { firestoreRunQuery } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { computeAdminDigest, computeAdminTasks } from "../../_utils/bot-logic.js";

// Carriers reject/garble very long texts and split them into multiple billed
// segments. Keep the whole body comfortably inside a few segments.
const MAX_SMS_CHARS = 600;
// How many of each kind of line to include before summarizing the rest.
const MAX_TASK_LINES = 4;
const MAX_CHECK_LINES = 4;

export const onRequestPost = async ({ request, env }) => {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const provided = request.headers.get("x-cron-secret") || "";
    let caller = null;
    if (provided && env.FOUNDERS_SMS_SECRET && provided === env.FOUNDERS_SMS_SECRET) {
      caller = "cron";
    } else {
      const auth = await requireRole(request, env, ["admin"]);
      if (auth instanceof Response) {
        return unauthorized("Founders SMS requires the cron secret or an admin token.");
      }
      caller = `admin:${auth.email || auth.uid}`;
    }

    let body = {};
    try { body = await request.json(); } catch { /* empty body is fine */ }
    const dryRun = !!body.dryRun;

    // ── Recipients (kept private — env only) ──────────────────────────────────
    // Comma- or whitespace-separated list of email-to-SMS gateway addresses,
    // e.g. "2405150910@vtext.com, 2019700096@vtext.com".
    const recipients = String(env.FOUNDERS_SMS_TO || "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const now = new Date();

    // ── Compute the signals ───────────────────────────────────────────────────
    const [projects, users] = await Promise.all([
      loadAll(env, "projects"),
      loadAll(env, "users"),
    ]);

    const rows = computeAdminDigest({ projects, users, now });
    const adminTasks = computeAdminTasks({ projects, users, now });

    const message = buildFoundersSms({ rows, adminTasks });

    const result = {
      ok: true,
      calledBy: caller,
      sentAt: now.toISOString(),
      recipientCount: recipients.length,
      charCount: message.length,
      message,                 // returned so the admin UI / test can preview it
      sent: false,
      error: null,
    };

    if (!recipients.length) {
      result.error = "FOUNDERS_SMS_TO is not set — no recipients configured.";
      return json(result, { status: 200 });
    }

    if (dryRun) {
      result.skipped = "dryRun";
      return json(result);
    }

    // ── Send (one message per recipient so a bad address can't block others) ──
    const errors = [];
    let sentCount = 0;
    for (const to of recipients) {
      try {
        await sendEmail(env, {
          // Carriers use the SUBJECT and BODY differently; some prepend the
          // subject. Keep the subject empty-ish and put everything in the body.
          to,
          subject: "Catalyst",
          text: message,
          // A minimal HTML part keeps Resend happy; carriers use the text.
          html: `<pre style="font:inherit;white-space:pre-wrap;margin:0;">${escapeHtml(message)}</pre>`,
        });
        sentCount++;
      } catch (err) {
        errors.push({ to, error: err?.message || String(err) });
      }
    }

    result.sent = sentCount > 0;
    result.sentCount = sentCount;
    if (errors.length) result.errors = errors;
    return json(result);
  } catch (err) {
    return serverError(err);
  }
};

// GET — health check / no-op.
export const onRequestGet = async () =>
  json({ ok: true, service: "catalyst-founders-sms", hint: "POST to send." });

// ─── Message builder ────────────────────────────────────────────────────────

// Turns the digest rows + admin tasks into a short, friendly text.
function buildFoundersSms({ rows, adminTasks }) {
  const lines = [];
  lines.push("Good Morning Awesome Founders!");
  lines.push("Here are the catalyst updates:");

  // 1) Things only the admins can unblock (approve / assign / decide).
  const taskLines = [];
  let proposalsPending = 0;
  for (const t of adminTasks) {
    for (const f of t.flags) {
      if (f.kind === "proposal-pending") proposalsPending++;
      else if (f.kind === "needs-editor") taskLines.push(`Assign an editor to ${quote(t.title)}`);
      else if (f.kind === "deadline-request-pending") taskLines.push(`Decide ${firstName(t.writerName)}'s deadline change on ${quote(t.title)}`);
    }
  }
  if (proposalsPending > 0) {
    taskLines.unshift(`${proposalsPending} proposal${proposalsPending === 1 ? "" : "s"} waiting on your approval`);
  }

  // 2) People to check on — overdue / idle / deadline-soon writers.
  const checkLines = [];
  for (const row of rows) {
    if (!row.projects?.length) continue;
    const worst = pickWorstFlag(row.projects);
    if (!worst) continue;
    const first = firstName(row.writerName);
    if (worst.kind === "overdue") {
      checkLines.push(`Check on ${first} — ${quote(worst.title)} overdue ${worst.days}d`);
    } else if (worst.kind === "idle") {
      checkLines.push(`Check on ${first} — ${quote(worst.title)} quiet ${worst.days}d`);
    } else if (worst.kind === "deadline-soon") {
      checkLines.push(`Nudge ${first} — ${quote(worst.title)} due in ${worst.days}d`);
    }
  }

  // Assemble with sensible truncation so the text stays short.
  const todo = summarizeList(taskLines, MAX_TASK_LINES, "more to review");
  const check = summarizeList(checkLines, MAX_CHECK_LINES, "more to check on");

  if (!todo.length && !check.length) {
    lines.push("All clear — nothing needs you right now. Nice work! 🎉");
    return clamp(lines.join("\n"));
  }

  if (todo.length) {
    lines.push("");
    lines.push("Needs you:");
    for (const l of todo) lines.push(`• ${l}`);
  }
  if (check.length) {
    lines.push("");
    lines.push("Check in with:");
    for (const l of check) lines.push(`• ${l}`);
  }

  return clamp(lines.join("\n"));
}

// Of a writer's projects, return the single most urgent flag to mention.
// Priority: overdue (most days) > idle (most days) > deadline-soon (fewest days left).
function pickWorstFlag(projects) {
  let best = null;
  const rank = { overdue: 3, idle: 2, "deadline-soon": 1 };
  for (const p of projects) {
    for (const f of p.flags || []) {
      const r = rank[f.kind];
      if (!r) continue;
      const cand = { kind: f.kind, days: f.days, title: p.title };
      if (!best) { best = { ...cand, _r: r }; continue; }
      if (r > best._r) { best = { ...cand, _r: r }; continue; }
      if (r === best._r) {
        // Same kind: deadline-soon → fewer days is worse; others → more days is worse.
        const worse = f.kind === "deadline-soon" ? (f.days < best.days) : (f.days > best.days);
        if (worse) best = { ...cand, _r: r };
      }
    }
  }
  return best;
}

function summarizeList(items, max, moreLabel) {
  if (items.length <= max) return items;
  const head = items.slice(0, max);
  head.push(`+${items.length - max} ${moreLabel}`);
  return head;
}

function firstName(name) {
  const n = String(name || "").trim();
  if (!n || /^unassigned|unknown$/i.test(n)) return "the writer";
  return n.split(/\s+/)[0];
}

// Short double-quoted title, trimmed so one long headline can't blow the budget.
function quote(s) {
  let t = String(s || "").trim();
  if (t.length > 42) t = t.slice(0, 40).trimEnd() + "…";
  return `"${t}"`;
}

function clamp(text) {
  if (text.length <= MAX_SMS_CHARS) return text;
  return text.slice(0, MAX_SMS_CHARS - 1).trimEnd() + "…";
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// ─── Firestore ────────────────────────────────────────────────────────────────

async function loadAll(env, collectionId) {
  const rows = await firestoreRunQuery(env, {
    from: [{ collectionId }],
    limit: 2000,
  });
  return rows.map((r) => ({ id: r.id, ...r.data }));
}
