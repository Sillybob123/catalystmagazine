#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "cloudflare-dist");

const excludedDirectories = new Set([
  ".git",
  ".claude",
  ".wrangler",
  "cloudflare-dist",
  "firebase-functions",
  "gitignore",
  "node_modules",
  "tools",
  "scripts",
  "scheduler-worker",
  "__pycache__"
  // NOTE: "functions" is intentionally NOT excluded — Cloudflare Pages
  // auto-deploys anything under cloudflare-dist/functions/ as a Function.
]);

const excludedFiles = new Set([
  ".gitignore",
  ".htaccess",
  ".nojekyll",
  ".dev.vars",
  ".dev.vars.example",
  "_config.yml",
  "generate-article.php",
  "install.sh",
  "package-lock.json",
  "package.json",
  "publish-article.js",
  "scheduler/QUICK_START.txt",
  "scheduler/UPLOAD_INSTRUCTIONS.txt",
  "server.js",
  "wrangler.jsonc",
  "firestore.rules",
  "firestore.indexes.json",
  "firestore-winners.rules",
  "firebase.json",
  "DEPLOYMENT-GUIDE.md",
  // Internal scratch / legacy files that were being served publicly.
  "index_backup.html",
  "email_fixed_1.html",
  "gameexample.html",
  "Posts.csv",
  "newarticlesturcture.json",
  "article-index.txt"
]);

const excludedExtensions = new Set([
  ".backup",
  ".md",
  ".py",
  ".sh",
  ".csv",
  // Source media for hero-frame extraction — large, used as input only.
  // The extracted WebP frames under public/assets/hero-frames/ ship instead.
  ".mov",
  ".mp4"
]);

// ...except the small web-encoded loops the pages actually play. Keep in
// step with the mp4 exceptions in .gitignore.
const shippedVideoPatterns = [
  /^edition-art\/[^/]+\/[^/]+\.mp4$/,
  /^beta\/articles\/[^/]+\.mp4$/,
  /^beta\/book-reviews\/[^/]+\.mp4$/,
  /^beta\/brain-teaser\/[^/]+\.mp4$/
];

// Credentials must never reach the public bundle, even when they sit in the
// working tree (they're gitignored, but a local `npm run pages:deploy` copies
// whatever is on disk). Mirrors the secret patterns in .gitignore.
const secretFilePatterns = [
  /firebase-adminsdk.*\.json$/i,
  /^service-?account.*\.json$/i,
  /^(secrets|credentials)\.json$/i,
  /^gsc-.*\.json$/i,
  /^\.env(\..*)?$/i,
  /^\.dev\.vars(\..*)?$/i,
  /\.(pem|key|p12|pfx)$/i
];

async function resetOutputDirectory() {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
}

function shouldSkip(relativePath, dirent) {
  if (!relativePath) {
    return false;
  }

  const parts = relativePath.split(path.sep);
  const baseName = path.basename(relativePath);

  if (baseName === ".DS_Store") {
    return true;
  }

  if (!dirent.isDirectory() && secretFilePatterns.some((re) => re.test(baseName))) {
    return true;
  }

  if (parts.some((part) => excludedDirectories.has(part))) {
    return true;
  }

  if (excludedFiles.has(relativePath) || excludedFiles.has(baseName)) {
    return true;
  }

  if (!dirent.isDirectory() && shippedVideoPatterns.some((re) => re.test(parts.join("/")))) {
    return false;
  }

  if (!dirent.isDirectory() && excludedExtensions.has(path.extname(baseName))) {
    return true;
  }

  return false;
}

async function copyTree(sourceDir, targetDir, relativeDir = "") {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);

    if (shouldSkip(relativePath, entry)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true });
      await copyTree(sourcePath, targetPath, relativePath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
}

async function main() {
  await resetOutputDirectory();
  await copyTree(projectRoot, outputDir);
  console.log(`Cloudflare assets prepared in ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
