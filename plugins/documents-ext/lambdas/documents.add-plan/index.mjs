import { kindOf, safeName, tFor } from "./lib.mjs";

/**
 * A file added by hand (dropped on the screen, chosen, or uploaded in a todo's attach panel): what the built-in's addDocument (src/plugins/documents/store.ts)
 * does with it, as statements for the flow — the same content as a document kept already gives that one back (nothing doubled), else a new document waits to be
 * read. event: { name, mime, sha256, size, file (as files.take kept it), now }. Returns { fresh, id (of the document kept already), statements, name, message }.
 */
export async function handler(event, context) {
  const z = context.zeff;
  const t = tFor(context.language);
  const { sha256, size, file } = event;
  const now = String(event?.now ?? new Date().toISOString());
  const name = safeName(String(event?.name ?? "document"));
  const had = (await z.call("sql.query", { sql: "select id from documents where sha256 = ?", params: [sha256], limit: 1 })).rows[0];
  if (had) return { fresh: false, id: had.id, statements: [], name, message: t("Already there.") };
  return {
    fresh: true,
    id: 0,
    name,
    message: t("{n} added — being read.", { n: 1 }),
    statements: [
      {
        sql: "insert into documents (name, mime, size, sha256, kind, status, error, file, text, summary, concepts, compiled, created_at, updated_at) values (?, ?, ?, ?, ?, 'queued', '', ?, '', '', '', 0, ?, ?)",
        params: [name, String(event?.mime ?? "").slice(0, 100), size, sha256, kindOf(name, String(event?.mime ?? "")), file, now, now],
      },
    ],
  };
}
