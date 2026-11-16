import { baseName, crumbs, entryIcon, sizeText, tFor, viewKind } from "./lib.mjs";

/**
 * What the Explorer's screen shows (views/explorer.html reads it as data.x): a folder's entries (no path: This PC, the drives) ready to draw — icon, type, size,
 * date, whether it is in Documents —, the address bar's crumbs, the places, and what the folder actions are about (the folder picked, else the one we are in:
 * watched? live?). The kernel's reads fs.list and fs.places do the looking (the built-in Explorer's own); this works the rest out like ExplorerApp does.
 * event: { path, filter, picked } — picked is the JSON list of the ticked paths.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const when = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });
  const same = (a, b) => String(a).replace(/[\/]+$/, "").toLowerCase() === String(b).replace(/[\/]+$/, "").toLowerCase();

  let error = null;
  let listing;
  const path = String(event?.path ?? "").trim();
  try {
    listing = await zeff.call("fs.list", { path });
  } catch (e) {
    // The folder is gone (a drive pulled out): This PC, and why.
    error = String(e?.message ?? e);
    listing = await zeff.call("fs.list", {});
  }
  const places = await zeff.call("fs.places", {});
  const live = places.live ?? [];
  const isLive = (p) => live.some((l) => same(l, p));

  const q = String(event?.filter ?? "").trim().toLowerCase();
  let picked = [];
  try {
    const v = JSON.parse(String(event?.picked ?? "[]"));
    if (Array.isArray(v)) picked = v.map(String);
  } catch {
    picked = [];
  }
  const all = listing.entries;
  const shown = (q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all).map((e) => {
    const ext = e.dir || !e.name.includes(".") ? "" : e.name.slice(e.name.lastIndexOf(".") + 1);
    const kind = e.dir ? "" : viewKind(e.name);
    return {
      id: e.path,
      name: e.name,
      path: e.path,
      dir: e.dir,
      icon: entryIcon(e),
      live: e.dir && isLive(e.path),
      type: e.dir ? t("Folder") : kind === "none" ? (ext ? ext.toUpperCase() : t("File")) : ext.toUpperCase(),
      size: e.dir ? "" : sizeText(e.size),
      sizeBytes: e.dir ? -1 : e.size,
      date: e.mtime ? when.format(new Date(e.mtime)) : "",
      mtime: e.mtime,
      inDocs: e.docId !== null,
      docMark: e.docId === null ? "" : e.changed ? "🟡" : "✅",
      docTip: e.docId === null ? "" : e.changed ? t("In Documents — changed since") : t("In Documents"),
    };
  });

  // The folder the folder actions are about: the one picked, else the one we're in.
  const pickedEntries = all.filter((e) => picked.some((p) => same(p, e.path)));
  const pickedDir = pickedEntries.length === 1 && pickedEntries[0].dir ? pickedEntries[0] : null;
  const pickedFiles = pickedEntries.filter((e) => !e.dir).map((e) => e.path);
  const folder = pickedDir?.path ?? listing.path;
  const watchedPlace = pickedDir ? (places.watched.find((w) => same(w.path, pickedDir.path)) ?? null) : listing.watched;
  const watchedHere = !!(watchedPlace && folder && same(watchedPlace.path, folder));

  return {
    path: listing.path ?? "",
    parent: listing.parent ?? "",
    atPc: listing.path === null,
    crumbs: listing.path ? crumbs(listing.path) : [],
    entries: shown,
    count: all.length,
    nPicked: pickedEntries.length,
    pickedFiles: JSON.stringify(pickedFiles),
    nPickedFiles: pickedFiles.length,
    folder: folder ?? "",
    folderName: folder ? baseName(folder) : "",
    watched: watchedPlace ? { id: watchedPlace.id, path: watchedPlace.path, name: baseName(watchedPlace.path), mode: watchedPlace.mode, here: watchedHere, live: isLive(watchedPlace.path) } : null,
    cut: !!listing.cut,
    canOpen: !!places.canOpen,
    error,
    quick: places.quick,
    watchedPlaces: places.watched.map((w) => ({ ...w, live: isLive(w.path) })),
    drives: places.drives,
    labels: {
      empty: q ? t("Nothing here matches “{q}”.", { q }) : t("This folder is empty."),
      items: t("{n} items", { n: all.length }),
      picked: t("{n} picked", { n: picked.length }),
      cut: t("Only the first 5000 entries are shown."),
    },
  };
}
