import { DEBT, caseFromRow, caseTitle, standingOf, tFor } from "./lib.mjs";

/** Every row of a store (pages of 500). */
async function all(zeff, store) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, limit: 500, offset });
    out.push(...rows);
    if (!rows.length || out.length >= total) return out;
  }
}

/**
 * The cases' debts as records (the source "debts"): a case with money open is a row of the debts database, its figures what its letters say (the
 * payments since counted). The built-in's debtRecords, rule for rule.
 */
export async function handler(_event, context) {
  const t = tFor(context.language);
  const zeff = context.zeff;
  const cases = (await all(zeff, "finances-ext.cases"))
    .map(caseFromRow)
    .filter((c) => c.status === "open" && c.compiled && !c.compiled.manual && !c.compiled.done)
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  if (!cases.length) return [];
  const { allocations } = await zeff.call("money.allocations", { refs: cases.map((c) => "case:" + c.id) });
  // The parties (a contact gone: none).
  const parties = await all(zeff, "finances-ext.parties");
  const ids = [...new Set(parties.map((r) => r.person_id).filter(Boolean))];
  const { names } = ids.length ? await zeff.call("read.people.names", { ids }) : { names: {} };
  const partyOf = (caseId, role) => {
    const r = parties.find((x) => x.case_id === caseId && x.role === role && names[x.person_id]);
    return r ? r.person_id : null;
  };
  return cases.flatMap((c) => {
    const s = c.compiled;
    const open = standingOf(c, allocations["case:" + c.id] ?? []).open ?? s.open;
    if (open == null || open <= 0) return [];
    const creditor = partyOf(c.id, "creditor");
    const collector = partyOf(c.id, "collector");
    return [
      {
        ref: "case:" + c.id,
        title: caseTitle(c),
        fields: {},
        updatedAt: c.updatedAt,
        dataType: "debts",
        typed: [
          { id: DEBT.dir, name: "Direction", type: "select", value: t("I owe") },
          // The case's person is who writes — often who collects it (a bailiff), not whom it is owed to: never taken for the creditor; with no
          // parties known yet it stands as who collects it.
          { id: DEBT.creditor, name: "Other side", type: "person", value: creditor ? [creditor] : [] },
          { id: DEBT.collector, name: "Collected by", type: "person", value: collector ? [collector] : !creditor && c.personId ? [c.personId] : [] },
          { id: DEBT.total, name: "Total", type: "number", format: "euro", value: s.total },
          { id: DEBT.open, name: "Open", type: "number", format: "euro", value: open },
          { id: DEBT.rate, name: "Instalment", type: "number", format: "euro", value: s.installment },
          { id: DEBT.due, name: "Next due", type: "date", value: s.nextDue },
          { id: DEBT.day, name: "Plan's day", type: "number", value: s.installmentDay ?? null },
          { id: DEBT.case, name: "Case number", type: "text", value: c.label },
          { id: DEBT.next, name: "Next", type: "text", value: s.nextWhat },
        ],
      },
    ];
  });
}
