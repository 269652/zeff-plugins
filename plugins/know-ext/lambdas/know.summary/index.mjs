import { KNOW_SUMMARY_INSTRUCTIONS, SCHEMA, briefEmpty, day, summaryLines } from "./lib.mjs";

/**
 * "What you should know": the AI's short summary on top of a brief — a few points, each resting on numbered lines of the brief (its people, open promises,
 * latest events, related things) and linked to them; a point without a valid line is dropped. Kept per brief with the brief's hash by the flow (a lambda only
 * reads): the AI is asked again only when what the brief says changed. The built-in's summarizeBrief (src/plugins/know/summary.ts) over the kernel's brief.get
 * and ai.memo-get. event: { key, brief, force }. Returns { summary: { points, hash, at, current } | null, made }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const key = String(event?.key ?? "");
  const b = event?.brief;
  if (!b || briefEmpty(b)) return { summary: null, made: false };
  const kept = await zeff.call("ai.memo-get", { scope: "know-summary", ref: key });
  const had = kept.found ? { points: Array.isArray(kept.value) ? kept.value : [], hash: kept.hash, at: kept.at, current: kept.hash === b.hash } : null;
  if (had?.current && event?.force !== true && event?.force !== "true") return { summary: had, made: false };
  const lines = summaryLines(b);
  const what = b.meeting ? `den Termin „${b.meeting.title}“ (${day(b.meeting.start)})` : `„${b.label}“`;
  const text = (await zeff.call("prompts.fill", { key: "know-summary", template: KNOW_SUMMARY_INSTRUCTIONS, vars: { what } })).text;
  const prompt = `${text}\n${JSON.stringify(SCHEMA)}\n\n${lines.map((l, i) => `[${i + 1}] ${l.text}`).join("\n")}`;
  const answer = await zeff.call("ai.json", { prompt, schema: SCHEMA, task: "know-ext.summary" });
  const points = (answer?.points ?? []).flatMap((p) => {
    const t = String(p.text ?? "").trim().slice(0, 400);
    const sources = [...new Set((Array.isArray(p.sources) ? p.sources : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= lines.length).map((n) => lines[n - 1].link);
    return t && sources.length ? [{ text: t, sources }] : [];
  });
  if (!points.length) return { summary: had, made: false };
  return { summary: { points, hash: b.hash, at: new Date().toISOString(), current: true }, made: true };
}
