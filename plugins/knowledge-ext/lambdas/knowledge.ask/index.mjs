/**
 * A question to the knowledge, with the conversation so far: first the structured questions' chance (a question about numbers and dates in your own data is
 * answered from it — the kernel's `data.answer`, null for a text question or without that plugin), else the knowledge server's answer from the pages it
 * compiled, citing them. The built-in's askKnowledgeAction (src/plugins/knowledge/server-actions.ts). event: { question }. Returns { turns, at, error? } — the
 * whole conversation with this exchange added (the flow keeps it; a lambda only reads).
 */
const entityTip = (e) => [e.summary, ...(e.related ?? []).map((r) => (r.dir === "out" ? `→ ${r.rel} ${r.name}` : `← ${r.name} ${r.rel}`))].filter(Boolean).join("\n");

export async function handler(event, context) {
  const zeff = context.zeff;
  const question = String(event?.question ?? "").trim();
  if (!question) return { turns: [], error: "No question." };
  const kept = await zeff.call("ai.memo-get", { scope: "knowledge-chat", ref: "main" });
  const turns = kept.found && Array.isArray(kept.value) ? kept.value : [];
  const history = turns.slice(-8).map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", text: String(t.text ?? "").slice(0, 4000) }));
  let answer;
  try {
    // (without the structured questions plugin there is no such function: a text question for the knowledge)
    answer = (await zeff.call("data.answer", { question, history }).catch((e) => (/no Zeff function/.test(String(e?.message ?? e)) ? { answer: null } : Promise.reject(e)))).answer;
    if (!answer) answer = await zeff.call("service.read", { service: "knowledge", path: "/api/ask", body: { question, history }, timeoutMs: 360000 });
  } catch (e) {
    return { turns, error: String(e?.message ?? e) };
  }
  const reply = {
    role: "assistant",
    mine: false,
    text: String(answer.answer ?? ""),
    sources: (answer.sources ?? []).map((s) => ({ n: s.n, title: s.title, url: s.url || "", heading: s.heading || "" })),
    entities: (answer.entities ?? []).map((e) => ({ name: e.name, type: e.type, tip: entityTip(e) })),
    queries: (answer.structured?.queries ?? []).map((q) => ({
      explain: q.explain,
      total: String(q.total?.value ?? "—"),
      rows: q.total?.count ?? 0,
      groups: (q.groups ?? []).slice(0, 8).map((g) => ({ key: g.key, value: String(g.value ?? "—"), count: g.count })),
      more: (q.groupsTotal ?? 0) > 8 ? (q.groupsTotal ?? 0) - 8 : 0,
    })),
  };
  return { turns: [...turns, { role: "user", mine: true, text: question }, reply].slice(-30), at: new Date().toISOString() };
}
