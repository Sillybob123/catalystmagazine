// POST /api/edition/notify
//
// Rings the bell for the people a This-edition post is for. The Suite writes
// the post itself (edition_hub/{edition}/messages/{id}, see js/dashboard/
// edition-hub.js) so it shows instantly, then calls this with its id. We read
// the post back, check the caller wrote it, and notify:
//   • on a piece: its writers and the section's editor (+ whoever asked, for a reply)
//   • on a section: its editor, and its writers when an editor posts
//   • edition-wide: the editors and admins, and every writer for an
//     announcement or an editor's update
// Never the author. Bell only (no email). Idempotent: one notification per
// post per person (dedupe ids), so a retry is harmless.
//
// Body: { edition, id }
// Auth: any staff role.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreUpdate, firestoreRunQuery, fromFirestoreDoc } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { createNotifications } from "../../_utils/notifications.js";

const STAFF = ["admin", "editor", "writer", "newsletter_builder", "marketing", "social_media"];
const SAFE = /^[A-Za-z0-9_-]{1,80}$/;

const first = (name) => String(name || "Someone").trim().split(/\s+/)[0];
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const uidsOf = (people) => (people || []).flatMap((p) => (Array.isArray(p?.uids) ? p.uids : []));

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, STAFF, ["#/edition"]);
    if (auth instanceof Response) return auth;

    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }
    const edition = String(body.edition || "");
    const id = String(body.id || "");
    if (!SAFE.test(edition) || !SAFE.test(id)) return badRequest("Missing post.");

    const hubDoc = await firestoreGet(env, `edition_hub/${edition}`);
    const msgDoc = await firestoreGet(env, `edition_hub/${edition}/messages/${id}`);
    if (!hubDoc || !msgDoc) return badRequest("That post doesn't exist.");
    const hub = fromFirestoreDoc(hubDoc).data;
    const msg = fromFirestoreDoc(msgDoc).data;
    if (msg.authorUid !== auth.uid) return json({ ok: false, error: "Only the author can send this." }, { status: 403 });
    if (msg.notifiedAt) return json({ ok: true, already: true });

    const sections = Array.isArray(hub.sections) ? hub.sections : [];
    const editorUids = new Set(Array.isArray(hub.editorUids) ? hub.editorUids : []);
    const authorIsEditor = editorUids.has(auth.uid) || auth.role === "admin";

    let piece = null;
    if (msg.pieceId && SAFE.test(msg.pieceId)) {
      const pd = await firestoreGet(env, `edition_hub/${edition}/pieces/${msg.pieceId}`).catch(() => null);
      piece = pd ? fromFirestoreDoc(pd).data : null;
    }
    const sectionId = piece?.section || msg.sectionId || "";
    const section = sections.find((s) => s.id === sectionId) || null;
    const sectionEditor = section?.editor ? uidsOf([section.editor]) : [];

    // Every piece, for section- and edition-wide posts that go to writers.
    const allPieces = async () => {
      const list = await firestoreGet(env, `edition_hub/${edition}/pieces?pageSize=300`).catch(() => null);
      return (list?.documents || []).map((d) => fromFirestoreDoc(d).data);
    };

    const to = new Set();
    const add = (uids) => (uids || []).forEach((u) => u && to.add(u));

    if (piece) {
      add(piece.writerUids);
      add(sectionEditor);
    } else if (section) {
      add(sectionEditor);
      if (authorIsEditor || msg.kind === "announcement") add((await allPieces()).filter((p) => p.section === section.id).flatMap((p) => p.writerUids || []));
    } else {
      add([...editorUids]);
      const admins = await firestoreRunQuery(env, {
        from: [{ collectionId: "users" }],
        where: { fieldFilter: { field: { fieldPath: "role" }, op: "EQUAL", value: { stringValue: "admin" } } },
        limit: 50,
      }).catch(() => []);
      add(admins.map((a) => a.id));
      if (msg.kind === "announcement" || (authorIsEditor && msg.kind === "update")) {
        add((await allPieces()).filter((p) => p.section !== "held").flatMap((p) => p.writerUids || []));
      }
    }

    let parent = null;
    if (msg.parentId && SAFE.test(msg.parentId)) {
      const pd = await firestoreGet(env, `edition_hub/${edition}/messages/${msg.parentId}`).catch(() => null);
      parent = pd ? fromFirestoreDoc(pd).data : null;
      if (parent?.authorUid) to.add(parent.authorUid);
    }

    // Never the author, under any of their accounts.
    const authorName = String(msg.authorName || auth.name || "").toLowerCase();
    const everyone = [...sections.map((s) => s.editor), ...(piece?.writers || [])].filter(Boolean);
    for (const p of everyone) if (String(p.name || "").toLowerCase() === authorName) (p.uids || []).forEach((u) => to.delete(u));
    to.delete(auth.uid);

    const who = first(msg.authorName || auth.name);
    const where = piece ? `“${clip(piece.title, 60)}”` : section ? section.name : String(hub.name || "this edition");
    const title = {
      question: `${who} asked a question about ${where}`,
      update: `${who} shared an update on ${where}`,
      reply: parent?.kind === "question" && parent.authorUid !== auth.uid
        ? `${who} replied to ${first(parent.authorName)}'s question on ${where}`
        : `${who} replied on ${where}`,
      announcement: `${who} posted to everyone working on ${hub.name || "this edition"}`,
    }[msg.kind] || `${who} posted on ${where}`;
    const actionHash = msg.pieceId ? `#/edition?piece=${msg.pieceId}` : "#/edition?tab=talk";

    const recipients = [...to];
    const sent = await createNotifications(env, recipients, {
      type: "message",
      eventType: `edition-${msg.kind}`,
      title,
      body: clip(msg.text, 160),
      actorId: auth.uid,
      actorName: msg.authorName || auth.name || "",
      actionHash,
    }, (rid) => `ed_${edition}_${id}_${rid}`).catch(() => 0);

    await firestoreUpdate(env, `edition_hub/${edition}/messages/${id}`, { notifiedAt: new Date().toISOString(), notifiedCount: recipients.length }).catch(() => {});
    return json({ ok: true, notified: sent });
  } catch (err) {
    return serverError(err);
  }
};
