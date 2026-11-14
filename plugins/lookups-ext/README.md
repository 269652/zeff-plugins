# Lookups

Zeff's Lookups as a plugin: search fields for your own Workspace views (`<lookup>`). Type a title, pick a suggestion, and its data
becomes a row: films and series (TMDB, Wikidata, TVmaze), books (Open Library, Google Books), Wikipedia articles, Google's Knowledge
Graph and web results.

- **Lambdas, no Notebook needed.** Each source is a lambda in `lambdas/`: a Node process of its own that may read only its folder and
  reach only the domains its `lambda.json` names. You can read and change each one in the Studio; a change of yours wins over the
  plugin's until you reset it.
- **Keys.** TMDB and Google keys go into the plugin's settings (Plugins page → its card → ⚙️ Settings). They are kept encrypted and
  never shown again, and only this plugin's lambdas get them (as `TMDB_KEY` / `GOOGLE_KEY`). A Studio secret of the same name works too.
- What you type goes to the service you search. Pictures stay linked, not copied.
