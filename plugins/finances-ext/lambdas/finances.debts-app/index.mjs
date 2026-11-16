import { DEBT, amountIn, caseFromRow, debtsAppData, paymentOf, schedule, standingOf, summarize, tFor } from "./lib.mjs";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const firstId = (v) => (Array.isArray(v) && typeof v[0] === "number" ? v[0] : null);
const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v && typeof v === "object" && "start" in v ? String(v.start).slice(0, 10) : null);
const round2 = (n) => Math.round(n * 100) / 100;
const PALETTE = ["#c4b5fd", "#fcd34d", "#6ee7b7", "#fca5a5", "#7dd3fc", "#f9a8d4", "#bef264", "#fdba74", "#99f6e4", "#d8b4fe", "#cbd5e1", "#fde68a"];

/** Every row of a store (pages of 500). */
async function all(zeff, store) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, limit: 500, offset });
    out.push(...rows);
    if (!rows.length || out.length >= total) return out;
  }
}

/** Your monthly income: yours (set by hand), else the average of the last three whole months the knowledge read off your statements. */
async function monthlyIncome(zeff, today) {
  const manual = (await zeff.call("pref.get", { key: "cases.income" })).value;
  const running = today.slice(0, 7);
  const facts = ((await zeff.call("pref.get", { key: "cases.incomeFacts" })).value ?? []).filter((f) => f.period < running).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 3);
  const derived = facts.length ? round2(facts.reduce((s, f) => s + f.amount, 0) / facts.length) : null;
  return {
    amount: manual ?? derived,
    source: manual != null ? "manual" : derived != null ? "knowledge" : "none",
    derived,
    months: facts.map((f) => ({ month: f.period, amount: f.amount, text: f.text, pageTitle: f.pageTitle })).reverse(),
  };
}

/** Your monthly fixed costs: the value published as "Fixkosten" — each item with its amount, where it is from and a colour, the largest first. */
async function fixedCosts(zeff) {
  const v = await zeff.call("workspace.value", { type: "fixkosten" });
  if (!v.items.length && v.total === null) return { amount: null, agg: null, items: [] };
  const colored = [...v.items].sort((a, b) => b.amount - a.amount).map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] }));
  return { amount: v.total, agg: v.agg, items: v.items.map((x) => colored.find((c) => c.id === x.id)) };
}

/**
 * Promises with an amount — yours ("… 200 € zurücküberweisen": a debt), theirs ("zahlt mir 50 € zurück": owed to you) — not written down yet
 * (the built-in's debtSuggestions, over the kernel's people.commitments).
 */
async function promiseSuggestions(zeff, db, dir, caseOf) {
  const { commitments } = await zeff.call("people.commitments", {});
  const rows = db ? (await zeff.call("db.cells", { db })).rows : [];
  const taken = new Set(rows.flatMap((r) => (typeof r.cells[DEBT.claim] === "number" ? [r.cells[DEBT.claim]] : [])));
  const dirOf = (r) => (r.cells[DEBT.dir] === "owed" ? "owed" : "owe");
  const sideOf = (r) => (Array.isArray(r.cells[DEBT.creditor]) ? r.cells[DEBT.creditor] : []);
  const owedBy = new Set(rows.filter((r) => dirOf(r) === "owed").flatMap(sideOf));
  const running = [...caseOf.values()].filter((c) => c.status === "open");
  const runningIds = new Set([...caseOf.entries()].filter(([, c]) => c.status === "open").map(([id]) => id));
  const parties = (await all(zeff, "finances-ext.parties")).filter((p) => runningIds.has(p.case_id)).map((p) => p.person_id);
  const covered = new Set([...rows.filter((r) => dirOf(r) === "owe").flatMap(sideOf), ...running.flatMap((c) => (c.personId ? [c.personId] : [])), ...parties]);
  return commitments
    .filter((c) => !taken.has(c.id) && (c.direction === "mine" ? !covered.has(c.personId) : c.direction === "theirs" && !owedBy.has(c.personId)))
    .flatMap((c) => {
      const amount = amountIn(c.text);
      return amount ? [{ claimId: c.id, dir: c.direction === "mine" ? "owe" : "owed", personId: c.personId, name: c.personName, text: c.text, amount, due: /^d{4}-d{2}-d{2}$/.test(c.due) ? c.due : null }] : [];
    })
    .filter((s) => s.dir === dir);
}

/**
 * What the debts view's template reads as app.*: the overview worked out as the built-in's server does (debtPlans, the income, the fixed costs, the
 * contacts) and shaped by the built-in's own debtsAppData (bundled) — the same figures, lists and words. event: { dir: owe | owed, withFixed }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const dir = event?.dir === "owed" ? "owed" : "owe";
  const today = new Date().toLocaleDateString("sv-SE");
  const { debts: db } = await zeff.call("zeff.places", {});
  const rows = db ? (await zeff.call("db.cells", { db })).rows : [];
  const wanted = rows.filter((r) => (num(r.cells[DEBT.open]) ?? 0) > 0 && (r.cells[DEBT.dir] === "owed" ? "owed" : "owe") === dir);

  // The cases (their summaries) and what was paid on them, your own debts' last payment.
  const caseOf = new Map((await all(zeff, "finances-ext.cases")).map((r) => [r.id, caseFromRow(r)]));
  const caseIds = wanted.flatMap((r) => (/^case:(\d+)$/.exec(String(r.cells.srcref ?? "")) ? [Number(/^case:(\d+)$/.exec(String(r.cells.srcref))[1])] : []));
  const refs = [...caseIds.map((id) => "case:" + id), ...wanted.map((r) => "debt:" + r.id)];
  const { allocations } = refs.length ? await zeff.call("money.allocations", { refs }) : { allocations: {} };

  // The contacts on them: their names, mails and details; where a case's person pays to.
  const ids = [...new Set(wanted.flatMap((r) => [firstId(r.cells[DEBT.creditor]), firstId(r.cells[DEBT.collector])]).filter(Boolean))];
  const casePersons = [...new Set(caseIds.map((id) => caseOf.get(id)?.personId).filter(Boolean))];
  const { people: who } = ids.length ? await zeff.call("people.details", { ids }) : { people: {} };
  const { accounts } = casePersons.length ? await zeff.call("people.accounts", { ids: casePersons }) : { accounts: {} };

  const debts = wanted.map((r) => {
    const open = num(r.cells[DEBT.open]);
    const ref = /^case:(\d+)$/.exec(String(r.cells.srcref ?? ""));
    const caseId = ref ? Number(ref[1]) : null;
    const creditor = who[firstId(r.cells[DEBT.creditor])] ?? null;
    const collector = who[firstId(r.cells[DEBT.collector])] ?? null;
    const reach = collector ?? creditor;
    const rdet = reach ? reach.details : [];
    const installment = num(r.cells[DEBT.rate]);
    const own = creditor ? creditor.details : [];
    const iban = own.find((d) => d.key === "iban")?.value ?? "";
    const c = caseId ? caseOf.get(caseId) : null;
    const payment = caseId
      ? c
        ? paymentOf(c, !c.compiled?.iban && c.personId ? (accounts[c.personId] ?? null) : null)
        : null
      : iban && creditor
        ? { name: creditor.name, iban, bic: own.find((d) => d.key === "bic")?.value ?? "", purpose: r.title, amount: installment ?? open }
        : null;
    const last = caseId ? (c ? standingOf(c, allocations["case:" + caseId] ?? []).last : null) : (() => { const a = (allocations["debt:" + r.id] ?? []).at(-1); return a ? { date: a.date, amount: a.amount } : null; })();
    return {
      id: r.id,
      dir,
      caseId,
      title: r.title,
      label: caseId ? String(r.cells[DEBT.case] ?? "") : "",
      creditor: creditor?.name ?? (r.title || "—"),
      creditorId: firstId(r.cells[DEBT.creditor]),
      collector: collector?.name ?? "",
      manual: !caseId,
      total: num(r.cells[DEBT.total]),
      open,
      installment,
      nextDue: dayOf(r.cells[DEBT.due]),
      day: num(r.cells[DEBT.day]),
      nextWhat: String(r.cells[DEBT.next] ?? ""),
      payment,
      plan: schedule({ open, installment, nextDue: dayOf(r.cells[DEBT.due]), day: num(r.cells[DEBT.day]) }, today),
      contact: [reach?.name, ...(reach?.emails ?? []), ...rdet.filter((x) => x.key === "phone" || x.key === "address").map((x) => x.value)].filter(Boolean).join(" · "),
      iban: payment?.iban ?? "",
      last,
    };
  });
  // The next due first, those without a day last.
  debts.sort((a, b) => (a.plan.payments[0]?.date ?? "9999").localeCompare(b.plan.payments[0]?.date ?? "9999"));
  const summary = summarize(debts.map((d) => ({ id: d.id, ...d.plan })), today);

  const { people } = await zeff.call("people.list", {});
  const income = await monthlyIncome(zeff, today);
  const fixed = await fixedCosts(zeff);
  const suggestions = await promiseSuggestions(zeff, db, dir, caseOf);
  const overview = { dir, debts, summary, income, fixed, contacts: people.map((p) => ({ id: p.id, name: p.name, kind: p.kind })), suggestions };
  const withFixed = event?.withFixed !== false && event?.withFixed !== "false";
  const app = debtsAppData(overview, { t, withFixed, today, locale: undefined });
  return { ...app, ...extras(overview, app, { t, withFixed, today }) };
}

/**
 * What the port's template needs beyond the built-in's data (the built-in's React parts read it from the overview): each debt's due day and payment, the open
 * balance by month and the monthly payments by creditor as rows for the kit's charts. The built-in's own fields are not touched.
 */
function extras(o, app, v) {
  const byId = new Map(o.debts.map((d) => [d.id, d]));
  const label = (m) => new Date(m + "-15T12:00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  const months = o.summary.months;
  const after = months.map((_, i) => o.summary.unplanned + months.slice(i + 1).reduce((s, m) => s + m.amount, 0));
  const balance = [{ label: v.t("today"), value: app.open }, ...months.map((m, i) => ({ label: label(m.month), value: after[i] }))];
  const key = (d) => d.creditorId ?? -d.id;
  const nameOf = new Map(o.debts.map((d) => [key(d), d.creditor]));
  const monthlyRows = months.flatMap((m) => {
    const by = new Map();
    for (const b of m.by) {
      const d = byId.get(b.id);
      if (d) by.set(key(d), (by.get(key(d)) ?? 0) + b.amount);
    }
    const fixed = v.withFixed && app.owe ? o.fixed.items.filter((f) => f.amount > 0).map((f) => ({ month: label(m.month), name: f.title, amount: f.amount })) : [];
    return [...fixed, ...[...by].map(([k, amount]) => ({ month: label(m.month), name: nameOf.get(k) ?? "?", amount }))];
  });
  const debts = app.debts.map((x) => {
    const d = byId.get(x.id);
    return { ...x, due: d?.nextDue ?? "", dueText: d?.nextDue ? new Date(d.nextDue + "T12:00:00").toLocaleDateString() : "", day: d?.day ?? "", payment: d?.payment ?? null };
  });
  return { debts, balance, monthlyRows, suggestions: o.suggestions.map((s) => ({ ...s, dueText: s.due ? new Date(s.due + "T12:00:00").toLocaleDateString() : "" })) };
}
