// GET /api/bot/email-log
//
// Admin-only. Returns the recent bot email activity log (writer/editor
// reminders only — admin digests are excluded). Joins each entry with the
// project's *current* lastActivity so the admin UI can flag rows where the
// project hasn't moved since the email was sent (the "ignored" signal).

import { json, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreRunQuery } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { lastActivityDate } from "../../_utils/bot-logic.js";

const EMAIL_LOG_PATH = "bot_email_log/recent";

// How long after a send before we consider an unchanged project "ignored",
// keyed by reminder kind. Editor/writer "deadline-1d" or "interview-prep" need
// faster turnaround than a generic idle nudge.
const STALE_DAYS_BY_KIND = {
  "idle":              3,
  "editor-idle":       3,
  "deadline-3d":       2,
  "deadline-1d":       1,
  "deadline-overdue":  2,
  "interview-prep":    1,
  "interview-followup":2,
  "post-approval-idle":3,
  "editor-just-assigned": 3,
};
const STALE_DAYS_DEFAULT = 3;

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"]);
    if (auth instanceof Response) return auth;

    const [logDoc, projects] = await Promise.all([
      firestoreGet(env, EMAIL_LOG_PATH).catch(() => null),
      loadAllProjects(env),
    ]);

    const entries = decodeEntries(logDoc);
    const projectsById = new Map(projects.map((p) => [p.id, p]));

    const now = Date.now();
    const annotated = entries
      .filter((e) => e.role !== "admin") // admin digests excluded per spec
      .map((e) => {
        const project = projectsById.get(e.projectId) || null;
        const currentActivity = project ? lastActivityDate(project) : null;
        const sentAtMs = Date.parse(e.sentAt || "");
        const sentActivityMs = Date.parse(e.projectActivityAtSend || "");
        const hoursSinceSent = Number.isFinite(sentAtMs) ? (now - sentAtMs) / 3600000 : null;
        const daysSinceSent = hoursSinceSent != null ? hoursSinceSent / 24 : null;

        // "No change since email" = current lastActivity ≤ what it was at send.
        // If we don't have a snapshot, fall back to "current activity older
        // than the email itself."
        let unchanged = null;
        if (currentActivity) {
          if (Number.isFinite(sentActivityMs)) {
            unchanged = currentActivity.getTime() <= sentActivityMs;
          } else if (Number.isFinite(sentAtMs)) {
            unchanged = currentActivity.getTime() <= sentAtMs;
          }
        }

        const staleAfter = STALE_DAYS_BY_KIND[e.kind] ?? STALE_DAYS_DEFAULT;
        const ignored = unchanged === true && daysSinceSent != null && daysSinceSent >= staleAfter;
        const projectComplete = project ? !!(project.timeline && project.timeline["Suggestions Reviewed"]) : false;

        return {
          ...e,
          projectMissing: !project,
          projectComplete,
          currentLastActivity: currentActivity ? currentActivity.toISOString() : null,
          daysSinceSent,
          unchangedSinceEmail: unchanged,
          ignored: ignored && !projectComplete, // a finished project isn't "ignored"
          staleThresholdDays: staleAfter,
        };
      });

    // Newest first.
    annotated.sort((a, b) => Date.parse(b.sentAt || 0) - Date.parse(a.sentAt || 0));

    return json({
      ok: true,
      count: annotated.length,
      entries: annotated,
    });
  } catch (err) {
    return serverError(err);
  }
};

async function loadAllProjects(env) {
  const rows = await firestoreRunQuery(env, {
    from: [{ collectionId: "projects" }],
    limit: 2000,
  });
  return rows.map((r) => ({ id: r.id, ...r.data }));
}

function decodeEntries(doc) {
  const arr = doc?.fields?.entries?.arrayValue?.values;
  if (!Array.isArray(arr)) return [];
  return arr.map(firestoreValueToJs).filter((v) => v && typeof v === "object");
}

function firestoreValueToJs(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(firestoreValueToJs);
  if ("mapValue" in v) {
    const out = {};
    for (const [k, vv] of Object.entries(v.mapValue.fields || {})) {
      out[k] = firestoreValueToJs(vv);
    }
    return out;
  }
  return null;
}
