#!/usr/bin/env node
// One-off: seed the Planner's content tracker (social_assignments) with the
// rows from the team's old Content_tracker spreadsheet (June 2026).
//
// Usage:
//   node scripts/seed-content-tracker.js            # DRY RUN — prints plan
//   node scripts/seed-content-tracker.js --write    # actually write
//
// Idempotent: skips any row whose (type + deadline + platform) already
// exists in social_assignments, so re-running never duplicates.

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
const serviceAccount = JSON.parse(dv.FIREBASE_SERVICE_ACCOUNT);
const projectId = dv.FIREBASE_PROJECT_ID;
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId });
const db = admin.firestore();

// Spreadsheet rows. Owner names match the users directory; rows the sheet
// left unowned stay unowned (they render as "—" in the tracker).
const ROWS = [
  { platform: "instagram", type: "Article highlight",        topic: "",                                   owners: ["Dani Molloy"],  status: "published", deadline: "2026-06-08" },
  { platform: "linkedin",  type: "LinkedIn Discussion Post", topic: "",                                   owners: [],               status: "published", deadline: "2026-06-09" },
  { platform: "instagram", type: "Wacky Word Wednesday",     topic: "Sphingolipid",                       owners: ["Dani Molloy"],  status: "published", deadline: "2026-06-10" },
  { platform: "linkedin",  type: "Fellow spotlight",         topic: "Yair",                               owners: ["Skye Schurr"],  status: "published", deadline: "2026-06-11" },
  { platform: "instagram", type: "Article highlight",        topic: "Algae",                              owners: ["Dani Molloy"],  status: "published", deadline: "2026-06-12" },
  { platform: "instagram", type: "Science in One Number",    topic: "71% of Earth's surface is covered",  owners: [],               status: "planned",   deadline: "2026-06-15" },
  { platform: "linkedin",  type: "Fellow spotlight",         topic: "Le Nguyen",                          owners: ["Cameron Fields"], status: "planned", deadline: "2026-06-16" },
];

function norm(s) { return String(s || "").trim().toLowerCase(); }

async function main() {
  const usersSnap = await db.collection("users").get();
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const findUser = (name) => {
    const n = norm(name);
    const first = n.split(/\s+/)[0];
    return users.find((u) => norm(u.name) === n)
      || users.find((u) => norm(u.name).startsWith(first))
      // "Danielle" on the sheet vs "Dani" in the directory and vice versa.
      || users.find((u) => first.startsWith(norm(u.name).split(/\s+/)[0]) && norm(u.name).split(/\s+/)[0].length >= 3);
  };

  const creator = users.find((u) => u.role === "admin" && norm(u.name).includes("yair")) || null;
  console.log(`Creator: ${creator ? `${creator.name} (${creator.id})` : "fallback 'import'"}`);

  const existingSnap = await db.collection("social_assignments").get();
  const existingKeys = new Set(existingSnap.docs.map((d) => {
    const x = d.data();
    return `${norm(x.type)}|${x.deadline || ""}|${norm(x.platform)}`;
  }));

  let planned = 0, skipped = 0;
  for (const row of ROWS) {
    const key = `${norm(row.type)}|${row.deadline}|${norm(row.platform)}`;
    if (existingKeys.has(key)) {
      console.log(`SKIP (exists)  ${row.deadline}  ${row.type}  "${row.topic}"`);
      skipped++;
      continue;
    }

    const owners = row.owners.map((name) => {
      const u = findUser(name);
      if (!u) console.warn(`  ! owner not found in users directory: "${name}" — row will carry the name only`);
      return { id: u?.id || "", name: u?.name || name, email: u?.email || "" };
    });
    const primary = owners[0] || null;

    const docData = {
      articleTitle: row.topic || "",
      projectId: null,
      storyId: null,
      type: row.type,
      platform: row.platform,
      deadline: row.deadline,
      link: "",
      notes: "",
      assigneeId: primary?.id || "",
      assigneeName: primary?.name || "",
      assigneeEmail: primary?.email || "",
      assignees: owners,
      assigneeIds: owners.map((o) => o.id).filter(Boolean),
      status: row.status,
      doneAt: row.status === "published" ? `${row.deadline}T12:00:00.000Z` : null,
      createdById: creator?.id || "import",
      createdByName: creator?.name || "Imported from spreadsheet",
      createdAt: new Date().toISOString(),
      importedFrom: "content_tracker_sheet",
    };

    console.log(`${WRITE ? "WRITE" : "PLAN "}  ${row.deadline}  ${row.platform}/${row.type}  "${row.topic || "(untitled)"}"  → ${owners.map((o) => o.name).join(", ") || "—"}  [${row.status}]`);
    planned++;
    if (WRITE) await db.collection("social_assignments").add(docData);
  }

  console.log(`\n${WRITE ? "Wrote" : "Would write"} ${planned} row(s), skipped ${skipped}.${WRITE ? "" : " Re-run with --write to commit."}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
