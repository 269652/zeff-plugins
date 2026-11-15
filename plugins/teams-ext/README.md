# Teams (teams-ext)

Reads your Teams mentions and 1:1 messages into Zeff from Teams in the account's automation Chrome — its own cache, read-only. Replies are sent through the same scraper. Its scraper is a lambda you (or the AI) can mend when Teams changes. (Reading Teams through Microsoft's API with your sign-in is still Zeff's — switch only when it is the automation Chrome.)

- **The scraper** is the driver lambda `teams.driver` — the built-in's own files (`driver.mjs`, `adapter.mjs`, `contract.json`),
  Zeff's generic automation kit imported by name (`zeff:chrome`, `zeff:automation/…`). A lambda of kind *driver*: it runs with the
  account's automation Chrome / the app on this computer, outside the sandbox (this plugin asks for `exec`). **When the app changes and
  the sync breaks**, mend it in the Studio (Lambdas → teams.driver) — you or the AI; the fix is kept in Zeff's database.
- **The sync** is the flow `teams.sync` — a step of the Sync menu in the built-in's place: the scraper's `read`, the messages kept with
  the kernel's `messages.save` (the inbox, the chats, the todos found in them read them as before). Its permissions: `sync: teams`,
  `driver: teams.driver` — allowed when you switch.
- **Replies, a chat's history** go through the same scraper while this plugin is on.
- **Generated** by Zeff's `scripts/port-drivers.mts`.

**Switching:** Plugins → Teams (built-in) → *Switch to the plugin*.
