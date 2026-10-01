// functions/_utils/activity-digest.js
// Real-time "what just happened on a story" emails to admins, batched.
//
// Every tracker event (a step ticked, a comment) is queued on
// bot_activity_pending/{projectId}. A story's queue is sent as ONE email once
// the story has been quiet for ACTIVITY_SETTLE_MS (so "tick four boxes in a
// row" is one email, not four), or after ACTIVITY_MAX_WAIT_MS at the latest.
// Queues are flushed by the 5-minute newsletter cron (/api/newsletter/
// dispatch-due), opportunistically by the next event on any story, and by
// the daily bot run, so nothing sits stranded.
//
// Smarter than before:
//   • ticking a step and unticking it again before the email goes out
//     cancels out (no email about a mis-click);
//   • admins aren't emailed about their own actions;
//   • "behind / on track" now checks the real timeline steps.

import { firestoreGet, firestoreCreate, firestoreUpdate, firestoreRunQuery, fromFirestoreDoc } from "./firebase.js";
import { sendEmail } from "./resend.js";
import { adminActivityUpdateEmail } from "./reminder-emails.js";

export const ACTIVITY_SETTLE_MS = 3 * 60 * 1000;
export const ACTIVITY_MAX_WAIT_MS = 15 * 60 * 1000;

export const ADMIN_ACTIVITY_RECIPIENTS = [
  "bendoryair@gmail.com",
  "stemcatalystmagazine@gmail.com",
  "aidan.schurr@gwmail.gwu.edu",
];

const QUEUE_COLLECTION = "bot_activity_pending";

export async function queueActivity(env, projectId, incoming) {
  const path = `${QUEUE_COLLECTION}/${projectId}`;
  const existing = await firestoreGet(env, path);
  const queue = existing ? fromFirestoreDoc(existing).data : {};
  const activities = Array.isArray(queue.activities) ? queue.activities : [];
  activities.push(incoming);
  await upsert(env, projectId, { activities, lastSentAt: queue.lastSentAt || null });
  return activities.length;
}

// Send every queue that is ready. `force` sends anything waiting (daily run).
export async function flushActivityQueues(env, { siteUrl, force = false, skipProjectId = null, now = Date.now() } = {}) {
  const out = { checked: 0, sent: 0, cancelledOut: 0, waiting: 0, errors: [] };
  let rows = [];
  try {
    rows = await firestoreRunQuery(env, { from: [{ collectionId: QUEUE_COLLECTION }], limit: 200 });
  } catch (err) {
    out.errors.push(err?.message || String(err));
    return out;
  }
  for (const row of rows) {
    const projectId = row.id;
    if (projectId === skipProjectId) continue;
    const acts = Array.isArray(row.data.activities) ? row.data.activities : [];
    if (!acts.length) continue;
    out.checked++;
    const times = acts.map((a) => Date.parse(a.timestamp || "")).filter(Number.isFinite);
    const newest = times.length ? Math.max(...times) : 0;
    const oldest = times.length ? Math.min(...times) : 0;
    const ready = force || (now - newest >= ACTIVITY_SETTLE_MS) || (now - oldest >= ACTIVITY_MAX_WAIT_MS);
    if (!ready) { out.waiting++; continue; }

    // Claim the queue first so two flushers can't both send it.
    await upsert(env, projectId, { activities: [], lastSentAt: new Date(now).toISOString() });

    const kept = cancelOut(acts);
    if (!kept.length) { out.cancelledOut++; continue; }
    try {
      const doc = await firestoreGet(env, `projects/${projectId}`);
      if (!doc) continue;
      const project = { id: projectId, ...fromFirestoreDoc(doc).data };
      // Who acted? Don't email someone about only their own clicks.
      const actorEmails = new Set(kept.map((a) => String(a.actorEmail || "").toLowerCase()).filter(Boolean));
      const recipients = ADMIN_ACTIVITY_RECIPIENTS.filter((e) => !(actorEmails.size === 1 && actorEmails.has(e.toLowerCase())));
      if (!recipients.length) continue;
      const last = kept[kept.length - 1];
      const actorNames = [...new Set(kept.map((a) => a.actorName).filter(Boolean))];
      const { subject, html } = adminActivityUpdateEmail({
        project,
        actor: { name: actorNames.join(" & ") || last.actorName, email: last.actorEmail, role: last.actorRole },
        activities: kept,
        health: projectHealth(project, new Date(now)),
        siteUrl,
      });
      await sendEmail(env, { to: recipients, subject, html, replyTo: env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com" });
      out.sent++;
    } catch (err) {
      out.errors.push(`${projectId}: ${err?.message || String(err)}`);
    }
  }
  return out;
}

// "completed: X" followed by "uncompleted: X" (or the reverse) in the same
// batch is a correction; drop both.
function cancelOut(acts) {
  const list = [...acts];
  const drop = new Set();
  for (let i = 0; i < list.length; i++) {
    if (drop.has(i)) continue;
    const m = /^(un)?completed: (.+)$/.exec(list[i].text || "");
    if (!m) continue;
    for (let j = i + 1; j < list.length; j++) {
      if (drop.has(j)) continue;
      const n = /^(un)?completed: (.+)$/.exec(list[j].text || "");
      if (n && n[2] === m[2] && !!n[1] !== !!m[1]) { drop.add(i); drop.add(j); break; }
    }
  }
  return list.filter((_, i) => !drop.has(i));
}

// Behind / on track, against the steps the tracker really uses.
export function projectHealth(project, now) {
  const deadlines = project.deadlines || {};
  const tl = project.timeline || {};
  const checkpoints = [
    { key: "contact",     step: "Interview Scheduled",      label: "schedule the interview" },
    { key: "interview",   step: "Interview Complete",       label: "the interview" },
    { key: "draft",       step: "Article Writing Complete", label: "the draft" },
    { key: "review",      step: "Review Complete",          label: "the editor's review" },
    { key: "edits",       step: "Suggestions Reviewed",     label: "the edits" },
    { key: "publication", step: "Suggestions Reviewed",     label: "publication" },
  ];
  const skipInterview = project.type === "Op-Ed" || !!project.noInterview;
  let overdue = null, upcoming = null;
  for (const c of checkpoints) {
    if (skipInterview && (c.key === "contact" || c.key === "interview")) continue;
    const ms = Date.parse(deadlines[c.key] || (c.key === "publication" ? project.deadline : "") || "");
    if (!Number.isFinite(ms) || tl[c.step]) continue;
    const days = Math.round((ms - now.getTime()) / 86400000);
    if (days < 0) { if (!overdue || days < overdue.days) overdue = { ...c, days }; }
    else if (!upcoming || days < upcoming.days) upcoming = { ...c, days };
  }
  if (overdue) {
    const d = -overdue.days;
    return { state: "behind", note: `${d} day${d === 1 ? "" : "s"} past the deadline for ${overdue.label}` };
  }
  if (upcoming) {
    return { state: "on-track", note: `next: ${upcoming.label} in ${upcoming.days} day${upcoming.days === 1 ? "" : "s"}` };
  }
  return { state: "unknown", note: "" };
}

async function upsert(env, projectId, data) {
  const payload = { ...data, updatedAt: new Date().toISOString() };
  try {
    await firestoreUpdate(env, `${QUEUE_COLLECTION}/${projectId}`, payload, { mergeFields: true });
  } catch (err) {
    if (err?.status === 404 || /404|NOT_FOUND/.test(err?.message || "")) {
      await firestoreCreate(env, QUEUE_COLLECTION, payload, projectId);
    } else {
      throw err;
    }
  }
}
