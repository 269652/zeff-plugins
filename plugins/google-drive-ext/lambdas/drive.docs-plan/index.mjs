import { CONN, EXPORTS, FOLDER_MIME, API, MAX_DOCUMENT_BYTES, PULL_MAX, SCOPE_FULL, flag, listFolder, rows, tFor } from "./lib.mjs";

/**
 * Documents ↔ Drive, what to do (the built-in's syncDocuments, planned): every document that isn't in Drive yet goes up; files you add to
 * Zeff's Documents folder (when set) and to the folders of yours you chose come in — each once, an edited one again, Google's own
 * documents as the Office file — when Zeff may see them (full access). Nothing is ever removed on one side because it went on the other.
 * The flow does it: this only reads.
 */
export async function handler(event, context) {
  const { zeff } = context;
  const t = tFor(context.language);
  const folderId = String(event?.folderId ?? "");
  const status = await zeff.call("oauth.status", { connection: CONN });
  if (!status.connected) throw new Error(t("Google Drive isn't connected — connect it on its page."));
  const known = (await rows(zeff, "files")).filter((r) => r.kind === "document");
  const byKey = new Set(known.map((r) => r.key));
  const byDrive = new Map(known.map((r) => [r.drive_id, r]));

  // Zeff → Drive: each document that isn't there yet.
  const uploads = (await zeff.call("documents.list", {})).docs
    .sort((a, b) => a.id - b.id)
    .filter((d) => !byKey.has(`doc:${d.id}`))
    .map((d) => ({ id: d.id, key: `doc:${d.id}`, name: d.name, mime: d.mime || "application/octet-stream", size: d.size }));

  // The folders you chose before (the built-in kept them as a preference): taken over once, then they are the plugin's.
  let pullFolders = (await rows(zeff, "pullfolders")).map((f) => ({ id: f.id, path: f.path }));
  let seedFolders = [];
  if (!pullFolders.length) {
    try {
      const { value } = await zeff.call("pref.get", { key: "googleDrive.pullFolders" });
      if (Array.isArray(value) && value.length) seedFolders = pullFolders = value.filter((f) => f && typeof f.id === "string").map((f) => ({ id: f.id, path: String(f.path ?? f.id) }));
    } catch {
      // (nothing to take over)
    }
  }

  // Drive → Zeff: what you added to Zeff's folder (when set) and to the folders of yours you chose — when Zeff may see it.
  const from = [...(flag(context, "pullDocuments", false) ? [folderId] : []), ...pullFolders.map((f) => f.id)].filter(Boolean);
  const pulls = [];
  const tooLarge = [];
  let failed = 0;
  let note = "";
  if (from.length && !status.scopes.includes(SCOPE_FULL)) note = t("Files you add in Drive can't be read with the access Zeff has — connect again to give it.");
  else {
    const seen = new Set();
    for (const id of from) {
      let files;
      try {
        files = await listFolder(context, id);
      } catch (e) {
        if (++failed === 1) note ||= e instanceof Error ? e.message : String(e);
        continue;
      }
      for (const f of files) {
        if (pulls.length >= PULL_MAX) break;
        if (f.mimeType === FOLDER_MIME || seen.has(f.id)) continue;
        const version = f.md5Checksum ?? f.modifiedTime ?? "";
        const had = byDrive.get(f.id);
        if (had && had.version === version) continue;
        const exp = EXPORTS[f.mimeType];
        if (f.mimeType.startsWith("application/vnd.google-apps.") && !exp) continue;
        seen.add(f.id);
        if (!exp && Number(f.size ?? 0) > MAX_DOCUMENT_BYTES) {
          // Remembered as it is (not tried again until it changes in Drive).
          tooLarge.push({ driveId: f.id, version, size: Number(f.size ?? 0) });
          if (++failed === 1) note ||= `${f.name}: ${t("“{name}” is too large (at most {n} MB).", { name: f.name, n: MAX_DOCUMENT_BYTES / 1024 / 1024 })}`;
          continue;
        }
        const name = exp && !f.name.toLowerCase().endsWith(exp.ext) ? `${f.name}${exp.ext}` : f.name;
        pulls.push({ driveId: f.id, name, version, mime: exp ? exp.mime : f.mimeType, url: exp ? `${API}/drive/v3/files/${encodeURIComponent(f.id)}/export?${new URLSearchParams({ mimeType: exp.mime })}` : `${API}/drive/v3/files/${encodeURIComponent(f.id)}?alt=media` });
      }
    }
  }
  return { uploads, pulls, tooLarge, seedFolders, failed, note, at: new Date().toISOString() };
}
