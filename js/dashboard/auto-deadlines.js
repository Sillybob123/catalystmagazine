// js/dashboard/auto-deadlines.js
//
// Computes the automatic deadline patches the pipeline writes when key
// editorial events happen. The rules:
//
//   approval (Interview type) → deadlines.contact = approvedAt + 2d
//   interview scheduled       → deadlines.draft   = interviewDate + 7d
//   editor assigned           → deadlines.review  = assignedAt + 7d
//                               + editorAssignedAt = assignedAt
//   review complete           → deadlines.edits   = completedAt + 7d
//
// All of these are *defaults* — they only fire when the field is currently
// empty. An admin who has already set a custom date will never have it
// clobbered by automation. Same logic on the scheduler side: see the plain
// script copy at /scheduler/autoDeadlines.js. Keep the two in sync.
//
// Returns a Firestore-style update patch. Caller merges it into their own
// updateDoc/update payload.

const ONE_DAY_MS = 86400000;

// YYYY-MM-DD in local time. Matches the existing deadline storage format.
function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const d = new Date(date.getTime() + days * ONE_DAY_MS);
  return toIsoDate(d);
}

function existing(project, key) {
  return !!(project?.deadlines && project.deadlines[key]);
}

// Patch on proposal approval. Pipe in `now` so callers can use the same
// timestamp they're stamping into proposalApprovedAt.
//
// Op-Eds skip the contact deadline — they have no professor to chase.
// So do Interview-type stories flagged noInterview (no one to interview).
export function deadlinePatchOnApproval(project, now = new Date()) {
  if (!project) return {};
  if ((project.type || "Interview") !== "Interview") return {};
  if (project.noInterview) return {};
  if (existing(project, "contact")) return {};
  return { "deadlines.contact": addDays(now, 2) };
}

// Patch on Interview Scheduled (with a confirmed interview date). The
// interview row itself is already mirrored elsewhere in the caller — we
// only set the draft deadline.
export function deadlinePatchOnInterviewScheduled(project, interviewDate) {
  if (!project || !interviewDate) return {};
  if (existing(project, "draft")) return {};
  const iv = new Date(`${interviewDate}T00:00:00`);
  if (isNaN(iv.getTime())) return {};
  return { "deadlines.draft": addDays(iv, 7) };
}

// Patch on editor assignment. Always stamp editorAssignedAt (used by the
// review-overdue reminder), but only set deadlines.review if it's empty.
export function deadlinePatchOnEditorAssigned(project, now = new Date()) {
  const patch = { editorAssignedAt: now.toISOString() };
  if (!existing(project, "review")) {
    patch["deadlines.review"] = addDays(now, 7);
  }
  return patch;
}

// Patch on Review Complete checked. Gives the writer one week to address
// the editor's notes.
export function deadlinePatchOnReviewComplete(project, now = new Date()) {
  if (!project) return {};
  if (existing(project, "edits")) return {};
  return { "deadlines.edits": addDays(now, 7) };
}
