import { DEBT, schedule, summarize, movedOnly, recipientKey } from "./lib.mjs";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v && typeof v === "object" && "start" in v ? String(v.start).slice(0, 10) : null);
/** Months from now to a day (whole, rounded up) — null without one. */
const monthsUntil = (iso) => {
  if (!iso) return null;
  const a = new Date();
  const b = new Date(iso);
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() > a.getDate() ? 1 : 0));
};

/** The debts of one direction with their plans, as the built-in's debtPlans makes them (what the Kennzahlen need of a debt). */
async function plans(zeff, dir, today) {
  const { debts } = await zeff.call("zeff.places", {});
  if (!debts) return { debts: [], summary: summarize([], today) };
  const { rows } = await zeff.call("db.cells", { db: debts });
  const list = rows.flatMap((r) => {
    const open = num(r.cells[DEBT.open]);
    if (open == null || open <= 0) return [];
    const d = r.cells[DEBT.dir] === "owed" ? "owed" : "owe";
    if (d !== dir) return [];
    const installment = num(r.cells[DEBT.rate]);
    const plan = schedule({ open, installment, nextDue: dayOf(r.cells[DEBT.due]), day: num(r.cells[DEBT.day]) }, today);
    return [{ id: r.id, open, installment, plan }];
  });
  // (the next due first, those without a day last)
  list.sort((a, b) => (a.plan.payments[0]?.date ?? "9999").localeCompare(b.plan.payments[0]?.date ?? "9999"));
  return { debts: list, summary: summarize(list.map((d) => ({ id: d.id, ...d.plan })), today) };
}

const round2 = (n) => Math.round(n * 100) / 100;
/** The last three whole months before a day: from (inclusive), to (exclusive). */
function lastThreeMonths(day) {
  const d = new Date(day + "T00:00:00Z");
  return { from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10) };
}
const pref = async (zeff, key) => (await zeff.call("pref.get", { key })).value;

/** Your monthly income: yours (set by hand), else the average of the last three whole months the knowledge read off your statements. */
async function income(zeff) {
  const manual = await pref(zeff, "cases.income");
  const running = new Date().toISOString().slice(0, 7);
  const facts = ((await pref(zeff, "cases.incomeFacts")) ?? []).filter((f) => f.period < running).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 3);
  const derived = facts.length ? round2(facts.reduce((t, f) => t + f.amount, 0) / facts.length) : null;
  return manual ?? derived;
}

/** What was spent a month: the outgoing bookings of the last three whole months on average, money only moved and your own accounts left out. */
async function spending(zeff, today) {
  const { from, to } = lastThreeMonths(today);
  const { bookings } = await zeff.call("bank.bookings", { from, to });
  if (!bookings.length) return null;
  const marked = (await pref(zeff, "finances.ownAccounts")) ?? {};
  const moved = movedOnly(bookings);
  const out = bookings.filter((b) => b.amount < 0 && !moved.has(recipientKey(b)) && !marked[recipientKey(b)]).reduce((t, b) => t - b.amount, 0);
  return round2(out / 3);
}

/** What went to the recipients marked as credit accounts a month (the last three whole months on average). */
async function creditPayments(zeff, today) {
  const marked = (await pref(zeff, "finances.ownAccounts")) ?? {};
  const credit = new Set(Object.entries(marked).flatMap(([k, v]) => (v === "credit" ? [k] : [])));
  if (!credit.size) return null;
  const { from, to } = lastThreeMonths(today);
  const { bookings } = await zeff.call("bank.bookings", { from, to });
  if (!bookings.length) return null;
  return round2(bookings.filter((b) => b.amount < 0 && credit.has(recipientKey(b))).reduce((t, b) => t - b.amount, 0) / 3);
}

/**
 * One of the Kennzahlen, by event.which — the debt ones: owe-open, owe-count, rates, free-in, owe-unplanned, owed-open, owed-count, owed-rates,
 * owed-free-in, owed-unplanned; the money ones: income, spending, credit, free-monthly, savings-rate, debt-service-rate — the number the
 * built-in's metrics.ts gives (null: none). owe-open, owe-count, rates, free-in, owe-unplanned, owed-open, owed-count, owed-rates,
 * owed-free-in, owed-unplanned — the number the built-in's metrics.ts gives (null: none).
 */
export async function handler(event, context) {
  const today = new Date().toLocaleDateString("sv-SE");
  const which = String(event?.which ?? "");
  const zeff = context.zeff;
  if (["income", "spending", "credit", "free-monthly", "savings-rate", "debt-service-rate"].includes(which)) {
    const rates = () => plans(zeff, "owe", today).then((p) => p.summary.monthlyRates);
    if (which === "income") return await income(zeff);
    if (which === "spending") return await spending(zeff, today);
    if (which === "credit") return await creditPayments(zeff, today);
    if (which === "free-monthly") {
      const i = await income(zeff);
      if (i === null) return null;
      const fixed = (await zeff.call("workspace.value", { type: "fixkosten" })).total;
      return i - (await rates()) - (fixed ?? 0);
    }
    if (which === "savings-rate") {
      const i = await income(zeff);
      const sp = await spending(zeff, today);
      return i && sp !== null ? ((i - sp) / i) * 100 : null;
    }
    const i = await income(zeff);
    return i ? ((await rates()) / i) * 100 : null;
  }
  const dir = which.startsWith("owed-") ? "owed" : "owe";
  const p = await plans(context.zeff, dir, today);
  const open = () => p.debts.reduce((s, d) => s + d.open, 0);
  switch (which) {
    case "owe-open":
    case "owed-open":
      return open();
    case "owe-count":
    case "owed-count":
      return p.debts.length;
    case "rates":
    case "owed-rates":
      return p.summary.monthlyRates;
    case "free-in":
    case "owed-free-in":
      return monthsUntil(p.summary.debtFree);
    case "owe-unplanned":
    case "owed-unplanned":
      return p.summary.unplanned;
    default:
      throw new Error("Unknown Kennzahl " + which);
  }
}
