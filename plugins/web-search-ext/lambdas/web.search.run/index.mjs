/**
 * A web search: through an official API with your key (Brave Search, or Google Programmable Search — Google takes no new customers and
 * ends it on 2027-01-01), else through the web search of your Claude login (Zeff's `ai.websearch`, no key or card). Never by scraping.
 * Only http(s) hits.
 * @param {{ query: string, count?: number, site?: string, language?: string }} event
 * @param {{ secrets: Record<string, string>, zeff: { call: (name: string, input?: object) => Promise<any> } }} context
 */
export async function handler(event, context) {
  const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const web = (u) => {
    try {
      const url = new URL(String(u));
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  };
  const count = Math.min(10, Math.max(1, Math.round(Number(event.count) || 5)));
  const q = [String(event.query ?? "").trim(), event.site ? `site:${String(event.site).trim()}` : ""].filter(Boolean).join(" ");
  if (!q) throw new Error("A search needs words.");
  const s = context.secrets;
  // (Google chosen without its key and engine id: it was never set up — Brave then, as the built-in did.)
  const provider = s.PROVIDER === "google" && s.GOOGLE_KEY && s.GOOGLE_CX ? "google" : "brave";
  const ready = provider === "brave" ? !!s.BRAVE_KEY : true;
  if (!ready) {
    try {
      return await context.zeff.call("ai.websearch", { query: q, count, ...(event.language ? { language: event.language } : {}) });
    } catch (e) {
      throw new Error(/Claude CLI/.test(String(e?.message ?? e)) ? "Web search needs the Claude CLI, signed in, or a Brave Search API key in the Web search plugin's settings." : String(e?.message ?? e));
    }
  }
  if (provider === "brave") {
    const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, count: String(count), ...(event.language ? { search_lang: event.language } : {}) })}`;
    const r = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": s.BRAVE_KEY } });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`Brave Search: ${data?.error?.message ?? r.status}`);
    return { hits: (data?.web?.results ?? []).flatMap((x) => (web(x.url) ? [{ title: clean(x.title, 200), url: web(x.url), snippet: clean(x.description, 500) }] : [])) };
  }
  const url = `https://www.googleapis.com/customsearch/v1?${new URLSearchParams({ key: s.GOOGLE_KEY, cx: s.GOOGLE_CX, q, num: String(count), ...(event.language ? { lr: `lang_${event.language}` } : {}) })}`;
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Google search: ${data?.error?.message ?? r.status}`);
  return { hits: (data?.items ?? []).flatMap((x) => (web(x.link) ? [{ title: clean(x.title, 200), url: web(x.link), snippet: clean(x.snippet, 500) }] : [])) };
}
