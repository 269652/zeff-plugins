# zeff-plugins

**The official plugin collection for [Zeff](https://github.com/269652/Zeff)** — the local-first app that turns everything that reaches you
(mail, chats, tickets, calendars, documents, bank statements) into one todo list. In Zeff, nearly everything is a plugin; this repository
holds 39 of them: connectors for your mail, chats and tickets, apps such as time tracking, finances, cases and news, and language packs.

## Install a plugin

In Zeff, open **Menu → Plugins → Browse**. This repository is already listed there — search, read a plugin's README, see what it asks
for, and press **Install**. No download, no restart. Updates show up behind the bell in the header, with what changed, and are merged with
whatever you changed yourself.

## What is here

### Apps

| Plugin | What it does | Version |
| --- | --- | --- |
| 📒 [**Agenda**](plugins/agenda-ext) | Notes on a timeline, in projects, as in the app Agenda: a date or a range, on the agenda, pinned, done, tags and people; its text is the note's page. | 1.0.0 |
| 📅 [**Calendar**](plugins/calendar-ext) | One calendar for everything: your own calendars and those of your sources in one page (day, week, month, agenda), appointments made and moved, proposals accepted, todos made from appointments and matched to them. | 0.1.0 |
| 📄 [**Documents**](plugins/documents-ext) | Your documents: the text read out of text files, Office files, PDFs, pictures and recordings, the AI's todos from them, which documents belong to which todo, your local folders read in by themselves. | 0.2.0 |
| 🗂️ [**Explorer**](plugins/explorer-ext) | The files of this computer in the Workspace, like Windows Explorer: drives, folders and files with dates and sizes; import into Documents, watch folders, open text, Markdown, CSV, pictures, PDFs, audio and video — and ed | 0.1.0 |
| 🎓 [**Learn (external)**](plugins/learn) | Zeff's Learn as an external plugin: courses researched and planned as skill trees, a live teacher in every lesson, exercises, cards, experience, study times, lesson todos. | 1.4.2 |
| 📰 [**News**](plugins/news-ext) | Your news, gathered for you: the feeds you pick plus a search per interest, everything scored for you, filtered by an agent, tagged, with an overview, stories, discovery, a page and settings of its own, a widget, a Today | 0.3.0 |
| 🔁 [**Open loops**](plugins/loops-ext) | What is still open between you and others: promises, questions and requests nobody answered, Jira comments addressed to you. | 0.1.0 |
| ✅ [**Todos (screens)**](plugins/todos-ext) | The Todos screen in the Workspace, made of Zeff's own kit: your todos grouped by urgency, the ones you wait on, done, the workers'; tick, flag, set aside, dismiss, a due day, add. | 0.4.8 |

### Mail & chat

| Plugin | What it does | Version |
| --- | --- | --- |
| 📧 [**E-Mail (IMAP / POP3)**](plugins/imap-mail-ext) | Reads your mail accounts (IMAP / POP3) into Zeff — each under its name, from its own server; none marked read. | 1.0.0 |
| 📮 [**Gmail**](plugins/gmail-ext) | Reads your Gmail accounts' latest mails into Zeff — through Gmail's API or Gmail in the account's automation Chrome, as the Connections page says; none marked read. | 1.0.0 |
| 💬 [**Mail & Chat**](plugins/mail-client-ext) | Your mails and chats as a mail client, a chat and one inbox across channels: read, reply (or let the AI draft), snooze, archive, new inboxes. | 1.0.1 |
| ✉️ [**Outlook Mail**](plugins/outlook-mail-ext) | Reads your Outlook inbox's latest mails into Zeff — through Microsoft's API or Outlook Web in the account's automation Chrome, as the Connections page says; none marked read. | 1.0.0 |
| 🔵 [**Signal**](plugins/signal-ext) | Reads your Signal chats' messages into Zeff from Signal Desktop on this computer — no chat opened, nothing marked read. | 1.0.0 |
| 🟣 [**Teams**](plugins/teams-ext) | Reads your Teams mentions and 1:1 messages into Zeff from Teams in the account's automation Chrome — its own cache, read-only. | 1.0.0 |
| 🟢 [**WhatsApp**](plugins/whatsapp-ext) | Reads your WhatsApp chats' messages into Zeff from WhatsApp Web in the account's automation Chrome — no chat opened, nothing marked read. | 1.0.0 |

### Connectors

| Plugin | What it does | Version |
| --- | --- | --- |
| 📅 [**Google Calendar**](plugins/google-calendar-ext) | Reads your Google calendars into Zeff's calendars — through Google's API or the automation Chrome, as the Connections page says. | 1.0.0 |
| ☁️ [**Google Drive**](plugins/google-drive-ext) | Keeps a copy of your documents in your Google Drive — and, if you turn it on, of your backups. | 1.0.0 |
| 🟡 [**Google Keep**](plugins/keep-ext) | Reads your Google Keep notes into a Workspace database, in the account's automation Chrome (Keep opened in a new tab, what it loads taken over, the tab closed; nothing changes in Keep). | 1.0.0 |
| 🔎 [**Lookups**](plugins/lookups-ext) | Search fields for your Workspace views: type a title, pick a suggestion, its data becomes a row — films and series, books, Wikipedia, Google's Knowledge Graph and web results. | 1.0.0 |
| 📓 [**Notion**](plugins/notion-ext) | Notion in the Workspace, both ways and close to live: the pages, databases and rows you share with your integration come in under My Notion; what you change on either side reaches the other within seconds. | 1.0.0 |

### AI

| Plugin | What it does | Version |
| --- | --- | --- |
| ⚡ [**Auto actions**](plugins/auto-actions-ext) | The AI step after the briefing: every open todo without a button gets ready-made actions from what the installed plugins can do (a message, a comment, a mail draft, a meeting, a hand-over). | 0.1.0 |
| 🌐 [**Browser**](plugins/browser-ext) | Lets Zeff's AI open public web pages in an automated Chrome — pages that only load with JavaScript too: it reads their text, links and pictures, and can click and type on them. | 1.0.0 |
| 📈 [**Correlations**](plugins/correlations-ext) | What goes with what in your days: a journal's energy or mood against meetings, booked hours, messages, todos, spending and your other fields — same day and the day after. | 1.0.0 |
| 🖥️ [**Local AI (Ollama, LM Studio)**](plugins/local-ai-ext) | An AI that runs on this computer — Ollama, LM Studio, llama.cpp or any server with an OpenAI-compatible API: the briefing, the mail steps and the other AI tasks without a byte leaving it. | 1.0.0 |
| 👥 [**People (AI steps)**](plugins/people-ext) | What the AI does with your people: reads what new messages say about them (roles, tasks, promises, links), writes their overview, tells a person from an organisation and places them in a circle, and matches the names. | 1.2.0 |
| ❓ [**Questions**](plugins/questions-ext) | Questions about numbers and dates answered from Zeff's own data: the AI plans queries over the named views, Zeff runs them, the AI phrases the answer from the numbers and cites the rows. | 0.1.0 |
| 🔍 [**Web search**](plugins/web-search-ext) | Lets Zeff's AI search the web and read a page — tools for agents and the Workspace chat. | 1.0.0 |
| 💡 [**What you should know**](plugins/know-ext) | What you should know right now: the few points before a meeting or beside a mail, a chat, a ticket, a person — from what Zeff put together about the people and things (open promises, last contacts, related tickets), each | 0.1.0 |

### Time

| Plugin | What it does | Version |
| --- | --- | --- |
| ⏱️ [**Time tracking — the report**](plugins/zeiterfassung-ext) | The report of your booked time in the view language: the week (booking, suggestions, closing it) and the month, over Zeff's own figures. | 0.7.8 |

### Money

| Plugin | What it does | Version |
| --- | --- | --- |
| 📁 [**Cases**](plugins/cases-ext) | One place per matter: the case numbers in your mails, letters and todos hold together one case — who it is owed to, what is open after your payments, what is due next and where to pay (GiroCode). | 0.1.0 |
| 💶 [**Finances**](plugins/finances-ext) | Your debts and what you are owed: the Kennzahlen of the debts database — what you owe, what you are owed, the instalments a month, months until debt-free. | 0.1.0 |
| 🏦 [**Revolut**](plugins/revolut-ext) | Reads your Revolut statements (the CSV export, in German or English — other banks' CSV too) into Zeff's bank: a file you import on the cases' overview, or one that comes in as a document. | 1.0.0 |

### Knowledge

| Plugin | What it does | Version |
| --- | --- | --- |
| 📚 [**Knowledge**](plugins/knowledge-ext) | Ask the knowledge — Confluence's pages compiled into a knowledge graph by Zeff's knowledge server — in a chat with sources, have it read, keep something in it, and have its pages matched to your open todos. | 0.1.0 |

### Developer

| Plugin | What it does | Version |
| --- | --- | --- |
| 🛠️ [**Code**](plugins/work-ext) | The Code tab in the Workspace: your sessions with workers and agents, each conversation live, the questions they ask you, tickets and new sessions. | 0.1.0 |
| 🦊 [**GitLab**](plugins/gitlab-ext) | Reads your GitLab merge requests, their comments and your branches into Zeff — through GitLab in the account's automation Chrome. | 1.0.0 |
| 🎫 [**Jira**](plugins/jira-ext) | Reads your Jira tickets and those of the boards you chose into Zeff — the basis of the todos, the context sync and the entries per ticket — through the Jira MCP server (mcp-atlassian). | 1.0.0 |
| 🧭 [**Jira briefing**](plugins/jira-lage-ext) | The board briefing of your Jira boards: which tickets matter now, read fresh from Jira (through the Jira plugin or Zeff's connection) and assessed by the Workspace's AI review. | 0.1.0 |

### Languages

| Plugin | What it does | Version |
| --- | --- | --- |
| 🇩🇪 [**Deutsch**](plugins/lang-de) | Zeff auf Deutsch: alle Texte der Oberfläche, Datum und Zahlen im deutschen Format. | 1.0.0 |
| 🇪🇸 [**Español**](plugins/lang-es) | Zeff en español: todos los textos de la interfaz, fechas y números en formato español. | 1.0.0 |

## Make your own

A plugin is a folder with a `zeff-plugin.json` — pages and databases built from Zeff's building blocks, flows, syncs, widgets, rules for AI
workers, commands. Copy any folder here as a start, or use your own GitHub repository: add its address in Browse (*Where they come from*)
and its plugins are listed beside these. Read [how plugins work](https://github.com/269652/Zeff/tree/master/docs/plugins) in Zeff's docs.

---

## For maintainers

A Zeff installs them from here through its `packages.json` (in its data folder):

```json
{
  "sources": { "zeff-plugins": { "url": "../zeff-plugins", "branch": "main" } },
  "plugins": { "learn-ext": { "source": "zeff-plugins", "path": "plugins/learn" } }
}
```

- A running Zeff follows `packages.json` when it changes: what it lists is installed, or reinstalled from the place it names.
- Every half hour it looks for newer versions here and shows an update note with the commits since your version.
- Updating merges the new version with what was changed in that Zeff, file by file, the way git does; where both changed the same
  lines it asks — keep yours, take the new one, let the AI merge, or write it yourself.

Publishing a new version: change the plugin, raise `version` in its `zeff-plugin.json`, commit. A commit without a new version number is
offered as an update too (same version, other commit).

## The catalog (`catalog.json`)

`catalog.json` at the top lists every plugin of this repository — what it is (name, version, description, keywords, category, icon), what it
asks for (permissions), needs and adds (apps, pages, databases, flows, syncs, views, widgets, drivers, tools …), its folder, a content hash,
whether it is signed, its size and the start of its README. A Zeff reads this one file to list the plugins (**Plugins → Browse**, and the
header's search) instead of every `zeff-plugin.json` one by one; installing still downloads exactly the plugin's folder and checks it.

It is generated — never edit it by hand:

```
node scripts/catalog.mjs            # writes catalog.json
node scripts/catalog.mjs --check    # fails when catalog.json is out of date (run it before you commit)
```

After changing a plugin (a new version, new keywords …) run the script and commit `catalog.json` with the change. A Zeff whose source has
no catalog, or one out of date, still works: it reads the manifests itself (slower) and says the catalog is stale.

The fields a plugin sets for the catalog, in its `zeff-plugin.json` (all optional, see Zeff's `docs/plugins/manifest.md`):

| Field | What |
| --- | --- |
| `keywords` | Up to 20 words the search finds it by. |
| `category` | One of `app`, `connector`, `communication`, `ai`, `time`, `finance`, `knowledge`, `language`, `developer`, `system`. |
| `icon` | An emoji, or the path of a small image (png, svg, jpg, webp, up to 32 kB) in the folder. |
| `screenshots` | Up to 8 paths of images in the folder, shown in the plugin's details. |
| `homepage` | A web address about it. |
| `requires.plugins` | The ids of other plugins it needs. |
