import { CLASSIFY_INSTRUCTIONS, CLASSIFY_SCHEMA, classifyPrompt } from "./lib.mjs";

/**
 * What each contact is, as the AI reads it: a person or an organisation (a bank, an authority, a company) and their circle (family, friends, work, authorities &
 * creditors, services) — from what Zeff knows of each (relations, roles, addresses, accounts, cases, how you are in touch), many at once, one call per batch. What you
 * chose stays. The built-in's classifyContacts (src/plugins/people/classify.ts); a lambda only reads: the flow `people.classify` keeps each batch's answer.
 * event: { ids, force }. Returns { results: [{ ids, answer }], asked }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const input = await zeff.call("people.classify-input", { ids: event?.ids, force: event?.force === true || event?.force === "true" });
  if (!input.asked) return { results: [], asked: 0 };
  const instructions = (await zeff.call("prompts.fill", { key: "people-classify", template: CLASSIFY_INSTRUCTIONS, vars: {} })).text;
  const results = [];
  for (const b of input.batches) {
    const answer = await zeff.call("ai.json", { prompt: classifyPrompt(instructions, input.myName ?? undefined, b.blocks), schema: CLASSIFY_SCHEMA, task: "people-ext.classify", budget: 0.3 });
    results.push({ ids: b.ids, answer });
  }
  return { results, asked: input.asked };
}
