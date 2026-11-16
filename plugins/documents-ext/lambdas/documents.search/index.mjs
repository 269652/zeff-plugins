import { matchWhere, wordsOf } from "./lib.mjs";

/**
 * The documents app's search: the ids of the documents holding every word typed — in their whole text, not only the name (the built-in's documentsMatching,
 * src/plugins/documents/fulltext.ts, with the same words and the same SQL over the plugin's adopted table). event: { q }. Returns { ids }.
 */
export async function handler(event, context) {
  const words = wordsOf(String(event?.q ?? "").slice(0, 300));
  if (!words.length) return { ids: [] };
  const { rows } = await context.zeff.call("sql.query", { sql: `select id from documents where ${matchWhere(words)}`, params: words, limit: 2000 });
  return { ids: rows.map((r) => r.id) };
}
