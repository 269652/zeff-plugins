# WhatsApp

Reads your WhatsApp chats' latest messages into Zeff from WhatsApp Web in the account's automation Chrome — no chat opened, nothing marked read. Replies are sent from Zeff on your click.

- **A sync of the Sync menu.** The package brings one flow, `whatsapp.sync`, marked as a sync in the place of the built-in's step:
  run it there, see how it last went, set how often on the Sync settings page. By itself it runs only between 8 and 19 o'clock.
- **The reading is Zeff's.** Reading WhatsApp is a driver of Zeff's kernel; the flow calls it through `connector.sync`, which needs the
  flow's permission `sync: whatsapp` — you allow it when you switch.
- **Everything else stays.** Replies from Zeff, the inbox, the chats and the todos found in them keep working.
- **Generated** by Zeff's `scripts/port-connectors.mts`.

**Switching:** Plugins → WhatsApp (built-in) → *Switch to the plugin*.
