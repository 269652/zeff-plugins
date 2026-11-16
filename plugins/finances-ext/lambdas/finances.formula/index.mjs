import { DEBT, schedule } from "./lib.mjs";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v && typeof v === "object" && "start" in v ? String(v.start).slice(0, 10) : null);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The snapshot of a person formula (Schulden, Forderungen, Rate): { total, byId, byName } — each open debt's amount (open, or the instalment of a plan that
 * runs) summed by its other side (the contact's id; a debt without one by the lower-case name it carries), as the built-in's perPerson adds them up.
 */
export async function handler(event, context) {
  const which = String(event?.which ?? "");
  const dir = which.startsWith("owed") ? "owed" : "owe";
  const today = new Date().toLocaleDateString("sv-SE");
  const { debts: db } = await context.zeff.call("zeff.places", {});
  const rows = db ? (await context.zeff.call("db.cells", { db })).rows : [];
  const out = { total: 0, byId: {}, byName: {} };
  for (const r of rows) {
    const open = num(r.cells[DEBT.open]);
    if (open == null || open <= 0 || (r.cells[DEBT.dir] === "owed" ? "owed" : "owe") !== dir) continue;
    const plan = schedule({ open, installment: num(r.cells[DEBT.rate]), nextDue: dayOf(r.cells[DEBT.due]), day: num(r.cells[DEBT.day]) }, today);
    const amount = which === "owe-rate" ? (plan.kind === "plan" ? (num(r.cells[DEBT.rate]) ?? 0) : 0) : open;
    out.total += amount;
    const id = Array.isArray(r.cells[DEBT.creditor]) && typeof r.cells[DEBT.creditor][0] === "number" ? r.cells[DEBT.creditor][0] : null;
    const name = String(r.title || "—").toLowerCase();
    if (id) out.byId[id] = (out.byId[id] ?? 0) + amount;
    else out.byName[name] = (out.byName[name] ?? 0) + amount;
  }
  out.total = round2(out.total);
  return out;
}
