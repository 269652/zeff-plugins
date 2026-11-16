import { FOLDER_MIME, folderInfo, listFolder } from "./lib.mjs";

/** The folders in a folder of your Drive ("root": My Drive) — to choose from — with where you are ("My Drive → Kontoauszug") and the way up. */
export async function handler(event, context) {
  const parent = String(event?.parent || "root");
  const folders = (await listFolder(context, parent)).filter((f) => f.mimeType === FOLDER_MIME).map((f) => ({ id: f.id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name));
  // Where this folder is: the names up to My Drive (a few steps at most).
  const names = [];
  let up = "";
  let id = parent;
  for (let i = 0; id !== "root" && i < 8; i++) {
    const info = await folderInfo(context, id);
    names.unshift(info.name);
    if (i === 0) up = info.parents?.[0] ?? "root";
    id = info.parents?.[0] ?? "root";
  }
  return { id: parent, path: ["My Drive", ...names].join(" → "), up, folders };
}
