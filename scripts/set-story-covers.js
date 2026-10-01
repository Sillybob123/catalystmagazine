#!/usr/bin/env node
// Replace story cover images: upload a local image to Firebase Storage and
// point stories/{id}.coverImage at it. The old URL is kept in
// stories/{id}.coverImagePrevious so a cover can be put back.
//
// Usage:
//   node scripts/set-story-covers.js <map.json>           # DRY RUN — prints the plan
//   node scripts/set-story-covers.js <map.json> --write   # upload + update Firestore
//
// map.json: [{ "id": "<story doc id>", "file": "/abs/path/cover.jpg" }, ...]
// Credentials come from .dev.vars, same as scripts/backfill-tags.js.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");

const ROOT = path.resolve(__dirname, "..");
const WRITE = process.argv.includes("--write");
const MAP = process.argv[2];
const BUCKET = "catalystwriters-5ce43.firebasestorage.app";

function loadDevVars(fp) {
  const v = {};
  for (const raw of fs.readFileSync(fp, "utf8").split("\n")) {
    const l = raw.trim(); if (!l || l.startsWith("#")) continue;
    const eq = l.indexOf("="); if (eq === -1) continue;
    v[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
  }
  return v;
}

(async () => {
  if (!MAP) { console.error("usage: set-story-covers.js <map.json> [--write]"); process.exit(1); }
  const items = JSON.parse(fs.readFileSync(MAP, "utf8"));
  const dv = loadDevVars(path.join(ROOT, ".dev.vars"));
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(dv.FIREBASE_SERVICE_ACCOUNT)), projectId: dv.FIREBASE_PROJECT_ID, storageBucket: BUCKET });
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  for (const it of items) {
    const ref = db.collection("stories").doc(it.id);
    const snap = await ref.get();
    if (!snap.exists) { console.log("MISSING", it.id); continue; }
    const d = snap.data();
    const ext = path.extname(it.file).toLowerCase();
    const dest = `stories/covers/${d.slug || it.id}-${Date.now()}${ext}`;
    console.log(`${it.id}  ${d.slug}\n  old: ${String(d.coverImage || "").slice(0, 90)}\n  new: gs://${BUCKET}/${dest}`);
    if (!WRITE) continue;
    const token = crypto.randomUUID();
    await bucket.upload(it.file, {
      destination: dest,
      metadata: {
        contentType: ext === ".webp" ? "image/webp" : "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`;
    const update = { coverImage: url };
    if (d.coverImage && !d.coverImagePrevious) update.coverImagePrevious = d.coverImage;
    await ref.update(update);
    console.log("  written:", url.slice(0, 120));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
