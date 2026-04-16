#!/usr/bin/env node

const { spawnSync } = require("child_process");

const args = process.argv.slice(2);

// Cloudflare is currently configured to run "npx bundle exec jekyll build".
// Translate that legacy command into the repo's actual static asset build.
if (args.join(" ") !== "exec jekyll build") {
  console.error(`Unsupported bundle invocation: ${args.join(" ")}`);
  process.exit(1);
}

const result = spawnSync("npm", ["run", "build:cloudflare"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);
