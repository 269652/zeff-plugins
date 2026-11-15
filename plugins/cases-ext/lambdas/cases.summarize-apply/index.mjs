import { caseFromRow, checkedSummary, settledSummary, standingOf } from "./lib.mjs";

/** The checked summary (the built-in's own core) as the case's row, moved on by its payments since; what people.contacts is asked. */
export async function handler(event, context) {
  const zeff = context.zeff;
  const item = event.item;
  const summary = checkedSummary(event.answer ?? {}, item.key, item.sources, new Date().toISOString());
  // (your corrections stay over it, as the built-in reads a case — then its payments move it on: todo-paid.ts settleCase)
  const { rows } = await zeff.call("store.query", { store: "cases-ext.cases", where: { id: item.id }, limit: 1 });
  const merged = caseFromRow({ ...rows[0], compiled: JSON.stringify(summary) });
  const { allocations } = await zeff.call("money.allocations", { refs: ["case:" + item.id] });
  const paid = allocations["case:" + item.id] ?? [];
  const moved = merged.compiled ? settledSummary(merged.compiled, paid, merged.compiled.open != null ? standingOf(merged, paid).open : null) : null;
  const compiled = moved ?? summary;
  const { rows: parties } = await zeff.call("store.query", { store: "cases-ext.parties", where: { case_id: item.id } });
  return {
    row: { id: item.id, compiled: JSON.stringify(compiled), updated_at: new Date().toISOString() },
    contacts: [
      { name: summary.creditor ?? "", make: true, kind: summary.creditorKind, creditor: true },
      { name: summary.collector ?? "", make: true, kind: summary.collectorKind, orPerson: item.personId ?? null },
      { name: summary.payee ?? "" },
    ],
    parties,
  };
}
