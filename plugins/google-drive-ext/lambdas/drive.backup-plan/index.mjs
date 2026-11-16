import { CONN, flag, rows } from "./lib.mjs";

/**
 * Backups → Drive, what to do (the built-in's syncBackups, planned): the backup files not recorded as in Drive yet go up — unencrypted
 * ones stay home unless allowed —, and (when set, and never when the folder looks empty: a missing disk) what the local retention removed
 * goes from Drive too, only files Zeff recorded as its own. The flow does it: this only reads.
 */
export async function handler(_event, context) {
  const { zeff } = context;
  const mirror = flag(context, "mirrorBackupRetention", true);
  const unencrypted = flag(context, "uploadUnencrypted", false);
  const local = (await zeff.call("backup.files", {})).files;
  const status = await zeff.call("oauth.status", { connection: CONN });
  if (!status.connected) throw new Error("Google Drive isn't connected — connect it on its page.");
  const state = (await rows(zeff, "state")).find((r) => r.id === "main") ?? {};
  // (another Google account than the one the files were recorded for: nothing of it is in this Drive — the flow clears it)
  const reset = !!(state.email && status.email && state.email !== status.email);
  const known = reset ? [] : (await rows(zeff, "files")).filter((r) => r.kind === "backup");
  const knownKeys = new Set(known.map((r) => r.key));
  const toSend = local.filter((f) => !knownKeys.has(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  const uploads = [];
  let withheld = 0;
  for (const f of toSend) {
    // A backup without a password is the whole database in the clear: not off to Google unless you said so.
    if (!unencrypted && f.encrypted !== true) withheld++;
    else uploads.push({ name: f.name, size: f.size });
  }
  const names = new Set(local.map((f) => f.name));
  const removes = mirror && local.length ? known.filter((r) => !names.has(r.key)).map((r) => ({ driveId: r.drive_id, key: r.key })) : [];
  return { needsFolder: toSend.length > 0 || known.length > 0 || reset, reset, uploads, withheld, removes, at: new Date().toISOString() };
}
