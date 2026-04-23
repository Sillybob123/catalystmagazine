// functions/_utils/bot-logic.js
// Pure scheduling logic for the Catalyst bot. No I/O — takes data in, returns
// decisions out. Kept side-effect-free so it can be unit-tested and so the HTTP
// handler stays readable.
//
// Inputs:
//   projects: array of { id, ...projectFields } from Firestore `projects`
//   users:    array of { id, email, name, role } from Firestore `users`
//   reminders: map of { [key]: lastSentISO } read from `bot_reminder_log`
//   now:      Date (injected for testability)
//
// Outputs:
//   writerReminders: [{ kind, projectId, writer, project, daysUntilDeadline?, daysInactive? }]
//   adminDigestRows: [{ writer, projects: [...], flags: [...], copyPasteMessage }]

// ─── Tunables ────────────────────────────────────────────────────────────────

export const DEADLINE_WARN_DAYS = [3, 1];   // fire reminder at 3d and 1d before deadline
export const IDLE_DAYS_THRESHOLD = 10;      // days of no activity → idle nudge
export const REMINDER_COOLDOWN_DAYS = 7;    // don't re-nag the same kind within this window
export const BOT_REMINDER_EXEMPTION_TIMEZONE = "America/New_York";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isProjectComplete(project) {
  const tl = project.timeline || {};
  return !!tl["Suggestions Reviewed"];
}

export function publicationDeadline(project) {
  return (project.deadlines && project.deadlines.publication) || project.deadline || null;
}

export function daysBetween(a, b) {
  const MS = 86400000;
  return Math.floor((a.getTime() - b.getTime()) / MS);
}

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "object" && v.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function uniqueStrings(values) {
  return [...new Set(
    (values || [])
      .filter((v) => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean)
  )];
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameParts(value) {
  return normalizeName(value).split(" ").filter(Boolean);
}

function firstLastSignature(value) {
  const parts = nameParts(value);
  if (!parts.length) return "";
  return `${parts[0]}|${parts[parts.length - 1]}`;
}

function userNameVariants(user) {
  return uniqueStrings([
    user?.name,
    user?.displayName,
  ]);
}

function damerauLevenshtein(a, b, maxDistance = 2) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const da = Object.create(null);
  const rows = a.length + 2;
  const cols = b.length + 2;
  const max = a.length + b.length;
  const d = Array.from({ length: rows }, () => Array(cols).fill(0));

  d[0][0] = max;
  for (let i = 0; i <= a.length; i++) {
    d[i + 1][0] = max;
    d[i + 1][1] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    d[0][j + 1] = max;
    d[1][j + 1] = j;
  }

  for (const ch of new Set((a + b).split(""))) da[ch] = 0;

  for (let i = 1; i <= a.length; i++) {
    let db = 0;
    for (let j = 1; j <= b.length; j++) {
      const i1 = da[b[j - 1]] || 0;
      const j1 = db;
      let cost = 1;
      if (a[i - 1] === b[j - 1]) {
        cost = 0;
        db = j;
      }
      d[i + 1][j + 1] = Math.min(
        d[i][j] + cost,
        d[i + 1][j] + 1,
        d[i][j + 1] + 1,
        d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1)
      );
    }
    da[a[i - 1]] = i;
  }

  return d[a.length + 1][b.length + 1];
}

function namesLooselyMatch(a, b) {
  const aNorm = normalizeName(a);
  const bNorm = normalizeName(b);
  if (!aNorm || !bNorm) return false;
  if (aNorm === bNorm) return true;

  const aParts = aNorm.split(" ");
  const bParts = bNorm.split(" ");
  if (aParts.length === bParts.length && aParts.length >= 2) {
    let typoCount = 0;
    for (let i = 0; i < aParts.length; i++) {
      if (aParts[i] === bParts[i]) continue;
      if (damerauLevenshtein(aParts[i], bParts[i], 1) > 1) return false;
      typoCount++;
    }
    if (typoCount === 1) return true;
  }

  return false;
}

function userPreferenceScore(user) {
  let score = 0;
  if (user?.email) score += 1000;
  if ((user?.status || "").toLowerCase() === "active") score += 40;
  if (user?.role && user.role !== "reader") score += 10;
  if (user?.lastSeenAt) score += 8;
  if (user?.updatedAt) score += 4;
  if (user?.createdAt) score += 4;
  score += userNameVariants(user).length * 2;
  return score;
}

function dateKeyInTimeZone(date, timeZone = BOT_REMINDER_EXEMPTION_TIMEZONE) {
  const d = toDate(date);
  if (!d) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!byType.year || !byType.month || !byType.day) return null;
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function normalizeExemptionDate(v) {
  if (!v) return null;
  if (typeof v === "string") {
    const match = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  return dateKeyInTimeZone(v);
}

export function activeBotReminderExemption(user, now = new Date()) {
  const raw = user?.botReminderExemption;
  if (!raw || typeof raw !== "object") return null;

  const untilDate = normalizeExemptionDate(raw.untilDate || raw.until || null);
  const today = dateKeyInTimeZone(now);
  if (untilDate && today && untilDate < today) return null;

  const updatedAt = toDate(raw.updatedAt);
  return {
    untilDate: untilDate || null,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : null,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
    updatedById: raw.updatedById || null,
    updatedByName: raw.updatedByName || null,
  };
}

export function lastActivityDate(project) {
  const candidates = [
    project.lastActivity,
    project.updatedAt,
    project.createdAt,
    ...((project.activity || []).map((a) => a && a.timestamp)),
  ];
  let latest = 0;
  for (const c of candidates) {
    const d = toDate(c);
    if (d && d.getTime() > latest) latest = d.getTime();
  }
  return latest ? new Date(latest) : null;
}

export function daysInactive(project, now) {
  const d = lastActivityDate(project);
  if (!d) return null;
  return daysBetween(now, d);
}

function findUser(users, { uid, name, email }) {
  // Projects can carry a stale authorId that points at an incomplete user row
  // while a newer row for the same person has the real email. Rank matches by
  // both confidence and record completeness so we pick the row we can actually
  // contact, even if the project carries an old uid or a small name typo.
  const matches = new Map();

  const addMatch = (user, confidence) => {
    if (!user) return;
    const key = user.id || `${user.email || ""}|${user.name || ""}|${user.displayName || ""}`;
    const prev = matches.get(key);
    if (!prev || confidence > prev.confidence) {
      matches.set(key, { user, confidence });
    }
  };

  const addNameMatches = (target, scores = {}) => {
    const {
      exact = 85,
      normalized = 82,
      firstLast = 78,
      loose = 72,
    } = scores;
    const raw = String(target || "").trim();
    const norm = normalizeName(raw);
    const signature = firstLastSignature(raw);
    if (!raw && !norm) return;

    for (const user of users) {
      let best = 0;
      for (const variant of userNameVariants(user)) {
        if (variant === raw) {
          best = Math.max(best, exact);
        } else if (normalizeName(variant) === norm) {
          best = Math.max(best, normalized);
        } else if (signature && firstLastSignature(variant) === signature) {
          best = Math.max(best, firstLast);
        } else if (namesLooselyMatch(variant, raw)) {
          best = Math.max(best, loose);
        }
      }
      if (best) addMatch(user, best);
    }
  };

  if (uid) {
    const byUid = users.find((u) => u.id === uid);
    if (byUid) {
      addMatch(byUid, 95);
      for (const variant of userNameVariants(byUid)) {
        addNameMatches(variant, { exact: 88, normalized: 85, firstLast: 82, loose: 74 });
      }
    }
  }

  if (email) {
    const lowered = email.toLowerCase();
    users
      .filter((u) => (u.email || "").toLowerCase() === lowered)
      .forEach((u) => addMatch(u, 100));
  }

  if (name) {
    addNameMatches(name);
  }

  const ranked = [...matches.values()].sort((a, b) => {
    const aScore = a.confidence + userPreferenceScore(a.user);
    const bScore = b.confidence + userPreferenceScore(b.user);
    return bScore - aScore;
  });

  return ranked[0]?.user || null;
}

export function writerFor(project, users) {
  const match = findUser(users, {
    uid: project.authorId,
    name: project.authorName,
    email: project.authorEmail,
  });

  // If we matched a user but they have no email on their row, prefer the
  // project's own authorEmail (that field is set from Firebase Auth at the
  // time the project was created, so it's often the most reliable source).
  if (match && !match.email && project.authorEmail) {
    return { ...match, email: project.authorEmail };
  }

  // If no user row matched at all but the project carries an author email,
  // synthesize a minimal writer record so we can still reach them.
  if (!match && project.authorEmail) {
    return {
      id: project.authorId || null,
      name: project.authorName || project.authorEmail,
      email: project.authorEmail,
    };
  }

  return match;
}

function shouldSkipReminder(log, key, now) {
  const last = log[key];
  if (!last) return false;
  const lastDate = toDate(last);
  if (!lastDate) return false;
  return daysBetween(now, lastDate) < REMINDER_COOLDOWN_DAYS;
}

// ─── Writer reminders ────────────────────────────────────────────────────────
//
// Returns one record per (writer, project, kind) that should be emailed *today*.
// "kind" is one of: "deadline-3d", "deadline-1d", "deadline-overdue", "idle".

export function computeWriterReminders({ projects, users, reminderLog = {}, now }) {
  const out = [];
  const skipped = [];

  const record = (projectId, projectTitle, reason, extra = {}) => {
    skipped.push({ projectId, projectTitle, reason, ...extra });
  };

  for (const project of projects) {
    const title = project.title || "(untitled)";

    if (isProjectComplete(project)) {
      record(project.id, title, "project-complete");
      continue;
    }

    const writer = writerFor(project, users);
    if (!writer) {
      record(project.id, title, "writer-not-found", {
        authorId: project.authorId || null,
        authorName: project.authorName || null,
        authorEmail: project.authorEmail || null,
      });
      continue;
    }
    if (!writer.email) {
      record(project.id, title, "writer-has-no-email", {
        writerName: writer.name,
        writerId: writer.id,
      });
      continue;
    }

    const exemption = activeBotReminderExemption(writer, now);
    if (exemption) {
      record(project.id, title, "writer-exempt", {
        writerEmail: writer.email,
        writerName: writer.name,
        writerId: writer.id || null,
        exemption,
      });
      continue;
    }

    let queuedForProject = false;

    // ── Deadline reminders ──
    const deadlineStr = publicationDeadline(project);
    if (deadlineStr) {
      const deadline = toDate(deadlineStr + (deadlineStr.includes("T") ? "" : "T23:59:59"));
      if (deadline) {
        const days = daysBetween(deadline, now);
        let kind = null;
        if (days < 0) kind = "deadline-overdue";
        else if (days === 1 || days === 0) kind = "deadline-1d";
        else if (days === 3) kind = "deadline-3d";

        if (kind) {
          const key = `${project.id}:${kind}`;
          const last = reminderLog[key];
          if (shouldSkipReminder(reminderLog, key, now)) {
            record(project.id, title, "cooldown-active", {
              kind,
              lastSentAt: last,
              writerEmail: writer.email,
              writerName: writer.name,
            });
          } else {
            out.push({
              kind,
              key,
              projectId: project.id,
              project,
              writer,
              deadline,
              daysUntilDeadline: days,
            });
            queuedForProject = true;
          }
        }
      }
    }

    // ── Idle nudge ── (only if no deadline reminder already queued for this project)
    if (!queuedForProject) {
      const inactive = daysInactive(project, now);
      if (inactive == null) {
        record(project.id, title, "no-activity-data", {
          writerEmail: writer.email,
          writerName: writer.name,
        });
      } else if (inactive < IDLE_DAYS_THRESHOLD) {
        // Only report this for projects that are close to idle (>= 5d) — otherwise the list
        // becomes noisy. Still useful to see "was this close to triggering?" in the preview.
        if (inactive >= 5) {
          record(project.id, title, "not-idle-yet", {
            daysInactive: inactive,
            threshold: IDLE_DAYS_THRESHOLD,
            writerEmail: writer.email,
            writerName: writer.name,
          });
        }
      } else {
        const key = `${project.id}:idle`;
        const last = reminderLog[key];
        if (shouldSkipReminder(reminderLog, key, now)) {
          record(project.id, title, "cooldown-active", {
            kind: "idle",
            lastSentAt: last,
            daysInactive: inactive,
            writerEmail: writer.email,
            writerName: writer.name,
          });
        } else {
          out.push({
            kind: "idle",
            key,
            projectId: project.id,
            project,
            writer,
            daysInactive: inactive,
          });
        }
      }
    }
  }

  return { reminders: out, skipped };
}

// ─── Admin digest ────────────────────────────────────────────────────────────
//
// Groups every active project by writer, flags the problems, and produces a
// copy-paste-ready message the admin can send to that writer.

export function computeAdminDigest({ projects, users, now }) {
  const activeProjects = projects.filter((p) => !isProjectComplete(p));
  const byWriter = new Map();

  for (const project of activeProjects) {
    const writer = writerFor(project, users);
    const writerKey =
      writer?.id ||
      (writer?.email ? `email:${writer.email.toLowerCase()}` : null) ||
      (project.authorEmail ? `email:${project.authorEmail.toLowerCase()}` : null) ||
      `unknown:${(writer?.name || project.authorName || "Unassigned").toLowerCase()}`;
    if (!byWriter.has(writerKey)) {
      const exemption = activeBotReminderExemption(writer, now);
      byWriter.set(writerKey, {
        writer,
        writerName: writer?.name || project.authorName || "Unassigned",
        writerEmail: writer?.email || null,
        exemption,
        projects: [],
      });
    }
    const row = byWriter.get(writerKey);

    const flags = [];
    const deadlineStr = publicationDeadline(project);
    const deadline = deadlineStr
      ? toDate(deadlineStr + (deadlineStr.includes("T") ? "" : "T23:59:59"))
      : null;
    if (deadline && !row.exemption) {
      const days = daysBetween(deadline, now);
      if (days < 0) flags.push({ kind: "overdue", days: -days, deadline });
      else if (days <= 3) flags.push({ kind: "deadline-soon", days, deadline });
    }
    const inactive = daysInactive(project, now);
    if (!row.exemption && inactive != null && inactive >= IDLE_DAYS_THRESHOLD) {
      flags.push({ kind: "idle", days: inactive });
    }
    if (project.proposalStatus === "pending") {
      flags.push({ kind: "proposal-pending" });
    }
    if (project.deadlineRequest?.status === "pending" || project.deadlineChangeRequest?.status === "pending") {
      flags.push({ kind: "deadline-request-pending" });
    }

    const stage = currentStageLabel(project);

    row.projects.push({
      id: project.id,
      title: project.title || "(untitled)",
      stage,
      deadline,
      deadlineStr,
      daysInactive: inactive,
      flags,
    });
  }

  const rows = [...byWriter.values()];

  // Sort: writers with flagged projects first, then by name.
  rows.sort((a, b) => {
    const aFlagged = a.projects.some((p) => p.flags.length > 0);
    const bFlagged = b.projects.some((p) => p.flags.length > 0);
    if (aFlagged !== bFlagged) return aFlagged ? -1 : 1;
    return (a.writerName || "").localeCompare(b.writerName || "");
  });

  // Attach a copy-paste message for each flagged writer. Alternate the signoff
  // across actual generated messages so admins get:
  //   Yair and Aidan
  //   Aidan and Yair
  //   Yair and Aidan
  //   ...
  let signoffIndex = 0;
  for (const row of rows) {
    row.copyPasteMessage = buildCopyPasteMessage(row, signoffIndex);
    if (row.copyPasteMessage) signoffIndex++;
  }

  return rows;
}

function currentStageLabel(project) {
  if (project.proposalStatus !== "approved") {
    return `Proposal ${project.proposalStatus || "pending"}`;
  }
  const tl = project.timeline || {};
  if (project.type === "Interview" && !tl["Interview Complete"]) {
    return tl["Interview Scheduled"] ? "Interview scheduled" : "Schedule interview";
  }
  if (!tl["Article Writing Complete"]) return "Writing in progress";
  if (!project.editorId) return "Awaiting editor";
  if (!tl["Review Complete"]) return "Under editor review";
  if (!tl["Suggestions Reviewed"]) return "Author reviewing feedback";
  return "Ready to publish";
}

function digestMessageSignoff(index = 0) {
  return index % 2 === 0 ? "Yair and Aidan" : "Aidan and Yair";
}

function buildCopyPasteMessage(row, signoffIndex = 0) {
  if (row.exemption) return null;
  const flagged = row.projects.filter((p) => p.flags.length > 0);
  if (!flagged.length) return null;

  const firstName = (row.writerName || "there").split(/\s+/)[0];
  const lines = [`Hey ${firstName}!`, ""];

  if (flagged.length === 1) {
    const p = flagged[0];
    lines.push(flagLine(p));
  } else {
    lines.push("A quick check-in on your stories with us:");
    lines.push("");
    for (const p of flagged) {
      lines.push(`• "${p.title}" — ${flagLine(p, { short: true })}`);
    }
  }

  lines.push("");
  lines.push("Let us know how it's going or if anything's blocking you — we're happy to help. Thanks for all you do for The Catalyst!");
  lines.push("");
  lines.push(`— ${digestMessageSignoff(signoffIndex)}`);

  return lines.join("\n");
}

function flagLine(p, { short = false } = {}) {
  const overdue = p.flags.find((f) => f.kind === "overdue");
  const soon = p.flags.find((f) => f.kind === "deadline-soon");
  const idle = p.flags.find((f) => f.kind === "idle");
  const proposalPending = p.flags.some((f) => f.kind === "proposal-pending");

  const parts = [];
  if (!short) parts.push(`I'm checking in on your story "${p.title}."`);
  if (overdue) {
    parts.push(short
      ? `publication deadline was ${overdue.days} day${overdue.days === 1 ? "" : "s"} ago`
      : `The publication deadline was ${overdue.days} day${overdue.days === 1 ? "" : "s"} ago — let us know where you're at and whether you need more time.`);
  } else if (soon) {
    parts.push(short
      ? `deadline in ${soon.days} day${soon.days === 1 ? "" : "s"}`
      : `Your publication deadline is in ${soon.days} day${soon.days === 1 ? "" : "s"} — just a heads-up so nothing sneaks up on you.`);
  }
  if (idle) {
    parts.push(short
      ? `${idle.days} days with no activity`
      : `We noticed the piece has been quiet for ${idle.days} days. No pressure — just wanted to make sure it's still on your radar.`);
  }
  if (proposalPending && !overdue && !soon && !idle) {
    parts.push(short
      ? `proposal still pending review`
      : `Your topic proposal is still waiting on approval — we'll get it looked at.`);
  }
  return parts.join(" ");
}
