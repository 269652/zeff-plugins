import { ANSWER_INSTRUCTIONS, PLAN_INSTRUCTIONS } from "./lib.mjs";

/**
 * Structured questions: a question about numbers and dates answered from Zeff's own data. One AI call routes and plans at once — text (the knowledge's
 * answer) or structured, with up to three queries over the named views as JSON; the kernel checks and runs them (data.query: a plan that fails goes back
 * once with what was wrong), a second AI call phrases the answer from the numbers, citing the rows behind them. The built-in's askStructured
 * (src/plugins/questions/ask.ts) over the kernel's views. event: { question, history: [{ role, text }], via: chat | mcp }.
 * Returns { kind: "text", why } or { kind: "structured", answer: { answer, sources, queries, model, durationMs } }.
 */
const LANGUAGE = { de: "Deutsch", en: "Englisch", es: "Spanisch" };

const describeView = (v, timeDims) => {
  const filters = Object.entries(v.filters).map(([k, f]) => `${k} (${f.type}${f.values ? `: ${f.values.join("|")}` : ""}${f.required ? ", Pflicht" : ""}) — ${f.description}`);
  const measures = Object.entries(v.measures).map(([k, d]) => `${k} — ${d}`);
  return [
    `### ${v.name}`,
    v.description,
    `Filter: ${filters.join("; ") || "keine"}`,
    v.dynamic ? `Gruppierungen: die Eigenschaften der Datenbank, ${timeDims.join(", ")}` : `Gruppierungen: ${[...v.dims, ...timeDims].join(", ")}`,
    v.dynamic ? "Maße: ihre Zahl-Eigenschaften" : `Maße: ${measures.join("; ") || "keine (nur zählen)"}`,
  ].join("\n");
};

const planSchema = (aggregates) => ({
  type: "object",
  properties: {
    kind: { type: "string", enum: ["structured", "text"] },
    why: { type: "string", description: "Ein kurzer Satz, warum." },
    queries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          view: { type: "string" },
          aggregate: { type: "string", enum: aggregates },
          groupBy: { type: "string" },
          measure: { type: "string" },
          order: { type: "string", enum: ["desc", "asc"] },
          limit: { type: "integer" },
          filters: {
            type: "array",
            items: { type: "object", properties: { name: { type: "string" }, value: { type: "string" }, values: { type: "array", items: { type: "string" } }, prop: { type: "string" }, op: { type: "string" } }, required: ["name"] },
          },
        },
        required: ["view", "aggregate"],
      },
    },
  },
  required: ["kind", "queries"],
});

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "Die Antwort, knapp; Belege als [1], [2] im Text." },
    cites: { type: "array", items: { type: "integer" }, description: "Die Nummern der Einträge, die du benutzt hast." },
  },
  required: ["answer", "cites"],
};

/** The results as the phrasing reads them: each query, its total and groups, its rows numbered across all queries. */
const resultsBlock = (results, numbered) =>
  results
    .map((r, i) => {
      const rows = numbered.filter((s) => r.rows.includes(s.row));
      const groups = r.groups.slice(0, 25).map((g) => `- ${g.key}: ${g.value ?? "—"} (${g.count} Einträge)`);
      return [
        `### Abfrage ${i + 1}: ${r.explain}`,
        `Gesamt: ${r.query.aggregate}${r.query.measure ? `(${r.query.measure})` : ""} = ${r.total.value ?? "—"} über ${r.total.count} Einträge`,
        ...(groups.length ? [`Gruppen (${r.groupsTotal}${r.groupsTotal > groups.length ? `, die ersten ${groups.length}` : ""}):`, ...groups] : []),
        ...(rows.length ? ["Einträge:", ...rows.map((s) => `[${s.n}] ${s.row.at.slice(0, 16).replace("T", " ")} · ${s.row.title}${s.row.value !== undefined ? ` · ${s.row.value}` : ""}`)] : ["Keine Einträge."]),
      ].join("\n");
    })
    .join("\n\n");

export async function handler(event, context) {
  const zeff = context.zeff;
  const via = event?.via === "mcp" ? "mcp" : "chat";
  const question = String(event?.question ?? "");
  const history = Array.isArray(event?.history) ? event.history : [];
  const started = Date.now();
  const info = await zeff.call("data.views", { via });
  const planText = (await zeff.call("prompts.fill", { key: "questions-plan", template: PLAN_INSTRUCTIONS, vars: {} })).text;
  const answerText = (await zeff.call("prompts.fill", { key: "questions-answer", template: ANSWER_INSTRUCTIONS, vars: {} })).text;
  const schema = planSchema(info.aggregates);

  const planPrompt = (retry) =>
    [
      planText,
      "",
      `Heute ist ${info.today}.`,
      "",
      "## Sichten",
      ...info.views.map((v) => describeView(v, info.timeDims)),
      ...(info.databases.length ? ["", "## Datenbanken des Workspace (für die Sicht workspace)", ...info.databases.map((d) => `- ${d.id} „${d.title}“: ${d.props}`)] : []),
      ...(history.length ? ["", "## Gespräch bisher", ...history.slice(-6).map((h) => `${h.role === "assistant" ? "Antwort" : "Frage"}: ${String(h.text).slice(0, 600)}`)] : []),
      "",
      `## Frage\n${question}`,
      ...(retry ? ["", `## Dein letzter Plan ging nicht\n${retry}\nKorrigiere ihn mit den erlaubten Namen.`] : []),
    ].join("\n");
  const plan = (prompt) => zeff.call("ai.json", { prompt, schema, task: "questions-ext.structured", budget: 0.2 });

  let p = await plan(planPrompt());
  if (p.kind !== "structured") return { kind: "text", why: p.why };
  let ran = await zeff.call("data.query", { queries: p.queries ?? [], via });
  if (!ran.ok) {
    // A plan that failed goes back once with what was wrong.
    p = await plan(planPrompt(ran.error));
    if (p.kind !== "structured") return { kind: "text", why: p.why };
    ran = await zeff.call("data.query", { queries: p.queries ?? [], via });
  }
  if (!ran.ok) return { kind: "text", why: ran.error };

  const results = ran.results;
  let n = 0;
  const numbered = results.flatMap((r) => r.rows.map((row) => ({ n: ++n, row, view: r.query.view })));
  const lang = LANGUAGE[context.language] ?? "Deutsch";
  const raw = await zeff.call("ai.json", { prompt: [answerText, `Antworte auf ${lang}.`, "", `Frage: ${question}`, "", resultsBlock(results, numbered)].join("\n"), schema: ANSWER_SCHEMA, task: "questions-ext.structured", budget: 0.2 });
  const answer = String(raw.answer ?? "").slice(0, 4000);
  const cited = new Set([...(raw.cites ?? []).map(Number), ...[...answer.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]))]);
  const sources = numbered.filter((s) => cited.has(s.n)).map((s) => ({ n: s.n, title: s.row.title, url: s.row.href ?? "", heading: `${s.view} · ${s.row.at.slice(0, 10)}`, excerpt: s.row.value !== undefined ? String(s.row.value) : "" }));
  return { kind: "structured", answer: { answer, sources, queries: results, model: null, durationMs: Date.now() - started } };
}
