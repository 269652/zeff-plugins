import { caseAppData, caseFromRow, caseTitle, paymentOf, standingOf, tFor } from "./lib.mjs";

/** The page's data (the built-in's own caseAppData) for the row it stands on — and what its fields start with. */
export async function handler(event, context) {
  const z = context.zeff;
  const t = tFor(context.language);
  const { ref } = await z.call("workspace.row-source", { row: event.row });
  const id = Number(/^case:(\d+)$/.exec(ref ?? "")?.[1] ?? 0);
  if (!id) throw new Error(t("This row is not a case."));
  const { rows } = await z.call("store.query", { store: "cases-ext.cases", where: { id }, limit: 1 });
  if (!rows[0]) throw new Error(t("Unknown case."));
  const c = caseFromRow(rows[0]);
  const sources = (await z.call("store.query", { store: "cases-ext.sources", where: { case_id: id }, order: "-at", limit: 500 })).rows;
  const partyRows = (await z.call("store.query", { store: "cases-ext.parties", where: { case_id: id } })).rows;
  const { installed } = await z.call("zeff.installed", { ids: ["people", "llm"] });
  const ids = [...new Set([c.personId, ...partyRows.map((p) => p.person_id)].filter(Boolean))];
  const pl = installed.people ? await z.call("people.list", { hrefs: ids }) : { people: [], hrefs: {} };
  const names = Object.fromEntries(pl.people.map((p) => [p.id, p.name]));
  const parties = {};
  for (const p of partyRows) if (names[p.person_id]) parties[p.role] = { personId: p.person_id, name: names[p.person_id], href: pl.hrefs[p.person_id] ?? "", source: p.source === "manual" ? "manual" : "ai" };
  const person = c.personId && names[c.personId] ? { id: c.personId, name: names[c.personId], href: pl.hrefs[c.personId] ?? "" } : null;
  const todoIds = sources.filter((x) => x.ref.startsWith("todo:")).map((x) => Number(x.ref.slice(5)));
  const { todos } = todoIds.length ? await z.call("todos.by-ids", { ids: todoIds }) : { todos: [] };
  const { allocations } = await z.call("money.allocations", { refs: ["case:" + id] });
  const paid = allocations["case:" + id] ?? [];
  const needAccount = !c.compiled?.iban && c.personId && installed.people;
  const { accounts } = needAccount ? await z.call("people.accounts", { ids: [c.personId] }) : { accounts: {} };
  const payment = paymentOf(c, needAccount ? (accounts[c.personId] ?? null) : null);
  const refs = sources.filter((x) => !x.ref.startsWith("todo:")).map((x) => x.ref);
  const bundle = {
    id, key: c.key, label: c.label, title: caseTitle(c), status: c.status, note: c.note, compiled: c.compiled, person, people: pl.people, parties,
    manual: !!c.compiled?.manual, sources: refs,
    todos: todos.map((x) => ({ id: x.id, ref: "T-" + x.id, text: x.text, done: x.status === "done", due: x.due })),
    counts: { mail: sources.filter((x) => x.kind === "mail").length, doc: sources.filter((x) => x.kind === "doc").length, todo: todos.length },
    canCompile: !!installed.llm, payment, compiling: false,
    paid: paid.map((x) => ({ date: x.date, amount: x.amount, todo: x.key.startsWith("todo:") ? "T-" + x.key.slice(5) : null })),
    openNow: standingOf(c, paid).open,
  };
  const data = caseAppData(bundle, { t, busy: false, locale: context.language });
  delete data.bundle;
  return {
    ...data,
    caseId: id,
    rowId: Number(event.row),
    refs,
    statusValue: c.status,
    noteText: c.note,
    payAmount: payment?.amount != null ? payment.amount.toFixed(2).replace(".", ",") : "",
    partyIds: Object.fromEntries(["creditor", "collector", "payee"].map((r) => [r, parties[r] ? String(parties[r].personId) : ""])),
    peopleOptions: [["", "—"], ...pl.people.map((p) => [String(p.id), p.name])],
    bundlePayment: payment,
  };
}
