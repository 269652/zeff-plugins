/** What the knowledge read about your income off your statements — for the flow to keep as the preference the income reads (cases.incomeFacts). A knowledge server not answering: ok false, what was kept stays. */
export async function handler(event, context) {
  let facts;
  try {
    facts = (await context.zeff.call("knowledge.profile", { key: "net_income" })).facts;
  } catch {
    return { ok: false, facts: [] };
  }
  return { ok: true, facts: facts.filter((f) => f.key === "net_income").map((f) => ({ period: f.period, amount: f.amount, text: f.text, pageTitle: f.pageTitle })) };
}
