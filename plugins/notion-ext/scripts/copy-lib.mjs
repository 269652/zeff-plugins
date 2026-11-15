#!/usr/bin/env node
// The shared files (lambdas/_*.mjs) copied into each lambda's folder without their "_" — a lambda imports only from its own folder.
// Run after changing one of them: node scripts/copy-lib.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..", "lambdas");
const shared = fs.readdirSync(root).filter((f) => /^_.+\.mjs$/.test(f));
for (const dir of fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const f of shared) fs.copyFileSync(path.join(root, f), path.join(root, dir.name, f.slice(1)));
}
console.log(`${shared.length} shared files into ${fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).length} lambdas.`);
