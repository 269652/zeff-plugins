import { caseFromRow, dueForSummary, SUMMARY_INSTRUCTIONS, summaryPrompt } from "./lib.mjs";

async function all(zeff, store) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, limit: 500, offset });
    out.push(...rows);
    if (!rows.length || out.length >= total) return out;
  }
}

/** The plan: the due cases (the newest activity first — the built-in's order), each with its prompt (the built-in's own core). */
export async function handler(event, context) {
  const zeff = context.zeff;
  const cases = (await all(zeff, "cases-ext.cases")).map(caseFromRow).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const sources = await all(zeff, "cases-ext.sources");
  const counts = {};
  for (const x of sources) counts[x.case_id] = (counts[x.case_id] ?? 0) + 1;
  const ids = Array.isArray(event.ids) && event.ids.length ? event.ids.map(Number) : undefined;
  const due = dueForSummary(cases, counts, { ids, force: event.force === true, limit: Number(event.limit) || 8 });
  if (!due.length) return { items: [] };
  const { text: instructions } = await zeff.call("prompts.text", { key: "cases-compile", fallback: SUMMARY_INSTRUCTIONS });
  const items = [];
  for (const c of due) {
    // (its sources oldest first — the built-in's order)
    const mine = sources.filter((x) => x.case_id === c.id).sort((a, b) => b.at.localeCompare(a.at)).reverse();
    const { sources: said } = await zeff.call("sources.texts", { refs: mine.map((x) => x.ref) });
    const texts = mine.map((x) => ({ ref: x.ref, at: x.at, title: x.title, ...(said[x.ref] ?? {}) }));
    items.push({ id: c.id, key: c.key, sources: mine.length, personId: c.personId, prompt: summaryPrompt(c, texts, instructions) });
  }
  return { items };
}
