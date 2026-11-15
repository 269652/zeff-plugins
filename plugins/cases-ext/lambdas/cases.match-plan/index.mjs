import { caseFromRow, matchPlan, tFor } from "./lib.mjs";

async function all(zeff, store, where) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, where, limit: 500, offset });
    out.push(...rows);
    if (!rows.length || out.length >= total) return out;
  }
}

/** The plan (the built-in's own core) as the steps of the flow: the bookings kept as matched, payments confirmed and booked, todos done, evidence. */
export async function handler(_event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const open = (await all(zeff, "cases-ext.bank")).filter((b) => b.amount < 0 && b.case_id == null && b.todo_id == null && b.matched_at == null).sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const empty = { bankRows: [], confirms: [], pays: [], dones: [], evidence: [], matched: 0 };
  if (!open.length) return empty;
  const cases = (await all(zeff, "cases-ext.cases")).map(caseFromRow);
  const running = cases.filter((c) => c.status === "open");
  const { allocations } = running.length ? await zeff.call("money.allocations", { refs: running.map((c) => "case:" + c.id) }) : { allocations: {} };
  const { todos } = await zeff.call("todos.transfers", {});
  const local = (d) => d.toLocaleDateString("sv-SE");
  const plan = matchPlan({
    bookings: open,
    todos,
    keys: Object.fromEntries(cases.map((c) => [c.key, c.id])),
    cases: running.map((c) => ({ id: c.id, key: c.key, compiled: c.compiled })),
    paid: Object.fromEntries(running.map((c) => [c.id, (allocations["case:" + c.id] ?? []).map((a) => ({ paymentId: a.paymentId, date: a.date, amount: a.amount, source: a.source, tx: a.tx }))])),
    since60: local(new Date(Date.now() - 60 * 864e5)),
    booking: t("Booking"),
  });
  const now = new Date().toISOString();
  const out = { ...empty, matched: plan.matched };
  for (const st of plan.steps) {
    if (st.kind === "twin") {
      out.confirms.push({ paymentId: st.paymentId, tx: st.tx, label: st.label });
      out.bankRows.push({ id: st.tx, case_id: st.caseId, matched_at: now });
    } else if (st.kind === "read") out.bankRows.push({ id: st.tx, case_id: st.caseId, matched_at: now });
    else if (st.kind === "evidence") out.evidence.push({ tx: st.tx, evidence: st.evidence });
    else {
      out.bankRows.push({ id: st.tx, case_id: st.caseId, todo_id: st.todoId, matched_at: now });
      if (st.caseId && st.payment) out.pays.push({ ...st.payment, source: "bank", tx: st.tx, allocate: [{ ref: "case:" + st.caseId, amount: Math.abs(st.payment.amount) }] });
      if (st.todoId && st.todoNote) out.dones.push({ id: st.todoId, note: st.todoNote });
    }
  }
  return out;
}
