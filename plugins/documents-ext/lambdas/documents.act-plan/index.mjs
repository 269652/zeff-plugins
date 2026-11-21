import { tFor } from "./lib.mjs";

/**
 * What a button of the Documents screen does to documents, as statements for the flow to run (a lambda only reads): mark read (seen) or unread, delete (the
 * row, its marks, and which files and todo refs go with it), read again, skip, restart the reading, confirm those waiting for you (the built-in's seen.ts,
 * store.ts deleteDocument, server-actions.ts, gate.ts). event: { op: read | unread | delete | reread | skip | restart | approve, ids (a list: 3,7 or [3,7]), now }.
 * Returns { statements, drops: [file], refs: ["doc:3"], reading (the flow reads what waits now), changed, message }.
 */
const ids = (v) => [...new Set(String(Array.isArray(v) ? v.join(",") : (v ?? "")).match(/\d+/g)?.map(Number).filter((n) => n > 0) ?? [])].slice(0, 500);

export async function handler(event, context) {
  const z = context.zeff;
  const t = tFor(context.language);
  const op = String(event?.op ?? "");
  const list = ids(event?.ids ?? event?.id);
  const now = String(event?.now ?? new Date().toISOString());
  const out = { statements: [], drops: [], refs: [], reading: false, changed: 0, message: "" };
  if (op === "read") {
    out.statements = list.map((id) => ({ sql: "insert or ignore into document_seen (doc_id, at) values (?, ?)", params: [id, now] }));
    out.changed = list.length;
  } else if (op === "unread") {
    out.statements = list.map((id) => ({ sql: "delete from document_seen where doc_id = ?", params: [id] }));
    out.changed = list.length;
  } else if (op === "delete") {
    for (const id of list) {
      const r = (await z.call("sql.query", { sql: "select file from documents where id = ?", params: [id], limit: 1 })).rows[0];
      if (!r) continue;
      out.drops.push(r.file);
      out.refs.push(`doc:${id}`);
      out.statements.push({ sql: "delete from documents where id = ?", params: [id] }, { sql: "delete from doc_gate where doc_id = ?", params: [id] }, { sql: "delete from document_seen where doc_id = ?", params: [id] });
      out.changed++;
    }
    if (out.changed) out.message = t("Document deleted.");
  } else if (op === "reread") {
    for (const id of list) {
      const r = (await z.call("sql.query", { sql: "select 1 as x from documents where id = ?", params: [id], limit: 1 })).rows[0];
      if (!r) throw new Error(t("This document doesn't exist (any more)."));
      out.statements.push({ sql: "update documents set status = 'queued', error = '', updated_at = ? where id = ?", params: [now, id] });
      out.changed++;
    }
    out.reading = true;
    out.message = t("Reading it again …");
  } else if (op === "skip") {
    for (const id of list) {
      out.statements.push({ sql: "update documents set status = 'failed', error = ?, updated_at = ? where id = ? and status in ('queued', 'extracting')", params: [t("Skipped — click “Read again”."), now, id] });
      out.changed++;
    }
    out.message = t("Skipped.");
  } else if (op === "restart") {
    // What was left "being read" is waiting again; the reading begins afresh.
    out.statements.push({ sql: "update documents set status = 'queued', updated_at = ? where status = 'extracting'", params: [now] });
    out.reading = true;
    out.message = t("Reading restarted.");
  } else if (op === "approve") {
    for (const id of list) out.statements.push({ sql: "update doc_gate set state = 'approved', at = ? where doc_id = ? and state = 'pending'", params: [now, id] });
    out.changed = list.length;
    out.reading = true;
    out.message = list.length === 1 ? t("1 document confirmed.") : t("{n} documents confirmed.", { n: list.length });
  } else throw new Error("op: read, unread, delete, reread, skip, restart or approve.");
  return out;
}
