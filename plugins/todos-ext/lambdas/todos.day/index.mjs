import { tFor } from "./lib.mjs";

/**
 * The Recap (views/todos.html reads it as data.day): what you did on a day — whether it is being written, the AI's summary, per ticket its lead and what was done with the
 * evidence it was written from (bookings, todos, workers, Jira, commits, GitLab), the work on no ticket, the days before and after. The kernel's read `todos.recap` does the
 * looking (the built-in page's own). event: { day: YYYY-MM-DD, or "" for the last workday }.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const locale = { de: "de-DE", es: "es-ES", en: "en-GB" }[lang];
  const r = await context.zeff.call("todos.recap", { day: String(event?.day ?? "") });
  const KIND = { entry: t("Entry"), todo: t("Todo"), work: t("Worker"), "jira-comment": "Jira", "jira-change": "Jira", commit: t("Commit"), gitlab: "GitLab" };
  const PHASES = { gather: t("gathering the day"), ai: t("writing"), saving: t("saving") };
  const hours = (h) => h.toLocaleString(locale, { maximumFractionDigits: 2 });
  const time = (at) => (at ? new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "");
  const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const facts = (list) => list.map((f) => ({ time: time(f.at), kind: KIND[f.kind] ?? f.kind, hours: f.hours ? `${hours(f.hours)} h` : "", text: f.text }));
  const since = r.since ? Math.max(0, Math.round((Date.now() - r.since) / 1000)) : 0;
  const when = (iso) => (iso ? new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) || iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const mins = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")} min` : "");
  return {
    day: r.day,
    label: dayLabel(r.day),
    before: r.before,
    after: r.after,
    max: r.today,
    running: r.running,
    runningText: r.running ? `${since ? `${Math.floor(since / 60)}:${String(since % 60).padStart(2, "0")}` : ""} · ${r.phase === "ai" ? t("{provider} writing", { provider: r.provider }) : (PHASES[r.phase] ?? t("running"))}` : "",
    again: !!r.shown,
    facts: r.shown ? [t("As of: {when}", { when: when(r.shown.at) }), r.shown.model, mins(r.shown.durationMs), r.shown.costUsd != null ? `≈ $${r.shown.costUsd.toFixed(2)}` : ""].filter(Boolean).map((text) => ({ text })) : [],
    failed: r.failed ? t("The last run failed: {error}", { error: r.failed.error }) : "",
    summary: r.summary,
    booked: r.booked > 0 ? t("{hours} h booked", { hours: hours(r.booked) }) : "",
    tickets: r.tickets.map((x) => ({ key: x.key, summary: x.summary, status: x.status, url: x.url, lead: x.lead, done: x.done.map((text) => ({ text })), hours: x.hours > 0 ? t("{hours} h booked", { hours: hours(x.hours) }) : "", facts: facts(x.facts), nFacts: x.facts.length, badges: x.badges.map((b) => ({ ...b, when: b.at ? time(b.at) : "" })), nBadges: x.badges.length })),
    hasOther: r.other.done.length > 0 || r.other.facts.length > 0,
    otherDone: r.other.done.map((text) => ({ text })),
    otherHours: r.other.hours > 0 ? t("{hours} h booked", { hours: hours(r.other.hours) }) : "",
    otherFacts: facts(r.other.facts),
    nOtherFacts: r.other.facts.length,
    empty: r.shown ? "" : t("No recap for this day yet — “Summarize” gathers what you did and has the AI write it."),
  };
}
