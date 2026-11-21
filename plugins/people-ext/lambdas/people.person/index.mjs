import { personPageData, tFor, kindLabel } from "./lib.mjs";

/**
 * What a person's page shows (the plugin's detail page views/person.html reads it as data.page.* and data.wiki.*): the built-in's own personPageData
 * (src/plugins/people/row-data.ts, bundled) over the kernel's bundle of what Zeff knows of them (`people.page-data`) and, separately — it may take a few seconds —
 * what the knowledge server knows of them (`people.wiki-of`). event: { row, part: "page" | "wiki" }.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const row = Number(event?.row) || 0;
  if (event?.part === "loops") {
    // what is open with them (the Open loops plugin's list, as its block on the page shows it)
    const r = await context.zeff.call("people.loops-of", { row });
    if (!r.ok) return { items: [], any: false, off: !!r.off, error: r.off ? "" : (r.error ?? "") };
    const items = r.loops.map((l) => ({
      ref: l.ref,
      open: l.state === "open",
      mine: l.direction === "mine",
      who: l.direction === "mine" ? t("I owe") : t("They owe"),
      kind: kindLabel(t, l.kind),
      text: l.text,
      quote: l.quote ? `“${l.quote}”` : "",
      since: t("since {day}", { day: l.at.slice(0, 10) }),
      due: l.due ? t("due {day}", { day: l.due }) : l.overdue ? t("overdue") : "",
      overdue: !!l.overdue,
      unconfirmed: l.confirmed ? "" : t("unconfirmed"),
      href: l.href ?? "",
      proposal: l.proposal && l.state === "open" ? { text: `${l.proposal.by === "ai" ? t("Kept? The AI read:") : t("Kept? A reply about it:")} “${l.proposal.quote}”`, href: l.proposal.href ?? "" } : null,
      closed: l.state === "open" ? "" : `${l.closedBy === "rule" ? t("Closed by its source") : l.closedBy === "ai" ? t("Closed (the AI's reading, confirmed)") : t("Closed by you")}${l.closeQuote ? ` — “${String(l.closeQuote).slice(0, 160)}”` : ""}`,
    }));
    return { items, any: items.length > 0, off: false, error: "", openCount: items.filter((x) => x.open).length };
  }
  if (event?.part === "wiki") {
    const w = (await context.zeff.call("people.wiki-of", { row })).wiki;
    const d = personPageData({ person: { id: 1, name: "", aliases: [], emails: [], jira: [], whatsapp: "", note: "", starred: false, compiled: null, dates: [], details: [], claims: [], links: [], relations: { out: [], in: [] }, contacts: [], todos: [], pages: [], tickets: [], others: [], documents: [], cases: [], events: null, pulse: null }, error: null, loading: false, wiki: w }, { t, locale: context.language });
    const pick = ({ wiki, showWiki, wikiLoading, wikiError, wikiEmpty, wikiFull, wikiMerge, hasWikiMerge, wikiPagesTitle }) => ({ wiki: wiki ?? { summary: "", related: [], pages: [], graph: "", error: "", merge: null }, showWiki, wikiLoading, wikiError, wikiEmpty, wikiFull, wikiMerge, hasWikiMerge, wikiPagesTitle });
    return pick(d);
  }
  const bundle = (await context.zeff.call("people.page-data", { row })).person;
  const d = personPageData({ person: bundle, error: bundle ? null : t("This row is not a person."), loading: false, wiki: null }, { t, locale: context.language });
  if (!d.ready) return { ready: false, error: d.error ?? "", row };
  // (the whole bundle and the knowledge part are not what the page reads from here)
  const { person, wiki, showWiki, wikiLoading, wikiError, wikiEmpty, wikiFull, wikiMerge, hasWikiMerge, wikiPagesTitle, ...rest } = d;
  const option = (x) => String(x).replace(/[,:]/g, " ").replace(/\s+/g, " ").trim();
  return { ...rest, row, relationOptions: [`:${t("to you")}`, ...rest.others.map((o) => `${o.id}:${option(o.name)}`)].join(", ") };
}
