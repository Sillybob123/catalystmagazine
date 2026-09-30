#!/usr/bin/env node
// Copy each workflow project's `edition` onto its published story.
//
// Edition pages (e.g. /edition-winter) list published stories whose
// `stories/{id}.edition` matches the page's edition. New publishes and
// Story Tracker "Move" already keep that field in sync (js/dashboard/
// publish-sync.js); this script catches stories published before their
// project was assigned an edition.
//
// A project is matched to its story by `publishedStoryId`, else by
// normalized title (same rule as publish-sync.js).
//
// Usage:
//   node scripts/backfill-editions.js           # DRY RUN — prints changes, writes nothing
//   node scripts/backfill-editions.js --write   # write them

"use strict";

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const ROOT = path.resolve(__dirname, "..");
const WRITE = process.argv.includes("--write");

function loadDevVars(fp) {
  const v = {};
  for (const raw of fs.readFileSync(fp, "utf8").split("\n")) {
    const l = raw.trim(); if (!l || l.startsWith("#")) continue;
    const eq = l.indexOf("="); if (eq === -1) continue;
    v[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
  }
  return v;
}
const dv = loadDevVars(path.join(ROOT, ".dev.vars"));
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(dv.FIREBASE_SERVICE_ACCOUNT)), projectId: dv.FIREBASE_PROJECT_ID });
const db = admin.firestore();

const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

(async () => {
  const [projects, stories] = await Promise.all([
    db.collection("projects").select("title", "edition", "publishedStoryId").get(),
    db.collection("stories").where("status", "==", "published").select("title", "edition").get(),
  ]);
  const byId = new Map(stories.docs.map((d) => [d.id, d]));
  const byTitle = new Map(stories.docs.map((d) => [norm(d.get("title")), d]));

  let changes = 0;
  const batch = db.batch();
  for (const p of projects.docs) {
    const edition = p.get("edition");
    if (!edition) continue;
    const story = byId.get(p.get("publishedStoryId")) || byTitle.get(norm(p.get("title")));
    if (!story || story.get("edition") === edition) continue;
    changes++;
    console.log(`${story.get("edition") || "(none)"} -> ${edition}   ${story.get("title")}`);
    if (WRITE) batch.update(story.ref, { edition });
  }
  if (!changes) console.log("Nothing to do: every published story already matches its project's edition.");
  else if (WRITE) { await batch.commit(); console.log(`\nWrote ${changes} stor${changes === 1 ? "y" : "ies"}.`); }
  else console.log(`\nDry run: ${changes} change(s). Re-run with --write to apply.`);
})().catch((e) => { console.error(e); process.exit(1); });
