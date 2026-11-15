# GitLab (gitlab-ext)

Reads your GitLab merge requests, their comments and your branches into Zeff — through GitLab in the account's automation Chrome. Replies, merges, opened merge requests and resolved threads go through the same scraper. Its scraper is a lambda you (or the AI) can mend when GitLab changes. (Connected through GitLab's API with a token or sign-in? That reading is still Zeff's — switch only when it is the automation Chrome.)

- **The scraper** is the driver lambda `gitlab.driver` — the built-in's own files (`driver.mjs`, `adapter.mjs`, `contract.json`),
  Zeff's generic automation kit imported by name (`zeff:chrome`, `zeff:automation/…`). A lambda of kind *driver*: it runs with the
  account's automation Chrome / the app on this computer, outside the sandbox (this plugin asks for `exec`). **When the app changes and
  the sync breaks**, mend it in the Studio (Lambdas → gitlab.driver) — you or the AI; the fix is kept in Zeff's database.
- **The sync** is the flow `gitlab.sync` — a step of the Sync menu in the built-in's place: the scraper's `read`, the messages kept with
  the kernel's `messages.save` (the inbox, the chats, the todos found in them read them as before). Its permissions: `sync: gitlab`,
  `driver: gitlab.driver` — allowed when you switch.
- **Replies, a chat's history** go through the same scraper while this plugin is on.
- **Generated** by Zeff's `scripts/port-drivers.mts`.

**Switching:** Plugins → GitLab (built-in) → *Switch to the plugin*.
