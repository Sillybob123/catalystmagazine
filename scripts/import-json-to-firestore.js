#!/usr/bin/env node
// One-time migration: import all posts/article*.json files into Firestore.
//
// Usage:  node scripts/import-json-to-firestore.js [--dry-run] [--skip-existing]
//
// Flags:
//   --dry-run        Print what would be written without touching Firestore.
//   --skip-existing  Don't overwrite a doc whose title already matches one in
//                    Firestore (based on the slug). Default: overwrite.

"use strict";

const fs   = require("fs");
const path = require("path");
const admin = require("firebase-admin");

// ── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, "..");
const POSTS_DIR    = path.join(PROJECT_ROOT, "posts");
const DEV_VARS     = path.join(PROJECT_ROOT, ".dev.vars");

// ── Parse .dev.vars for the service account ──────────────────────────────────

function loadDevVars(filePath) {
  const vars = {};
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    vars[key] = val;
  }
  return vars;
}

const devVars      = loadDevVars(DEV_VARS);
const serviceAccount = JSON.parse(devVars.FIREBASE_SERVICE_ACCOUNT);
const projectId      = devVars.FIREBASE_PROJECT_ID;

admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId });
const db = admin.firestore();

// ── Flags ────────────────────────────────────────────────────────────────────

const DRY_RUN       = process.argv.includes("--dry-run");
const SKIP_EXISTING = process.argv.includes("--skip-existing");

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escHtml(str) {
  return (str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Mirrors the renderContentBlocks logic in main.js so the stored `body` HTML
// is identical to what the article page renders today.
function renderContentBlocks(blocks = []) {
  const sorted = [...blocks].sort((a, b) => (a.order || 0) - (b.order || 0));
  return sorted.map((block) => {
    const type    = (block.type || "").toLowerCase();
    const content = block.content || "";
    switch (type) {
      case "section_header":
      case "section_header_or_caption":
        return `<h2 class="article-block section-header">${content}</h2>`;
      case "section_sub_header":
        return `<h3 class="article-block section-subheader">${content}</h3>`;
      case "pull_quote":
        return `<blockquote class="article-block pull-quote">${content}</blockquote>`;
      case "blockquote":
        return `<blockquote class="article-block pull-quote">${content}</blockquote>`;
      case "image": {
        const url     = block.url || "";
        const alt     = block.alt_text || "Article image";
        const caption = block.caption || "";
        if (!url) return "";
        return `<figure class="article-block article-image"><img src="${escHtml(url)}" alt="${escHtml(alt)}" loading="lazy">${caption ? `<figcaption class="image-caption">${caption}</figcaption>` : ""}</figure>`;
      }
      case "image_placeholder": {
        const alt     = block.alt_text || "Image placeholder";
        const caption = block.caption || block.note || "";
        return `<figure class="article-block image-placeholder" aria-label="${escHtml(alt)}"><div class="image-placeholder-box"><span>${escHtml(alt)}</span></div>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
      }
      case "embed": {
        const url     = block.url || block.src || "";
        const title   = block.title || block.alt_text || "Embedded content";
        const height  = block.height || 480;
        const caption = block.caption || block.note || "";
        if (!url) return "";
        return `<figure class="article-block article-embed"><div class="embed-frame"><iframe src="${escHtml(url)}" title="${escHtml(title)}" loading="lazy" style="width:100%;height:${height}px;border:none;border-radius:12px;" allow="fullscreen"></iframe></div>${caption ? `<figcaption class="embed-caption">${caption}</figcaption>` : ""}</figure>`;
      }
      case "html": {
        const caption = block.caption || block.note || "";
        return `<div class="article-block custom-html">${block.content || ""}${caption ? `<p class="html-caption">${caption}</p>` : ""}</div>`;
      }
      case "game": {
        const src    = block.src || "";
        const title  = block.title || "Interactive Game";
        const height = block.height || "600";
        if (!src) return "";
        return `<div class="article-block article-game"><iframe src="${escHtml(src)}" title="${escHtml(title)}" loading="lazy" allow="fullscreen" style="width:100%;height:${height}px;border:none;"></iframe></div>`;
      }
      default:
        return `<p class="article-block paragraph">${content}</p>`;
    }
  }).join("\n");
}

function formatDate(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function normalizeCategory(cat) {
  const c = (cat || "feature").toLowerCase().trim();
  const map = {
    "op-ed": "op-ed", "oped": "op-ed", "editorial": "op-ed",
    "profile": "profile",
    "interview": "interview",
    "news": "news",
    "science": "science",
    "feature": "feature",
  };
  return map[c] || c;
}

function buildExcerpt(blocks, metaExcerpt) {
  if (metaExcerpt && metaExcerpt.trim()) return metaExcerpt.trim();
  const firstPara = blocks.find((b) => (b.type || "").toLowerCase().includes("paragraph"));
  const text = (firstPara?.content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 220) || "";
}

// ── Load all JSON files ───────────────────────────────────────────────────────

const jsonFiles = fs.readdirSync(POSTS_DIR)
  .filter((f) => /^article\d+\.json$/.test(f))
  .sort((a, b) => {
    const na = parseInt(a.match(/\d+/)[0], 10);
    const nb = parseInt(b.match(/\d+/)[0], 10);
    return na - nb;
  })
  .map((f) => path.join(POSTS_DIR, f));

console.log(`Found ${jsonFiles.length} JSON article files.`);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // If SKIP_EXISTING, load all existing Firestore story slugs up front.
  let existingSlugs = new Set();
  if (SKIP_EXISTING) {
    console.log("Fetching existing Firestore slugs…");
    const snap = await db.collection("stories").select("slug").get();
    snap.forEach((d) => { if (d.data().slug) existingSlugs.add(d.data().slug); });
    console.log(`  Found ${existingSlugs.size} existing stories.`);
  }

  let imported = 0;
  let skipped  = 0;
  let errored  = 0;

  for (const file of jsonFiles) {
    const filename = path.basename(file);
    const indexMatch = filename.match(/article(\d+)/);
    const index = indexMatch ? parseInt(indexMatch[1], 10) : 0;

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`  ✗ ${filename}: JSON parse error — ${err.message}`);
      errored++;
      continue;
    }

    const meta   = raw.article_data?.metadata || {};
    const blocks = Array.isArray(raw.article_data?.content_blocks)
      ? raw.article_data.content_blocks
      : [];

    const title = (meta.title || "").trim();
    if (!title) {
      console.warn(`  ⚠ ${filename}: no title, skipping.`);
      skipped++;
      continue;
    }

    const slug = slugify(title);

    if (SKIP_EXISTING && existingSlugs.has(slug)) {
      console.log(`  → ${filename}: "${title}" already in Firestore, skipping.`);
      skipped++;
      continue;
    }

    const category   = normalizeCategory(meta.category);
    const coverImage = meta.cover_image_url || "";
    const body       = renderContentBlocks(blocks);
    const dek        = buildExcerpt(blocks, meta.excerpt);
    const authorName = (meta.author || "The Catalyst").trim();

    // Use a deterministic doc ID: "json-article-<N>" so re-runs are idempotent.
    const docId = `json-article-${String(index).padStart(3, "0")}`;

    const payload = {
      title,
      slug,
      category,
      coverImage,
      body,
      dek,
      authorName,
      authorId:    "json-import",
      status:      "published",
      publishedAt: meta.publish_date
        ? new Date(meta.publish_date).toISOString()
        : new Date("2024-01-01").toISOString(),
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
      sourceFile:  filename,
    };

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would write ${docId}: "${title}" (${category}, ${blocks.length} blocks)`);
      imported++;
      continue;
    }

    try {
      await db.collection("stories").doc(docId).set(payload, { merge: true });
      console.log(`  ✓ ${docId}: "${title}" (${category}, ${blocks.length} blocks)`);
      imported++;
    } catch (err) {
      console.error(`  ✗ ${docId} "${title}": ${err.message}`);
      errored++;
    }
  }

  console.log(`\nDone. Imported: ${imported}  Skipped: ${skipped}  Errors: ${errored}`);
  process.exit(errored > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
