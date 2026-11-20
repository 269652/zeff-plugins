import { tFor } from "./lib.mjs";

/**
 * What a todo's panel shows (views/todos.html reads it as data.p): the todo whole — its words, kind, ticket, due day, where it came from and its note; your notes and
 * the runs' reports; its actions in words (what each does, the text it would send) with whether Zeff can run it here; the time reported on it; its merge requests; the
 * steps planned after it; and the comments, messages and mails it comes from. The kernel's read `todos.detail` does the looking (the built-in panel's own data); this puts the
 * words of the page on it. event: { id }.
 */
/** A note's text with its pictures inline: ![title](doc:12) is the stored picture. */
const noteParts = (text) => {
  const parts = [];
  let last = 0;
  for (const m of String(text).matchAll(/!\[([^\]]*)\]\(doc:(\d+)\)/g)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), image: false, url: "", title: "" });
    parts.push({ text: "", image: true, url: `/api/documents/${m[2]}/file`, title: m[1] || "Bild" });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), image: false, url: "", title: "" });
  return parts;
};

export async function handler(event, context) {
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const locale = { de: "de-DE", es: "es-ES", en: "en-GB" }[lang];
  // (a number, or a quick panel's key "time-3": the todo it is open on)
  const id = Number(String(event?.id ?? "").replace(/^[a-z]+-/, ""));
  if (!Number.isInteger(id) || id <= 0) return { found: false };
  const d = await context.zeff.call("todos.detail", { id });
  if (!d.found) return { found: false, error: t("Unknown todo.") };

  const stamp = (at) => {
    if (!at) return "";
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00` : at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
    if (Number.isNaN(date.getTime())) return String(at);
    return `${date.toLocaleDateString(locale, { day: "numeric", month: "short" })}, ${date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
  };
  const minutes = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
  const KINDS = { reply: t("Reply"), comment: t("Comment"), update: t("Update ticket"), implement: t("Implement"), fix: t("Fix"), test: t("Test"), review: t("Review"), clarify: t("Clarify"), document: t("Docs"), deploy: t("Deploy"), merge: t("Deliver"), other: t("Other") };

  const runnable = d.ops.filter((o) => o.runnable);
  return {
    found: true,
    id: d.id,
    ref: d.ref,
    text: d.text,
    kind: KINDS[d.kind] ?? d.kindLabel,
    closed: d.status !== "open",
    status: d.status,
    waiting: d.owner === "other",
    ticket: d.ticket,
    due: d.due,
    source: d.source ? t("Source: {source}", { source: d.source }) : "",
    note: d.note,
    attachments: d.attachments.map((a) => ({ ...a, insert: `![${a.name.replace(/\.[a-z0-9]+$/i, "").replace(/[[\]]/g, "")}](doc:${a.id})`, url: `/api/documents/${a.id}/file` })),
    nImages: d.attachments.filter((a) => a.image).length,
    notes: d.notes.map((n) => ({ ...n, parts: noteParts(n.text), when: stamp(n.at), by: n.by ? String(n.by) : "", mine: n.own, sync: n.own ? (n.jira === "synced" ? t("on Jira") : n.jira === "changed" ? t("changed since Jira") : "") : "" })),
    nNotes: d.notes.length,
    ops: d.ops.map((o) => ({ ...o, only: String(o.index), editBody: o.hasText && d.status === "open" })),
    nOps: d.ops.length,
    nRunnable: runnable.length,
    manyRunnable: runnable.length > 1,
    alternatives: d.alternatives.map((a) => ({ label: a.label, title: a.title, also: !!a.also })),
    nAlternatives: d.alternatives.length,
    payment: d.payment ? { ...d.payment, line: `${d.payment.iban}${d.payment.amount ? ` · ${d.payment.amount.toLocaleString(locale, { minimumFractionDigits: 2 })} €` : ""} · ${d.payment.purpose}`, title: t("Pay with GiroCode — the account of {name}", { name: d.payment.name }) } : null,
    knowledge: d.knowledge,
    nKnowledge: d.knowledge ? d.knowledge.pages.length + d.knowledge.entities.length + d.knowledge.links.length + (d.knowledge.repo ? 1 : 0) : 0,
    draft: d.draft,
    recurrence: d.recurrence,
    away: d.away.map((a) => ({ text: t("{name} is away until {date}", { name: a.name, date: new Date(a.until).toLocaleDateString(locale) }) })),
    opsWhy: d.opsWhy ? t("Suggested: {why}", { why: d.opsWhy }) : "",
    blockedBy: d.blockedBy ? t("Waiting: {what} — the GitLab sync notices once it's ready", { what: d.blockedBy }) : "",
    time: d.time.map((r) => ({ ...r, when: stamp(r.at), length: minutes(r.minutes), mine: r.by === "Du" })),
    timeTotal: d.time.length ? minutes(d.time.reduce((n, r) => n + r.minutes, 0)) : "",
    nTime: d.time.length,
    totalTime: d.totalMinutes ? minutes(d.totalMinutes) : "",
    mrs: d.mrs,
    planned: d.planned,
    nPlanned: d.planned.reduce((n, p) => n + p.steps.length, 0),
    sources: d.sources.map((s) => ({ ...s, when: stamp(s.at) })),
    nSources: d.sources.length,
  };
}
