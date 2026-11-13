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
