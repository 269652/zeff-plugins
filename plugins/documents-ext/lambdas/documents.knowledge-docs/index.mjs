/**
 * The documents as pages for the knowledge server (its "Zeff" source): one each, in the space "Zeff · Documents" — their text read, with what they are. Unchanged
 * ones aren't compiled again (the version is a hash of the text). The built-in's documentDocs (src/plugins/documents/export.ts); those waiting for your confirmation
 * aren't given. Returns the pages.
 */
function version(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) || 1;
}
const sizeText = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`);

export async function handler(_event, context) {
  const { rows } = await context.zeff.call("sql.query", {
    sql: "select id, name, kind, size, text, created_at, updated_at from documents where status = 'ready' and trim(text) != '' and id not in (select doc_id from doc_gate where state = 'pending') order by id",
    limit: 2000,
  });
  return rows.map((d) => {
    const body = `Dokument „${d.name}“ (${d.kind}, ${sizeText(d.size)}, abgelegt am ${d.created_at.slice(0, 10)}):\n\n${d.text}`;
    return { id: `zeff:doc:${d.id}`, space: "Zeff · Documents", title: d.name, version: version(`${d.name}\n${body}`), updatedAt: d.updated_at, author: null, body };
  });
}
