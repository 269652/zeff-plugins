import { caseFromRow, caseTitle, lateWarnings } from "./lib.mjs";

async function all(zeff, store) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, limit: 500, offset });
    out.push(...rows);
    if (!rows.length || out.length >= total) return out;
  }
}

export async function handler(_event, context) {
  const zeff = context.zeff;
  const today = new Date().toLocaleDateString("sv-SE");
  const cases = (await all(zeff, "cases-ext.cases")).map(caseFromRow).filter((c) => c.status === "open" && !c.compiled?.done);
  const { allocations } = cases.length ? await zeff.call("money.allocations", { refs: cases.map((c) => "case:" + c.id) }) : { allocations: {} };
  const warned = (await all(zeff, "cases-ext.warnings")).map((w) => ({ caseId: w.case_id, due: w.due }));
  const plan = lateWarnings({ cases: cases.map((c) => ({ id: c.id, label: c.label, status: c.status, title: caseTitle(c), compiled: c.compiled })), paid: Object.fromEntries(cases.map((c) => [c.id, allocations["case:" + c.id] ?? []])), warned, today });
  return { warnings: plan.map((w) => ({ ...w, today, ops: w.op ? [w.op] : [] })) };
}
