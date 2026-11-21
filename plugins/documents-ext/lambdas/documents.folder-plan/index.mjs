import { tFor } from "./lib.mjs";

/**
 * A change to the local folders (Settings → Documents), worked out for the flow: a folder added (its path as files.browse found it — a folder that is there), its
 * mode set (auto: the AI goes on by itself; confirm: it waits for you) or the folder no longer read (its documents stay). The built-in's addFolder / setFolderMode /
 * removeFolder (src/plugins/documents/folders.ts) over the pref the folders are kept in. event: { op: add | mode | remove, path, mode, id }.
 * Returns { prefValue (the folders to keep), statements, scan (read in now), message }.
 */
const same = (a, b) => String(a).replace(/[\\/]+$/, "").toLowerCase() === String(b).replace(/[\\/]+$/, "").toLowerCase();

export async function handler(event, context) {
  const z = context.zeff;
  const t = tFor(context.language);
  const list = (await z.call("pref.get", { key: "documents:folders" })).value;
  const folders = Array.isArray(list) ? list : [];
  const mode = event?.mode === "confirm" ? "confirm" : "auto";
  const op = String(event?.op ?? "");
  if (op === "add") {
    const path = String(event?.path ?? "").trim();
    if (!path) throw new Error(t("“{path}” is not a folder on this computer.", { path }));
    const had = folders.find((f) => same(f.path, path));
    if (had) return { prefValue: folders.map((f) => (f === had ? { ...f, mode } : f)), statements: [], scan: true, message: t("“{path}” is read in now.", { path }) };
    const id = Math.random().toString(16).slice(2, 10);
    return { prefValue: [...folders, { id, path, mode, addedAt: new Date().toISOString(), lastScanAt: null, files: 0 }], statements: [], scan: true, message: t("“{path}” is read in now.", { path }) };
  }
  if (op === "mode") return { prefValue: folders.map((f) => (f.id === String(event?.id) ? { ...f, mode } : f)), statements: [], scan: false, message: "" };
  if (op === "remove") {
    const id = String(event?.id ?? "");
    return { prefValue: folders.filter((f) => f.id !== id), statements: [{ sql: "delete from doc_local_files where folder_id = ?", params: [id] }], scan: false, message: t("The folder is no longer read in; its documents stay.") };
  }
  throw new Error("op: add, mode or remove.");
}
