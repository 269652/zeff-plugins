import { tFor } from "./lib.mjs";
import { rowTools } from "./rows.mjs";

/**
 * The briefing and the Tickets tab (views/todos.html reads it as data.lage): whether a run goes on and since when, the run shown (when, model, duration, cost, tickets analyzed),
 * the last failure, the lede and the sources that weren't well — and per ticket what Jira says and what the run made of it: its attention, lead, summary, what happened, flags,
 * the changes it suggests (done or still to do), questions, and the todos on it. The kernel's reads `todos.board` and `todos.rows` do the looking (the built-in page's own).
 * event: { att: an attention to filter by, or "" }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const { view, day, locale } = rowTools(t, lang);
  const b = await zeff.call("todos.board", {});
  const todos = await zeff.call("todos.rows", { scope: "open" });
  const doneAll = await zeff.call("todos.rows", { scope: "done", limit: 300 });
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  // (what was closed in the last week stays under its ticket, as on the page)
  const recent = doneAll.rows.filter((r) => r.doneAt && r.doneAt >= weekAgo);
  const att = String(event?.att ?? "");
  // What "Run now" does, in order — each step as the Sync menu has it: the syncs it runs first (the Auswerten settings), then the Lage and its steps.
  const stepKeys = [...b.presync, "boards", "review", "matching", "autoactions"];
  const sync = await zeff.call("sync.steps", { keys: stepKeys });
  const sinceT = (iso) => {
    if (!iso) return t("not synced yet");
    const m = Math.max(0, Math.round((Date.now() - new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) || iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).getTime()) / 60000));
    return m < 1 ? t("just now") : m < 60 ? t("{n} min ago", { n: m }) : m < 1440 ? t("{n} h ago", { n: Math.round(m / 60) }) : t("{n} d ago", { n: Math.round(m / 1440) });
  };
  const healthOf = new Map((sync.health ?? []).map((h) => [h.key, h]));
  const steps = stepKeys.flatMap((k) => sync.steps.filter((x) => x.key === k)).map((x) => ({ key: x.key, label: x.label, what: x.what, running: x.running, ok: x.lastOk !== false, failed: x.lastOk === false, text: x.running ? t("syncing…") : `${sinceT(x.lastAt)}${x.lastMessage ? ` · ${x.lastMessage}` : ""}`, health: healthOf.get(x.key)?.reason ?? "", href: x.href }));
  const ATT = { feedback: [t("Open question"), "#f97316"], active: [t("In progress"), "#0d9488"], check: [t("Testing / Review"), "#6366f1"], spec: [t("Spec"), "#a855f7"], blocked: [t("Waiting on others"), "#a1a1aa"], ready: [t("Ready"), "#cbd5e1"], stale: [t("Stalled"), "#d6d3d1"] };
  const PHASES = { sync: t("syncing first"), jira: t("reading Jira and Zeff"), ai: t("analyzing"), saving: t("saving"), mailtodos: t("finding todos in mails and WhatsApp"), mails: t("matching mails to the todos"), notetodos: t("finding todos in notes"), knowledge: t("matching knowledge to the todos"), notes: t("matching notes to the todos"), calendarmatch: t("matching appointments to the todos"), calendartodos: t("finding todos in appointments"), documents: t("finding todos in documents"), docrelations: t("matching documents to the todos"), people: t("finding the people in the todos"), autoactions: t("taking actions for the todos") };
  const when = (iso) => (iso ? new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) || iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const mins = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")} min` : "");
  const since = b.since ? Math.max(0, Math.round((Date.now() - b.since) / 1000)) : 0;

  const onTicket = (r, key) => r.ticket === key || (r.alsoTickets ?? []).includes(key);
  const chips = b.counts.map((c) => ({ attention: c.attention, label: ATT[c.attention][0], color: ATT[c.attention][1], n: c.n, on: att === c.attention }));
  const tickets = b.tickets
    .filter((x) => !att || x.attention === att)
    .map((x) => ({
      ...x,
      attLabel: x.analyzed ? ATT[x.attention][0] : "",
      attColor: ATT[x.attention][1],
      followLabel: x.followed ? t("followed") : "",
      flags: x.flags.map((text) => ({ text })),
      factsLine: [x.facts.issueType, x.facts.priority, x.facts.comments === 1 ? t("1 comment") : t("{n} comments", { n: x.facts.comments }), x.facts.parent ? t("Parent {key}", { key: x.facts.parent }) : "", x.facts.updatedAt ? t("last {date}", { date: day(x.facts.updatedAt.slice(0, 10)) }) : ""].filter(Boolean).map((text) => ({ text })),
      recent: x.recent.map((c) => ({ ...c, ticket: x.key, when: c.at ? day(c.at.slice(0, 10)) : "" })),
      gitlab: x.gitlab.map((c) => ({ ...c, when: c.at ? day(c.at.slice(0, 10)) : "", tip: t("On {ref} {title} — open in GitLab", { ref: c.ref, title: c.title }) })),
      nComments: x.recent.length + x.gitlab.length,
      commentsTitle: [x.recent.length ? (x.facts.comments > x.recent.length ? t("Jira {n} of {total}", { n: x.recent.length, total: x.facts.comments }) : `Jira ${x.recent.length}`) : "", x.gitlab.length ? `GitLab ${x.gitlab.length}` : ""].filter(Boolean).join(" · "),
      mails: x.mails.map((m) => ({ ...m, when: m.at ? day(m.at.slice(0, 10)) : "" })),
      nMails: x.mails.length,
      mailsTitle: x.mails.some((m) => m.unread) ? t("Mails ({n}, {unread} unread)", { n: x.mails.length, unread: x.mails.filter((m) => m.unread).length }) : t("Mails ({n})", { n: x.mails.length }),
      chat: x.chat.map((c) => ({ ...c, sourceList: c.sources.map((text) => ({ text })) })),
      questions: x.questions.map((q) => ({ ...q, sourceList: (x.questionSources[q.q] ?? []).map((text) => ({ text })) })),
      happened: x.happened.map((h) => ({ when: h.when ? day(h.when.slice(0, 10)) : "", who: h.who ?? "", what: h.what })),
      actions: x.actions.map((a) => ({ ...a, ticket: x.key, doneAt: a.done ? when(a.done.at) : "", ok: a.done?.status === "done", failed: a.done?.status === "failed", detail: a.done?.detail ?? "", icon: a.type === "transition" ? "→" : a.type === "assign" ? "👤" : "💬" })),
      todos: [...todos.rows.filter((r) => onTicket(r, x.key)).map((r) => view(r, todos)), ...recent.filter((r) => onTicket(r, x.key)).map((r) => view(r, doneAll))],
    }));
  return {
    running: b.running,
    runningText: b.running ? `${since ? `${Math.floor(since / 60)}:${String(since % 60).padStart(2, "0")}` : ""} · ${b.phase === "ai" ? t("{provider} analyzing", { provider: b.provider }) : (PHASES[b.phase] ?? t("running"))}` : "",
    asOf: b.shown ? t("As of: {when}", { when: when(b.shown.at) }) : "",
    facts: b.shown ? [b.shown.analyzed === 1 ? t("1 ticket analyzed") : t("{n} tickets analyzed", { n: b.shown.analyzed }), b.shown.model, mins(b.shown.durationMs), b.shown.costUsd != null ? `≈ ${b.shown.costUsd.toLocaleString(locale, { style: "currency", currency: "USD" })}` : ""].filter(Boolean).map((text) => ({ text })) : [],
    runId: b.shown?.id ?? 0,
    none: b.shown ? "" : t("No briefing yet — “Run now” reads your tickets and has the AI ({ai}) write the briefing (takes a minute or two).", { ai: b.provider }),
    failed: b.failed ? t("The last run ({when}) failed: {error}", { when: when(b.failed.at), error: b.failed.error }) + (b.shown ? ` — ${t("this is the one before.")}` : "") : "",
    jql: b.jql,
    lede: b.lede,
    gaps: b.gaps.length ? t("Not up to date when this ran:") : "",
    gapList: b.gaps.map((g) => ({ label: g.label, href: g.href, state: g.state })),
    chips,
    nAll: b.tickets.length,
    att,
    tickets,
    nTickets: tickets.length,
    left: b.left,
    listed: b.listed.map((x) => ({ ...x, day: x.updatedAt ? day(x.updatedAt.slice(0, 10)) : "" })),
    nListed: b.listed.length,
    empty: t("No open tickets on the chosen boards."),
    presync: b.presync,
    steps,
    nSteps: steps.length,
    stepsRunning: steps.some((x) => x.running),
  };
}
