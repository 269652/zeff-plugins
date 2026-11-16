import { CLOSE_INSTRUCTIONS, CLOSE_SCHEMA, flatSlice } from "./lib.mjs";
import { loadStates, merged, toRow } from "./_loops.mjs";

/**
 * The AI's look at the promises still open (with the timeline — it knows what came since): a proposal for each one a message shows kept, its quote checked
 * against the message. Not for a promise with a proposal already; not a message whose closing you rejected. The built-in's closeByAi
 * (src/plugins/loops/close.ts), for the flow `loops.close-by-ai` to write (a lambda only reads): { stateRows, proposed, asked }.
 */
const MAX_LOOPS = 15;
const PER_LOOP = 8;
const norm = (s) => String(s ?? "").toLowerCase().replace(/[„“”"'’`]/g, "").replace(/\s+/g, " ").trim();

export async function handler(event, context) {
  const zeff = context.zeff;
  const now = new Date();
  const states = await loadStates(zeff);
  const claims = (await zeff.call("people.claims", { done: false })).claims;
  const sources = claims.length ? (await zeff.call("messages.of-ref", { refs: [...new Set(claims.map((c) => c.source_ref).filter(Boolean))] })).sources : {};
  const loops = [];
  const evIds = new Map();
  for (const c of claims) {
    if (loops.length >= MAX_LOOPS) break;
    const st = states.get(`claim:${c.id}`);
    if (st?.proposal) continue;
    const rejected = new Set(st?.rejected ?? []);
    const src = sources[c.source_ref];
    const since = src?.at ?? c.created_at;
    const srcKey = String(c.source_ref ?? "").replace(/^mail:/, "").replace(/^teams:/, "").replace(/^jira-comment:/, "comment:");
    const evs = (await zeff.call("timeline.events-for", { ref: `person:${c.person_id}`, since, kinds: ["mail", "message", "comment", "document", "mr"], limit: PER_LOOP * 2 })).events.filter((e) => e.at > since && e.sourceRef !== srcKey && !rejected.has(`tl:${e.id}`)).slice(0, PER_LOOP);
    if (!evs.length) continue;
    loops.push({
      id: `L${loops.length + 1}`,
      claim: c,
      since,
      events: evs.map((e) => {
        if (!evIds.has(e.id)) evIds.set(e.id, `e${evIds.size + 1}`);
        return { id: evIds.get(e.id), ev: e };
      }),
    });
  }
  if (!loops.length) return { stateRows: [], proposed: 0, asked: 0 };
  const events = new Map();
  for (const l of loops)
    for (const e of l.events) {
      const had = events.get(e.id);
      if (had) had.loops.push(l.id);
      else events.set(e.id, { ...e.ev, loops: [l.id] });
    }
  const instructions = (await zeff.call("prompts.fill", { key: "loops-close", template: CLOSE_INSTRUCTIONS, vars: {} })).text;
  const prompt = [
    instructions,
    "",
    "# Zusagen",
    ...loops.map((l) => `[${l.id}] ${l.claim.direction === "mine" ? "ich schulde" : "schuldet mir"} ${l.claim.person_name ?? "?"}: ${flatSlice(l.claim.text, 200)} — „${flatSlice(l.claim.evidence, 200)}“ (seit ${l.since.slice(0, 10)})`),
    "",
    "# Nachrichten",
    ...[...events.entries()].map(([id, e]) => `[${id}] ${e.at.slice(0, 10)} ${e.kind} · ${flatSlice(e.title, 120)}: ${flatSlice(e.summary, 400)}  (zu: ${e.loops.join(", ")})`),
  ].join("\n");
  const answer = await zeff.call("ai.json", { prompt, schema: CLOSE_SCHEMA, task: "loops-ext.close", budget: 0.3 });
  const stateRows = [];
  const done = new Set();
  for (const x of answer.closes ?? []) {
    const loop = loops.find((l) => l.id === String(x.loop ?? ""));
    const ev = events.get(String(x.event ?? ""));
    const quote = flatSlice(String(x.quote ?? ""), 400);
    if (!loop || !ev || done.has(loop.id) || !ev.loops.includes(loop.id) || norm(quote).length < 6) continue;
    if (!norm(`${ev.title} ${ev.summary}`).includes(norm(quote))) continue;
    const ref = `claim:${loop.claim.id}`;
    stateRows.push(toRow(merged(ref, states.get(ref), { proposal: { ref: `tl:${ev.id}`, quote, href: ev.url, at: ev.at, by: "ai" } }, now)));
    done.add(loop.id);
  }
  return { stateRows, proposed: stateRows.length, asked: loops.length };
}
