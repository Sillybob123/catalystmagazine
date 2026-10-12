#!/usr/bin/env node
// Remove email addresses from published stories.
//
// Published stories are world-readable (firestore.rules allows reads when
// status == 'published', and rules can't hide single fields), so anything on
// a story doc is public. Book reviews approved before 2026-10-12 carried the
// reader's `submitterEmail` and the approving admin's email in `publishedBy`
// (functions/api/book-reviews/decide.js no longer writes either). The
// reader's email stays on the staff-only bookReviewSubmissions doc linked by
// sourceSubmissionId; this script checks that before touching anything.
//
// Usage:
//   node scripts/strip-story-pii.js           # DRY RUN — lists docs, writes a backup, changes nothing
//   node scripts/strip-story-pii.js --write   # delete submitterEmail + email-valued publishedBy
//
// Backup of the removed values: scripts/.story-pii-backup.json (gitignored —
// it holds the emails; delete it once you're satisfied).

"use strict";

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const ROOT = path.resolve(__dirname, "..");
const WRITE = process.argv.includes("--write");
const BACKUP = path.join(ROOT, "scripts", ".story-pii-backup.json");

// ── Firestore admin connection (same pattern as backfill-tags.js) ──
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
const serviceAccount = JSON.parse(dv.FIREBASE_SERVICE_ACCOUNT);
const projectId = dv.FIREBASE_PROJECT_ID;
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId });
const db = admin.firestore();

(async () => {
  const snap = await db.collection("stories").where("status", "==", "published").get();
  const targets = snap.docs.filter((d) =>
    d.get("submitterEmail") !== undefined || /@/.test(String(d.get("publishedBy") || "")));

  const backup = [];
  let unsafe = 0;
  for (const d of targets) {
    const subId = d.get("sourceSubmissionId");
    const email = d.get("submitterEmail");
    let kept = email === undefined;
    if (!kept && subId) {
      const sub = await db.collection("bookReviewSubmissions").doc(subId).get();
      kept = sub.exists && sub.get("submitterEmail") === email;
    }
    if (!kept) unsafe++;
    backup.push({ id: d.id, title: d.get("title"), submitterEmail: email ?? null, publishedBy: d.get("publishedBy") ?? null, sourceSubmissionId: subId ?? null, emailKeptOnSubmission: kept });
    console.log(`${kept ? "ok  " : "SKIP"} ${d.id}  ${d.get("title")}`);
  }
  fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
  console.log(`\n${targets.length} published stories carry an email; backup written to ${path.relative(ROOT, BACKUP)}`);

  if (!WRITE) return console.log("Dry run. Re-run with --write to remove them.");

  const FieldValue = admin.firestore.FieldValue;
  let done = 0;
  for (const [i, d] of targets.entries()) {
    if (!backup[i].emailKeptOnSubmission) continue; // never drop the only copy
    const patch = { submitterEmail: FieldValue.delete() };
    if (/@/.test(String(d.get("publishedBy") || ""))) patch.publishedBy = FieldValue.delete();
    await d.ref.update(patch);
    done++;
  }
  console.log(`Removed emails from ${done} stories${unsafe ? `; skipped ${unsafe} whose email isn't on its submission` : ""}.`);
})().catch((e) => { console.error(e); process.exit(1); });
