import { stamp } from "./lib.mjs";

/**
 * The unread box ticked off (or on) in a row of the document inbox is the document seen (unread) — the built-in's pullDocuments
 * (src/plugins/documents/workspace-source.ts) as statements for the flow. event: { rows: [{ cells }] } (the rows of the database the source fills). A row whose
 * document changed since it was read (its stamp differs) is left: the row follows the document, not the other way. Returns { statements, seen, unread }.
 */
export async function handler(event, context) {
  const z = context.zeff;
  const now = new Date().toISOString();
  const docs = new Map((await z.call("sql.query", { sql: "select d.id, d.name, d.status, d.compiled, (s.doc_id is null) as unread from documents d left join document_seen s on s.doc_id = d.id", limit: 5000 })).rows.map((d) => [d.id, d]));
  const statements = [];
  let seen = 0;
  let again = 0;
  for (const row of Array.isArray(event?.rows) ? event.rows : []) {
    const cells = row?.cells ?? {};
    const m = /^doc:(\d+)$/.exec(String(cells.srcref ?? ""));
    const d = m ? docs.get(Number(m[1])) : null;
    if (!d) continue;
    if (String(cells.srcedited ?? "") !== stamp([d.status, !!d.compiled, d.name, !!d.unread])) continue;
    const wantUnread = cells.docunread === true;
    if (!wantUnread && d.unread) {
      statements.push({ sql: "insert or ignore into document_seen (doc_id, at) values (?, ?)", params: [d.id, now] });
      seen++;
    } else if (wantUnread && !d.unread) {
      statements.push({ sql: "delete from document_seen where doc_id = ?", params: [d.id] });
      again++;
    }
  }
  return { statements, seen, unread: again };
}
