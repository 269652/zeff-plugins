import { tFor } from "./lib.mjs";

/**
 * What came of reading one document: the built-in's process.ts (a text read: ready, with the text kept; a kind that needs the AI in the fast lane: waiting for the
 * slow lane — or for your confirmation, when its folder says so; nothing readable: unsupported; any other error: failed, "took too long" said so) as statements
 * for the flow over the plugin's adopted tables. event: { id, lane: fast|slow, read: the answer of files.text or { error }, now }.
 * Returns { slow, statements }.
 */
const MAX_TEXT = 400000;

export async function handler(event, context) {
  const z = context.zeff;
  const t = tFor(context.language);
  const { id, lane, read, now } = event;
  const set = (status, error) => ({ sql: "update documents set status = ?, error = ?, updated_at = ? where id = ? and status = 'extracting'", params: [status, String(error ?? "").slice(0, 500), now, id] });
  if (read?.error) {
    const tooLong = /took longer than/i.test(String(read.error));
    return { slow: false, statements: [set("failed", tooLong ? t("It took too long — click “Read again”.") : read.error)] };
  }
  if (read?.unsupported) return { slow: false, statements: [set("unsupported", read.unsupported)] };
  if (read?.slow) {
    if (lane === "slow") return { slow: false, statements: [set("failed", t("It took too long — click “Read again”."))] };
    // Waiting for your confirmation (a local folder set so): the AI reads it only once you confirm.
    const held = (await z.call("sql.query", { sql: "select 1 as held from doc_gate where doc_id = ? and state = 'pending'", params: [id], limit: 1 })).rows.length > 0;
    return held ? { slow: false, statements: [set("queued", t("Waits for your confirmation — then the AI reads it."))] } : { slow: true, statements: [set("queued", "")] };
  }
  const text = String(read?.text ?? "").slice(0, MAX_TEXT);
  return { slow: false, statements: [{ sql: "update documents set text = ?, status = 'ready', error = '', compiled = 0, summary = '', concepts = '', updated_at = ? where id = ? and status = 'extracting'", params: [text, now, id] }] };
}
