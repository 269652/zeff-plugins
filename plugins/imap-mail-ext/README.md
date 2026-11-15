# E-Mail (IMAP / POP3)

Reads your mail accounts (IMAP / POP3) into Zeff — each under its name, from its own server; none marked read. Replies are sent over the account's SMTP server on your click.

- **A sync of the Sync menu.** The package brings one flow, `imap-mail.sync`, marked as a sync in the place of the built-in's step:
  run it there, see how it last went, set how often on the Sync settings page. By itself it runs only between 8 and 19 o'clock.
- **The reading is Zeff's.** Reading E-Mail (IMAP / POP3) is a driver of Zeff's kernel; the flow calls it through `connector.sync`, which needs the
  flow's permission `sync: imap-mail` — you allow it when you switch.
- **Everything else stays.** Replies from Zeff, the inbox, the chats and the todos found in them keep working.
- **Generated** by Zeff's `scripts/port-connectors.mts`.

**Switching:** Plugins → E-Mail (IMAP / POP3) (built-in) → *Switch to the plugin*.
