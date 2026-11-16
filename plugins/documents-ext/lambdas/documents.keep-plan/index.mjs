import { kindOf } from "./lib.mjs";

/**
 * One file of a local folder read in: what the built-in's addDocument / replaceDocument (src/plugins/documents/store.ts) and scanFolders do with it, as
 * statements for the flow to run over the plugin's adopted tables — a new file is a new document (the same content as one kept already gives that one back,
 * nothing doubled), a changed file puts its new content in its document's place (to be read and compiled again), the file's state in doc_local_files, and,
 * from a folder that waits for you, the document held until you confirm it (doc_gate). The document is told by the content's hash — one row per content.
 * event: { item: a work item of documents.folders-plan, sha256, size, now }. Returns { keep, file, drop, added, updated, statements }.
 */
export async function handler(event, context) {
  const z = context.zeff;
  const { item, sha256, size, now } = event;
  // (the file couldn't be read: empty, too large, gone — said so, nothing else happens with it)
  if (event.error || !sha256) return { error: String(event.error ?? "unreadable"), keep: false, file: "", drop: null, added: 0, updated: 0, statements: [] };
  const file = `${sha256.slice(0, 16)}-${item.clean}`;
  const one = async (sql, params) => (await z.call("sql.query", { sql, params, limit: 1 })).rows[0];
  const statements = [];
  let keep = false;
  let drop = null;
  let added = 0;
  let updated = 0;
  const insert = () => {
    keep = true;
    statements.push({
      sql: "insert into documents (name, mime, size, sha256, kind, status, error, file, text, summary, concepts, compiled, created_at, updated_at) values (?, '', ?, ?, ?, 'queued', '', ?, '', '', '', 0, ?, ?)",
      params: [item.clean, size, sha256, kindOf(item.clean, ""), file, now, now],
    });
  };
  const cur = item.hadDocId ? await one("select id, sha256, file, mime from documents where id = ?", [item.hadDocId]) : null;
  if (item.hadDocId) updated++;
  if (cur) {
    // A changed file: its document is updated in place (read and compiled again) — unless the content is one kept already.
    if (cur.sha256 !== sha256) {
      const other = await one("select id from documents where sha256 = ?", [sha256]);
      if (!other) {
        keep = true;
        if (cur.file !== file) drop = cur.file;
        statements.push({
          sql: "update documents set name = ?, size = ?, sha256 = ?, file = ?, kind = ?, status = 'queued', error = '', text = '', summary = '', concepts = '', compiled = 0, updated_at = ? where id = ?",
          params: [item.clean, size, sha256, file, kindOf(item.clean, cur.mime), now, cur.id],
        });
      }
    }
  } else {
    // A new file (or one whose document is gone): a new document, unless that content is kept already.
    const had = await one("select id from documents where sha256 = ?", [sha256]);
    if (!had) {
      insert();
      if (!item.hadDocId) added++;
    }
  }
  // A folder that waits for you: the new or changed document waits (again) for your confirmation.
  if (item.mode === "confirm") statements.push({ sql: "insert into doc_gate (doc_id, state, at) select id, 'pending', ? from documents where sha256 = ? on conflict(doc_id) do update set state = 'pending', at = excluded.at", params: [now, sha256] });
  statements.push({
    sql: "insert into doc_local_files (path, folder_id, rel, doc_id, size, mtime, missing_at) select ?, ?, ?, id, ?, ?, null from documents where sha256 = ? on conflict(path) do update set folder_id = excluded.folder_id, rel = excluded.rel, doc_id = excluded.doc_id, size = excluded.size, mtime = excluded.mtime, missing_at = null",
    params: [item.path, item.folderId, item.rel, item.size, item.mtime, sha256],
  });
  return { keep, file, drop, added, updated, statements };
}
