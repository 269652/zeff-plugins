import { NORMALIZE_INSTRUCTIONS, NORMALIZE_SCHEMA, normalizePrompt } from "./lib.mjs";

/**
 * One identity per person, whatever the todos call them: the AI reads the names in your todos, your profiles (with their aliases and the hints from your chats) and
 * your contacts (WhatsApp chats, mail senders) and says which mention is which person — a new way to call someone becomes their alias, a contact without a profile gets
 * one, two profiles that are one person are merged, who is who for whom is noted. Only what is unambiguous. The built-in's matchNames
 * (src/plugins/people/normalize.ts): what it is asked is the kernel's read people.normalize-input. A lambda only reads: the flow `people.normalize` keeps the answer
 * (people.normalize-apply). Returns { asked, answer, chatNames, addresses }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const input = await zeff.call("people.normalize-input", {});
  if (input.empty) return { asked: false, answer: {}, chatNames: [], addresses: [] };
  const instructions = (await zeff.call("prompts.fill", { key: "people-normalize", template: NORMALIZE_INSTRUCTIONS, vars: {} })).text;
  const answer = await zeff.call("ai.json", { prompt: normalizePrompt(instructions, input), schema: NORMALIZE_SCHEMA, task: "people-ext.normalize", budget: 0.5 });
  return { asked: true, answer: answer ?? {}, chatNames: input.chatNames, addresses: input.addresses };
}
