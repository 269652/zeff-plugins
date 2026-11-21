/**
 * The abstracts the knowledge server made (its pages as knowledge.pages gave them): kept with the documents that are compiled — the built-in's pullAbstracts
 * (src/plugins/documents/process.ts). event: { pages: [{ id: "zeff:doc:3", summary, concepts, compiled }] }. Returns { statements, n }.
 */
export async function handler(event) {
  const statements = [];
  for (const p of Array.isArray(event?.pages) ? event.pages : []) {
    const id = Number(String(p?.id ?? "").replace("zeff:doc:", ""));
    if (!p?.compiled || !String(p.summary ?? "").trim() || !Number.isInteger(id)) continue;
    statements.push({ sql: "update documents set summary = ?, concepts = ?, compiled = 1 where id = ?", params: [String(p.summary).slice(0, 4000), String(p.concepts ?? "").slice(0, 1000), id] });
  }
  return { statements, n: statements.length };
}
