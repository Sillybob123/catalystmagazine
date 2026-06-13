#!/usr/bin/env node
// One-off: set users/{uid}.phone for the team from the list the admins keep.
// Phone lives only on the staff-read-only users collection (see
// firestore.rules) — it is never exposed publicly.
//
// Usage:
//   node scripts/seed-phones.js            # DRY RUN — prints plan
//   node scripts/seed-phones.js --write    # actually write
//
// Matching: rows with a full name must match the users directory exactly
// (case-insensitive); single-name rows match everyone whose first name is
// that word (so "Yair" updates both of Yair's user docs). Unmatched rows are
// reported, not guessed.

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

// "LaMayla Hill" on the admin list is LaMyla Hill in the directory; "Lori
// preci" is Lori Preci. Corrected here so exact matching works.
const ROWS = [
  ["Aidan Schurr",  "+1 (201) 970-0096"],
  ["Alexis Tamm",   "9179218398"],
  ["Belinda",       "5712792562"],
  ["Aidan Brown",   "+1 (917) 716-2711"],
  ["Cameron",       "1 (732) 608-4886"],
  ["Dani",          "+1 (914) 826-3943"],
  ["Ginger",        "+1 (310) 740-2245"],
  ["Izzy",          "+1 (347) 533-2941"],
  ["Jada",          "+1 (484) 723-3286"],
  ["Josh Shapo",    "+1 (571) 444-9092"],
  ["Juan Martinez", "+1 (202) 497-4891"],
  ["LaMyla Hill",   "(912) 509-9619"],
  ["Layla",         "+1 (786) 423-9633"],
  ["Le",            "+1 (571) 583-2847"],
  ["Lori Preci",    "+1 (347) 893-0444"],
  ["Skye",          "+1 (201) 970-0095"],
  ["Sienna",        "+1 (802) 558-8110"],
  ["Natalie Burg",  "+1 (248) 220-0462"],
  ["Yair",          "2405150910"],
  ["Yahav",         "(917) 578-6213"],
  // "MayMay" on the admin list — Catherine May May Hubbard in the directory.
  ["Catherine May May Hubbard", "(808) 312-8296"],
];

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

function fmtPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return String(raw || "").trim();
  return `+1 (${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

async function main() {
  const usersSnap = await db.collection("users").get();
  const users = usersSnap.docs.map((d) => ({ ...d.data(), id: d.id }));

  let planned = 0;
  const unmatched = [];

  for (const [name, rawPhone] of ROWS) {
    const n = norm(name);
    const isFullName = n.includes(" ");
    const matches = isFullName
      ? users.filter((u) => norm(u.name) === n)
      : users.filter((u) => norm(u.name).split(" ")[0] === n);

    if (!matches.length) {
      unmatched.push(name);
      console.log(`MISS   "${name}" — no user doc matches; add them via Directory → "+ Add person"`);
      continue;
    }

    const phone = fmtPhone(rawPhone);
    for (const u of matches) {
      const already = norm(u.phone) === norm(phone);
      console.log(`${already ? "SKIP " : WRITE ? "WRITE" : "PLAN "}  ${u.name} <${u.email || "no email"}>  ${phone}${already ? "  (unchanged)" : ""}`);
      if (already) continue;
      planned++;
      if (WRITE) await db.collection("users").doc(u.id).set({ phone }, { merge: true });
    }
  }

  console.log(`\n${WRITE ? "Wrote" : "Would write"} ${planned} phone number(s).` +
    (unmatched.length ? ` Unmatched: ${unmatched.join(", ")}.` : "") +
    (WRITE ? "" : " Re-run with --write to commit."));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
