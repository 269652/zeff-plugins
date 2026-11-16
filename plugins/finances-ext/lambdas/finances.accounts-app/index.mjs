import { movedOnly, recipientKey } from "./lib.mjs";

/**
 * Your own accounts (the built-in's accounts.ts recipients): the recipients of your transfers of the last six months, the most money first,
 * with what you marked them as (own: an account of your own, credit: a credit account you pay into) and whether money only moves there and back.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const d = new Date();
  const from = new Date(Date.UTC(d.getFullYear(), d.getMonth() - 6, 1)).toISOString().slice(0, 10);
  const { bookings } = await zeff.call("bank.bookings", { from, to: "9999-12-31" });
  const marked = (await zeff.call("pref.get", { key: "finances.ownAccounts" })).value ?? {};
  const moved = movedOnly(bookings);
  const by = new Map();
  for (const b of [...bookings].sort((x, y) => x.date.localeCompare(y.date))) {
    if (b.amount >= 0) continue;
    const key = recipientKey(b);
    if (!key || (!(b.counterparty || "").trim() && !marked[key])) continue;
    const r = by.get(key) ?? { key, name: "", count: 0, out: 0, last: "", kind: marked[key] ?? "", moved: moved.has(key) };
    r.name = (b.counterparty || "").trim() || (b.text || "").trim();
    r.count++;
    r.out = Math.round((r.out - b.amount) * 100) / 100;
    r.last = b.date;
    by.set(key, r);
  }
  const recipients = [...by.values()].sort((a, b) => Number(!!b.kind) - Number(!!a.kind) || b.out - a.out).slice(0, 40);
  return { recipients, any: recipients.length > 0 };
}
