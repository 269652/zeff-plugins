/**
 * A document's whole text and its summary, for its detail (the built-in's documentText, src/plugins/documents/fulltext.ts). event: { id }.
 * Returns { found, text, summary }.
 */
export async function handler(event, context) {
  const { rows } = await context.zeff.call("sql.query", { sql: "select text, summary from documents where id = ?", params: [Number(event?.id)], limit: 1 });
  const r = rows[0];
  return r ? { found: true, text: r.text ?? "", summary: r.summary ?? "" } : { found: false, text: "", summary: "" };
}
