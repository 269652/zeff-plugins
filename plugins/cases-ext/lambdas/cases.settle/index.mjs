import { caseFromRow, settledSummary, standingOf } from "./lib.mjs";

/** The case's row (its summary as it reads, your corrections over it — as the built-in keeps it) when its payments move it on; none else. */
export async function handler(event, context) {
  const zeff = context.zeff;
  const id = Number(String(event.ref ?? "").replace(/^case:/, ""));
  if (!id) return { rows: [] };
  const { rows } = await zeff.call("store.query", { store: "cases-ext.cases", where: { id }, limit: 1 });
  const c = rows[0] ? caseFromRow(rows[0]) : null;
  if (!c?.compiled) return { rows: [] };
  const { allocations } = await zeff.call("money.allocations", { refs: ["case:" + id] });
  const paid = allocations["case:" + id] ?? [];
  const next = settledSummary(c.compiled, paid, c.compiled.open != null ? standingOf(c, paid).open : null);
  return { rows: next ? [{ id, compiled: JSON.stringify(next), updated_at: new Date().toISOString() }] : [] };
}
