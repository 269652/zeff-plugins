import { CONN, findFolder, folderExists, folderNameOf, rows } from "./lib.mjs";

/**
 * Zeff's folder in Drive and its Backups or Documents folder inside: which of them are there (the ones the plugin knows still are, else
 * the ones found by name) and which have to be made — the flow makes them. Another account's Drive than before, or another folder name:
 * what was recorded doesn't apply (`reset`). The built-in's folderFor, in two parts: this reads, the flow writes.
 */
export async function handler(event, context) {
  const { zeff } = context;
  const kind = event?.kind === "backups" ? "backups" : "documents";
  const state = (await rows(zeff, "state")).find((r) => r.id === "main") ?? {};
  const email = (await zeff.call("oauth.status", { connection: CONN })).email;
  const name = folderNameOf(context);
  // (another Google account: its Drive has none of what was recorded; another name: made, or found, anew)
  const reset = !!(state.email && email && state.email !== email);
  const fresh = reset || (!!state.folder_name && state.folder_name !== name);
  const column = kind === "backups" ? "backups_id" : "documents_id";
  let rootId = fresh ? "" : state.root_id || "";
  let kindId = fresh ? "" : state[column] || "";
  const kindName = kind === "backups" ? "Backups" : "Documents";
  if (kindId && !(await folderExists(context, kindId))) kindId = "";
  if (!kindId) {
    if (rootId && !(await folderExists(context, rootId))) rootId = "";
    if (!rootId) rootId = await findFolder(context, name, null);
    if (rootId) kindId = await findFolder(context, kindName, rootId);
  }
  return { reset, rootId, rootName: name, kindId, kindName, email: email || state.email || "", folderName: name };
}
