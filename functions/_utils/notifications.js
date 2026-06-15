// functions/_utils/notifications.js
//
// Shared helper that writes one in-app notification doc to the `notifications`
// collection — the data behind the dashboard topbar bell. Called best-effort
// by the /api/notify/* endpoints right alongside the email they already send,
// so a person sees "something needs me" inside the dashboard, not just in their
// inbox.
//
// Design notes:
//  • Server-only writes. Firestore rules set `create: if false` for clients, so
//    only these functions (running on the service account, which bypasses
//    rules) can mint a notification. Clients can only flip read-state.
//  • Best-effort + never throws. A notification-write failure must never turn an
//    already-sent email into a 500 — callers wrap this and ignore the result,
//    but we also swallow everything here as a second line of defense.
//  • Idempotent when given a dedupeId. We pass it as the Firestore documentId;
//    a repeat fire collides (409) and we treat that as a successful no-op, so
//    the same event never double-notifies the same person.

import { firestoreCreate } from "./firebase.js";

// Create a single notification for one recipient. Returns true on a fresh
// write, false on dedupe/skip/failure. Never throws.
//
// fields:
//   recipientId  (required) — uid the notification is for
//   type         (required) — "message" | "comment" | "assignment" | "published" | "event"
//   eventType    (optional) — workflow sub-type for type:"event"
//   title        (required) — one-line headline shown in the bell
//   body         (optional) — short preview line
//   actorId      (optional) — uid of who triggered it
//   actorName    (optional) — display name of who triggered it
//   actionHash   (optional) — dashboard hash to open on click, e.g. "#/editor/queue"
// dedupeId (optional) — deterministic doc id so retries/re-fires are no-ops.
export async function createNotification(env, fields, dedupeId) {
  try {
    const recipientId = String(fields?.recipientId || "").trim();
    const title = String(fields?.title || "").trim();
    if (!recipientId || !title) return false; // nothing useful to store

    const doc = {
      recipientId,
      type: String(fields.type || "event"),
      eventType: fields.eventType ? String(fields.eventType) : "",
      title: title.slice(0, 200),
      body: fields.body ? String(fields.body).slice(0, 400) : "",
      actorId: fields.actorId ? String(fields.actorId) : "",
      actorName: fields.actorName ? String(fields.actorName).slice(0, 120) : "",
      actionHash: fields.actionHash ? String(fields.actionHash).slice(0, 200) : "",
      read: false,
      createdAt: new Date().toISOString(),
    };

    // A clean dedupeId keeps the doc id Firestore-safe (no slashes etc.).
    const safeId = dedupeId
      ? String(dedupeId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 1500)
      : undefined;

    await firestoreCreate(env, "notifications", doc, safeId);
    return true;
  } catch (err) {
    // 409 = a doc with this dedupeId already exists → already notified. Any
    // other error is logged and swallowed so the caller's email still succeeds.
    const msg = String(err?.message || err);
    if (!/\b409\b|ALREADY_EXISTS/i.test(msg)) {
      console.warn("[notifications] createNotification failed:", msg);
    }
    return false;
  }
}

// Convenience for fanning a notification out to several recipients (e.g. a
// multi-owner social assignment). Skips falsy/duplicate uids and the actor
// themselves. Returns the count actually written.
export async function createNotifications(env, recipientIds, fields, dedupeIdFor) {
  const seen = new Set();
  let written = 0;
  for (const rid of recipientIds || []) {
    const id = String(rid || "").trim();
    if (!id || seen.has(id)) continue;
    if (fields?.actorId && id === fields.actorId) continue; // don't notify yourself
    seen.add(id);
    const dedupeId = typeof dedupeIdFor === "function" ? dedupeIdFor(id) : undefined;
    const ok = await createNotification(env, { ...fields, recipientId: id }, dedupeId);
    if (ok) written++;
  }
  return written;
}
