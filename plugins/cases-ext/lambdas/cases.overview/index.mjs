import { caseFromRow, casesAppData, overviewOf, tFor } from "./lib.mjs";

/** Every row of a store (pages of 500). */
async function all(zeff, store, where) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, where, limit: 500, offset });
    out.push(...rows);
    if (!rows.length || out.length >= total) return out;
  }
}

/**
 * The cases view's data: the cases (the built-in's table, adopted), their parties and payments, the names and accounts of the people
 * they have, the rows they are in — worked out by the built-in's own core (lib.mjs) in the user's language.
 */
export async function handler(_event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const local = (d) => d.toLocaleDateString("sv-SE");
  const today = local(new Date());
  const cases = (await all(zeff, "cases-ext.cases")).map(caseFromRow);
  const running = cases.filter((c) => c.status === "open" && !c.compiled?.done && !c.compiled?.manual);
  const partyRows = await all(zeff, "cases-ext.parties");
  const people = [...new Set([...partyRows.map((p) => p.person_id), ...cases.map((c) => c.personId)].filter(Boolean))];
  const { names } = people.length ? await zeff.call("people.names", { ids: people }).catch(() => ({ names: {} })) : { names: {} };
  const parties = {};
  for (const p of partyRows) if (names[p.person_id] && (p.role === "creditor" || p.role === "collector")) (parties[p.case_id] ??= {})[p.role] = names[p.person_id];
  const { allocations } = running.length ? await zeff.call("money.allocations", { refs: running.map((c) => "case:" + c.id) }) : { allocations: {} };
  const payments = Object.fromEntries(running.map((c) => [c.id, allocations["case:" + c.id] ?? []]));
  const needAccount = [...new Set(running.filter((c) => c.personId && !c.compiled?.iban).map((c) => c.personId))];
  const { accounts } = needAccount.length ? await zeff.call("people.accounts", { ids: needAccount }).catch(() => ({ accounts: {} })) : { accounts: {} };
  const places = await zeff.call("zeff.places", {});
  const { rows } = places.cases ? await zeff.call("workspace.rows-by-ref", { db: places.cases, prefix: "case:" }) : { rows: {} };
  const overview = overviewOf({ cases, payments, parties, names, accounts, rows, today, in30: local(new Date(Date.now() + 30 * 864e5)), debtsDb: places.debts });
  const data = casesAppData(overview, { t, today, paying: "", locale: context.language });
  // (whose GiroCode is open is the view's state: each case's id as text, to compare with state.paying)
  for (const c of data.cases) c.key = String(c.id);
  delete data.overview;
  return data;
}
