import { CONTRACT, matchContracts, recurringFlows, tFor } from "./lib.mjs";

const addDays = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/** The rows of the databases publishing "Fixkosten", each with its cost a month, whether it runs, its customer number. */
async function contractRows(zeff, sources) {
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

/** Where a subscription goes as a row: the contracts database — the template's first, else one called so, else the first publishing "Fixkosten". */
function contractsTarget(sources) {
  return sources.find((s) => s.properties.some((p) => p.id === CONTRACT.monthly)) ?? sources.find((s) => /vertr|contract/i.test(s.title)) ?? sources[0] ?? null;
}

/** The subscriptions running now that no contracts row covers, the dearest first. */
async function missing(zeff, day, sources) {
  const { bookings } = await zeff.call("bank.bookings", { from: addDays(day, -800), to: "9999-12-31" });
  const marked = (await zeff.call("pref.get", { key: "finances.ownAccounts" })).value ?? {};
  const out = recurringFlows(bookings, day).out.filter((r) => !marked[r.key]);
  const rows = await contractRows(zeff, sources);
  const matched = matchContracts(out, rows);
  const items = out.filter((r) => !matched.has(r.key)).map((r) => ({ ...r, yearly: Math.round(r.monthly * 1200) / 100 })).sort((a, b) => b.monthly - a.monthly);
  return { items, running: out.length, rows: rows.length };
}


/**
 * A subscription (by its recipient's key) as the row it becomes in the contracts database: { database, title, values } — values by the fields' names
 * (what the flow's db.add writes): its cost a month, per payment, rhythm, last and next, the status, the source ref when the database follows the recurring source.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const zeff = context.zeff;
  const day = new Date().toLocaleDateString("sv-SE");
  const { sources } = await zeff.call("workspace.value-sources", { type: "fixkosten" });
  const target = contractsTarget(sources);
  if (!target) throw new Error(t("There is no contracts database yet (Workspace → templates → Contracts)."));
  const { bookings } = await zeff.call("bank.bookings", { from: addDays(day, -800), to: "9999-12-31" });
  const r = recurringFlows(bookings, day).out.find((x) => x.key === String(event?.key ?? ""));
  if (!r) throw new Error(t("This payment isn't recurring any more."));
  const prop = (id) => target.properties.find((p) => p.id === id);
  const option = (p, name) => (p?.options ?? []).find((o) => String(o).toLowerCase() === String(name).toLowerCase());
  const rhythm = { monthly: t("Monthly"), quarterly: t("Quarterly"), yearly: t("Yearly") }[r.rhythm];
  const status = target.properties.find((p) => p.type === "status");
  const values = {};
  const set = (p, v) => {
    if (p && v !== undefined && v !== null) values[p.name] = v;
  };
  set(prop(target.propId), r.monthly);
  set(prop(CONTRACT.amount), r.amount);
  set(prop(CONTRACT.rhythm), option(prop(CONTRACT.rhythm), rhythm));
  set(prop(CONTRACT.last), r.last);
  set(prop(CONTRACT.next), r.next);
  if (status?.options?.length) set(status, status.options[0]);
  // A database that follows the recurring source: the row is the one it would bring (its ref) — it isn't brought twice.
  if (prop("srcref") && target.follows.includes("recurring")) set(prop("srcref"), "recurring:" + r.key);
  return { database: target.dbId, title: r.name, values };
}
