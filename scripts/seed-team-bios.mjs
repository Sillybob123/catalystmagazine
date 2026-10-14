// Copies the About page's bios (teamMembers / alumniMembers in js/main.js)
// into Firestore team_bios/{slug}, the live copy people now update from the
// Editorial Suite (your name → Update bio) and admins manage under Team bios.
//
// Only fills in people who have no team_bios doc yet (and the `sections`
// list on older docs), so it never overwrites a bio an admin has approved.
// Safe to run again after adding someone to js/main.js by hand.
//
//   node scripts/seed-team-bios.mjs [--dry]
//
// Credentials: GOOGLE_APPLICATION_CREDENTIALS, or the gitignored
// *-firebase-adminsdk-*.json service-account key in the repo root.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

const dry = process.argv.includes("--dry");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Pull the three data arrays out of js/main.js without running the page.
const src = fs.readFileSync(path.join(root, "js/main.js"), "utf8");
const grab = (name) => {
  const start = src.indexOf(`const ${name} = [`);
  if (start < 0) throw new Error(`${name} not found in js/main.js`);
  let i = src.indexOf("[", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) break;
  }
  return vm.runInNewContext(`(${src.slice(src.indexOf("[", start), i + 1)})`);
};
const team = grab("teamMembers");
const alumni = grab("alumniMembers");
const roster = grab("rosterGroups");

const slugOf = (t) => String(t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[‘’']/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// Every section a person appears in (someone can be in two, e.g. Staff ·
// Social Media and the Graduate Fellowship).
const sectionsOf = (name) => {
  const out = [];
  for (const g of roster) for (const c of g.clusters) if (c.members.includes(name)) out.push(c.subtitle ? `${g.id}:${c.subtitle}` : g.id);
  return out;
};

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || fs.readdirSync(root).map((f) => path.join(root, f)).find((f) => /-firebase-adminsdk-.*\.json$/.test(f));
if (!keyPath) { console.error("No service-account key found."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, "utf8"))) });
const db = admin.firestore();

const people = [...team.map((m) => ({ ...m, sections: sectionsOf(m.name) })), ...alumni.map((m) => ({ ...m, sections: ["alumni"] }))];
let added = 0, filled = 0;
for (const m of people) {
  const slug = slugOf(m.name);
  const ref = db.collection("team_bios").doc(slug);
  const snap = await ref.get();
  if (snap.exists) {
    // Older docs held one `section`; give them the full list the page uses.
    if (!Array.isArray(snap.get("sections"))) {
      console.log(`${dry ? "would fill" : "filling"} sections for ${slug}: ${m.sections.join(", ")}`);
      if (!dry) await ref.update({ sections: m.sections, hidden: snap.get("hidden") === true });
      filled++;
    }
    continue;
  }
  const doc = { name: m.name, slug, role: m.role || "", bio: m.bio || "", image: m.image || "", sections: m.sections, section: m.sections[0] || "", hidden: false, updatedAt: new Date().toISOString(), approvedByName: "From the About page" };
  console.log(`${dry ? "would add" : "adding"} ${slug} (${doc.sections.join(", ") || "no section"})`);
  if (!dry) await ref.set(doc);
  added++;
}
console.log(`${dry ? "Would add" : "Added"} ${added}, ${dry ? "would fill" : "filled"} sections on ${filled}, of ${people.length}.`);
process.exit(0);
