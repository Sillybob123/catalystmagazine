// Seed an edition's planning hub (Suite → This edition, #/edition) from a
// private data file: edition_hub/{id} (sections, editors, key dates, guidance)
// and edition_hub/{id}/pieces/{pieceId} (each piece with its proposal and the
// editors' notes).
//
//   node scripts/seed-edition-hub.mjs <data.mjs> [--id winter-2027] [--force]
//
// The data file exports HUB and PIECES (see "Catalyst Winter Edition 2027/
// suite-seed/winter-2027.mjs"). It holds unpublished proposals, so it lives
// outside git; only this loader is in the repo.
//
// Safe to re-run: pieces that already exist are left alone (writers and
// editors may have changed their status, proposal or next steps in the
// Suite), and the hub doc only gains fields it doesn't have yet. --force
// overwrites both from the file.
//
// Needs the *-firebase-adminsdk-*.json service-account key in the repo root.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const force = args.includes("--force");
const id = (args[args.indexOf("--id") + 1] && args.includes("--id")) ? args[args.indexOf("--id") + 1] : "winter-2027";
if (!file) { console.error("Usage: node scripts/seed-edition-hub.mjs <data.mjs> [--id winter-2027] [--force]"); process.exit(1); }

const { HUB, PIECES } = await import(pathToFileURL(path.resolve(file)).href);

const keyPath = fs.readdirSync(root).map((f) => path.join(root, f)).find((f) => /-firebase-adminsdk-.*\.json$/.test(f));
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))) });
const db = admin.firestore();
const now = new Date().toISOString();

const person = (p) => (p ? { name: p.name, slug: p.slug, uids: p.uids || [] } : null);

// ── hub
const hubRef = db.doc(`edition_hub/${id}`);
const sections = HUB.sections.map((s) => ({ ...s, editor: person(s.editor) }));
const hub = {
  ...HUB,
  id,
  sections,
  editorUids: [...new Set(sections.flatMap((s) => s.editor?.uids || []))],
  updatedAt: now,
};
const existingHub = await hubRef.get();
if (!existingHub.exists || force) {
  await hubRef.set({ ...hub, createdAt: existingHub.data()?.createdAt || now });
  console.log(`${existingHub.exists ? "overwrote" : "created"} edition_hub/${id}`);
} else {
  const have = existingHub.data();
  const missing = Object.fromEntries(Object.entries(hub).filter(([k]) => !(k in have)));
  if (Object.keys(missing).length) await hubRef.update(missing);
  console.log(`edition_hub/${id} exists; added ${Object.keys(missing).join(", ") || "nothing"}`);
}

// ── pieces
let made = 0, kept = 0;
for (const p of PIECES) {
  const ref = hubRef.collection("pieces").doc(p.id);
  const snap = await ref.get();
  if (snap.exists && !force) { kept++; continue; }
  const writers = (p.writers || []).map(person);
  await ref.set({
    ...p,
    writers,
    writerUids: [...new Set(writers.flatMap((w) => w.uids))],
    // Next steps become a checklist the writer ticks off.
    nextSteps: (p.nextSteps || []).map((text, i) => (typeof text === "string" ? { id: `s${i + 1}`, text, done: false } : text)),
    createdAt: snap.data()?.createdAt || now,
    updatedAt: now,
    updatedByName: "Seeded from the proposals",
  });
  made++;
}
console.log(`pieces: ${made} written, ${kept} already there (left alone)`);
process.exit(0);
