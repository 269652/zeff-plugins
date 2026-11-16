import { INSTRUCTIONS, LANGUAGE_NAMES, SCHEMA, blockOf, entitiesFor, isDue, kindOfPage, kindOn, pickedOf } from "./lib.mjs";

/**
 * The Wissens-Zuordnung (after the Ticket-Lage): for each open todo that's new or changed since its last one, the knowledge server's full-text candidates —
 * the pages and terms of the knowledge base that might help — and the AI keeps only those that really fit, each page with a line on why. The built-in's
 * relateKnowledge (src/plugins/knowledge/relations.ts) over the kernel's reads `todos.attached` (the todos with what was matched before, the numbers set in
 * Settings → Todos, your own instructions for the step, what a todo shows) and `service.read` (the knowledge server's /api/related). A lambda only reads: it
 * hands back the assignments, the flow keeps them. event: {}. Returns { items: [{ id, value: { at, pages, entities, links } }], todos, assigned, failed, batches }.
 */
const ROOM = 23000; // (the prompt's room per batch: what Copilot takes — the shortest of the AI backends)

export async function handler(event, context) {
  const zeff = context.zeff;
  const all = await zeff.call("todos.attached", { slot: "matches", area: "knowledge" });
  const off = all.displayOff ?? [];
  const maxTodos = Number(all.numbers?.maxTodos) || 20;
  const cand = Number(all.numbers?.candidates) || 6;
  const due = all.todos
    .filter((t) => isDue(t, t.attached))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, maxTodos);
  if (!due.length) return { items: [], todos: 0, assigned: 0, failed: 0, batches: 0 };
  const open = new Set(all.openIds.map((id) => `zeff:todo:${id}`));
  const notKnowledge = (t, p) => !kindOn(off, kindOfPage(p)) || p.id === `zeff:todo:${t.id}` || open.has(p.id) || (!!t.ticket && p.id === `zeff:jira:${t.ticket}`);
  const candidates = new Map();
  for (const t of due) {
    const r = await zeff.call("service.read", { service: "knowledge", path: "/api/related", body: { text: [t.text, t.ticketSummary].filter(Boolean).join(" — "), ticket: t.ticket || null, limit: cand * 3 + 4 }, timeoutMs: 10000 }).catch(() => null);
    const pages = (r?.pages ?? []).filter((p) => !notKnowledge(t, p)).slice(0, cand);
    candidates.set(t.id, { pages, entities: off.includes("entities") ? [] : entitiesFor(r?.entities ?? [], []), links: [] });
  }
  const at = new Date().toISOString();
  const items = [];
  const withCandidates = due.filter((t) => {
    const c = candidates.get(t.id);
    if (c.pages.length || c.entities.length || c.links.length) return true;
    items.push({ id: t.id, value: { at, pages: [], entities: [], links: [] } }); // nothing to pick: saved as none (until it changes)
    return false;
  });
  // (batches by the size of their prompt text)
  const batches = [];
  let size = 0;
  for (const t of withCandidates) {
    const n = blockOf(t, candidates.get(t.id)).length + 2;
    if (!batches.length || size + n > ROOM || batches[batches.length - 1].length >= 8) {
      batches.push([]);
      size = 0;
    }
    batches[batches.length - 1].push(t);
    size += n;
  }
  const instructions = (await zeff.call("prompts.fill", { key: "knowledge-relations", template: INSTRUCTIONS, vars: {} })).text;
  const lang = LANGUAGE_NAMES[context.language] ?? LANGUAGE_NAMES.en;
  let assigned = 0;
  let failed = 0;
  for (const batch of batches) {
    const prompt = `${instructions} Schreib die „why“-Sätze auf ${lang}.${all.extra ?? ""}\n\n${batch.map((t) => blockOf(t, candidates.get(t.id))).join("\n\n")}`;
    const answer = await zeff.call("ai.json", { prompt, schema: SCHEMA, task: "knowledge-ext.relations", budget: 0.5 }).catch(() => null);
    if (!answer) {
      failed++;
      continue;
    }
    const picked = new Map((answer.todos ?? []).map((x) => [Number(x.id), x]));
    for (const t of batch) {
      const v = pickedOf(candidates.get(t.id), picked.get(t.id));
      items.push({ id: t.id, value: { at, ...v } });
      if (v.pages.length || v.entities.length || v.links.length) assigned++;
    }
  }
  return { items, todos: due.length, assigned, failed, batches: batches.length };
}
