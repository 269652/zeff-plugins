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


const euro = (v) => v.toLocaleString(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDay = (iso) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** The widget "Subscriptions not in your contracts": what goes out regularly but isn't in your contracts database, each with its cost a month and next payment. */
export async function handler(event, context) {
  const t = tFor(context.language);
  const zeff = context.zeff;
  const config = event?.config ?? {};
  const day = new Date().toLocaleDateString("sv-SE");
  const { sources } = await zeff.call("workspace.value-sources", { type: "fixkosten" });
  const { items: all, running } = await missing(zeff, day, sources);
  const target = contractsTarget(sources);
  const rhythmText = { monthly: t("Monthly"), quarterly: t("Quarterly"), yearly: t("Yearly") };
  const items = all.slice(0, Number(config.limit ?? 8)).map((r) => ({
    id: r.key,
    icon: "🔁",
    text: r.name + " · " + euro(r.amount),
    detail: [rhythmText[r.rhythm], r.rhythm !== "monthly" ? t("{amount} a month", { amount: euro(r.monthly) }) : "", t("last {date}", { date: shortDay(r.last) })].filter(Boolean).join(" · "),
    meta: t("next {date}", { date: shortDay(r.next) }),
    ...(target ? { actions: [{ id: "add", label: t("Add to {db}", { db: target.title || t("Contracts") }), icon: "+" }] } : {}),
  }));
  const monthly = all.reduce((x, r) => x + r.monthly, 0);
  return {
    kind: "list",
    items,
    ...(all.length ? { title: t("{n} of {running} running, {amount} a month", { n: all.length, running, amount: euro(monthly) }), count: all.length } : {}),
    empty: running ? t("Every subscription is in your contracts.") : t("No recurring payments in your bank bookings."),
    ...(target ? { footer: { text: target.title || t("Contracts"), href: "/workspace/" + target.dbId } } : {}),
  };
}
