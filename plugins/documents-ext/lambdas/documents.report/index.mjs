import { scanSummary, tFor } from "./lib.mjs";

/**
 * What a step says of how it went (the sync step's message, in your language): the built-in's own sentences (src/lib/sync/registry.ts doctodos, docrelations,
 * localdocs) from what the flow's lambdas and actions gave back. event: { kind: review | relate | folders | read, … }. Returns { ok, message }.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  if (event.kind === "review") {
    const rounds = Array.isArray(event.rounds) ? event.rounds.filter(Boolean) : [];
    const failed = rounds.filter((r) => r.failed).length;
    const reviewed = n(event.plan?.reviewed) + rounds.filter((r) => !r.failed).reduce((a, r) => a + n(r.docs), 0);
    const added = rounds.reduce((a, r) => a + n(r.added), 0);
    const merged = rounds.reduce((a, r) => a + n(r.merged), 0);
    const error = failed ? t("{failed} of {n} parts failed", { failed, n: rounds.length }) : "";
    // (a run with nothing to ask the AI about is fine; else it is when not every batch failed)
    if (rounds.length && failed >= rounds.length) return { ok: false, message: error || t("Failed.") };
    return { ok: true, message: `${t("{reviewed} documents reviewed, {added} new todos", { reviewed, added })}${merged ? `, ${t("{n} merged into open ones", { n: merged })}` : ""}${error ? ` (${error})` : ""}` };
  }
  if (event.kind === "relate") {
    const batches = n(event.batches);
    const failed = n(event.failed);
    const error = failed ? t("{failed} of {n} parts failed", { failed, n: batches }) : "";
    if (batches && failed >= batches) return { ok: false, message: error || t("Failed.") };
    return { ok: true, message: `${t("{todos} todos, {changed} changed", { todos: n(event.todos), changed: n(event.changed) })}${error ? ` (${error})` : ""}` };
  }
  if (event.kind === "folders") {
    const done = Array.isArray(event.done) ? event.done.filter(Boolean) : [];
    const errors = [...(Array.isArray(event.errors) ? event.errors : []), ...done.filter((d) => d.error).map((d) => `${d.rel}: ${d.error}`)];
    return scanSummary({ added: done.reduce((a, d) => a + n(d.added), 0), updated: done.reduce((a, d) => a + n(d.updated), 0), missing: n(event.gone), errors }, t);
  }
  if (event.kind === "read") {
    const done = Array.isArray(event.done) ? event.done.filter(Boolean) : [];
    return { ok: true, message: done.length ? t("{n} documents read", { n: done.length }) : t("Nothing to read.") };
  }
  throw new Error("kind: review, relate, folders or read.");
}
