import { tFor } from "./lib.mjs";

/**
 * What the Documents settings page shows (the built-in's settings page: its folders and the audio transcriber, src/plugins/documents/LocalFoldersForm.tsx,
 * DocumentSettingsForm.tsx): your local folders with how many documents each holds and when it was read in, the documents waiting for your confirmation, what
 * is being read, the transcriber command and the Poppler setting. event: { save: { transcriber, autoInstall } } — then it gives the setting to keep as `prefValue` (a
 * lambda only reads: the flow keeps it). Returns { folders, pending, reading, transcriber, autoInstall } (or { prefValue, message }).
 */
export async function handler(event, context) {
  const z = context.zeff;
  const t = tFor(context.language);
  const lang = context.language || "en";
  const prefs = (await z.call("pref.get", { key: "plugin:documents" })).value;
  const cur = prefs && typeof prefs === "object" ? prefs : {};
  if (event?.save) {
    return { prefValue: { transcriber: String(event.save.transcriber ?? "").trim().slice(0, 500), autoInstall: String(event.save.autoInstall) !== "false" }, message: t("Saved.") };
  }
  const list = (await z.call("pref.get", { key: "documents:folders" })).value;
  const folders = (Array.isArray(list) ? list : []).map((f) => ({
    id: f.id,
    path: f.path,
    mode: f.mode,
    files: Number(f.files) || 0,
    status: f.lastScanAt ? t("{n} documents · read in {when}", { n: Number(f.files) || 0, when: new Date(f.lastScanAt).toLocaleString(lang) }) : t("not read in yet"),
  }));
  const pending = (await z.call("sql.query", { sql: "select d.id, d.name, d.kind from documents d join doc_gate g on g.doc_id = d.id where g.state = 'pending' order by d.created_at desc", limit: 200 })).rows;
  const reading = (await z.call("sql.query", { sql: "select status, count(*) as n from documents where status in ('queued', 'extracting') group by status", limit: 5 })).rows;
  const count = (s) => reading.find((r) => r.status === s)?.n ?? 0;
  return {
    folders,
    pending,
    reading: { waiting: count("queued"), now: count("extracting") },
    transcriber: String(cur.transcriber ?? ""),
    autoInstall: cur.autoInstall !== false,
  };
}
