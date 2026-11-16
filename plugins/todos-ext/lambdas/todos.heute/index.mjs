import { tFor } from "./lib.mjs";

/**
 * The todos' parts of Today (views/todos.html reads them as data.today): yours due today or before, what you wait on for three days or more, what agents ask you, what
 * workers report done — each ready to draw. The kernel's read `todos.today` does the looking (the Today page's own lists).
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const locale = { de: "de-DE", es: "es-ES", en: "en-GB" }[lang];
  const d = await context.zeff.call("todos.today", {});
  const date = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  const dueText = (days, due) => (days < 0 ? (days === -1 ? t("overdue (1 day)") : t("overdue ({n} days)", { n: -days })) : days === 0 ? t("due today") : days === 1 ? t("due tomorrow") : t("due {date}", { date: date(due) }));
  const ago = (n) => (n <= 0 ? t("today") : n === 1 ? t("since yesterday") : t("for {n} days", { n }));
  const base = (x) => ({ id: x.id, ref: x.ref, text: x.text, ticket: x.ticket, when: x.due ? dueText(x.dueDays, x.due) : "", overdue: x.dueDays !== null && x.dueDays < 0, ago: ago(x.ageDays) });
  const due = d.due.map(base);
  const waiting = d.waiting.map(base);
  const asking = d.asking.map((x) => ({ ...base(x), question: x.question }));
  const reported = d.reported.map((x) => ({ ...base(x), by: String(x.by).split(" · ")[0], note: x.note }));
  return {
    due,
    waiting,
    asking,
    reported,
    nothing: !due.length && !waiting.length && !asking.length && !reported.length ? t("Nothing due, promised or waiting today.") : "",
  };
}
