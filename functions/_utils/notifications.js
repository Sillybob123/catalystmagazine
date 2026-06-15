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

import { firestoreCreate, firestoreRunQuery } from "./firebase.js";

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

// ─── email-keyed notifications ───────────────────────────────────────────────
// Many email sites (the bot's daily reminders, task/calendar notifies) only
// know the recipient's EMAIL, not their uid. These helpers turn an email into a
// uid (cached per request) so those sites can mirror their email into a bell
// notification with a one-liner.

// Resolve a staff member's uid from their email. `cache` is an optional
// Map shared across a single request (e.g. one bot run) so resolving 30
// reminders doesn't issue 30 identical Firestore queries. Returns "" if not
// found. Never throws.
export async function resolveUidByEmail(env, email, cache) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return "";
  if (cache && cache.has(key)) return cache.get(key);
  let uid = "";
  try {
    const rows = await firestoreRunQuery(env, {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "email" },
          op: "EQUAL",
          value: { stringValue: key },
        },
      },
      select: { fields: [{ fieldPath: "email" }] },
      limit: 1,
    });
    uid = rows && rows.length ? rows[0].id : "";
  } catch (err) {
    console.warn("[notifications] resolveUidByEmail failed:", String(err?.message || err));
  }
  if (cache) cache.set(key, uid);
  return uid;
}

// Create a notification for one-or-more email addresses by resolving each to a
// uid first. Use for send sites that only carry emails. `dedupeKey`, when
// given, is suffixed per-recipient so the same daily reminder doesn't stack.
// Best-effort; never throws. Returns the count written.
export async function notifyByEmail(env, emails, fields, { dedupeKey = "", cache } = {}) {
  const list = Array.isArray(emails) ? emails : [emails];
  const resolved = [];
  for (const e of list) {
    const uid = await resolveUidByEmail(env, e, cache);
    if (uid) resolved.push(uid);
  }
  if (!resolved.length) return 0;
  return createNotifications(env, resolved, fields,
    dedupeKey ? (uid) => `${dedupeKey}_${uid}` : undefined);
}

// All admin users as { uid, email }. Used to fan admin-broadcast emails (story
// updates, digests, admin-task reminders) into per-admin bell notifications.
// `cache` (optional Map) memoizes the list for a request. Never throws.
export async function getAdminUsers(env, cache) {
  if (cache && cache.has("__admins__")) return cache.get("__admins__");
  let admins = [];
  try {
    const rows = await firestoreRunQuery(env, {
      from: [{ collectionId: "users" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "role" },
          op: "EQUAL",
          value: { stringValue: "admin" },
        },
      },
      select: { fields: [{ fieldPath: "email" }] },
      limit: 50,
    });
    admins = (rows || []).map((r) => ({ uid: r.id, email: r.data?.email || "" }));
  } catch (err) {
    console.warn("[notifications] getAdminUsers failed:", String(err?.message || err));
  }
  if (cache) cache.set("__admins__", admins);
  return admins;
}
