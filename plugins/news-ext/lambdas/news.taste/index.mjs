import { DEFAULT_PREFS, TASTE_INSTRUCTIONS, TASTE_SCHEMA, fallbackTaste, tastePrompt, tokens } from "./lib.mjs";

/**
 * Your taste, written down: a short description of what you like to read, growing as you go. Every article you like (👍), save (🔖) or reject (👎) is a signal;
 * the queued signals (a few at a time) are fed to the AI with the current description, which rewrites it — new likes added, vague ones sharpened,
 * contradictions out — with the terms you like, those you avoid and searches that would find more. Without an AI the description is built from the tags of what
 * you liked. Handed back as the new value of the preference news:taste for the flow to keep. The built-in's updateTaste (src/plugins/news/taste.ts).
 * Returns { taste, taken } — taste null: nothing queued.
 */
const clean = (l, n) => [...new Set((Array.isArray(l) ? l : []).filter((x) => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length >= 2 && x.length <= 60))].slice(0, n);
const EMPTY = { text: "", likes: [], avoids: [], queries: [], updatedAt: null, pending: [], edited: false };

export async function handler(event, context) {
  const zeff = context.zeff;
  const cur = { ...EMPTY, ...((await zeff.call("pref.get", { key: "news:taste" })).value ?? {}) };
  const batch = cur.pending.slice(0, 12);
  if (!batch.length) return { taste: null, taken: 0 };
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  // What Zeff knows about the person (as the built-in's profileLines gives it).
  const q = async (sql, params = []) => (await zeff.call("sql.query", { sql, params, limit: 100 })).rows;
  const profile = [];
  if (prefs.interests.length) profile.push(`Interessen: ${prefs.interests.map((i) => (i.weight > 1 ? `${i.term} (wichtig)` : i.term)).join(", ")}`);
  const liked = (await q("select term from news_terms where score >= 1 order by score desc, term limit 10")).map((r) => r.term);
  if (liked.length) profile.push(`Wofür sie 👍 gegeben hat: ${liked.join(", ")}`);
  if (prefs.mutes.length) profile.push(`Nicht interessiert an: ${prefs.mutes.join(", ")}`);
  const facts = (await zeff.call("facts.list", { limit: 30 })).facts.slice(0, 12).map((f) => `${f.subject}: ${f.text}`.slice(0, 120));
  if (facts.length) profile.push(`Fakten über sie: ${facts.join(" | ")}`);
  const close = (await zeff.call("people.known-in", { text: "" })).close;
  if (close.length) profile.push(`Ihr wichtige Personen: ${close.join(", ")}`);
  const count = new Map();
  for (const t of (await zeff.call("todos.open", {})).todos) for (const w of tokens(t.text)) if (w.length >= 5) count.set(w, (count.get(w) ?? 0) + 1);
  const work = [...count].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
  if (work.length) profile.push(`Woran sie gerade arbeitet (aus offenen Todos): ${work.join(", ")}`);

  let out = null;
  try {
    const instructions = (await zeff.call("prompts.fill", { key: "news-taste", template: TASTE_INSTRUCTIONS, vars: {} })).text;
    out = await zeff.call("ai.json", { prompt: tastePrompt(cur, batch, profile, instructions), schema: TASTE_SCHEMA, task: "news-ext.taste", budget: 0.2 });
  } catch {
    out = null;
  }
  const next = out?.description && String(out.description).trim().length >= 20 ? out : fallbackTaste(cur, batch);
  return {
    taken: batch.length,
    taste: {
      ...cur,
      text: String(next.description ?? cur.text).trim().slice(0, 1200),
      likes: clean(next.likes, 12),
      avoids: clean(next.avoids, 8),
      queries: clean(next.queries, 6),
      updatedAt: new Date().toISOString(),
      // The batch is taken in; signals that came meanwhile stay queued.
      pending: cur.pending.filter((p) => !batch.some((b) => b.id === p.id && b.kind === p.kind)),
      edited: false,
    },
  };
}
