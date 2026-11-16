/** The conversation kept so far (Zeff's AI memo "knowledge-chat"): the turns the page shows. Returns { turns }. */
export async function handler(event, context) {
  const kept = await context.zeff.call("ai.memo-get", { scope: "knowledge-chat", ref: "main" });
  return { turns: kept.found && Array.isArray(kept.value) ? kept.value : [] };
}
