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
  "scripts",
  "__pycache__"
]);

const excludedFiles = new Set([
  ".gitignore",
  ".htaccess",
  ".nojekyll",
  "_config.yml",
  "generate-article.php",
  "install.sh",
  "package-lock.json",
  "package.json",
  "publish-article.js",
  "scheduler/QUICK_START.txt",
  "scheduler/UPLOAD_INSTRUCTIONS.txt",
  "server.js",
  "wrangler.jsonc"
]);

const excludedExtensions = new Set([
  ".backup",
  ".md",
  ".py",
  ".sh"
]);

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

  if (parts.some((part) => excludedDirectories.has(part))) {
    return true;
  }

  if (excludedFiles.has(relativePath) || excludedFiles.has(baseName)) {
    return true;
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
