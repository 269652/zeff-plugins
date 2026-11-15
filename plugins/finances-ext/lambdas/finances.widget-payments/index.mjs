import { DEBT, schedule, tFor } from "./lib.mjs";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v && typeof v === "object" && "start" in v ? String(v.start).slice(0, 10) : null);
const euro = (v) => v.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The widget "Payments coming up": the instalments and payments of your debts (or what comes back to you) in the next weeks, the overdue first. */
export async function handler(event, context) {
  const t = tFor(context.language);
  const config = event?.config ?? {};
  const dir = config.dir === "owed" ? "owed" : "owe";
  const today = new Date().toLocaleDateString("sv-SE");
  const inDays = (day) => Math.round((Date.parse(day.slice(0, 10)) - Date.parse(today)) / 864e5);
  const whenText = (day) => {
    const n = inDays(day);
    return n < 0 ? t("{n} d overdue", { n: -n }) : n === 0 ? t("today") : n === 1 ? t("tomorrow") : t("in {n} d", { n });
  };
  const until = new Date(Date.now() + Number(config.days ?? 45) * 864e5).toLocaleDateString("sv-SE");
  const { debts: db } = await context.zeff.call("zeff.places", {});
  const rows = db ? (await context.zeff.call("db.cells", { db })).rows : [];
  const ids = [...new Set(rows.flatMap((r) => (Array.isArray(r.cells[DEBT.creditor]) && typeof r.cells[DEBT.creditor][0] === "number" ? [r.cells[DEBT.creditor][0]] : [])))];
  const names = ids.length ? (await context.zeff.call("people.names", { ids })).names : {};
  const debts = rows.flatMap((r) => {
    const open = num(r.cells[DEBT.open]);
    if (open == null || open <= 0 || (r.cells[DEBT.dir] === "owed" ? "owed" : "owe") !== dir) return [];
    const caseRef = /^case:(\d+)$/.exec(String(r.cells.srcref ?? ""));
    const creditorId = Array.isArray(r.cells[DEBT.creditor]) && typeof r.cells[DEBT.creditor][0] === "number" ? r.cells[DEBT.creditor][0] : null;
    const plan = schedule({ open, installment: num(r.cells[DEBT.rate]), nextDue: dayOf(r.cells[DEBT.due]), day: num(r.cells[DEBT.day]) }, today);
    return [{ id: r.id, title: r.title, label: caseRef ? String(r.cells[DEBT.case] ?? "") : "", creditor: (creditorId && names[creditorId]) || r.title || "—", plan }];
  });
  debts.sort((a, b) => (a.plan.payments[0]?.date ?? "9999").localeCompare(b.plan.payments[0]?.date ?? "9999"));
  const all = debts.flatMap((d) => d.plan.payments.filter((p) => p.date <= until).map((p) => ({ d, p }))).sort((a, b) => a.p.date.localeCompare(b.p.date));
  const items = all.slice(0, Number(config.limit ?? 8)).map(({ d, p }) => ({
    id: d.id + ":" + p.date,
    icon: "💶",
    text: d.creditor + " · " + euro(p.amount),
    detail: [d.label ? "Az. " + d.label : "", d.title && d.title !== d.creditor ? d.title : ""].filter(Boolean).join(" · ") || undefined,
    meta: whenText(p.date),
    tone: inDays(p.date) < 0 ? "bad" : inDays(p.date) <= 3 ? "warn" : undefined,
    href: db ? "/workspace/" + db + "?row=" + d.id : undefined,
  }));
  return {
    kind: "list",
    items,
    count: all.length || undefined,
    empty: dir === "owe" ? t("No payments due.") : t("Nothing comes back in these days."),
    ...(db ? { footer: { text: dir === "owe" ? t("Creditors overview") : t("Debtors overview"), href: "/workspace/" + db } } : {}),
  };
}
