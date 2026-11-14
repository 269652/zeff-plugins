# Signal

Reads your Signal chats' latest messages into Zeff from Signal Desktop on this computer — no chat opened, nothing marked read. Replies are sent from Zeff on your click.

- **A sync of the Sync menu.** The package brings one flow, `signal.sync`, marked as a sync in the place of the built-in's step:
  run it there, see how it last went, set how often on the Sync settings page. By itself it runs only between 8 and 19 o'clock.
- **The reading is Zeff's.** Reading Signal is a driver of Zeff's kernel; the flow calls it through `connector.sync`, which needs the
  flow's permission `sync: signal` — you allow it when you switch.
- **Everything else stays.** Replies from Zeff, the inbox, the chats and the todos found in them keep working.
- **Generated** by Zeff's `scripts/port-connectors.mts`.

**Switching:** Plugins → Signal (built-in) → *Switch to the plugin*.
