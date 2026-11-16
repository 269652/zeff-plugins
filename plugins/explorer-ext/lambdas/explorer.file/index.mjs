import { crumbs, fileUrl, parseCsv, sizeText, tFor } from "./lib.mjs";

/**
 * A file opened for the viewer (views/explorer.html reads it as data.file): the kernel's fs.read-text (the built-in's own openFile) and what the viewer needs
 * of it — which way it is shown, its text, a CSV's rows, the addresses of the file for pictures, PDFs, audio, video and the download. event: { path }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const path = String(event?.path ?? "").trim();
  if (!path) return { found: false };
  let f;
  try {
    f = await zeff.call("fs.read-text", { path });
  } catch (e) {
    return { found: false, name: path, error: String(e?.message ?? e) };
  }
  let h = 0;
  for (const c of `${f.path}:${f.mtime}`) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  const csvRows = f.view === "csv" && f.text !== null ? parseCsv(f.text, f.name.toLowerCase().endsWith(".tsv")) : [];
  const cols = csvRows.reduce((m, r) => Math.max(m, r.length), 1);
  return {
    found: true,
    key: h.toString(36),
    path: f.path,
    name: f.name,
    view: f.view,
    textual: f.view === "text" || f.view === "markdown" || f.view === "csv",
    hasText: f.text !== null,
    text: f.text ?? "",
    editable: f.editable,
    readOnlyWhy: f.readOnlyWhy ?? "",
    mtime: f.mtime,
    size: sizeText(f.size),
    date: new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(f.mtime)),
    inDocs: f.docId !== null,
    changed: !!f.changed,
    importable: !!f.importable,
    csvCols: Math.min(cols, 12),
    csvRows: csvRows.map((r, i) => ({ cells: Array.from({ length: Math.min(cols, 12) }, (_, j) => ({ v: r[j] ?? "", head: i === 0 })) })),
    url: `${fileUrl(f.path)}&v=${f.mtime}`,
    downloadUrl: fileUrl(f.path, true),
    officeText: f.view === "office" ? f.text || t("No text in it.") : "",
    crumbs: crumbs(f.path),
  };
}
