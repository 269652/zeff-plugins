# Outlook Mail

Reads your Outlook inbox's latest mails into Zeff — through Microsoft's API or Outlook Web in the account's automation Chrome, as the Connections page says; none marked read. Replies open as drafts in Outlook.

- **A sync of the Sync menu.** The package brings one flow, `outlook-mail.sync`, marked as a sync in the place of the built-in's step:
  run it there, see how it last went, set how often on the Sync settings page. By itself it runs only between 8 and 19 o'clock.
- **The reading is Zeff's.** Reading Outlook Mail is a driver of Zeff's kernel; the flow calls it through `connector.sync`, which needs the
  flow's permission `sync: outlook-mail` — you allow it when you switch.
- **Everything else stays.** Replies from Zeff, the inbox, the chats and the todos found in them keep working.
- **Generated** by Zeff's `scripts/port-connectors.mts`.

**Switching:** Plugins → Outlook Mail (built-in) → *Switch to the plugin*.
