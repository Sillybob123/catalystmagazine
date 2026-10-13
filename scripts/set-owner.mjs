// Marks one person as the Editorial Suite's owner (users/{uid}.owner = true),
// on every account that shares their email. The owner decides which pages
// each person may open (Users & roles → Limit pages), admins included, and
// is the only one who can change their own account.
//
// Who the owner is lives only in Firestore, never in this repo. The app can't
// set or clear the flag (firestore.rules); only this Admin SDK script can.
//
//   node scripts/set-owner.mjs --name "Full Name"
//   node scripts/set-owner.mjs --email someone@example.com
//   node scripts/set-owner.mjs --name "Full Name" --remove
//
// Credentials: GOOGLE_APPLICATION_CREDENTIALS, or the gitignored
// *-firebase-adminsdk-*.json service-account key in the repo root.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const args = process.argv.slice(2);
const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const name = opt("--name");
const email = opt("--email");
const remove = args.includes("--remove");
if (!name && !email) {
  console.error('Usage: node scripts/set-owner.mjs --name "Full Name" | --email you@example.com [--remove]');
  process.exit(1);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || fs.readdirSync(root).map((f) => path.join(root, f)).find((f) => /-firebase-adminsdk-.*\.json$/.test(f));
if (!keyPath) { console.error("No service-account key found."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))) });
const db = admin.firestore();

const norm = (s) => String(s || "").trim().toLowerCase();
const snap = await db.collection("users").get();
const all = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));

// Find the person, then every account on their email(s).
const seeds = all.filter((u) => (email && norm(u.email) === norm(email)) || (name && norm(u.name) === norm(name) && u.role && u.role !== "reader"));
if (!seeds.length) { console.error("No matching staff account found."); process.exit(1); }
const emails = new Set(seeds.map((u) => norm(u.email)).filter(Boolean));
const targets = all.filter((u) => seeds.some((s) => s.id === u.id) || (u.email && emails.has(norm(u.email))));
if (emails.size > 1) { console.error(`That matches ${emails.size} different people. Use --email instead.`); process.exit(1); }

for (const u of targets) {
  await u.ref.update(remove ? { owner: admin.firestore.FieldValue.delete() } : { owner: true, blockedAccess: admin.firestore.FieldValue.delete() });
}
console.log(`${remove ? "Removed owner from" : "Owner set on"} ${targets.length} account${targets.length === 1 ? "" : "s"}.`);
process.exit(0);
