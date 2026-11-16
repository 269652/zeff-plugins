# Notion (notion-ext)

Your Notion workspace in Zeff's Workspace, **both ways and close to live**: the pages, databases and rows you share with your Notion
integration come in under the page *My Notion*; what you change on either side reaches the other within seconds. Use Zeff in place of
Notion, or beside it as a second place for the same notes. Built from Zeff's kit only — a package (pages, two flows), lambdas and the
plugin's two stores; nothing of Notion's in Zeff's kernel.

## For you

**Setting it up**

1. In Notion: *Settings → Connections → Develop or manage integrations → New integration* (internal). Copy its secret.
2. In Zeff: *Menu → Plugins → Notion → ⚙️ Settings*: paste it as **Notion token**. Install its package (*install and allow what it
   asks*): the page **Notion** with **My Notion** below it and the two flows.
3. In Notion: on each top page you want in Zeff, *••• → Connections →* your integration. Its sub-pages and databases come along.
4. Optional: **New pages from Zeff go to** — a Notion page's link. Pages you make right under *My Notion* in Zeff are made there.
   Pages you make below synced pages go next to them in Notion anyway.

**How live it is.** Zeff asks Notion every 15 seconds whether anything changed (one small request; the flow runs only then) and every
5 minutes anyway. What you change in Zeff goes to Notion 3 seconds after you stop typing. Notion's API can't tell Zeff by itself — a
Zeff on your computer can't be reached by Notion — so 15 seconds is the delay from Notion to Zeff.

**What comes across, both ways**

| Notion | Zeff |
| --- | --- |
| Paragraphs, headings 1–3, bullets, numbers, to-dos (with their nested items) | the same |
| Bold, italic, strike-through, underline, code, background colours, links | the same marks |
| Mentions of a synced page | a link to its Zeff page (a mention again in Notion) |
| Toggles (also toggle headings), quotes, callouts (icon and colour), dividers | toggles, quotes, info boxes, rules |
| Code (language), equations | code blocks (an equation: language `latex`) |
| Tables (header row / column), columns | tables, columns |
| Pictures | pictures — Notion's own kept in Zeff (its links expire after an hour); yours uploaded to Notion |
| Sub-pages, databases on a page | pages below it, shown where they are on the page |
| Databases: title, text, number, select, multi-select, status, date, checkbox, URL, e-mail, phone, relation | the same kinds of fields, values both ways |
| Formula, rollup, people, files, created/edited by and when, ID | text in Zeff, read only (Notion works them out) |
| A page's title, emoji icon, cover | the same |
| Moved to the trash | moved to the trash (Zeff's trash ↔ Notion's) |

**What stays on one side.** What only Zeff has — widgets, code cells, mentions of todos and people, embedded views of Zeff's own
databases — stays in Zeff and is never sent; a change from Notion merges around it. What only Notion has — bookmarks, embeds, videos,
files, synced blocks, a table of contents — shows in Zeff as a line *↗ …* linking to it in Notion, and stays as it is in Notion as long
as you leave that line alone. Text colours (not backgrounds) and a callout's custom icon picture stay in Notion while you don't change
that block in Zeff. Views of a database (filters, boards) are Notion's API doesn't give out: a database comes into Zeff as a table, and
your views in Zeff stay Zeff's.

**When both sides change the same page at once**, the two are merged block by block: different blocks both stay changed; the same
block changed on both sides within seconds keeps both versions one under the other — tidy up the one you don't want. Notion and Zeff
each keep the page's history.

**Using Zeff in place of Notion.** Leave the sync on while you move over; once you work only in Zeff, turn the plugin off — everything
stays in Zeff, nothing is deleted on either side. **Beside Notion**: leave it on.

## How it works

- **`notion.watch`** (lambda) — asked every 15 s by the watch trigger of the flow `notion.pull`: Notion's newest edit time against the
  last one read (Notion keeps edit times to the minute: an edit of the last 90 s counts as new).
- **`notion.pull`** (flow + lambda) — the lambda reads what changed (Notion's search, newest first, down to the last sync), converts it
  into Zeff's terms and gives a plan, parents first; the flow carries it out with the kit's `meta.run` (pages, databases),
  `db.add` / `db.update` (rows), `files.keep-page` (pictures), and keeps each link in the store `links`. A changed page is merged by the
  lambda **`notion.merge`**: Notion's version, Zeff's and how it was at the last sync (three ways, block by block). A page that points
  at one not synced yet is read again on the next run. Every 10 minutes a few synced pages are checked for Notion's trash.
- **`notion.push`** (flow + lambda) — on `page.added` / `page.changed` / `page.removed` and the row events below *My Notion*, 3 s after
  the page rests: the page as Zeff has it (`page.read`) written to Notion — made there, or its title, icon, cover, a row's values, and
  only the blocks that differ (each Notion block kept with the key of what it is in Zeff: unchanged blocks keep their id, a changed one
  of the same kind is updated in place, sub-pages are never deleted from a page's text).
- **Stores**: `links` (Notion id ↔ Zeff id, kind, the last edit read, a fingerprint of each side, the page's blocks with their keys,
  the base of the next merge, a database's fields) and `state` (the newest edit read, whether more is left, when the trash was checked).
- **Shared code**: `lambdas/_*.mjs` (Notion's API, blocks ↔ text, fields ↔ properties, fingerprints, the stores), copied into each
  lambda by `node scripts/copy-lib.mjs`. The package is written by `node scripts/package.mjs`.

Kit pieces it brought to Zeff (general, for any plugin): the flow events `page.added` / `page.changed` / `page.removed` with `under`
and `settle`, the `watch` trigger, `meta` `page.read` and native `doc` / `cover` / `parent` / `rev` in `page.create` / `page.update`,
options with ids in `schema`, `files.save` / `files.keep-page` / `files.read`, a database a flow makes being one it may write, a
lambda's `fetch` sending bytes and forms, and a flow never starting itself through its own change.

Tested in Zeff's `tests/notion-ext.test.ts` (against a Notion kept in memory, `tests/notion-fake.ts`) and `tests/flow-page-events.test.ts`.
