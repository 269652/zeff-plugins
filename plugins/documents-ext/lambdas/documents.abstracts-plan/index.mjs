/**
 * The documents the knowledge server has to compile (read, not yet compiled, not waiting for your confirmation) — the built-in's uncompiledDocuments
 * (src/plugins/documents/store.ts): their page ids for the flow to ask for. Returns { ids: ["zeff:doc:3", …] }.
 */
export async function handler(_event, context) {
  const { rows } = await context.zeff.call("sql.query", {
    sql: "select id from documents where status = 'ready' and compiled = 0 and id not in (select doc_id from doc_gate where state = 'pending') order by id",
    limit: 200,
  });
  return { ids: rows.map((r) => `zeff:doc:${r.id}`) };
}
