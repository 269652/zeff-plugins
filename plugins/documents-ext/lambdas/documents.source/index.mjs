import { stamp, tFor } from "./lib.mjs";

/**
 * The documents as a source of the Workspace's pipelines — the document inbox databases: one record per document, with what is known of it (kind, state, when it was
 * added, size, unread, compiled, where it came from, its concepts) and its abstract and text. "Unread" is the field an inbox is made of: a document is unread until you
 * open its file, tick the box off in a row or mark it (the flow documents.pull takes that box back). The built-in's documentRecords
 * (src/plugins/documents/workspace-source.ts). Returns the records.
 */
export async function handler(_event, context) {
  const z = context.zeff;
  const t = tFor(context.language);
  const { rows } = await z.call("sql.query", {
    sql: "select d.id, d.name, d.kind, d.status, d.size, d.compiled, d.summary, d.concepts, d.created_at, substr(d.text, 1, 6000) as head, (s.doc_id is null) as unread from documents d left join document_seen s on s.doc_id = d.id order by d.created_at desc",
    limit: 5000,
  });
  let origins = {};
  try {
    origins = (await z.call("documents.origins", { ids: rows.map((r) => r.id) })).origins ?? {};
  } catch {
    origins = {};
  }
  return rows.map((d) => {
    const o = origins[d.id];
    const from = o ? `${o.from}${o.subject ? ` — ${o.subject}` : ""}`.trim() : "";
    const concepts = String(d.concepts ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const unread = !!d.unread;
    return {
      ref: `doc:${d.id}`,
      title: d.name,
      text: [d.summary ? `## ${t("Abstract")}\n${d.summary}` : "", concepts.length ? `${t("Concepts")}: ${concepts.join(", ")}` : "", d.head ?? ""].filter(Boolean).join("\n\n"),
      // What the row remembers: another stamp means the document changed since (an edit of the row is then not applied).
      updatedAt: stamp([d.status, !!d.compiled, d.name, unread]),
      dataType: "documents",
      typed: [
        { id: "dockind", name: "Kind", type: "text", value: d.kind },
        { id: "docstatus", name: "Status", type: "text", value: d.status },
        { id: "docadded", name: "Added", type: "date", value: String(d.created_at).slice(0, 16) },
        { id: "docsize", name: "Size (KB)", type: "number", value: Math.max(1, Math.round(d.size / 1024)) },
        { id: "docunread", name: "Unread", type: "checkbox", value: unread || null },
        { id: "doccompiled", name: "Compiled", type: "checkbox", value: !!d.compiled || null },
        { id: "docfrom", name: "From", type: "text", value: from },
        { id: "docconcepts", name: "Concepts", type: "text", value: concepts.join(", ") },
      ],
    };
  });
}
