// Shared admin-task engine.
//
// Turns raw project/user state into a prioritized list of concrete, named
// instructions the admin can act on — "Assign an editor to …", "Review Jane's
// proposal", "Approve Sam's deadline change", "Publish X". Each task carries a
// priority, an icon/color, an optional deep link, an optional ready-to-send
// text message, and a stable sort key so the most time-sensitive work floats
// to the top.
//
// Both the Activity page (compact panel) and the dedicated Tasks page import
// from here so there is a single source of truth for "what the admin must do."

import { esc } from "./ui.js";

export const IDLE_WARNING_DAYS = 7;    // "idle" starts here
export const IDLE_STALE_DAYS   = 14;   // "stalled" — escalate
export const DEADLINE_SOON_DAYS = 3;   // "due soon" window

// Timeline step that marks a project fully edited (terminal workflow state).
export const FINAL_STEP = "Suggestions Reviewed";

// ─── Icons / colors ──────────────────────────────────────────────────────────

const TASK_ICONS = {
  proposal: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
  editor:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
  nudge:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  clock:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  publish:  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>`,
  schedule: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  deadline: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><path d="M2 12h3M19 12h3"/></svg>`,
  inbox:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
  book:     `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
};

const TASK_COLORS = {
  urgent: "#b91c1c",
  high:   "#b45309",
  normal: "#0f766e",
};

// ─── Date / project helpers ──────────────────────────────────────────────────

function toMs(v) {
  if (!v) return 0;
  if (typeof v === "object" && v.seconds) return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

export function projectLastTouched(project) {
  const candidates = [project.lastActivity, project.updatedAt, project.createdAt];
  for (const a of project.activity || []) candidates.push(a.timestamp);
  let latest = 0;
  for (const c of candidates) { const ms = toMs(c); if (ms > latest) latest = ms; }
  return latest || null;
}

export function pubDeadline(project) {
  return (project.deadlines?.publication) || project.deadline || null;
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return Math.ceil((d - Date.now()) / 86400000);
}

export function fmtRelative(v) {
  const ms = toMs(v);
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pipelineHref(project) {
  return `#/pipeline/${project.type === "Op-Ed" ? "opeds" : "interviews"}`;
}

// Absolute date label like "May 18" / "May 18, 2024" (older years get the year),
// matching how comment timestamps read in the feed.
export function fmtDateShort(v) {
  const ms = toMs(v);
  if (!ms) return "";
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Pull the most recent comments people left on their proposals/projects, so an
 * admin can follow them in one place. Reads the embedded `project.activity[]`
 * array (the same source the Activity feed uses) and keeps only comment-type
 * entries, extracting the plain comment body.
 *
 * @returns array of { id, projectId, projectTitle, projectType, href,
 *                      authorName, body, timestamp } newest-first.
 */
export function extractRecentComments(projects, limit = 12) {
  const out = [];
  for (const project of projects || []) {
    const acts = Array.isArray(project.activity) ? project.activity : [];
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const raw = String(a?.text || "");
      // Match `commented: "…"` (quotes optional). Anything else isn't a comment.
      const m = raw.match(/^commented:\s*"?([\s\S]*?)"?\s*$/i);
      if (!m || !m[1].trim()) continue;
      out.push({
        id: `${project.id}:${a.timestamp || i}`,
        projectId: project.id,
        projectTitle: project.title || "Untitled",
        projectType: project.type || "",
        href: pipelineHref(project),
        authorName: a.authorName || "Someone",
        body: m[1].trim(),
        timestamp: a.timestamp || project.updatedAt || project.createdAt || null,
      });
    }
  }
  out.sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
  return out.slice(0, limit);
}

function idleLabel(idleDays) {
  if (idleDays === null) return "No activity yet";
  if (idleDays >= IDLE_STALE_DAYS) return `Idle ${idleDays}d`;
  if (idleDays >= IDLE_WARNING_DAYS) return `Idle ${idleDays}d`;
  if (idleDays === 0) return "Active today";
  return `Last touched ${idleDays}d ago`;
}

function fmtSnoozeBack(untilMs) {
  if (!untilMs) return "soon";
  const days = Math.ceil((untilMs - Date.now()) / 86400000);
  if (days <= 0) return "shortly";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

// "Jane's" possessive for headlines; falls back gracefully for "the writer".
function who(name) {
  const n = String(name || "").trim();
  if (!n || /^the /i.test(n)) return esc(n || "the writer") + "’s";
  const first = n.split(/\s+/)[0];
  return esc(first) + (/s$/i.test(first) ? "’" : "’s");
}

// First name, capitalized, for mid-sentence use ("Jane needs to…").
function escFirst(name) {
  const n = String(name || "").trim();
  if (!n || /^the /i.test(n)) return esc(n || "the writer");
  return esc(n.split(/\s+/)[0]);
}

// Plain (un-escaped) first name for a copy-to-clipboard text message, or null
// when there's no real person. The message is plain text the admin pastes into
// their own texts, so it must NOT be escaped.
function firstNameOf(name) {
  const n = String(name || "").trim();
  if (!n || /^the (writer|editor)$/i.test(n)) return null;
  return n.split(/\s+/)[0];
}

// ─── Message crafting ────────────────────────────────────────────────────────

// Builds a short, friendly, ready-to-send text message for a teammate.
// `kind` selects the phrasing; everything is plain text (no HTML).
function craftMessage(kind, { name, title, idleDays, daysOverdue, daysUntilDue, reason }) {
  const first = name || "there";
  const story = title ? `"${title}"` : "your story";
  const quiet =
    typeof idleDays === "number" && idleDays >= IDLE_WARNING_DAYS
      ? ` It's been quiet for ${idleDays} days`
      : "";
  const overdueBit =
    typeof daysOverdue === "number" && daysOverdue > 0
      ? ` We're ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} past the deadline on it`
      : "";
  const soonBit =
    typeof daysUntilDue === "number" && daysUntilDue >= 0
      ? ` The deadline's coming up in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`
      : "";

  switch (kind) {
    case "interview":
      return `Hey ${first}, just checking in on ${story} — looks like the interview isn't booked yet.${overdueBit || soonBit} Are you able to lock in a date, or is there anything blocking you?`;
    case "editor":
      return `Hey ${first}, checking in on the edits for ${story}.${quiet}${overdueBit} How's it looking on your end — anything you need from me?`;
    case "revisions":
      return `Hey ${first}, the editor sent feedback on ${story}${quiet ? `, but it's been quiet for ${idleDays} days` : ""}. Do you have any updates? Let me know if you have questions on any of the notes.`;
    case "draft":
      if (daysOverdue > 0)
        return `Hey ${first}, ${story} is a bit past its deadline now${quiet ? ` and it's been quiet for ${idleDays} days` : ""}. How's the draft coming along? Let me know if you're stuck on anything.`;
      if (typeof daysUntilDue === "number")
        return `Hey ${first}, heads-up that ${story} is due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}. How's the draft looking? Shout if you need anything.`;
      return `Hey ${first}, checking in on ${story}.${quiet} How's the draft coming? Let me know if anything's blocking you.`;
    case "deadline-approved":
      return `Hey ${first}, good news — I've approved the new deadline for ${story}. You're all set, thanks for the heads-up!`;
    case "publish":
      return `Hey ${first}, great work on ${story} — it's fully edited and ready to go live. I'm publishing it now. Congrats!`;
    default:
      return `Hey ${first}, just checking in on ${story} — any updates? Let me know if you need anything.`;
  }
}

// Build a task object with its icon/color resolved.
function mkTask(t) {
  return {
    key: t.key || "",
    priority: t.priority,
    headline: t.headline,
    detail: t.detail || "",
    context: t.context || "",
    actionHref: t.href || "",
    actionLabel: t.actionLabel || "Open",
    icon: TASK_ICONS[t.kind] || TASK_ICONS.clock,
    color: TASK_COLORS[t.priority] || TASK_COLORS.normal,
    kind: t.kind || "clock",
    sort: t.sort || 0,
    message: t.message || "",            // ready-to-send text (plain), if any
    recipientName: t.recipientName || "", // who the message is addressed to
  };
}

// ─── The engine ──────────────────────────────────────────────────────────────

/**
 * @param projects  raw project docs from the workflow `projects` collection
 * @param users     raw user docs (for "who can I assign" hints)
 * @param overrides per-admin dismiss/snooze map: { [taskKey]: {dismissed} | {snoozeUntil} }
 * @param extras    optional already-fetched counts for cross-collection signals:
 *                  { bookReviewsPending: number }
 * @returns { active, hidden } — split by the admin's snooze/dismiss choices
 */
export function buildAdminTasks(projects, users, overrides = {}, extras = {}) {
  const tasks = [];
  const now = Date.now();

  const editors = (users || []).filter(
    (u) => u && (u.role === "editor" || u.role === "admin") && (!u.status || u.status === "active"),
  );
  const editorHint = editors.length
    ? `${editors.length} editor${editors.length === 1 ? "" : "s"} available`
    : `no editors on the roster yet`;

  for (const project of projects) {
    const tl = project.timeline || {};

    const title = project.title || "Untitled";
    const type = project.type || "story";
    const author = project.authorName || "the writer";
    const editor = project.editorName || "";
    const href = pipelineHref(project);

    const due = pubDeadline(project);
    const dDue = due ? daysUntil(due) : null;
    const overdue = dDue !== null && dDue < 0;
    const dueSoon = dDue !== null && dDue >= 0 && dDue <= DEADLINE_SOON_DAYS;

    const lastTouched = projectLastTouched(project);
    const idleDays = lastTouched ? Math.floor((now - lastTouched) / 86400000) : null;
    const stalled = idleDays !== null && idleDays >= IDLE_STALE_DAYS;

    const dueFragment = overdue
      ? ` <span class="admin-task-due admin-task-due-over">overdue by ${Math.abs(dDue)}d</span>`
      : dueSoon
        ? ` <span class="admin-task-due admin-task-due-soon">due in ${dDue}d</span>`
        : "";

    // 0) Pending deadline-change request — the writer asked to push a date.
    //    This is independent of pipeline stage and always needs an admin call,
    //    so it's evaluated before the "fully done -> skip" short-circuit.
    const dlReq = (project.deadlineRequest?.status === "pending" && project.deadlineRequest)
      || (project.deadlineChangeRequest?.status === "pending" && project.deadlineChangeRequest)
      || null;
    if (dlReq) {
      const reqBy = dlReq.requestedBy || author;
      const requestedDates = dlReq.requestedDeadlines && Object.keys(dlReq.requestedDeadlines).length
        ? Object.entries(dlReq.requestedDeadlines).map(([k, v]) => `${k}: ${v}`).join(", ")
        : (dlReq.requestedDate ? `new date ${dlReq.requestedDate}` : "");
      tasks.push(mkTask({
        kind: "deadline",
        key: `${project.id}:deadline-req`,
        priority: "urgent",
        headline: `Approve or decline ${who(reqBy)} deadline change on <strong>${esc(title)}</strong>`,
        detail: `${escFirst(reqBy)} asked to move the deadline${requestedDates ? ` (${esc(requestedDates)})` : ""}.${dlReq.reason ? ` Reason: “${esc(dlReq.reason)}”.` : ""} Open the project to approve or reject it.`,
        context: `Requested ${dlReq.requestedAt ? fmtRelative(dlReq.requestedAt) : "recently"}${dueFragment}`,
        href, actionLabel: "Review request",
        recipientName: firstNameOf(reqBy),
        message: craftMessage("deadline-approved", { name: firstNameOf(reqBy), title }),
        sort: 1000,
      }));
      // A deadline request is the headline action; still allow other stage
      // tasks below so nothing's hidden, but this one outranks them.
    }

    if (tl[FINAL_STEP]) {
      // Fully edited. The terminal workflow action is to push it live.
      // Projects carry no "published" flag, so to avoid flooding the list with
      // long-finished pieces we only surface a publish task while it's still
      // fresh (finished within PUBLISH_FRESH_DAYS). The admin can also clear it
      // outright once it's live; that choice persists.
      const PUBLISH_FRESH_DAYS = 30;
      const recentlyFinished = idleDays !== null && idleDays <= PUBLISH_FRESH_DAYS;
      if (recentlyFinished) {
        tasks.push(mkTask({
          kind: "publish",
          key: `${project.id}:publish`,
          priority: overdue ? "high" : "normal",
          headline: `Publish <strong>${esc(title)}</strong> — it's fully edited`,
          detail: `${escFirst(author)} and the editor finished everything. This is the last step: push it live, then clear this task.`,
          context: `Ready ${lastTouched ? fmtRelative(lastTouched) : "now"}${dueFragment}`,
          href, actionLabel: "Open project",
          recipientName: firstNameOf(author),
          message: craftMessage("publish", { name: firstNameOf(author), title }),
          sort: 700 + (overdue ? 100 : 0),
        }));
      }
      continue;
    }

    // 1) Proposal waiting on a decision — the admin is the gatekeeper.
    if (project.proposalStatus !== "approved" && project.proposalStatus !== "rejected") {
      tasks.push(mkTask({
        kind: "proposal",
        key: `${project.id}:proposal`,
        priority: overdue ? "urgent" : "high",
        headline: `Review ${who(author)} proposal for <strong>${esc(title)}</strong>`,
        detail: `This ${esc(type)} is waiting on your approval before ${escFirst(author)} can start. Approve it or send it back with notes.`,
        context: `Submitted ${lastTouched ? fmtRelative(lastTouched) : "recently"}${dueFragment}`,
        href, actionLabel: "Review proposal",
        sort: 900 + (overdue ? 200 : 0) + (idleDays || 0),
      }));
      continue;
    }

    if (project.proposalStatus === "rejected") continue;

    // 2) Interview needs scheduling.
    if (type === "Interview" && !tl["Interview Scheduled"] && !tl["Interview Complete"]) {
      tasks.push(mkTask({
        kind: "schedule",
        key: `${project.id}:interview`,
        priority: overdue ? "urgent" : dueSoon ? "high" : "normal",
        headline: `Make sure <strong>${esc(title)}</strong> gets its interview booked`,
        detail: `${escFirst(author)} hasn't scheduled the interview yet. Check in and help lock a date if it's stuck.`,
        context: `${idleLabel(idleDays)}${dueFragment}`,
        href, actionLabel: "Open project",
        recipientName: firstNameOf(author),
        message: craftMessage("interview", {
          name: firstNameOf(author), title, idleDays,
          daysOverdue: overdue ? Math.abs(dDue) : 0,
          daysUntilDue: dueSoon ? dDue : undefined,
        }),
        sort: 600 + (overdue ? 300 : dueSoon ? 100 : 0) + (idleDays || 0),
      }));
      continue;
    }

    // 3) Writing done, but no editor assigned — classic admin action.
    if (tl["Article Writing Complete"] && !project.editorId) {
      tasks.push(mkTask({
        kind: "editor",
        key: `${project.id}:assign-editor`,
        priority: overdue ? "urgent" : "high",
        headline: `Assign an editor to <strong>${esc(title)}</strong>`,
        detail: `${escFirst(author)} finished the draft — it's sitting idle until someone edits it. (${esc(editorHint)}.)`,
        context: `Draft ready ${lastTouched ? fmtRelative(lastTouched) : ""}${dueFragment}`,
        href, actionLabel: "Assign editor",
        sort: 800 + (overdue ? 200 : 0) + (idleDays || 0),
      }));
      continue;
    }

    // 4) Editor assigned, review not done, and it's stalled — chase the editor.
    if (project.editorId && tl["Article Writing Complete"] && !tl["Review Complete"]) {
      if (overdue || dueSoon || stalled) {
        tasks.push(mkTask({
          kind: "nudge",
          key: `${project.id}:chase-editor`,
          priority: overdue ? "urgent" : "high",
          headline: `Check in with ${who(editor || "the editor")} on editing <strong>${esc(title)}</strong>`,
          detail: `It's in editorial review${stalled ? ` and hasn't moved in ${idleDays} days` : ""}. Make sure ${escFirst(editor || "the editor")} is on track to finish.`,
          context: `${idleLabel(idleDays)}${dueFragment}`,
          href, actionLabel: "Open project",
          recipientName: firstNameOf(editor),
          message: craftMessage("editor", {
            name: firstNameOf(editor), title, idleDays,
            daysOverdue: overdue ? Math.abs(dDue) : 0,
          }),
          sort: 500 + (overdue ? 300 : dueSoon ? 120 : 0) + (idleDays || 0),
        }));
      }
      continue;
    }

    // 5) Feedback delivered, author hasn't reviewed suggestions — nudge author.
    if (tl["Review Complete"] && !tl[FINAL_STEP]) {
      if (overdue || dueSoon || stalled) {
        tasks.push(mkTask({
          kind: "nudge",
          key: `${project.id}:revisions`,
          priority: overdue ? "urgent" : "high",
          headline: `Nudge ${who(author)} to finish revisions on <strong>${esc(title)}</strong>`,
          detail: `The editor sent feedback${stalled ? `, but it's been quiet for ${idleDays} days` : ""}. ${escFirst(author)} needs to review the suggestions to wrap this up.`,
          context: `${idleLabel(idleDays)}${dueFragment}`,
          href, actionLabel: "Open project",
          recipientName: firstNameOf(author),
          message: craftMessage("revisions", {
            name: firstNameOf(author), title, idleDays,
            daysOverdue: overdue ? Math.abs(dDue) : 0,
          }),
          sort: 450 + (overdue ? 300 : dueSoon ? 120 : 0) + (idleDays || 0),
        }));
      }
      continue;
    }

    // 6) Drafting in progress, but overdue / due-soon / stalled — nudge writer.
    if (!tl["Article Writing Complete"]) {
      if (overdue || dueSoon || stalled) {
        tasks.push(mkTask({
          kind: "nudge",
          key: `${project.id}:draft`,
          priority: overdue ? "urgent" : "high",
          headline: `Reach out to ${who(author)} about <strong>${esc(title)}</strong>`,
          detail: overdue
            ? `This is past its deadline and still being written. Find out where ${escFirst(author)} is at.`
            : stalled
              ? `No activity for ${idleDays} days while still drafting. Check ${escFirst(author)} isn't blocked.`
              : `Deadline is close and the draft isn't finished — give ${escFirst(author)} a heads-up.`,
          context: `${idleLabel(idleDays)}${dueFragment}`,
          href, actionLabel: "Open project",
          recipientName: firstNameOf(author),
          message: craftMessage("draft", {
            name: firstNameOf(author), title, idleDays,
            daysOverdue: overdue ? Math.abs(dDue) : 0,
            daysUntilDue: !overdue && dueSoon ? dDue : undefined,
          }),
          sort: 400 + (overdue ? 300 : dueSoon ? 120 : 0) + (idleDays || 0),
        }));
      }
    }
  }

  // Cross-collection signal: pending reader-submitted book reviews.
  if (typeof extras.bookReviewsPending === "number" && extras.bookReviewsPending > 0) {
    const n = extras.bookReviewsPending;
    tasks.push(mkTask({
      kind: "book",
      key: "global:book-reviews",
      priority: "normal",
      headline: `Review ${n} pending book review${n === 1 ? "" : "s"} from readers`,
      detail: `Reader-submitted reviews are waiting in The Catalyzers queue. Approve the good ones to feature them, or decline.`,
      context: "Public submissions",
      href: "#/admin/book-reviews",
      actionLabel: "Open queue",
      sort: 300 + n,
    }));
  }

  // Apply the admin's dismiss / snooze choices.
  const active = [];
  const hidden = [];
  for (const t of tasks) {
    const ov = t.key ? overrides[t.key] : null;
    if (ov && ov.dismissed) {
      t.hiddenReason = "dismissed";
      hidden.push(t);
    } else if (ov && ov.snoozeUntil && ov.snoozeUntil > now) {
      t.hiddenReason = "snoozed";
      t.snoozeUntil = ov.snoozeUntil;
      hidden.push(t);
    } else {
      active.push(t);
    }
  }

  const rank = { urgent: 2, high: 1, normal: 0 };
  const byPriority = (a, b) => {
    if (rank[b.priority] !== rank[a.priority]) return rank[b.priority] - rank[a.priority];
    return b.sort - a.sort;
  };
  active.sort(byPriority);
  hidden.sort(byPriority);

  return { active, hidden };
}

// ─── Row renderer ────────────────────────────────────────────────────────────

/**
 * Returns a `renderTaskRow(task, isHidden)` function bound to the page's
 * toast + override-setter. Keeps the panel and the full page rendering
 * identical.
 *
 * @param opts.toast            (msg, type) => void
 * @param opts.setTaskOverride  (taskKey, override|null) => void  (override: {dismissed} | {snoozeUntil})
 * @param opts.getMenuRoot      () => Element   — scope for "close other open menus"
 */
export function createTaskRowRenderer({ toast, setTaskOverride, getMenuRoot }) {
  return function renderTaskRow(t, isHidden) {
    const row = document.createElement("div");
    row.className = `admin-task admin-task-${t.priority}${isHidden ? " admin-task-hidden" : ""}`;

    const badge = {
      urgent: `<span class="admin-task-badge admin-task-badge-urgent">Urgent</span>`,
      high:   `<span class="admin-task-badge admin-task-badge-high">Do soon</span>`,
      normal: `<span class="admin-task-badge admin-task-badge-normal">When you can</span>`,
    }[t.priority] || "";

    const statePill = isHidden
      ? (t.hiddenReason === "snoozed"
          ? `<span class="admin-task-state admin-task-state-snoozed">Snoozed · back ${esc(fmtSnoozeBack(t.snoozeUntil))}</span>`
          : `<span class="admin-task-state admin-task-state-dismissed">Cleared</span>`)
      : "";

    const copyBtn = t.message
      ? `<button type="button" class="admin-task-copy" title="Copy a ready-to-send message for ${esc(t.recipientName || "this person")}">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
           <span class="admin-task-copy-label">Copy text</span>
         </button>`
      : "";

    const openBtn = t.actionHref
      ? `<a class="admin-task-action" href="${esc(t.actionHref)}">${esc(t.actionLabel || "Open")}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></a>`
      : "";

    const manage = !t.key
      ? ""
      : isHidden
        ? `<button type="button" class="admin-task-restore" data-act="restore">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
             Restore
           </button>`
        : `<div class="admin-task-manage">
             <button type="button" class="admin-task-manage-btn" aria-haspopup="true" aria-expanded="false" title="Snooze or clear this task">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
             </button>
             <div class="admin-task-menu" role="menu" hidden>
               <div class="admin-task-menu-head">Snooze until later</div>
               <button type="button" role="menuitem" data-act="snooze" data-days="1">Tomorrow</button>
               <button type="button" role="menuitem" data-act="snooze" data-days="3">In 3 days</button>
               <button type="button" role="menuitem" data-act="snooze" data-days="5">In 5 days</button>
               <button type="button" role="menuitem" data-act="snooze" data-days="7">In a week</button>
               <div class="admin-task-menu-sep"></div>
               <button type="button" role="menuitem" class="admin-task-menu-clear" data-act="dismiss">Clear — it's fine</button>
             </div>
           </div>`;

    row.innerHTML = `
      <div class="admin-task-icon" style="color:${t.color};" aria-hidden="true">${t.icon}</div>
      <div class="admin-task-main">
        <div class="admin-task-headline">${t.headline}</div>
        ${t.detail ? `<div class="admin-task-detail">${t.detail}</div>` : ""}
        <div class="admin-task-foot">
          ${statePill}
          ${badge}
          ${t.context ? `<span class="admin-task-context">${t.context}</span>` : ""}
        </div>
      </div>
      ${(copyBtn || openBtn || manage) ? `<div class="admin-task-actions">${copyBtn}${openBtn}${manage}</div>` : ""}
    `;

    if (t.message) {
      const btn = row.querySelector(".admin-task-copy");
      const label = btn.querySelector(".admin-task-copy-label");
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(t.message);
          btn.classList.add("admin-task-copy-done");
          label.textContent = "Copied!";
          toast(`Message for ${t.recipientName || "them"} copied — paste it into your texts.`, "success");
          setTimeout(() => {
            btn.classList.remove("admin-task-copy-done");
            label.textContent = "Copy text";
          }, 1800);
        } catch (e) {
          toast("Couldn't copy automatically. Message: " + t.message, "info");
        }
      });
    }

    const restoreBtn = row.querySelector('[data-act="restore"]');
    if (restoreBtn) {
      restoreBtn.addEventListener("click", () => {
        setTaskOverride(t.key, null);
        toast("Task restored.", "info");
      });
    }

    const menuWrap = row.querySelector(".admin-task-manage");
    if (menuWrap) {
      const trigger = menuWrap.querySelector(".admin-task-manage-btn");
      const menu = menuWrap.querySelector(".admin-task-menu");
      const close = () => { menu.hidden = true; trigger.setAttribute("aria-expanded", "false"); };
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden;
        const root = (getMenuRoot && getMenuRoot()) || document;
        root.querySelectorAll(".admin-task-menu").forEach((m) => { m.hidden = true; });
        menu.hidden = !willOpen;
        trigger.setAttribute("aria-expanded", String(willOpen));
        if (willOpen) document.addEventListener("click", close, { once: true });
      });
      menu.addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]");
        if (!b) return;
        e.stopPropagation();
        close();
        if (b.dataset.act === "dismiss") {
          setTaskOverride(t.key, { dismissed: true });
          toast("Cleared. Find it under “Show cleared & snoozed.”", "success");
        } else if (b.dataset.act === "snooze") {
          const days = parseInt(b.dataset.days, 10) || 1;
          const until = Date.now() + days * 86400000;
          setTaskOverride(t.key, { snoozeUntil: until });
          toast(`Snoozed — back in ${days} day${days === 1 ? "" : "s"}.`, "success");
        }
      });
    }

    return row;
  };
}

// ─── Styles ──────────────────────────────────────────────────────────────────

export function ensureTaskStyles() {
  if (document.getElementById("admin-task-styles")) return;
  const s = document.createElement("style");
  s.id = "admin-task-styles";
  s.textContent = `
    .admin-tasks-card { border:1px solid #dbe3ea; box-shadow:0 2px 10px rgba(15,23,42,.05); }
    .admin-tasks-card .card-title { display:flex; align-items:center; gap:8px; }
    .admin-tasks-icon { display:inline-flex; align-items:center; justify-content:center;
      width:26px; height:26px; border-radius:7px; background:#0f172a; color:#fff; }
    .admin-tasks-count { font-size:12px; color:#64748b; }
    .admin-tasks-count strong { color:#0b1220; }
    .admin-tasks-count-urgent { color:#b91c1c; font-weight:700; }

    .admin-tasks-list { display:flex; flex-direction:column; gap:10px; }
    .admin-task {
      display:flex; align-items:flex-start; gap:13px;
      padding:13px 15px; background:#fff;
      border:1px solid #e5e7eb; border-left-width:3px; border-radius:10px;
      transition:border-color .12s, box-shadow .12s, transform .12s;
    }
    .admin-task:hover { box-shadow:0 2px 8px rgba(15,23,42,.07); transform:translateY(-1px); }
    .admin-task-urgent { border-left-color:#dc2626; background:#fffafa; }
    .admin-task-high   { border-left-color:#d97706; background:#fffdf7; }
    .admin-task-normal { border-left-color:#0d9488; }

    .admin-task-icon {
      flex-shrink:0; width:30px; height:30px; border-radius:8px;
      background:#f8fafc; border:1px solid currentColor;
      display:flex; align-items:center; justify-content:center;
    }
    .admin-task-main { flex:1; min-width:0; }
    .admin-task-headline { font-size:14px; font-weight:600; color:#0b1220; line-height:1.4; }
    .admin-task-headline strong { font-weight:800; }
    .admin-task-detail { font-size:12.5px; color:#475569; margin-top:3px; line-height:1.5; }
    .admin-task-foot { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px; }
    .admin-task-badge {
      font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.05em;
      padding:3px 8px; border-radius:999px;
    }
    .admin-task-badge-urgent { background:#fee2e2; color:#b91c1c; }
    .admin-task-badge-high   { background:#fef3c7; color:#92400e; }
    .admin-task-badge-normal { background:#ccfbf1; color:#0f766e; }
    .admin-task-context { font-size:11.5px; color:#94a3b8; }
    .admin-task-due { font-weight:700; }
    .admin-task-due-over { color:#b91c1c; }
    .admin-task-due-soon { color:#b45309; }

    .admin-task-actions {
      flex-shrink:0; align-self:center;
      display:flex; flex-direction:column; gap:7px; align-items:stretch;
    }
    .admin-task-action, .admin-task-copy {
      display:inline-flex; align-items:center; justify-content:center; gap:5px;
      font-size:12.5px; font-weight:700; font-family:inherit; cursor:pointer;
      padding:8px 12px; border-radius:8px; white-space:nowrap;
      min-height:40px; transition:background .12s, border-color .12s, color .12s;
    }
    .admin-task-action {
      color:#0f172a; border:1px solid #cbd5e1; background:#f8fafc; text-decoration:none;
    }
    .admin-task-action:hover { background:#0f172a; color:#fff; border-color:#0f172a; }
    .admin-task-action:focus-visible { outline:2px solid #0f172a; outline-offset:2px; }
    .admin-task-action svg { transition:transform .12s; }
    .admin-task-action:hover svg { transform:translateX(2px); }

    .admin-task-copy {
      color:#0f766e; border:1px solid #99f6e4; background:#f0fdfa;
    }
    .admin-task-copy:hover { background:#0f766e; color:#fff; border-color:#0f766e; }
    .admin-task-copy:focus-visible { outline:2px solid #0f766e; outline-offset:2px; }
    .admin-task-copy-done { background:#dcfce7 !important; color:#15803d !important; border-color:#86efac !important; }

    .admin-tasks-clear { display:flex; align-items:center; gap:14px; padding:6px 2px; }
    .admin-tasks-clear-icon {
      flex-shrink:0; width:44px; height:44px; border-radius:50%;
      background:#dcfce7; color:#15803d;
      display:flex; align-items:center; justify-content:center;
    }
    .admin-tasks-clear-title { font-size:15px; font-weight:700; color:#0b1220; }
    .admin-tasks-clear-sub { font-size:12.5px; color:#64748b; margin-top:2px; }

    .admin-task-manage { position:relative; align-self:center; }
    .admin-task-manage-btn {
      width:36px; height:36px; border-radius:8px; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      background:transparent; border:1px solid transparent; color:#94a3b8;
      transition:background .12s, color .12s, border-color .12s;
    }
    .admin-task-manage-btn:hover { background:#f1f5f9; color:#475569; border-color:#e2e8f0; }
    .admin-task-manage-btn:focus-visible { outline:2px solid #0f172a; outline-offset:2px; }
    .admin-task-menu {
      position:absolute; right:0; top:calc(100% + 6px); z-index:30;
      min-width:200px; padding:6px;
      background:#fff; border:1px solid #e2e8f0; border-radius:10px;
      box-shadow:0 10px 30px rgba(15,23,42,.14);
    }
    .admin-task-menu-head {
      font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em;
      color:#94a3b8; padding:6px 8px 4px;
    }
    .admin-task-menu button {
      display:block; width:100%; text-align:left; cursor:pointer;
      font-size:13px; font-weight:600; font-family:inherit; color:#0b1220;
      padding:8px 9px; border:none; border-radius:7px; background:transparent;
      min-height:36px;
    }
    .admin-task-menu button:hover { background:#f1f5f9; }
    .admin-task-menu button:focus-visible { outline:2px solid #0f172a; outline-offset:-2px; }
    .admin-task-menu-sep { height:1px; background:#f1f5f9; margin:5px 4px; }
    .admin-task-menu-clear { color:#15803d !important; }
    .admin-task-menu-clear:hover { background:#dcfce7 !important; }

    .admin-task-restore {
      align-self:center; display:inline-flex; align-items:center; gap:5px;
      font-size:12.5px; font-weight:700; font-family:inherit; cursor:pointer;
      padding:8px 12px; border-radius:8px; min-height:40px; white-space:nowrap;
      color:#475569; background:#f8fafc; border:1px solid #cbd5e1;
      transition:background .12s, color .12s, border-color .12s;
    }
    .admin-task-restore:hover { background:#0f172a; color:#fff; border-color:#0f172a; }
    .admin-task-restore:focus-visible { outline:2px solid #0f172a; outline-offset:2px; }

    .admin-task-state {
      font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.05em;
      padding:3px 8px; border-radius:999px;
    }
    .admin-task-state-snoozed { background:#e0f2fe; color:#0369a1; }
    .admin-task-state-dismissed { background:#f1f5f9; color:#64748b; }
    .admin-task-hidden { opacity:.72; background:#fcfcfd; }
    .admin-task-hidden:hover { opacity:1; }

    .admin-tasks-hidden-bar { margin-top:12px; }
    .admin-tasks-toggle {
      font-size:12.5px; font-weight:700; font-family:inherit; cursor:pointer;
      color:#475569; background:transparent; border:none; padding:6px 2px;
      text-decoration:underline; text-underline-offset:3px;
    }
    .admin-tasks-toggle:hover { color:#0b1220; }
    .admin-tasks-toggle:focus-visible { outline:2px solid #0f172a; outline-offset:2px; border-radius:4px; }
    .admin-tasks-hidden-list { margin-top:10px; }

    @media (max-width:560px) {
      .admin-task { flex-wrap:wrap; }
      .admin-task-actions { width:100%; flex-direction:row; flex-wrap:wrap; margin-top:6px; }
      .admin-task-action, .admin-task-copy, .admin-task-restore { flex:1; }
      .admin-task-manage { align-self:stretch; }
      .admin-task-manage-btn { width:100%; }
      .admin-task-menu { left:0; right:auto; }
    }
    @media (prefers-reduced-motion: reduce) {
      .admin-task, .admin-task-action, .admin-task-copy, .admin-task-restore,
      .admin-task-manage-btn, .admin-task-action svg { transition:none; }
      .admin-task:hover { transform:none; }
    }
  `;
  document.head.appendChild(s);
}
