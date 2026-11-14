# Teams

Reads your Teams mentions and 1:1 messages into Zeff — the inbox, the chats, the todos found in them. Through Teams' API or the account's automation Chrome, as the Connections page says. Replies are sent from Zeff on your click.

- **A sync of the Sync menu.** The package brings one flow, `teams.sync`, marked as a sync in the place of the built-in's step:
  run it there, see how it last went, set how often on the Sync settings page. By itself it runs only between 8 and 19 o'clock.
- **The reading is Zeff's.** Reading Teams is a driver of Zeff's kernel; the flow calls it through `connector.sync`, which needs the
  flow's permission `sync: teams` — you allow it when you switch.
- **Everything else stays.** Replies from Zeff, the inbox, the chats and the todos found in them keep working.
- **Generated** by Zeff's `scripts/port-connectors.mts`.

**Switching:** Plugins → Teams (built-in) → *Switch to the plugin*.
