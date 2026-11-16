import { CONN, SCOPE_FULL, flag, folderNameOf, rows } from "./lib.mjs";

/**
 * What the Google Drive page shows besides the sign-in: what syncs and how (the plugin's settings), the folders chosen to read, what Zeff
 * has in Drive (the files it recorded), whether the access needs to be asked for again.
 */
export async function handler(_event, context) {
  const { zeff } = context;
  const status = await zeff.call("oauth.status", { connection: CONN });
  const files = await rows(zeff, "files");
  const pullFolders = (await rows(zeff, "pullfolders")).map((f) => ({ id: f.id, path: f.path })).sort((a, b) => a.path.localeCompare(b.path));
  const pull = flag(context, "pullDocuments", false);
  const fullAccess = status.scopes.includes(SCOPE_FULL);
  return {
    connected: status.connected,
    email: status.email,
    fullAccess,
    needsReconnect: status.connected && (pull || pullFolders.length > 0) && !fullAccess,
    folderName: String(context.secrets.folderName ?? "").trim(),
    folder: folderNameOf(context),
    mirrorBackupRetention: flag(context, "mirrorBackupRetention", true),
    uploadUnencrypted: flag(context, "uploadUnencrypted", false),
    pullDocuments: pull,
    pullFolders,
    backupsInDrive: files.filter((r) => r.kind === "backup").length,
    documentsInDrive: files.filter((r) => r.kind === "document" && r.key !== "skipped").length,
    // (the way to sign in that reads the files you add yourself, when that is wanted — else only Zeff's own files)
    connectWith: pull || pullFolders.length > 0 ? "full" : "",
  };
}
