# Mail & Chat

Zeff's mail client as a plugin: your mails as a mail client, your chats as a chat, and one inbox across all channels. You read a
conversation, reply or let the AI draft one, snooze a thread, archive it, and make new inboxes (Unread, From people, Important …).

- **Its screens are view language alone.** `views/mail.html`, `views/chat.html` and `views/inbox.html` are the built-in's own
  templates with every part made of tags. Zeff shows their words in your language.
- **What the lists show is worked out in your browser.** `compute.js` is the built-in's view code (`view-data.ts`), bundled. It runs in
  a sandboxed frame without network and without access to Zeff. It sees only the rows, fields and state the view hands it.
- **Zeff's kernel does what leaves Zeff.** The buttons call the kernel's actions as you: `mail.thread`, `row.reply.draft`, `row.op`
  (a reply sent, kept as a draft, or opened in Outlook), `mail.archive`, `mail.mark-read`, `rows.set` (snooze), `mail.new-inbox`.
  Sending asks first. A view can do only reading and marking read by itself; everything else takes your click.
- **Generated.** `compute.js`, the views and `zeff-plugin.json` come from Zeff's `scripts/port-mail-client.mts`. Change the
  built-in in Zeff and generate them again.

**Switching:** Plugins → Mail & Chat (built-in) → *Switch to the plugin*. Your Mail, Chats and Inbox views get the port's screens
(views you changed keep your changes). Your mails, chats, inboxes and settings stay as they are.
