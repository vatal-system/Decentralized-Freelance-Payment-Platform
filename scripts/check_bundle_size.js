#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * scripts/check_bundle_size.js
 *
 * Inspects frontend build assets in dist/assets, calculates raw and gzipped sizes,
 * prints a formatted breakdown table to CI logs, and enforces bundle size budgets.
 * Fails with exit code 1 if any chunk exceeds the configured threshold.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Entry chunk / vendor chunk gzip budget in KB (defaults to 350 kB)
const BUDGET_KB = parseInt(process.env.BUNDLE_BUDGET_KB || "350", 10);
const MAX_GZIP_BYTES = BUDGET_KB * 1024;

const distDir = path.resolve(__dirname, "../frontend/dist/assets");

if (!fs.existsSync(distDir)) {
  console.error(`ERROR: Build output directory not found at ${distDir}. Run "npm run build" first.`);
  process.exit(1);
}

const files = fs.readdirSync(distDir);
console.log("\n=================== Frontend Bundle Size Report ===================");
console.log(`Configured chunk budget: ${BUDGET_KB} kB gzipped`);
console.log("-------------------------------------------------------------------");
console.log(
  `${"Asset Chunk".padEnd(44)} ${"Raw Size".padStart(10)} ${"Gzip Size".padStart(10)}  Status`
);
console.log("-------------------------------------------------------------------");

let failed = false;
let foundAssets = 0;

for (const file of files) {
  if (!file.endsWith(".js") && !file.endsWith(".css")) continue;
  foundAssets++;

  const filePath = path.join(distDir, file);
  const rawContent = fs.readFileSync(filePath);
  const rawBytes = rawContent.length;
  const gzipBytes = zlib.gzipSync(rawContent).length;

  const rawKb = (rawBytes / 1024).toFixed(2);
  const gzipKb = (gzipBytes / 1024).toFixed(2);

  const passed = gzipBytes <= MAX_GZIP_BYTES;
  if (!passed) failed = true;

  const status = passed ? "PASS" : "EXCEEDED";
  console.log(
    `${file.padEnd(44)} ${(rawKb + " kB").padStart(10)} ${(gzipKb + " kB").padStart(10)}  [${status}]`
  );
}

console.log("-------------------------------------------------------------------");
console.log(`Total inspected assets: ${foundAssets}`);

if (failed) {
  console.error(`\n❌ ERROR: One or more chunks exceed the ${BUDGET_KB} kB gzipped limit!\n`);
  process.exit(1);
} else {
  console.log(`\n✔ All chunks are within the ${BUDGET_KB} kB gzipped budget.\n`);
}
