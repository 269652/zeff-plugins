import { REVIEW_INSTRUCTIONS, REVIEW_RESERVE, batchByChars, reviewLine } from "./lib.mjs";

/**
 * The Dokument-Durchsicht, its plan: which documents the AI goes through now — the read ones (not those waiting for your confirmation) not gone through at this
 * version of their text — and in which batches. Those a todo already cites are only marked as gone through (a document you attached to a todo by hand is that
 * todo's context). The built-in's reviewDocumentsForTodos (src/plugins/documents/review.ts) over the plugin's adopted tables, the kernel's ai.memo-all and
 * todos.refs. A lambda only reads: the flow marks and goes through the batches. Returns { reviewed, marks: [{ ref, hash }], batches: [[{ id, version }]] }.
 */
const CHUNK = 40;

export async function handler(_event, context) {
  const z = context.zeff;
  const { rows } = await z.call("sql.query", {
    sql: "select id, updated_at from documents where status = 'ready' and length(trim(text, ' ' || char(9, 10, 11, 12, 13))) > 0 and id not in (select doc_id from doc_gate where state = 'pending') order by created_at desc",
    limit: 2000,
  });
  const seen = new Map((await z.call("ai.memo-all", { scope: "doc-reviewed" })).entries.map((e) => [e.ref, e.hash]));
  const unread = rows.filter((d) => seen.get(String(d.id)) !== d.updated_at);
  if (!unread.length) return { reviewed: 0, marks: [], batches: [] };
  const cited = new Set((await z.call("todos.refs", { prefix: "doc:" })).refs);
  const theirs = unread.filter((d) => cited.has(`doc:${d.id}`));
  const todo = unread.filter((d) => !cited.has(`doc:${d.id}`)).sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
  const marks = theirs.map((d) => ({ ref: String(d.id), hash: d.updated_at }));
  if (!todo.length) return { reviewed: theirs.length, marks, batches: [] };
  // How long each is in the prompt: its line (the part of its text the AI reads).
  const size = new Map();
  for (let i = 0; i < todo.length; i += CHUNK) {
    const ids = todo.slice(i, i + CHUNK).map((d) => d.id);
    const got = await z.call("sql.query", { sql: "select id, name, kind, created_at, summary, concepts, text from documents where id in (select value from json_each(?))", params: [JSON.stringify(ids)], limit: CHUNK });
    for (const r of got.rows) size.set(r.id, reviewLine({ id: r.id, ref: `doc:${r.id}`, name: r.name, kind: r.kind, createdAt: r.created_at, version: "", abstract: r.summary, concepts: r.concepts, text: r.text }).length + 1);
  }
  const room = (await z.call("prompts.fill", { key: "doc-review", template: REVIEW_INSTRUCTIONS, reserve: REVIEW_RESERVE })).room;
  const batches = batchByChars(todo, (d) => size.get(d.id) ?? 1, room).map((b) => b.map((d) => ({ id: d.id, version: d.updated_at })));
  return { reviewed: theirs.length, marks, batches };
}
