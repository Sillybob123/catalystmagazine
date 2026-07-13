// Publish-state bridge between the two editorial datasets.
//
// Stories (the `stories` collection) are what actually get published on the
// site; workflow projects (the `projects` collection, shown on the pipeline
// kanban) track the writing/editing lifecycle and historically carried no
// "published" flag — once a piece hit "Suggestions Reviewed" it sat in the
// Completed column looking identical whether or not it was live.
//
// This module gives projects a publish state:
//   • `markStoryPublishedOnProject(story, byName)` — called (best-effort) from
//     every publish path. Finds the workflow project whose title matches the
//     story and stamps `publishedAt` / `publishedStoryId` on it, plus an
//     activity entry so the feed reads "published the story".
//   • `fetchPublishedTitleSet()` — normalized titles of every published story,
//     so the kanban / briefing can recognize legacy projects that were
//     published before this stamp existed (title match ⇒ treat as published).
//   • `isProjectPublished(project, titleSet)` — the single truth test.
//
// Matching is by normalized title (lowercase, alphanumerics only). Titles can
// drift between proposal and publication, so the stamp is the reliable path
// and the title set is the backfill; an admin can also stamp manually from the
// project detail modal.

import { db } from "../firebase-config.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export function normTitle(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function isProjectPublished(project, publishedTitleSet) {
  if (!project) return false;
  if (project.publishedAt || project.publishedStoryId) return true;
  if (publishedTitleSet && publishedTitleSet.size) {
    const key = normTitle(project.title);
    if (key && publishedTitleSet.has(key)) return true;
  }
  return false;
}

// True once the workflow says the piece is fully edited (terminal step).
export function isProjectCompleted(project) {
  return !!(project && project.timeline && project.timeline["Suggestions Reviewed"]);
}

// Normalized titles of published stories, fetched via the public REST
// runQuery endpoint (published stories are world-readable) with a title-only
// projection so we never pull article bodies.
export async function fetchPublishedTitleSet() {
  const endpoint = "https://firestore.googleapis.com/v1/projects/catalystwriters-5ce43/databases/(default)/documents:runQuery";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "stories" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "published" },
          },
        },
        select: { fields: [{ fieldPath: "title" }] },
        limit: 1000,
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  const rows = await res.json();
  const set = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = normTitle(r.document?.fields?.title?.stringValue);
    if (key) set.add(key);
  }
  return set;
}

/**
 * Stamp the workflow project that corresponds to a just-published story.
 * Fire-and-forget: callers must never let a failure here block the publish
 * itself (the story is already live). Returns true if a project was stamped.
 */
export async function markStoryPublishedOnProject(story, byName) {
  try {
    const key = normTitle(story?.title);
    if (!key) return false;
    const snap = await getDocs(collection(db, "projects"));
    const candidates = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => normTitle(p.title) === key);
    if (!candidates.length) return false;
    // Prefer one that isn't already stamped (re-publishing shouldn't re-stamp
    // an unrelated duplicate); otherwise nothing to do.
    const target = candidates.find((p) => !p.publishedAt && !p.publishedStoryId);
    if (!target) return false;
    await updateDoc(doc(db, "projects", target.id), {
      publishedAt: new Date().toISOString(),
      publishedStoryId: story.id || "",
      lastActivity: serverTimestamp(),
      updatedAt: new Date().toISOString(),
      activity: arrayUnion({
        text: "published the story 🎉",
        authorName: byName || "Admin",
        authorId: "",
        timestamp: new Date().toISOString(),
      }),
    });
    return true;
  } catch (e) {
    console.warn("[publish-sync] could not stamp workflow project (non-blocking)", e);
    return false;
  }
}
