# Signal (signal-ext)

Reads your Signal chats' messages into Zeff from Signal Desktop on this computer — no chat opened, nothing marked read. Replies, a chat's history and the sign-in go through the same scraper. Its scraper is a lambda you (or the AI) can mend when Signal Desktop changes.

- **The scraper** is the driver lambda `signal.driver` — the built-in's own files (`driver.mjs`, `adapter.mjs`, `contract.json`),
  Zeff's generic automation kit imported by name (`zeff:chrome`, `zeff:automation/…`). A lambda of kind *driver*: it runs with the
  account's automation Chrome / the app on this computer, outside the sandbox (this plugin asks for `exec`). **When the app changes and
  the sync breaks**, mend it in the Studio (Lambdas → signal.driver) — you or the AI; the fix is kept in Zeff's database.
- **The sync** is the flow `signal.sync` — a step of the Sync menu in the built-in's place: the scraper's `read`, the messages kept with
  the kernel's `messages.save` (the inbox, the chats, the todos found in them read them as before). Its permissions: `sync: signal`,
  `driver: signal.driver` — allowed when you switch.
- **Replies, a chat's history, the sign-in** go through the same scraper while this plugin is on.
- **Generated** by Zeff's `scripts/port-drivers.mts`.

**Switching:** Plugins → Signal (built-in) → *Switch to the plugin*.
