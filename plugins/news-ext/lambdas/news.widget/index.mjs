import { tFor } from "./lib.mjs";

/**
 * The widget "News for you": the best new items, scored for you — save, like or hide them right there (its buttons run the flow news.widget-act). The built-in's
 * NEWS_WIDGETS (src/plugins/news/widgets.ts). event: { config: { limit } }. Returns the widget's list.
 */
const clip = (s, n) => (String(s ?? "").length > n ? String(s).slice(0, n - 1).trimEnd() + "…" : String(s ?? ""));
const initials = (name) =>
  String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

export async function handler(event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const limit = Math.max(1, Math.min(15, Number(event?.config?.limit) || 6));
  const prefs = (await zeff.call("pref.get", { key: "news:prefs" })).value ?? {};
  const since = new Date(Date.now() - (Number(prefs.maxAgeDays) || 7) * 864e5).toISOString();
  const rows = (
    await zeff.call("sql.query", {
      sql: `select i.id, i.title, i.url, i.summary, i.source_name, i.published_at, i.state from news_items i left join news_sources s on s.id = i.source_id where i.state in ('new', 'read') and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1)${prefs.funnel ? " and i.gate in ('pass', 'top')" : ""} order by i.seen_at is not null, ${prefs.funnel ? "i.gate = 'top' desc, " : ""}i.score desc, i.published_at desc, i.id desc limit ?`,
      params: [since, limit],
      limit,
    })
  ).rows;
  const rtf = new Intl.RelativeTimeFormat(context.language === "de" || context.language === "es" ? context.language : "en", { numeric: "auto" });
  const ago = (iso) => {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return !Number.isFinite(min) ? "" : min < 60 ? rtf.format(-Math.max(1, min), "minute") : min < 1440 ? rtf.format(-Math.round(min / 60), "hour") : rtf.format(-Math.round(min / 1440), "day");
  };
  return {
    kind: "list",
    items: rows.map((i) => ({
      id: String(i.id),
      icon: initials(i.source_name) || "📰",
      text: i.title,
      detail: [i.source_name, clip(i.summary, 110)].filter(Boolean).join(" — "),
      meta: ago(i.published_at),
      href: i.url,
      actions: [
        { id: "save", label: t("Save"), icon: "🔖" },
        { id: "like", label: t("More like this"), icon: "👍" },
        { id: "hide", label: t("Hide"), icon: "✕" },
      ],
    })),
    empty: t("Nothing new."),
    footer: { text: t("All news"), href: "/news" },
  };
}
