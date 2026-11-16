import { tFor } from "./lib.mjs";

/**
 * The Activity tab (views/todos.html reads it as data.feed): what happened to the todos in the last two weeks, newest first, by day — each made, done, dropped, opened again
 * or merged, by whom (the briefing, a worker, an agent, Jira, you) and why; what is new since you last looked is marked. The kernel's read `todos.activity` does the looking
 * (the built-in tab's own events). event: { filter: all | closed | created }.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const locale = { de: "de-DE", es: "es-ES", en: "en-GB" }[lang];
  const filter = event?.filter === "closed" || event?.filter === "created" ? event.filter : "all";
  const a = await context.zeff.call("todos.activity", {});
  const LABEL = { created: ["＋", t("new")], done: ["✓", t("done")], dismissed: ["✕", t("dismissed")], reopened: ["↺", t("reopened")], merged: ["⇄", t("merged")] };
  const key = (iso) => new Date(iso).toLocaleDateString("sv-SE");
  const today = new Date().toLocaleDateString("sv-SE");
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE");
  const dayLabel = (k) => (k === today ? t("Today") : k === yesterday ? t("Yesterday") : new Date(`${k}T00:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }));
  const shown = a.events.filter((e) => (filter === "closed" ? e.event === "done" || e.event === "dismissed" : filter === "created" ? e.event === "created" : true));
  const seen = a.seen;
  const days = [];
  for (const e of shown) {
    const k = key(e.at);
    const isNew = seen !== null && e.id > seen && !e.mine;
    const row = {
      id: e.id,
      time: new Date(e.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      icon: LABEL[e.event]?.[0] ?? "",
      label: LABEL[e.event]?.[1] ?? e.event,
      text: e.text,
      todoId: e.todoId,
      ref: e.ref,
      ticket: e.ticket,
      by: t("by {name}", { name: e.by.label }),
      byHref: e.by.href,
      byTitle: e.by.title,
      reopened: e.event !== "created" && e.openNow && e.event !== "reopened" && e.event !== "merged",
      run: e.event === "created" ? e.by.run : 0,
      note: e.note ? (e.event === "created" ? t("Source: {note}", { note: e.note }) : e.note) : "",
      isNew,
    };
    const last = days[days.length - 1];
    if (last?.key === k) last.items.push(row);
    else days.push({ key: k, label: dayLabel(k), items: [row] });
  }
  const unseen = seen === null ? 0 : a.events.filter((e) => e.id > seen && !e.mine).length;
  return {
    filter,
    days,
    max: a.max,
    unseen,
    unseenText: unseen > 0 ? t("{n} new since you last looked", { n: unseen }) : "",
    empty: t("Nothing in the last two weeks."),
    labels: { all: t("All"), closed: t("Closed"), created: t("New") },
  };
}
