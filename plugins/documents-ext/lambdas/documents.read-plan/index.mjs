/**
 * What is read now: the documents that wait to be read (queued) — and those left "being read" by a run that is gone (reading for more than a quarter of an hour:
 * waiting again). Not those held for your confirmation that the fast reading already said need the AI (nothing happens with them until you confirm — doc_gate).
 * The built-in's reading queue (src/plugins/documents/process.ts) over the plugin's adopted tables. A lambda only reads: the flow sets the stale ones back and
 * reads. event: { max }. Returns { recover: [statement], docs: [{ id, name, kind, file }], now }.
 */
const STALE_MS = 15 * 60000;
const WAITS = "Waits for your confirmation";

export async function handler(event, context) {
  const z = context.zeff;
  const max = Math.max(1, Math.min(300, Number(event?.max) || 150));
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_MS).toISOString();
  const rows = (
    await z.call("sql.query", {
      sql: "select id, name, kind, file, status from documents where (status = 'queued' or (status = 'extracting' and updated_at < ?)) and not (status = 'queued' and error like ? and id in (select doc_id from doc_gate where state = 'pending')) order by id",
      params: [staleBefore, `${WAITS}%`],
      limit: max,
    })
  ).rows;
  const recover = rows.some((r) => r.status === "extracting")
    ? [{ sql: "update documents set status = 'queued', updated_at = ? where status = 'extracting' and updated_at < ?", params: [now.toISOString(), staleBefore] }]
    : [];
  return { recover, docs: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, file: r.file })), now: now.toISOString() };
}
