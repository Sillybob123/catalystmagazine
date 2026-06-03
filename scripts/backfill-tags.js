#!/usr/bin/env node
// Auto-tag every published story in Firestore with topic tags.
//
// Reads each story's title + dek + body, matches the text against a keyword
// dictionary, and assigns one or more topic tags from a fixed list. Tags are
// stored as `stories/{id}.tags: string[]` (the front-end already reads this).
//
// Usage:
//   node scripts/backfill-tags.js            # DRY RUN — prints proposed tags, writes nothing
//   node scripts/backfill-tags.js --write    # actually write tags to Firestore
//   node scripts/backfill-tags.js --write --only=<docId>   # write a single doc (for fixes)
//
// Safe by default: without --write it only prints. Re-runnable: it overwrites
// the tags array each run, so editing the dictionary and re-running is fine.

"use strict";

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const ROOT = path.resolve(__dirname, "..");
const WRITE = process.argv.includes("--write");
const ONLY = (process.argv.find(a => a.startsWith("--only=")) || "").split("=")[1] || null;

// ── Firestore admin connection (same pattern as import-json-to-firestore.js) ──
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

// ── Tag dictionary ───────────────────────────────────────────────────────────
// Canonical tag -> regexes that, if matched in the text, assign that tag.
// Order doesn't matter; a story can earn several tags. Keep keywords specific
// enough to avoid false positives (e.g. require word boundaries on short ones).
// The canonical tag strings here are what get written and what the UI shows.
const TAG_RULES = {
  "AI": [
    /\bartificial intelligence\b/, /\bmachine learning\b/, /\bdeep learning\b/,
    /\bneural network/, /\blarge language model/, /\bllm\b/, /\bchatgpt\b/,
    /\bgenerative ai\b/, /\b(a\.i\.)\b/, /\bgpt\b/, /\bmachine-learning\b/,
    /\bai\b/, /\bai-/, /\bartificial neural/, /\brobotic/, /\bautonomous (system|robot|vehicle|surg)/
  ],
  "Health": [
    /\bhealth(?!care system audit)/, /\bwellness\b/, /\bhospital/, /\bclinic\b/,
    /\bpatient/, /\bdisease/, /\billness/, /\bmental health\b/, /\btherapy\b/
  ],
  "Medicine": [
    /\bmedicine\b/, /\bmedical\b/, /\bdrug\b/, /\bpharmaceutical/, /\bvaccine/,
    /\btreatment/, /\bclinical trial/, /\bsurgery\b/, /\bdiagnos/, /\bphysician/,
    /\bdoctor/, /\bmedication/, /\btherapeutic/
  ],
  "Biology": [
    /\bbiolog/, /\bgenetic/, /\bgenome/, /\bdna\b/, /\brna\b/, /\bcell(s|ular)?\b/,
    /\bprotein/, /\bevolution/, /\borganism/, /\becosystem/, /\bmicrob/, /\bspecies\b/,
    /\benzyme/, /\bmolecular biology\b/, /\bcrispr\b/, /\bgene\b/
  ],
  "Chemistry": [
    /\bchemistry\b/, /\bchemical/, /\bmolecule/, /\breaction\b/, /\bcompound\b/,
    /\bcatalyst\b/, /\bpolymer/, /\bsynthesis\b/, /\bperiodic table\b/, /\batom(s|ic)?\b/
  ],
  "Public Health": [
    /\bpublic health\b/, /\bepidemic/, /\bpandemic/, /\boutbreak/, /\bvaccination\b/,
    /\bepidemiolog/, /\bsanitation\b/, /\bhealth policy\b/, /\bcdc\b/, /\bwho\b/,
    /\bhealthcare system/, /\bhealth equity\b/, /\bnutrition\b/
  ],
  "Physics": [
    /\bphysics\b/, /\bquantum\b/, /\bparticle/, /\brelativity\b/, /\bthermodynamic/,
    /\bgravity\b/, /\belectromagnet/, /\bphoton/, /\bnuclear\b/, /\benergy physics\b/
  ],
  "Environment": [
    /\benvironment/, /\bclimate\b/, /\bclimate change\b/, /\bsustainab/, /\bpollution\b/,
    /\bcarbon\b/, /\bemission/, /\bgreenhouse\b/, /\brenewable/, /\bconservation\b/,
    /\bbiodiversity\b/, /\becolog/, /\bglobal warming\b/
  ],
  "Space": [
    /\bastronom/, /\bnasa\b/, /\bsatellite/, /\bgalaxy\b/, /\bgalaxies\b/,
    /\bcosmic\b/, /\bcosmolog/, /\btelescope\b/, /\bmars\b/, /\brocket\b/, /\bastrophysic/,
    /\bouter space\b/, /\bsolar system\b/, /\bexoplanet/, /\bspacecraft\b/, /\bplanetary\b/,
    /\bnebula/, /\bsupernova/, /\bblack hole/
  ],
  "Neuroscience": [
    /\bneuroscience\b/, /\bneuron/, /\bbrain\b/, /\bcognit/, /\bneural\b/,
    /\bsynapse/, /\bnervous system\b/, /\bneurolog/, /\bpsycholog/, /\bmemory\b/
  ],
  "Technology": [
    /\btechnolog/, /\bsoftware\b/, /\bhardware\b/, /\bcomputer/, /\bcoding\b/,
    /\bprogramming\b/, /\bengineering\b/, /\binternet\b/, /\bdigital\b/, /\bdata\b/,
    /\bsemiconductor/, /\bcyber/, /\bapp\b/, /\bdevice/
  ],
  "Policy": [
    /\bpolicy\b/, /\bregulation/, /\blegislation\b/, /\bcongress\b/, /\bgovernment\b/,
    /\bfunding\b/, /\bbill\b/, /\bsenate\b/, /\bfederal\b/, /\blaw\b/, /\bethics\b/,
    /\bgrant\b/, /\bpolitic/
  ]
};

const ALL_TAGS = Object.keys(TAG_RULES);

function stripHtml(s) {
  if (typeof s !== "string") return "";
  return s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ");
}

function tagFor(text) {
  const t = text.toLowerCase();
  const hits = [];
  for (const [tag, rules] of Object.entries(TAG_RULES)) {
    let count = 0;
    for (const re of rules) {
      const m = t.match(new RegExp(re.source, "g" + (re.flags.includes("i") ? "i" : "")));
      if (m) count += m.length;
    }
    if (count > 0) hits.push({ tag, count });
  }
  hits.sort((a, b) => b.count - a.count);

  // Strong tags = matched on 2+ keyword occurrences (filters out a single stray
  // word that happens to appear). Cap at 3 so cards stay clean.
  let strong = hits.filter(h => h.count >= 2).slice(0, 3).map(h => h.tag);

  // Fallback: if nothing cleared the threshold, keep the single best 1-hit tag
  // so the story still surfaces under a topic rather than only "All".
  if (!strong.length && hits.length) strong = [hits[0].tag];

  return strong;
}

(async () => {
  let query = db.collection("stories").where("status", "==", "published");
  const snap = await query.get();

  const rows = [];
  snap.forEach(doc => {
    if (ONLY && doc.id !== ONLY) return;
    const x = doc.data();
    // Don't auto-tag book reviews here — they're books, tagged by genre already.
    const isBookReview = String(x.category || "").toLowerCase().includes("book");
    const text = [x.title, x.dek, x.deck, x.excerpt, stripHtml(x.body || x.content || "")]
      .filter(Boolean).join(" ");
    const tags = isBookReview ? [] : tagFor(text);
    rows.push({ id: doc.id, title: x.title, category: x.category, isBookReview, tags });
  });

  // Report
  console.log(`\n${WRITE ? "WRITING" : "DRY RUN — no writes"} · ${rows.length} stories\n`);
  const untagged = [];
  for (const r of rows) {
    const tagStr = r.tags.length ? r.tags.join(", ") : (r.isBookReview ? "(book review — skipped)" : "⚠️  NO TAGS");
    console.log(`  ${r.tags.length ? "✓" : (r.isBookReview ? "·" : "✗")} ${String(r.title).slice(0, 60).padEnd(62)} → ${tagStr}`);
    if (!r.tags.length && !r.isBookReview) untagged.push(r.title);
  }

  // Tag distribution summary
  const dist = {};
  for (const r of rows) for (const t of r.tags) dist[t] = (dist[t] || 0) + 1;
  console.log("\nTag distribution:");
  for (const t of ALL_TAGS) console.log(`  ${t.padEnd(16)} ${dist[t] || 0}`);
  if (untagged.length) {
    console.log(`\n⚠️  ${untagged.length} non-book story(ies) matched NO tag — they'll show only under "All":`);
    untagged.forEach(t => console.log(`     - ${t}`));
  }

  if (!WRITE) {
    console.log("\nDry run complete. Re-run with --write to save these tags to Firestore.\n");
    process.exit(0);
  }

  // Write
  let written = 0;
  const batchSize = 400;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = db.batch();
    for (const r of rows.slice(i, i + batchSize)) {
      if (r.isBookReview) continue; // leave book reviews untouched
      batch.update(db.collection("stories").doc(r.id), { tags: r.tags });
      written++;
    }
    await batch.commit();
  }
  console.log(`\n✓ Wrote tags to ${written} stories.\n`);
  process.exit(0);
})().catch(e => { console.error("ERROR:", e); process.exit(1); });
