import { DEFAULT_PREFS, FUNNEL_INSTRUCTIONS, FUNNEL_SCHEMA, tokens } from "./lib.mjs";

/**
 * The funnel: thousands of headlines come in a day, a few dozen are worth your time. The best new ones by score go to an agent (the AI) that reads them like an
 * editor who knows you — your written taste, your interests, what you liked and rejected, what Zeff knows about you: pass (what interests you), top (important),
 * drop (filtered out), each with a short why. Handed back as statements and the day's figures for the flow to write (a lambda only reads). Stale headlines nobody
 * has seen go first (they wouldn't be shown any more). The built-in's runFunnelRounds (src/plugins/news/funnel.ts, store.ts). event: { rounds } — 3 with the sync, 10 by hand.
 */
const FUNNEL_DAYS = 2;
const STALE = "gate = '' and state = 'new' and seen_at is null and vote != 1 and published_at <= ?1 and id not in (select item_id from news_similar)";
const tagsOf = (raw) => {
  try {
    const t = JSON.parse(raw ?? "[]");
    return Array.isArray(t) ? t.filter((x) => typeof x === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
};
const dayOf = (ms) => new Date(ms).toLocaleDateString("sv-SE");

export async function handler(event, context) {
  const zeff = context.zeff;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  const none = { ok: true, statements: [], stats: null, judged: 0, passed: 0, top: 0, dropped: 0, cleared: 0 };
  if (!prefs.funnel) return none;
  const q = async (sql, params = [], limit = 1000) => (await zeff.call("sql.query", { sql, params, limit })).rows;

  // Stale headlines go first: they wouldn't be shown any more, so nobody pays for reading them.
  const cutoff = new Date(nowMs - FUNNEL_DAYS * 864e5).toISOString();
  const statements = [];
  const cleared = (await q(`select count(*) n from news_items where ${STALE}`, [cutoff]))[0]?.n ?? 0;
  if (cleared) {
    statements.push({ sql: `insert or replace into news_gone (url_key, title_key, at) select url_key, case when length(title_key) > 12 then title_key else '' end, ?2 from news_items where ${STALE}`, params: [cutoff, nowIso] });
    statements.push({ sql: `delete from news_items where ${STALE}`, params: [cutoff] });
  }

  // What the agent goes on: the taste description, what Zeff knows about you, what you liked and rejected lately.
  const taste = (await zeff.call("pref.get", { key: "news:taste" })).value ?? {};
  const signals = (await q("select title, tags, vote, state from news_items where vote != 0 or state = 'saved' order by published_at desc limit 30")).map((r) => ({ kind: r.vote < 0 ? "dislike" : "like", title: r.title }));
  const lines = [];
  if (prefs.interests.length) lines.push(`Interessen: ${prefs.interests.map((i) => (i.weight > 1 ? `${i.term} (wichtig)` : i.term)).join(", ")}`);
  const liked = (await q("select term from news_terms where score >= 1 order by score desc, term limit 10")).map((r) => r.term);
  if (liked.length) lines.push(`Wofür sie 👍 gegeben hat: ${liked.join(", ")}`);
  if (prefs.mutes.length) lines.push(`Nicht interessiert an: ${prefs.mutes.join(", ")}`);
  const facts = (await zeff.call("facts.list", { limit: 30 })).facts.slice(0, 12).map((f) => `${f.subject}: ${f.text}`.slice(0, 120));
  if (facts.length) lines.push(`Fakten über sie: ${facts.join(" | ")}`);
  const close = (await zeff.call("people.known-in", { text: "" })).close;
  if (close.length) lines.push(`Ihr wichtige Personen: ${close.join(", ")}`);
  const count = new Map();
  for (const t of (await zeff.call("todos.open", {})).todos) for (const w of tokens(t.text)) if (w.length >= 5) count.set(w, (count.get(w) ?? 0) + 1);
  const work = [...count].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
  if (work.length) lines.push(`Woran sie gerade arbeitet (aus offenen Todos): ${work.join(", ")}`);
  const instructions = (await zeff.call("prompts.fill", { key: "news-funnel", template: FUNNEL_INSTRUCTIONS, vars: {} })).text;
  const head = [
    instructions,
    "",
    `Ihr Geschmack: ${taste.text || "(noch nicht beschrieben)"}`,
    ...((taste.likes ?? []).length ? [`Mag: ${taste.likes.join(", ")}`] : []),
    ...((taste.avoids ?? []).length ? [`Meidet: ${taste.avoids.join(", ")}`] : []),
    ...lines,
    ...(signals.some((s) => s.kind !== "dislike") ? ["Zuletzt gemocht oder gemerkt:", ...signals.filter((s) => s.kind !== "dislike").slice(0, 12).map((s) => `- ${s.title}`)] : []),
    ...(signals.some((s) => s.kind === "dislike") ? ["Zuletzt abgelehnt:", ...signals.filter((s) => s.kind === "dislike").slice(0, 8).map((s) => `- ${s.title}`)] : []),
    "",
    "Neue Meldungen:",
  ];

  const totals = { judged: 0, passed: 0, top: 0, dropped: 0 };
  const decided = [];
  const size = Math.max(5, Math.min(150, prefs.funnelBatch));
  const rounds = Math.max(1, Math.min(10, Number(event?.rounds) || 3));
  for (let round = 0; round < rounds; round++) {
    const items = await q(
      "select i.id, i.title, i.summary, i.source_name, i.published_at from news_items i left join news_sources s on s.id = i.source_id where i.gate = '' and i.state = 'new' and i.seen_at is null and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1) and i.id not in (select value from json_each(?)) order by i.score desc, i.published_at desc limit ?",
      [new Date(nowMs - FUNNEL_DAYS * 864e5).toISOString(), JSON.stringify(decided), size],
    );
    if (!items.length) break;
    const numbered = items.map((it, i) => `${i + 1}. [${it.source_name}] ${it.title}${it.summary ? ` — ${String(it.summary).replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
    let answer;
    try {
      answer = await zeff.call("ai.json", { prompt: [...head, ...numbered].join("\n"), schema: FUNNEL_SCHEMA, task: "news-ext.funnel", budget: 0.4 });
    } catch {
      break;
    }
    const seen = new Set();
    let judged = 0;
    for (const a of answer.items ?? []) {
      const it = items[(Number(a.n) || 0) - 1];
      const gate = a.verdict === "top" || a.verdict === "pass" || a.verdict === "drop" ? a.verdict : null;
      if (!it || !gate || seen.has(it.id)) continue;
      seen.add(it.id);
      decided.push(it.id);
      judged++;
      statements.push({ sql: "update news_items set gate = ?, gate_why = ?, gate_at = ? where id = ?", params: [gate, (typeof a.why === "string" ? a.why.replace(/\s+/g, " ").trim() : "").slice(0, 200), nowIso, it.id] });
      if (gate === "pass") totals.passed++;
      else if (gate === "top") totals.top++;
      else totals.dropped++;
    }
    totals.judged += judged;
    // An item the answer left out is looked at again next round (it stays as it was).
    if (!judged) break;
  }
  // The day's figures.
  const had = (await zeff.call("pref.get", { key: "news:funnel-stats" })).value ?? {};
  const day = dayOf(nowMs);
  const base = had.day === day ? { fetched: 0, judged: 0, passed: 0, top: 0, dropped: 0, cleared: 0, ...had } : { day, fetched: 0, judged: 0, passed: 0, top: 0, dropped: 0, cleared: 0 };
  const stats = { ...base, day, judged: base.judged + totals.judged, passed: base.passed + totals.passed, top: base.top + totals.top, dropped: base.dropped + totals.dropped, cleared: base.cleared + cleared };
  return { ok: true, statements, stats, ...totals, cleared };
}
