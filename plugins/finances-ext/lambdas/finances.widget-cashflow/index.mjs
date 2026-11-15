import { DEBT, schedule, tFor, recurringFlows, matchContracts, cashflowFlows, forecast } from "./lib.mjs";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v && typeof v === "object" && "start" in v ? String(v.start).slice(0, 10) : null);
const euro = (v) => v.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const shortDay = (iso) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
const monthYear = (iso) => new Date(iso.slice(0, 7) + "-15T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
/** "1.234,56" or "-80" as you type it (empty, or no number: null). */
const typedAmount = (v) => {
  const s = String(v ?? "").replace(/[€\s]/g, "");
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return s && Number.isFinite(n) ? n : null;
};
const addDays = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/** The rows of the databases publishing "Fixkosten", each with its cost a month, whether it runs, its customer number. */
async function contractRows(zeff) {
  const { sources } = await zeff.call("workspace.value-sources", { type: "fixkosten" });
  const seen = new Set();
  return sources.flatMap((src) => {
    if (seen.has(src.dbId)) return [];
    seen.add(src.dbId);
    const cust = src.properties.find((p) => p.type === "text" && /kunden|customer|vertragsnummer|contract no/i.test(p.name));
    return src.rows.map((r) => {
      const v = r.cells[src.propId];
      const running = src.running[String(r.id)];
      return { id: r.id, dbId: src.dbId, title: r.title, monthly: running ?? (typeof v === "number" && Number.isFinite(v) ? v : null), srcref: String(r.cells.srcref ?? ""), customer: cust ? String(r.cells[cust.id] ?? "") : "", running: running !== undefined };
    });
  });
}

/** The widget "Cashflow ahead": your account in the next weeks — what comes in regularly, the fixed costs, subscriptions, instalments and payments. */
export async function handler(event, context) {
  const t = tFor(context.language);
  const zeff = context.zeff;
  const config = event?.config ?? {};
  const day = new Date().toLocaleDateString("sv-SE");
  const inDays = (d) => Math.round((Date.parse(d.slice(0, 10)) - Date.parse(day)) / 864e5);
  const start = typedAmount(config.balance);
  const buffer = Number(config.buffer ?? 0) || 0;
  const days = Number(config.days ?? 90);

  const { bookings } = await zeff.call("bank.bookings", { from: addDays(day, -800), to: "9999-12-31" });
  const flowing = recurringFlows(bookings, day);
  const marked = (await zeff.call("pref.get", { key: "finances.ownAccounts" })).value ?? {};
  const { debts: db } = await zeff.call("zeff.places", {});
  const rows = db ? (await zeff.call("db.cells", { db })).rows : [];
  const ids = [...new Set(rows.flatMap((r) => (Array.isArray(r.cells[DEBT.creditor]) && typeof r.cells[DEBT.creditor][0] === "number" ? [r.cells[DEBT.creditor][0]] : [])))];
  const names = ids.length ? (await zeff.call("people.names", { ids })).names : {};
  const payments = rows.flatMap((r) => {
    const open = num(r.cells[DEBT.open]);
    if (open == null || open <= 0) return [];
    const dir = r.cells[DEBT.dir] === "owed" ? "owed" : "owe";
    const creditorId = Array.isArray(r.cells[DEBT.creditor]) && typeof r.cells[DEBT.creditor][0] === "number" ? r.cells[DEBT.creditor][0] : null;
    const plan = schedule({ open, installment: num(r.cells[DEBT.rate]), nextDue: dayOf(r.cells[DEBT.due]), day: num(r.cells[DEBT.day]) }, day);
    return plan.payments.map((p) => ({ date: p.date, amount: p.amount, label: (creditorId && names[creditorId]) || r.title || "—", dir }));
  });
  const manual = (await zeff.call("pref.get", { key: "cases.income" })).value;
  const facts = ((await zeff.call("pref.get", { key: "cases.incomeFacts" })).value ?? []).filter((f) => f.period < day.slice(0, 7)).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 3);
  const derived = facts.length ? Math.round((facts.reduce((x, f) => x + f.amount, 0) / facts.length) * 100) / 100 : null;
  const income = manual ?? derived;
  const flows = cashflowFlows({ incomes: flowing.in, outgoings: flowing.out.filter((r) => !marked[r.key]), contracts: await contractRows(zeff), payments, income: income ? { amount: income, label: t("Income") } : null }, day, days);
  const count = (k) => new Set(flows.filter((f) => f.kind === k).map((f) => f.label)).size;
  const f = forecast(flows, { today: day, days, start, buffer });
  const i = { incomes: count("income"), subscriptions: count("subscription"), contracts: count("contract"), payments: count("debt") + count("claim") };

  const title = t("From {incomes} incomes, {subscriptions} subscriptions, {contracts} other contracts and {payments} debts", i);
  const months = f.months.map((m) => ({ id: m.month, icon: "🗓️", text: monthYear(m.month), detail: t("in {in} · out {out}", { in: euro(m.in), out: euro(m.out) }), badge: euro(m.net), tone: m.net < 0 ? "bad" : "good" }));
  if (!i.incomes && !i.subscriptions && !i.contracts && !i.payments) return { kind: "list", items: [], empty: t("Nothing known ahead yet — no bank bookings, contracts or debts.") };
  if (f.start == null) return { kind: "list", title, items: [{ id: "hint", icon: "💡", text: t("Net a month"), detail: t("Write your balance today in the widget's settings for the weeks ahead and the day it runs low."), wrap: true }, ...months] };
  const low = f.firstBelowBuffer;
  const verdict = low
    ? {
        text: f.firstNegative && f.firstNegative.date === low.date ? t("Below zero on {date}", { date: shortDay(low.date) }) : t("Below {buffer} on {date}", { buffer: euro(buffer), date: shortDay(low.date) }),
        detail: t("{amount} then · in {n} days", { amount: euro(low.balance), n: inDays(low.date) }),
        tone: f.firstNegative ? "bad" : "warn",
      }
    : { text: t("Stays above {amount}", { amount: euro(buffer) }), detail: f.lowest ? t("lowest {amount} on {date}", { amount: euro(f.lowest.balance), date: shortDay(f.lowest.date) }) : undefined, tone: "good" };
  const weeks = {
    id: "weeks",
    icon: low ? "⚠️" : "📈",
    ...verdict,
    badge: euro(f.start) + " → " + euro(f.end ?? f.start),
    mini: { bars: f.weeks.map((w) => ({ label: shortDay(w.to), value: Math.round(w.balance ?? 0), tone: (w.balance ?? 0) < 0 ? "bad" : (w.balance ?? 0) < buffer ? "warn" : undefined })), unit: "€" },
  };
  return { kind: "list", title, items: [weeks, ...months] };
}
