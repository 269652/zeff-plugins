#!/usr/bin/env node
/**
 * catalog.json — the index of this repository's plugins, the one file a Zeff reads to list them (its marketplace, Plugins → Browse) instead
 * of every zeff-plugin.json one by one. Generated from the plugin folders; nothing in it is written by hand.
 *
 *   node scripts/catalog.mjs            writes catalog.json
 *   node scripts/catalog.mjs --check    fails (exit 1) when catalog.json is not what the folders say — run it before a commit / in CI
 *
 * Plain Node (18+), no packages. Per plugin: what it is (id, name, version, description, keywords, category, icon, author, homepage), what it
 * asks for (permissions) and needs (the extension API version, other plugins), what it adds (apps and their pages, databases, flows, syncs,
 * views, widgets, drivers, tools …), its folder, a content hash of its files, whether it is signed, its size, the start of its README and
 * its screenshots.
 *
 * The content hash is the one Zeff computes over what it downloads (src/lib/ext/catalog.ts contentHash): every file of the folder (none in a
 * folder or with a name starting with "."), sorted by path, as "path\0sha256\n" — text with CRLF line endings counted as LF, so a Windows
 * checkout hashes like the repository. Zeff compares it after a download: a mismatch means this file is out of date.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "catalog.json");
const CATEGORIES = ["app", "connector", "communication", "ai", "time", "finance", "knowledge", "language", "developer", "system"];
const README_CHARS = 600;

/** The repository's files (tracked and new, without what .gitignore leaves out); without git: every file on disk. */
function repoFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
    return out.split("\0").filter(Boolean).filter((f) => fs.existsSync(path.join(ROOT, f)));
  } catch {
    const out = [];
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else if (e.isFile()) out.push(r);
      }
    };
    walk(ROOT, "");
    return out;
  }
}

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const isText = (b) => !b.subarray(0, 8000).includes(0);
/** A file as it is counted: text with LF line endings. */
const normalized = (b) => (isText(b) ? Buffer.from(b.toString("latin1").replace(/\r\n/g, "\n"), "latin1") : b);
const hidden = (rel) => rel.split("/").some((x) => x.startsWith("."));

export function contentHash(files) {
  const lines = [...files.keys()].sort().map((rel) => `${rel}\0${sha256(normalized(files.get(rel)))}\n`);
  return sha256(Buffer.from(lines.join(""), "utf8"));
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== 0 && v !== false && !(Array.isArray(v) && !v.length)));

/** The start of the README: its first paragraphs (no title, no code), up to README_CHARS. */
function readmeExcerpt(text) {
  if (!text) return undefined;
  const paras = text
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#/.test(p));
  let out = "";
  for (const p of paras) {
    if (out && out.length + p.length > README_CHARS) break;
    out += (out ? "\n\n" : "") + p;
  }
  return out.length > README_CHARS ? `${out.slice(0, README_CHARS - 1).trimEnd()}…` : out || undefined;
}

/** What a plugin adds, read from its manifest, its packages and its lambdas. */
function addsOf(dir, m) {
  const c = m.contributes ?? {};
  const apps = [];
  const databases = [];
  const flows = [];
  let pages = 0;
  for (const rel of c.workspacePackages ?? []) {
    let pkg;
    try {
      pkg = readJson(path.join(dir, rel));
    } catch {
      continue;
    }
    const items = Array.isArray(pkg.items) ? pkg.items : [];
    const pagesHere = items.filter((it) => it.kind === "page" && !it.flow).length;
    const dbs = items.filter((it) => it.kind === "database").map((it) => it.title);
    pages += pagesHere;
    databases.push(...dbs);
    for (const it of items) if (it.flow?.name) flows.push({ name: String(it.flow.name), title: String(it.flow.title ?? it.title ?? it.flow.name) });
    apps.push(compact({ name: String(pkg.name ?? rel), icon: pkg.icon ? String(pkg.icon) : undefined, version: pkg.version ? String(pkg.version) : undefined, pages: pagesHere, databases: dbs.length }));
  }
  const lambdas = [];
  if (typeof c.lambdas === "string") {
    const ld = path.join(dir, c.lambdas);
    try {
      for (const name of fs.readdirSync(ld).sort()) {
        const f = path.join(ld, name, "lambda.json");
        if (!fs.existsSync(f)) continue;
        try {
          const l = readJson(f);
          lambdas.push({ name: String(l.name ?? name), kind: String(l.kind ?? "function"), label: l.label ? String(l.label) : undefined });
        } catch {
          /* (a lambda that doesn't read: left out) */
        }
      }
    } catch {
      /* (no lambdas folder) */
    }
  }
  const names = (list, key = "id") => uniq((list ?? []).map((x) => (typeof x === "string" ? x : (x?.title ?? x?.label ?? x?.name ?? x?.[key]))));
  return compact({
    apps,
    pages,
    databases: uniq(databases),
    flows,
    syncs: flows.filter((f) => /\.sync$/.test(f.name)).map((f) => f.name),
    views: uniq([...names(c.appViews), ...names(c.workPanels)]),
    widgets: names(c.widgets),
    drivers: lambdas.filter((l) => l.kind === "driver").map((l) => l.name),
    lookups: uniq([...lambdas.filter((l) => l.kind === "lookup").map((l) => l.name), ...names(c.lookups)]),
    functions: lambdas.filter((l) => l.kind === "function").length + (c.functions ?? []).length,
    tools: names(c.tools, "name"),
    aiTasks: names(c.aiTasks),
    services: names(c.services, "name"),
    stores: names(c.stores, "name"),
    commands: names(c.workCommands),
    mcpServers: Object.keys(c.workerMcpServers ?? {}),
    hooks: Object.keys(c.hooks ?? {}),
    schedules: names(c.schedules),
    chats: names(c.chats),
    settings: (c.settings ?? []).length,
    oauth: names(c.oauth),
    languages: c.language ? [`${c.language.native} (${c.language.code})`] : [],
    workerRules: !!c.workerRules,
  });
}

/** Every folder with a zeff-plugin.json (up to five levels, as Zeff looks), described. Throws on a manifest that doesn't hold. */
export function buildCatalog() {
  const all = repoFiles().filter((f) => !hidden(f));
  const manifests = all.filter((f) => /(^|\/)zeff-plugin\.json$/.test(f) && f.split("/").length <= 5).sort();
  const problems = [];
  const plugins = [];
  const seen = new Map();
  for (const mf of manifests) {
    const rel = mf.replace(/\/?zeff-plugin\.json$/, "");
    const dir = path.join(ROOT, rel);
    let m;
    try {
      m = readJson(path.join(ROOT, mf));
    } catch (e) {
      problems.push(`${mf}: not JSON (${e.message})`);
      continue;
    }
    const bad = (why) => problems.push(`${mf}: ${why}`);
    if (typeof m.id !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(m.id)) bad("id must be a-z, digits and -, 2–40 characters");
    if (typeof m.name !== "string" || !m.name.trim()) bad("no name");
    if (!Number.isInteger(m.apiVersion)) bad("no apiVersion");
    if (m.keywords !== undefined && (!Array.isArray(m.keywords) || m.keywords.some((k) => typeof k !== "string" || !k.trim() || k.length > 40) || m.keywords.length > 20)) bad("keywords: up to 20 words of up to 40 characters");
    if (m.category !== undefined && !CATEGORIES.includes(m.category)) bad(`category must be one of ${CATEGORIES.join(", ")}`);
    if (m.icon !== undefined && (typeof m.icon !== "string" || !m.icon.trim() || m.icon.length > 200)) bad("icon: an emoji or a path to an image in the folder");
    if (m.screenshots !== undefined && (!Array.isArray(m.screenshots) || m.screenshots.length > 8)) bad("screenshots: up to 8 paths");
    if (seen.has(m.id)) bad(`the id "${m.id}" is used by ${seen.get(m.id)} too`);
    seen.set(m.id, rel);
    const prefix = rel ? `${rel}/` : "";
    // (every file under the folder — what Zeff downloads when it installs it)
    const fileList = all.filter((f) => f.startsWith(prefix));
    const files = new Map(fileList.map((f) => [f.slice(prefix.length), fs.readFileSync(path.join(ROOT, f))]));
    for (const s of m.screenshots ?? []) if (typeof s !== "string" || !files.has(s)) bad(`screenshot "${s}" is not in the folder`);
    let icon = typeof m.icon === "string" ? m.icon : undefined;
    let iconImage;
    if (icon && files.has(icon)) {
      const buf = files.get(icon);
      const ext = path.extname(icon).slice(1).toLowerCase();
      const type = { png: "image/png", svg: "image/svg+xml", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext];
      if (!type) bad(`icon "${icon}" is no png, svg, jpg or webp`);
      else if (buf.length > 32_000) bad(`icon "${icon}" is larger than 32 kB`);
      else iconImage = `data:${type};base64,${buf.toString("base64")}`;
      icon = undefined;
    }
    let signed = false;
    if (files.has("zeff-release.json")) {
      try {
        const r = JSON.parse(files.get("zeff-release.json").toString("utf8"));
        signed = { key: String(r.key ?? ""), version: String(r.version ?? "") };
        if (signed.version !== String(m.version ?? "")) bad(`zeff-release.json is for ${signed.version}, the manifest says ${m.version} — sign again`);
      } catch {
        bad("zeff-release.json is not JSON");
      }
    }
    let readme;
    for (const name of ["README.md", "readme.md", "Readme.md"]) if (files.has(name)) readme = readmeExcerpt(files.get(name).toString("utf8"));
    const firstAppIcon = addsOf(dir, m).apps?.find((a) => a.icon)?.icon;
    plugins.push(
      compact({
        id: m.id,
        name: m.name,
        version: String(m.version ?? "0.0.0"),
        description: String(m.description ?? ""),
        keywords: m.keywords,
        category: m.category,
        icon: icon ?? (iconImage ? undefined : firstAppIcon),
        iconImage,
        author: m.author,
        homepage: m.homepage,
        path: rel,
        permissions: m.permissions ?? [],
        requires: compact({ apiVersion: m.apiVersion, plugins: m.requires?.plugins }),
        adds: addsOf(dir, m),
        files: files.size,
        size: [...files.values()].reduce((a, b) => a + normalized(b).length, 0),
        hash: contentHash(files),
        signed,
        readme,
        screenshots: m.screenshots,
      }),
    );
  }
  if (problems.length) throw new Error(`catalog: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { format: 1, generatedBy: "scripts/catalog.mjs", categories: CATEGORIES, plugins };
}

export const catalogText = (c) => `${JSON.stringify(c, null, 2)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const text = catalogText(buildCatalog());
    if (process.argv.includes("--check")) {
      const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
      if (have !== text) {
        console.error("catalog.json is out of date — run `node scripts/catalog.mjs` and commit it.");
        process.exit(1);
      }
      console.log(`catalog.json is up to date (${JSON.parse(text).plugins.length} plugins).`);
    } else {
      fs.writeFileSync(OUT, text);
      console.log(`wrote catalog.json (${JSON.parse(text).plugins.length} plugins).`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
