/**
 * A document's whole text and its summary, for its detail (the built-in's documentText, src/plugins/documents/fulltext.ts). event: { id, chars }.
 * Returns { found, text, summary, length, more } — chars: how much of the text to give (all by default; the detail asks for the start).
 */
export async function handler(event, context) {
  const { rows } = await context.zeff.call("sql.query", { sql: "select text, summary from documents where id = ?", params: [Number(event?.id)], limit: 1 });
  const r = rows[0];
  if (!r) return { found: false, text: "", summary: "", length: 0, more: false };
  const text = r.text ?? "";
  const n = Math.max(0, Number(event?.chars) || 0);
  return { found: true, text: n ? text.slice(0, n) : text, summary: r.summary ?? "", length: text.length, more: n > 0 && text.length > n };
}
