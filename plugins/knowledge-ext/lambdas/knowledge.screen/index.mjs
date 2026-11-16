/**
 * What the Knowledge page shows beside the chat: the knowledge server's state — pages, spaces, entities, relations, how many aren't compiled yet, the
 * Confluence it reads, the last run and whether it is running now. The built-in's page (src/app/knowledge/page.tsx) over the kernel's `service.read`
 * (the account's knowledge server, or the address in this plugin's settings). Returns { ok, error?, counts, notCompiled, confluence, last, busy }.
 */
export async function handler(event, context) {
  let status;
  try {
    status = await context.zeff.call("service.read", { service: "knowledge", path: "/api/status", timeoutMs: 3000 });
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
  const c = status.counts ?? {};
  const run = (status.runs ?? [])[0];
  const busy = !!(status.running?.sync || status.running?.compile);
  const at = (v) => {
    const d = new Date(String(v).includes("T") ? v : `${v}Z`);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(context.language || "en");
  };
  return {
    ok: true,
    counts: [
      { label: "Pages", n: c.pages ?? 0 },
      { label: "Spaces", n: c.spaces ?? 0 },
      { label: "Entities", n: c.entities ?? 0 },
      { label: "Relations", n: c.relations ?? 0 },
    ],
    notCompiled: (c.compiled ?? 0) < (c.pages ?? 0) ? `${(c.pages ?? 0) - (c.compiled ?? 0)} not compiled yet` : "",
    confluence: status.confluence ?? "",
    last: run ? `${run.kind === "sync" ? "Last read" : "Last compiled"} ${at(run.started_at)}${run.ok === 0 ? " ✗" : ""}${busy ? " · running now" : ""}` : "",
    busy,
  };
}
