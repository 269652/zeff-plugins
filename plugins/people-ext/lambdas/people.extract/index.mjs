import { EXTRACT_INSTRUCTIONS, MAX_BATCHES, PER_BATCH, RAG_INSTRUCTIONS, askWithRetrievalWith, extractBatch, withLoopsAddendum } from "./lib.mjs";

/**
 * What new messages say about the people you keep a profile of — roles, who owns what, preferences, commitments, who reports to whom — read by the AI with a quote,
 * a source and how sure it is; every pair of a message and a person judged (the ones an answer leaves open asked about once more), and the AI may look up context it
 * misses (rag.retrieve). The built-in's extractKnowledge (src/plugins/people/extract.ts), over the kernel's reads: the messages (people.extract-input, in time order,
 * with the marks each source got to) and what you rejected. A lambda only reads: the flow `people.extract` keeps the claims and links and moves the marks.
 * event: { sinceDays, only }. Returns { claims, links, marks, items, open }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const input = await zeff.call("people.extract-input", { sinceDays: event?.sinceDays, only: event?.only });
  const items = input.items ?? [];
  const moveMarks = input.moveMarks !== false;
  if (!items.length) return { claims: [], links: [], marks: moveMarks ? input.marks : {}, items: 0, open: 0 };
  const installed = (await zeff.call("zeff.installed", { ids: ["loops"] })).installed ?? {};
  const base = (await zeff.call("prompts.fill", { key: "people-extract", template: EXTRACT_INSTRUCTIONS, vars: {} })).text;
  const instructions = installed.loops ? withLoopsAddendum(base) : base;
  const rag = (await zeff.call("prompts.fill", { key: "rag", template: RAG_INSTRUCTIONS, vars: {} })).text;
  const ask = (prompt, schema) => zeff.call("ai.json", { prompt, schema, task: "people-ext.extract", budget: 0.5 });
  const retrieve = (needs) => zeff.call("rag.retrieve", { needs });
  const ids = new Set(input.personIds ?? []);
  const batches = [];
  for (let i = 0; i < items.length && batches.length < MAX_BATCHES; i += PER_BATCH) batches.push(items.slice(i, i + PER_BATCH));
  const claims = [];
  const links = [];
  let read = 0;
  let open = 0;
  let upTo = "";
  for (const batch of batches) {
    batch.forEach((it, i) => (it.id = `m${i + 1}`));
    const involved = new Set(batch.flatMap((i) => i.people));
    const profiles = (input.profiles ?? []).filter((p) => involved.has(p.id));
    const found = await extractBatch({
      ask: (prompt, schema) => askWithRetrievalWith({ prompt: `${prompt}\n\n${rag}`, schema, ask, retrieve, rounds: 2 }),
      instructions,
      profiles,
      rejected: input.rejected ?? { claims: [], links: [] },
      items: batch,
      allowed: new Set(profiles.map((p) => p.id)),
      personExists: (id) => ids.has(id),
    });
    open += found.open.length;
    claims.push(...found.claims);
    links.push(...found.links);
    read += batch.length;
    upTo = batch[batch.length - 1].at;
  }
  // The marks move to where the batches got to (all of it, when every message was read); a read back for some profiles leaves them.
  const marks = {};
  if (moveMarks) {
    const all = read >= items.length;
    for (const [k, v] of Object.entries(input.marks ?? {})) marks[k] = all ? v : v < upTo ? v : upTo;
  }
  return { claims, links, marks, items: read, open };
}
