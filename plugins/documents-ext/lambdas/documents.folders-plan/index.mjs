import { MAX_DOCUMENT_BYTES, READABLE_EXTS, diffFolder, safeName, tFor } from "./lib.mjs";

/**
 * The local folders, their plan: every folder you set (Settings → Documents) looked at through the kernel's files.scan — which of its files are new or changed
 * (to read in, at most 150 a run — the rest the next time), which came back, which are gone. The built-in's scanFolders (src/plugins/documents/folders.ts) with
 * the same decisions (folders-core.ts diffFolder), over the plugin's adopted tables (doc_local_files) and the kernel's pref.get. A lambda only reads: the flow
 * reads the files in. Returns { work: [{ path, rel, name, clean, size, mtime, folderId, mode, hadDocId }], marks: [[statement]] (files back, files gone — in batches),
 * prefValue (the folders as the settings keep them), errors, now }.
 */
const PER_RUN = 150;
const baseName = (p) => String(p).split(/[\\/]/).pop() ?? "";

export async function handler(_event, context) {
  const z = context.zeff;
  const t = tFor(context.language);
  const list = (await z.call("pref.get", { key: "documents:folders" })).value;
  const folders = Array.isArray(list) ? list : [];
  const out = { work: [], restore: [], gone: [], folders: [], errors: [] };
  const scanned = new Set();
  let budget = PER_RUN;
  const now = new Date().toISOString();
  for (const folder of folders) {
    const scan = await z.call("files.scan", { root: folder.path, exts: READABLE_EXTS, maxBytes: MAX_DOCUMENT_BYTES });
    if (!scan.exists) {
      out.errors.push(t("“{path}” isn't there (a drive not connected?).", { path: folder.path }));
      continue;
    }
    const known = [];
    for (;;) {
      const page = (await z.call("sql.query", { sql: "select path, folder_id, rel, doc_id, size, mtime, missing_at from doc_local_files where folder_id = ? order by path limit 1500 offset ?", params: [folder.id, known.length], limit: 1500 })).rows;
      known.push(...page);
      if (page.length < 1500) break;
    }
    const plan = diffFolder(scan.files, known, budget);
    budget = plan.budget;
    out.restore.push(...plan.restore);
    out.gone.push(...plan.gone.map((r) => r.path));
    for (const { file, had } of plan.work) {
      out.work.push({ path: file.path, rel: file.rel, name: baseName(file.path), clean: safeName(baseName(file.path)), size: file.size, mtime: file.mtime, folderId: folder.id, mode: folder.mode === "confirm" ? "confirm" : "auto", hadDocId: had?.doc_id ?? null });
    }
    out.folders.push({ ...folder, lastScanAt: now, files: scan.files.length });
    scanned.add(folder.id);
  }
  const marks = [
    ...out.restore.map((path) => ({ sql: "update doc_local_files set missing_at = null where path = ?", params: [path] })),
    ...out.gone.map((path) => ({ sql: "update doc_local_files set missing_at = ? where path = ?", params: [now, path] })),
  ];
  const batches = [];
  for (let i = 0; i < marks.length; i += 400) batches.push(marks.slice(i, i + 400));
  // (the list as the settings keep it: the folders looked at with when and how many files)
  return { work: out.work, marks: batches, gone: out.gone.length, errors: out.errors, scanned: out.folders.length, now, prefValue: folders.map((f) => out.folders.find((x) => x.id === f.id) ?? f) };
}
