import { caseFromRow, caseTitle, standingOf, tFor } from "./lib.mjs";

async function all(zeff, store) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, limit: 500, offset });
    out.push(...rows);
    if (!rows.length || out.length >= total) return out;
  }
}

/** The records as the built-in's source gave them (workspace-source.ts caseRecords) — fields of fixed id and type. */
export async function handler(_event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const cases = (await all(zeff, "cases-ext.cases")).map(caseFromRow).filter((c) => c.status !== "ignored").sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const counts = {};
  for (const x of await all(zeff, "cases-ext.sources")) counts[x.case_id] = (counts[x.case_id] ?? 0) + 1;
  const people = [...new Set(cases.map((c) => c.personId).filter(Boolean))];
  const { names } = people.length ? await zeff.call("read.people.names", { ids: people }).catch(() => ({ names: {} })) : { names: {} };
  const withOpen = cases.filter((c) => c.compiled?.open != null);
  const { allocations } = withOpen.length ? await zeff.call("money.allocations", { refs: withOpen.map((c) => "case:" + c.id) }) : { allocations: {} };
  return cases.map((c) => {
    const s = c.compiled;
    const open = s?.open == null ? null : standingOf(c, allocations["case:" + c.id] ?? []).open;
    return {
      ref: "case:" + c.id,
      title: caseTitle(c),
      key: c.label,
      status: c.status === "closed" || s?.done ? { name: t("Closed"), group: "done" } : { name: t("Open"), group: "todo" },
      fields: {},
      text: c.note,
      updatedAt: c.updatedAt,
      dataType: "cases",
      typed: [
        { id: "casekey", name: "Case number", type: "text", value: c.label },
        { id: "caseparty", name: "Party", type: "text", value: s?.party ?? "" },
        { id: "caseperson", name: "Person", type: "text", value: c.personId ? (names[c.personId] ?? "") : "" },
        { id: "casetotal", name: "Total", type: "number", value: s?.total ?? null },
        { id: "caseopen", name: "Open", type: "number", value: open },
        { id: "caseinstallment", name: "Instalment", type: "number", value: s?.installment ?? null },
        { id: "casenext", name: "Next due", type: "date", value: s?.nextDue ?? null },
        { id: "casenextwhat", name: "Next", type: "text", value: s?.nextWhat ?? "" },
        { id: "caseiban", name: "IBAN", type: "text", value: s?.iban ?? "" },
        { id: "casesources", name: "Sources", type: "number", value: counts[c.id] ?? 0 },
        { id: "caselast", name: "Last activity", type: "date", value: c.lastAt.slice(0, 10) },
      ],
    };
  });
}
