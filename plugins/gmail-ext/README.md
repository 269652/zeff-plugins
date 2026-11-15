# Gmail

Reads your Gmail accounts' latest mails into Zeff — through Gmail's API or Gmail in the account's automation Chrome, as the Connections page says; none marked read. With Gmail's write access, replies are sent from Zeff on your click.

- **A sync of the Sync menu.** The package brings one flow, `gmail.sync`, marked as a sync in the place of the built-in's step:
  run it there, see how it last went, set how often on the Sync settings page. By itself it runs only between 8 and 19 o'clock.
- **The reading is Zeff's.** Reading Gmail is a driver of Zeff's kernel; the flow calls it through `connector.sync`, which needs the
  flow's permission `sync: gmail` — you allow it when you switch.
- **Everything else stays.** Replies from Zeff, the inbox, the chats and the todos found in them keep working.
- **Generated** by Zeff's `scripts/port-connectors.mts`.

**Switching:** Plugins → Gmail (built-in) → *Switch to the plugin*.
