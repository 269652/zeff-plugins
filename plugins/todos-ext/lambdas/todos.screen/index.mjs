import { tFor } from "./lib.mjs";
import { rowTools } from "./rows.mjs";

/**
 * What the Todos screen shows (views/todos.html reads it as data.x): the todos of a scope — open (yours, grouped by how urgent they are, and the ones you wait on),
 * done, or the workers' own — each ready to draw (rows.mjs). The kernel's read `todos.rows` does the looking (the built-in page's own: the same todos, the same
 * order); this puts the words of the page on it and applies the filter: the omnibar's chips (each a picked hit, "title␟ids": a todo stays when every chip names
 * it) and the typed words. event: { scope: open | done | worker, filter, chips }.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const { view } = rowTools(t, lang);

  const scope = event?.scope === "done" || event?.scope === "worker" ? event.scope : "open";
  const q = String(event?.filter ?? "").trim().toLowerCase();
  const data = await context.zeff.call("todos.rows", { scope });

  // The omnibar's chips: "icon title␟1,2,3".
  let picks = [];
  try {
    const v = JSON.parse(String(event?.chips || "[]"));
    if (Array.isArray(v)) picks = v.map(String);
  } catch {
    picks = [];
  }
  const chips = picks.map((p) => {
    const at = p.lastIndexOf("␟");
    return { pick: p, title: at < 0 ? p : p.slice(0, at), ids: new Set((at < 0 ? "" : p.slice(at + 1)).split(",").map(Number)) };
  });

  const GROUPS = { important: [t("Important"), "#ef4444"], overdue: [t("Overdue"), "#ef4444"], today: [t("Today"), "#f59e0b"], week: [t("This week"), "#0ea5e9"], later: [t("Later"), "#a1a1aa"], none: [t("No due date"), "#a1a1aa"], deferred: [t("Set aside"), "#d4d4d8"] };

  const match = (r) => chips.every((c) => c.ids.has(r.id)) && (!q || [r.text, r.ref, r.ticket, r.note, r.source, ...(r.alsoTickets ?? [])].some((s) => String(s ?? "").toLowerCase().includes(q)));
  const kept = data.rows.filter(match);
  const views = new Map(kept.map((r) => [r.id, view(r, data)]));
  const rows = kept.map((r) => views.get(r.id));

  let groups = [];
  let waiting = [];
  if (scope === "open") {
    waiting = kept.filter((r) => r.owner === "other").map((r) => views.get(r.id));
    const byGroup = new Map();
    for (const r of kept) {
      if (r.owner === "other") continue;
      byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), views.get(r.id)]);
    }
    groups = ["important", "overdue", "today", "week", "later", "none", "deferred"].filter((g) => byGroup.has(g)).map((g) => ({ key: g, label: GROUPS[g][0], color: GROUPS[g][1], overdue: g === "overdue", count: byGroup.get(g).length, items: byGroup.get(g) }));
  }
  const filtering = !!q || chips.length > 0;

  return {
    scope,
    filtering,
    chips: chips.map((c) => ({ pick: c.pick, title: c.title })),
    counts: data.counts,
    briefing: data.briefing,
    groups,
    waiting,
    nWaiting: waiting.length,
    rows: scope === "open" ? [] : rows,
    nRows: rows.length,
    nMine: scope === "open" ? rows.length - waiting.length : 0,
    empty: filtering ? t("Nothing matches the filter.") : scope === "open" ? t("Nothing open for you.") : scope === "done" ? t("Nothing done yet.") : t("No worker todos yet."),
  };
}
