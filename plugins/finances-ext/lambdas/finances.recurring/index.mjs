import { classifyNoise, CONTRACT, detectRecurring, movedOnly, STRICT, tFor } from "./lib.mjs";

const addDays = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/**
 * The recurring payments as records (the source "recurring"): each running contract or subscription your statements show — what it costs a payment
 * and a month, its rhythm, when last paid and next; the figures the bank's (locked). The built-in's recurringRecords, rule for rule.
 */
export async function handler(_event, context) {
  const t = tFor(context.language);
  const zeff = context.zeff;
  const today = new Date().toLocaleDateString("sv-SE");
  const { bookings } = await zeff.call("bank.bookings", { from: addDays(today, -800), to: "9999-12-31" });
  if (!bookings.length) return [];
  // What is no contract: money only moved, the bank's pocket moves by their words, and money to a person you know (an organisation can be a contract).
  const moved = movedOnly(bookings);
  const { people } = await zeff.call("people.list", {});
  const persons = new Set(people.filter((p) => p.kind !== "organization").map((p) => p.id));
  const ibans = [...new Set(bookings.filter((b) => b.person_id == null && b.iban).map((b) => b.iban))];
  const byIban = ibans.length ? (await zeff.call("people.by-iban", { ibans })).ids : {};
  const toPerson = (b) => {
    const id = b.person_id ?? byIban[b.iban] ?? null;
    return id !== null && persons.has(id);
  };
  const rows = bookings.filter((b) => b.amount < 0 && classifyNoise({ type: "bank", text: b.text, counterparty: b.counterparty }).kind !== "pocket" && !toPerson(b));
  const label = { monthly: t("Monthly"), quarterly: t("Quarterly"), yearly: t("Yearly") };
  // An account you marked as yours is no contract.
  const marked = (await zeff.call("pref.get", { key: "finances.ownAccounts" })).value ?? {};
  const own = new Set([...Object.keys(marked), ...moved]);
  return detectRecurring(rows, today, STRICT)
    .filter((r) => r.active && !classifyNoise({ type: "bank", key: r.key }, { own }).kind)
    .map((r) => ({
      ref: "recurring:" + r.key,
      title: r.name,
      fields: {},
      updatedAt: r.last,
      typed: [
        { id: CONTRACT.monthly, name: "Per month", type: "number", format: "euro", value: r.monthly },
        { id: CONTRACT.amount, name: "Per payment", type: "number", format: "euro", value: r.amount },
        { id: CONTRACT.rhythm, name: "Rhythm", type: "select", value: label[r.rhythm] },
        { id: CONTRACT.last, name: "Last paid", type: "date", value: r.last },
        { id: CONTRACT.next, name: "Next payment", type: "date", value: r.next },
      ],
    }));
}
