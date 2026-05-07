#!/usr/bin/env node
/*
 * extract-hero-frames.js
 * ─────────────────────────────────────────────────────────────────────────
 * Converts newvideo.mov (or any source video) into a web-optimized WebP
 * frame sequence for the scroll-scrubbed hero canvas in index_backup.html.
 *
 * Output: public/assets/hero-frames/frame_0001.webp … frame_NNNN.webp
 *
 * Requirements (already installed via Homebrew on this Mac):
 *   ffmpeg  — frame extraction + scaling
 *   libwebp — encoding (ffmpeg uses it via libwebp encoder)
 *
 * Usage:
 *   node scripts/extract-hero-frames.js
 *   node scripts/extract-hero-frames.js --input other.mov --width 1600 --quality 75
 *
 * Why ffmpeg-direct (not ffmpeg → png → cwebp)?
 *   Single pass, half the I/O, no temp PNGs to clean up.
 *   ffmpeg's libwebp encoder produces visually identical output to cwebp
 *   for q≈78 with compression_level=6 on watercolor-style imagery.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ── Args ─────────────────────────────────────────────────────────────────
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const INPUT    = path.resolve(arg('--input',   'newvideo.mov'));
const OUT_DIR  = path.resolve(arg('--out',     'public/assets/hero-frames'));
const WIDTH    = parseInt(arg('--width',       '1920'), 10);
const QUALITY  = parseInt(arg('--quality',     '78'), 10);  // 0–100
const COMPRESS = parseInt(arg('--compress',    '6'), 10);   // 0–6 (higher = smaller, slower)

// ── Pre-flight ───────────────────────────────────────────────────────────
if (!fs.existsSync(INPUT)) {
  console.error(`[extract] input not found: ${INPUT}`);
  process.exit(1);
}

const ffprobe = spawnSync('which', ['ffmpeg']);
if (ffprobe.status !== 0) {
  console.error('[extract] ffmpeg not on PATH. Install: brew install ffmpeg');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// Wipe any prior frames so old runs don't linger if the new video is shorter.
for (const f of fs.readdirSync(OUT_DIR)) {
  if (/^frame_\d{4}\.webp$/.test(f)) fs.unlinkSync(path.join(OUT_DIR, f));
}

// ── Extract ──────────────────────────────────────────────────────────────
//
//   -vf scale=W:-2:flags=lanczos
//        keep aspect, force even height (libwebp requires even dims for
//        some yuv subsampling paths), use lanczos for the cleanest downscale.
//   -c:v libwebp + -q:v Q + -compression_level 6
//        per-frame WebP encoding tuned for static images.
//   -loop 0 -an -vsync 0
//        no animation loop hint, drop audio, preserve frame timing 1:1.
//
const args = [
  '-y',
  '-i', INPUT,
  '-vf', `scale=${WIDTH}:-2:flags=lanczos`,
  '-c:v', 'libwebp',
  '-q:v', String(QUALITY),
  '-compression_level', String(COMPRESS),
  '-loop', '0',
  '-an',
  '-vsync', '0',
  path.join(OUT_DIR, 'frame_%04d.webp'),
];

console.log(`[extract] ${path.basename(INPUT)} → ${path.relative(process.cwd(), OUT_DIR)}/frame_NNNN.webp`);
console.log(`[extract] width=${WIDTH}px  quality=${QUALITY}  compression=${COMPRESS}`);

const t0 = Date.now();
const run = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
if (run.status !== 0) {
  console.error('[extract] ffmpeg failed.');
  process.exit(run.status || 1);
}

// ── Report ───────────────────────────────────────────────────────────────
const frames = fs.readdirSync(OUT_DIR).filter(f => /^frame_\d{4}\.webp$/.test(f)).sort();
const totalBytes = frames.reduce((sum, f) => sum + fs.statSync(path.join(OUT_DIR, f)).size, 0);
const mb = (totalBytes / (1024 * 1024)).toFixed(2);
const avgKb = (totalBytes / 1024 / Math.max(1, frames.length)).toFixed(1);

console.log(`[extract] ✓ ${frames.length} frames · ${mb} MB · avg ${avgKb} KB/frame · ${(Date.now() - t0) / 1000}s`);
console.log(`[extract] first: ${frames[0]}   last: ${frames[frames.length - 1]}`);
console.log(`[extract] update FRAME_COUNT in index_backup.html if this number changed.`);
