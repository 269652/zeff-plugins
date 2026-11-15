# WhatsApp (whatsapp-ext)

Reads your WhatsApp chats' messages into Zeff from WhatsApp Web in the account's automation Chrome — no chat opened, nothing marked read. Replies and a chat's history go through the same scraper. Its scraper is a lambda you (or the AI) can mend when WhatsApp Web changes.

- **The scraper** is the driver lambda `whatsapp.driver` — the built-in's own files (`driver.mjs`, `adapter.mjs`, `contract.json`),
  Zeff's generic automation kit imported by name (`zeff:chrome`, `zeff:automation/…`). A lambda of kind *driver*: it runs with the
  account's automation Chrome / the app on this computer, outside the sandbox (this plugin asks for `exec`). **When the app changes and
  the sync breaks**, mend it in the Studio (Lambdas → whatsapp.driver) — you or the AI; the fix is kept in Zeff's database.
- **The sync** is the flow `whatsapp.sync` — a step of the Sync menu in the built-in's place: the scraper's `read`, the messages kept with
  the kernel's `messages.save` (the inbox, the chats, the todos found in them read them as before). Its permissions: `sync: whatsapp`,
  `driver: whatsapp.driver` — allowed when you switch.
- **Replies, a chat's history** go through the same scraper while this plugin is on.
- **Generated** by Zeff's `scripts/port-drivers.mts`.

**Switching:** Plugins → WhatsApp (built-in) → *Switch to the plugin*.
