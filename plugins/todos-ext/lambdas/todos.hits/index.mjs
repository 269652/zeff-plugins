import { tFor } from "./lib.mjs";

/**
 * The omnibar's hits (views/todos.html reads them as data.hits): what a typed text names — tickets, kinds, people, the todos' own words and notes, mails, messages, comments,
 * notes, documents, facts — each with the todos it belongs to, grouped by what it is. The kernel's read `todos.omni` does the searching (the built-in route's own). Picking one
 * makes it a chip: its `pick` is "icon title␟1,2,3" (the todos it names). event: { q }.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const q = String(event?.q ?? "").trim();
  if (q.length < 2) return { hits: [], q, none: "", first: "" };
  const ICON = { text: "🔎", ticket: "🎫", todo: "☑", note: "📝", mail: "✉", teams: "💬", jira: "🗨", gitlab: "🔀", context: "📝", keep: "🗒", doc: "📄", fact: "💡", person: "👤", kind: "🏷" };
  const LABEL = { text: t("Everything with this"), ticket: t("Tickets"), kind: t("Kinds"), person: t("People"), todo: t("Todos"), note: t("Notes"), mail: t("Mails"), teams: t("Messages"), jira: t("Jira comments"), gitlab: t("GitLab"), context: t("Context"), keep: t("Keep"), doc: t("Documents"), fact: t("Facts") };
  const { hits } = await context.zeff.call("todos.omni", { q });
  return {
    q,
    first: hits[0] ? `${ICON[hits[0].kind] ?? "•"} ${hits[0].title}\u241f${hits[0].todoIds.join(",")}` : "",
    none: hits.length ? "" : t("Nothing found that a todo refers to."),
    hits: hits.map((h, i) => ({
      key: h.key,
      icon: ICON[h.kind] ?? "•",
      title: h.title,
      sub: h.kind === "text" ? "" : h.sub,
      n: t("{n} todos", { n: h.todoIds.length }),
      first: i === 0 || hits[i - 1].kind !== h.kind,
      label: LABEL[h.kind] ?? h.kind,
      pick: `${ICON[h.kind] ?? "•"} ${h.title}␟${h.todoIds.join(",")}`,
    })),
  };
}
