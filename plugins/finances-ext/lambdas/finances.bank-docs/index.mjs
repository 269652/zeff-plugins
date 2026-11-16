/**
 * The bank statements as pages for the knowledge server (its "Zeff" source): one per account and month, in the space "Zeff · Konto" — the money that
 * came in, by sender, and the largest payments out, by recipient. The built-in's bankDocs (src/plugins/finances/knowledge-docs.ts), over the kernel's bank.bookings.
 */
const MONTHS = 12;
const euro = (v) => `${v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const monthName = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

/** A text's version: a 31-bit hash (FNV-1a) — the same as the other Zeff pages'. */
function version(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) || 1;
}

/** A month's bookings grouped by who (the booking's text — the sender or recipient as the bank writes it). */
function grouped(list) {
  const by = new Map();
  for (const t of list) {
    const who = (t.counterparty || t.text || "").replace(/\s+/g, " ").trim() || "?";
    const g = by.get(who.toLowerCase()) ?? { who, sum: 0, n: 0, days: [], refs: [] };
    g.sum += t.amount;
    g.n++;
    g.days.push(t.date.slice(8, 10));
    if (t.reference && g.refs.length < 2 && !g.refs.includes(t.reference)) g.refs.push(t.reference.slice(0, 60));
    by.set(who.toLowerCase(), g);
  }
  return [...by.values()].sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
}

export async function handler(event, context) {
  const since = new Date();
  since.setDate(1);
  since.setMonth(since.getMonth() - MONTHS);
  const day = (d) => d.toLocaleDateString("sv-SE");
  const { bookings } = await context.zeff.call("bank.bookings", { from: day(since), to: "9999-12-31" });
  const by = new Map();
  for (const r of bookings) {
    const k = `${r.account}|${r.date.slice(0, 7)}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  const thisMonth = new Date().toISOString().slice(0, 7);
  return [...by.entries()].map(([k, list]) => {
    const [account, month] = k.split("|");
    const ins = grouped(list.filter((t) => t.amount > 0));
    const outs = grouped(list.filter((t) => t.amount < 0)).slice(0, 25);
    const line = (g) => `- ${g.who}: ${euro(Math.abs(g.sum))} (${g.n}×, am ${[...new Set(g.days)].slice(0, 6).join(".,")}.)${g.refs.length ? ` — Verwendungszweck: ${g.refs.join("; ")}` : ""}`;
    const sum = (l) => l.reduce((s, t) => s + t.amount, 0);
    const body = [
      `Kontoauszug meines Kontos bei ${account}, ${monthName(month)}${month === thisMonth ? " (Monat läuft noch)" : ""}.`,
      `Eingänge insgesamt ${euro(sum(list.filter((t) => t.amount > 0)))}, Ausgänge insgesamt ${euro(-sum(list.filter((t) => t.amount < 0)))}, ${list.length} Buchungen.`,
      "",
      "## Eingänge (nach Absender)",
      ...ins.map(line),
      "",
      "## Größte Ausgänge (nach Empfänger)",
      ...outs.map(line),
    ]
      .join("\n")
      .slice(0, 4800);
    // The version also names what the compile reads off a statement ("profile 2": the net income) — when that grows, the months already compiled are compiled once more.
    return { id: `zeff:bank:${account.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${month}`, space: "Zeff · Konto", title: `Kontoauszug ${account} ${monthName(month)}`, url: "", version: version(`profile 2\n${body}`), updatedAt: list.at(-1)?.date ?? `${month}-01`, author: null, body };
  });
}
