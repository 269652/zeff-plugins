import { RELATE_INSTRUCTIONS, RELATE_RESERVE, RELATE_SCHEMA, batchByChars, candidates, docWords, pickedRefs, relateBlock } from "./lib.mjs";

/**
 * The Dokument-Zuordnung: for each open todo the few documents likeliest to be about it (most shared words), then the AI picks by content — per batch of todos,
 * a batch that fails leaves its todos as they are. The built-in's relateDocuments (src/plugins/documents/relations.ts) over the plugin's adopted tables and the
 * kernel's todos.open / jira.summaries. A lambda only reads: the flow adds the picks to the todos (todos.set-related).
 * Returns { todos, batches, failed, picks: { <todo id>: [ref] } }.
 */
export async function handler(_event, context) {
  const z = context.zeff;
  const open = (await z.call("todos.open", {})).todos;
  const { rows } = await z.call("sql.query", {
    sql: "select id, name, kind, created_at, summary, concepts, substr(text, 1, 4000) as text from documents where status = 'ready' and length(trim(text, ' ' || char(9, 10, 11, 12, 13))) > 0 and id not in (select doc_id from doc_gate where state = 'pending') order by created_at desc",
    limit: 2000,
  });
  const docs = rows.map((r) => {
    const d = { id: r.id, ref: `doc:${r.id}`, name: r.name, kind: r.kind, createdAt: r.created_at, abstract: r.summary, concepts: r.concepts, text: r.text };
    return { d, w: docWords(d) };
  });
  const keys = [...new Set(open.map((t) => t.ticket).filter(Boolean))];
  const summaries = keys.length ? (await z.call("jira.summaries", { keys })).summaries : {};
  const picks = {};
  const groups = [];
  for (const todo of open) {
    const list = candidates({ id: todo.id, text: todo.text, ticket: todo.ticket, note: todo.note }, todo.ticket ? (summaries[todo.ticket] ?? "") : "", docs);
    if (list.length) groups.push({ todo, list });
    else picks[todo.id] = []; // nothing likely: no documents
  }
  const room = (await z.call("prompts.fill", { key: "doc-relations", template: RELATE_INSTRUCTIONS, reserve: RELATE_RESERVE })).room;
  const instructions = (await z.call("prompts.fill", { key: "doc-relations", template: RELATE_INSTRUCTIONS })).raw;
  const block = (g) => relateBlock({ id: g.todo.id, text: g.todo.text, ticket: g.todo.ticket }, g.list);
  const batches = batchByChars(groups, (g) => block(g).length, room);
  let failed = 0;
  for (const batch of batches) {
    let answer;
    try {
      answer = await z.call("ai.json", { prompt: `${instructions}\n\n${batch.map(block).join("\n\n")}`, schema: RELATE_SCHEMA, task: "documents-ext.doc-relations", budget: 1, minutes: 10 });
    } catch (e) {
      console.error("[doc-relations]", e instanceof Error ? e.message : String(e));
      failed++;
      continue;
    }
    const said = new Map((answer?.todos ?? []).filter((x) => Number.isInteger(x?.id)).map((x) => [x.id, x.docs ?? []]));
    for (const g of batch) picks[g.todo.id] = pickedRefs(said.get(g.todo.id), g.list);
  }
  return { todos: Object.keys(picks).length, batches: batches.length, failed, picks };
}
