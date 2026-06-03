// /api/admin/submissions
//
// GET   → list every collaboration_requests doc (Join the Team + article
//         proposals submitted via the public collaborate page), with all
//         fields the public form captured. Sorted newest-first.
// POST  → update a single submission (mark as reviewed / archived, add
//         a note). Body: { id, patch: { status, reviewerNote } }.
//
// Admin-only. Editors and writers don't see this page.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreRunQuery, firestoreUpdate } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";

const ALLOWED_STATUSES = new Set(["new", "reviewing", "replied", "archived"]);

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"], ["#/admin/submissions"]);
    if (auth instanceof Response) return auth;

    let docs;
    try {
      docs = await firestoreRunQuery(env, {
        from: [{ collectionId: "collaboration_requests" }],
        // No orderBy in the query — older Firestore docs may be missing
        // createdAt and would be excluded by an indexed orderBy. Sort
        // client-side below where we can be tolerant of missing values.
        limit: 500,
      });
    } catch (queryErr) {
      // Surface the real Firestore error to the client so we can fix
      // it instead of getting a generic "Internal server error".
      console.error("[admin/submissions] runQuery failed:", queryErr);
      return json(
        { ok: false, error: "Firestore query failed", message: queryErr?.message || String(queryErr) },
        { status: 500 }
      );
    }

    const submissions = docs
      .map((d) => ({
        id: d.id,
        // Form fields (everything the public collaborate form captures).
        name: d.data.name || "",
        email: d.data.email || "",
        phone: d.data.phone || "",
        role: d.data.role || d.data.interest || d.data.position || "",
        selectedRole: d.data.selectedRole || "",
        otherRole: d.data.otherRole || "",
        message: d.data.message || "",
        portfolio: d.data.portfolio || d.data.link || "",
        articleTitle: d.data.articleTitle || d.data.title || "",
        // Triage state (admin-mutable).
        status: d.data.status || "new",
        reviewerNote: d.data.reviewerNote || "",
        reviewedAt: d.data.reviewedAt || "",
        reviewedBy: d.data.reviewedBy || "",
        // Source separates "join-team" applications from article proposals
        // (anything else: "collaborate-form", "proposal-form", etc.).
        source: d.data.source || "collaborate-form",
        createdAt: d.data.createdAt || "",
        ip: d.data.ip || "",
      }))
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    // Lightweight per-source counts so the UI can render tab badges
    // without recomputing in the browser.
    const counts = { joinTeam: 0, proposal: 0, other: 0, total: submissions.length, unread: 0 };
    for (const s of submissions) {
      if (s.source === "join-team") counts.joinTeam++;
      else if (s.source === "proposal-form" || s.source === "proposal") counts.proposal++;
      else counts.other++;
      if (s.status === "new") counts.unread++;
    }

    return json({ ok: true, submissions, counts });
  } catch (err) {
    return serverError(err);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"], ["#/admin/submissions"]);
    if (auth instanceof Response) return auth;

    let body;
    try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }

    const id = String(body.id || "").trim();
    if (!id) return badRequest("id is required");
    const patch = body.patch || {};

    const update = {};
    if (typeof patch.status === "string") {
      if (!ALLOWED_STATUSES.has(patch.status)) {
        return badRequest(`status must be one of: ${[...ALLOWED_STATUSES].join(", ")}`);
      }
      update.status = patch.status;
    }
    if (typeof patch.reviewerNote === "string") {
      update.reviewerNote = patch.reviewerNote.slice(0, 2000);
    }

    if (!Object.keys(update).length) return badRequest("Nothing to update");

    update.reviewedAt = new Date().toISOString();
    update.reviewedBy = auth.name || auth.email || auth.uid || "admin";

    await firestoreUpdate(env, `collaboration_requests/${id}`, update);
    return json({ ok: true, id, update });
  } catch (err) {
    return serverError(err);
  }
};
