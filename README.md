# zeff-plugins

Zeff's plugins, each in its own folder under `plugins/` with a `zeff-plugin.json` (its id and version) — the runtime format Zeff
loads without a rebuild (see Zeff's `docs/plugins/`).

A Zeff installs them from here through its `packages.json` (in its data folder):

```json
{
  "sources": { "zeff-plugins": { "url": "../zeff-plugins", "branch": "main" } },
  "plugins": { "learn-ext": { "source": "zeff-plugins", "path": "plugins/learn" } }
}
```

- A running Zeff follows `packages.json` when it changes: what it lists is installed, or reinstalled from the place it names.
- Every half hour it looks for newer versions here and shows an update note with the commits since your version.
- Updating merges the new version with what was changed in that Zeff, file by file, the way git does; where both changed the same
  lines it asks — keep yours, take the new one, let the AI merge, or write it yourself.

Publishing a new version: change the plugin, raise `version` in its `zeff-plugin.json`, commit. A commit without a new version number is
offered as an update too (same version, other commit).

## The catalog (`catalog.json`)

`catalog.json` at the top lists every plugin of this repository — what it is (name, version, description, keywords, category, icon), what it
asks for (permissions), needs and adds (apps, pages, databases, flows, syncs, views, widgets, drivers, tools …), its folder, a content hash,
whether it is signed, its size and the start of its README. A Zeff reads this one file to list the plugins (**Plugins → Browse**, and the
header's search) instead of every `zeff-plugin.json` one by one; installing still downloads exactly the plugin's folder and checks it.

It is generated — never edit it by hand:

```
node scripts/catalog.mjs            # writes catalog.json
node scripts/catalog.mjs --check    # fails when catalog.json is out of date (run it before you commit)
```

After changing a plugin (a new version, new keywords …) run the script and commit `catalog.json` with the change. A Zeff whose source has
no catalog, or one out of date, still works: it reads the manifests itself (slower) and says the catalog is stale.

The fields a plugin sets for the catalog, in its `zeff-plugin.json` (all optional, see Zeff's `docs/plugins/manifest.md`):

| Field | What |
| --- | --- |
| `keywords` | Up to 20 words the search finds it by. |
| `category` | One of `app`, `connector`, `communication`, `ai`, `time`, `finance`, `knowledge`, `language`, `developer`, `system`. |
| `icon` | An emoji, or the path of a small image (png, svg, jpg, webp, up to 32 kB) in the folder. |
| `screenshots` | Up to 8 paths of images in the folder, shown in the plugin's details. |
| `homepage` | A web address about it. |
| `requires.plugins` | The ids of other plugins it needs. |
