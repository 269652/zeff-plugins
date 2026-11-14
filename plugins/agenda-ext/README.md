# Agenda

Zeff's Agenda as a plugin: notes on a timeline, in projects, like the app Agenda. A note has a date or a range, can be put on the
agenda, pinned and marked done, has tags and people; its text, checklists, tables and pictures are its page.

- **A package.** `agenda.package.json` (New → from a template → Agenda) holds the projects, the notes and three example notes. It is
  made in your language when installed: the field names, choices and views. It is generated from the built-in Agenda's template by
  Zeff's `scripts/port-agenda.mts`; change the template in Zeff and generate it again.
- **Its screen is view language alone.** The same timeline, sidebar, filters and panes as the built-in. The sidebar's projects and
  today's events come from the lambda `agenda.data` (read-only), and the new-note form is a dialog whose *Save* runs the flow
  `agenda.add-note`. That flow may write only the package's own notes; you allow it when you install the package.
