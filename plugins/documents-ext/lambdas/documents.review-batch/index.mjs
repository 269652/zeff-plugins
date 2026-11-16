import { REVIEW_INSTRUCTIONS, REVIEW_SCHEMA, plain, proposedTodos, reviewPrompt } from "./lib.mjs";

/**
 * The Dokument-Durchsicht, one batch: the AI reads these documents (each its beginning and end), against my tickets and the todos that are open, and says what I
 * have to do — handed back as todos for the flow to make through the gate. A batch whose answer fails comes back with failed: its documents are read next time.
 * event: { docs: [{ id, version }] }. Returns { failed, items: [todo], marks: [{ ref, hash }] }.
 */
const pad = (n) => String(n).padStart(2, "0");
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export async function handler(event, context) {
  const z = context.zeff;
  const docs = Array.isArray(event?.docs) ? event.docs : [];
  const ids = docs.map((d) => Number(d.id)).filter((n) => Number.isInteger(n));
  if (!ids.length) return { failed: false, items: [], marks: [] };
  const got = (await z.call("sql.query", { sql: "select id, name, kind, created_at, summary, concepts, text from documents where id in (select value from json_each(?))", params: [JSON.stringify(ids)], limit: ids.length })).rows;
  const byId = new Map(got.map((r) => [r.id, r]));
  const batch = docs.flatMap((d) => {
    const r = byId.get(Number(d.id));
    return r ? [{ id: r.id, ref: `doc:${r.id}`, name: r.name, kind: r.kind, createdAt: r.created_at, version: String(d.version ?? ""), abstract: r.summary, concepts: r.concepts, text: r.text }] : [];
  });
  if (!batch.length) return { failed: false, items: [], marks: [] };
  const tickets = (await z.call("board.tickets", {})).tickets;
  const open = (await z.call("todos.open", {})).todos.map((x) => ({ id: x.id, ticket: x.ticket, text: x.text }));
  const now = new Date();
  const prompt = reviewPrompt({
    instructions: (await z.call("prompts.fill", { key: "doc-review", template: REVIEW_INSTRUCTIONS })).raw,
    todayLong: now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    today: localDay(now),
    tickets: tickets.map((t) => `- ${t.key}${t.summary ? ` — ${plain(t.summary, 120)}` : ""}`),
    open,
    batch,
  });
  let answer;
  try {
    answer = await z.call("ai.json", { prompt, schema: REVIEW_SCHEMA, task: "documents-ext.doc-todos", budget: 1, minutes: 10 });
  } catch (e) {
    console.error("[doc-todos]", e instanceof Error ? e.message : String(e));
    return { failed: true, items: [], marks: [] };
  }
  const known = new Set(batch.map((d) => d.ref));
  return { failed: false, items: proposedTodos(answer, known, tickets.map((t) => t.key)), marks: batch.map((d) => ({ ref: String(d.id), hash: d.version })) };
}
