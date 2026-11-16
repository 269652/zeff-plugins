import { COMPILE_INSTRUCTIONS, COMPILE_SCHEMA } from "./lib.mjs";

/**
 * A person's short overview from everything Zeff has on them — what connects you, the key facts, the fun facts — written by the AI from their messages, mails,
 * Teams, Jira, GitLab, your todos, the facts and relations Zeff keeps; nothing invented, and someone Zeff knows nothing about isn't asked about. The built-in's
 * compilePerson (src/plugins/people/compile.ts): what Zeff has on them is the kernel's read people.compile-input. A lambda only reads: the flow `people.compile`
 * keeps the summary (and the circle and kind the AI read). event: { id, force }. Returns { state: fresh | nothing-known | ready, summary, answer, count }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const instructions = (await zeff.call("prompts.fill", { key: "people-compile", template: COMPILE_INSTRUCTIONS, vars: {} })).text;
  const r = await zeff.call("people.compile-input", { id: event?.id, force: event?.force === true || event?.force === "true", instructions });
  if (r.state !== "ready") return { state: r.state, summary: r.summary ?? null, answer: null, count: 0 };
  const answer = await zeff.call("ai.json", { prompt: r.prompt, schema: COMPILE_SCHEMA, task: "people-ext.compile", budget: 0.5 });
  return { state: "ready", summary: null, answer, count: r.count };
}
