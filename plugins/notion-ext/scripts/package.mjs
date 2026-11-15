#!/usr/bin/env node
// Writes notion.package.json (the pages and the two flows) — run after changing a flow here: node scripts/package.mjs
import fs from "node:fs";
import path from "node:path";

const LINKS = "notion-ext.links";
const STATE = "notion-ext.state";
const ROOT = "@notion-ext.i2";
const p = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (text) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const act = (id, action, input) => ({ id, kind: "action", action, input });
const put = (id, rows) => act(id, "store.put", { store: LINKS, rows });
const read = (id, pageExpr) => act(id, "meta.read", { op: "page.read", args: { id: pageExpr } });
const run = (id, op, args) => act(id, "meta.run", { op, args });
const iff = (id, when, then, otherwise = []) => ({ id, kind: "if", when, then, else: otherwise });
const pics = (id, pageExpr) => iff(id, "op.pictures", [act(`${id}k`, "files.keep-page", { page: pageExpr })]);
// A page's text merged with Notion's (what only Zeff has stays) and written only when it changed.
const merged = (pfx, idExpr) => [
  read(`${pfx}cur`, idExpr),
  act(`${pfx}mg`, "lambda.invoke", { name: "notion.merge", event: { current: `{{ steps.${pfx}cur.doc }}`, base: "{{ op.base }}", theirs: "{{ op.theirs }}" } }),
  iff(`${pfx}w`, `not steps.${pfx}mg.same`, [run(`${pfx}doc`, "page.update", { id: idExpr, doc: `{{ steps.${pfx}mg.doc }}` })]),
  put(`${pfx}l`, "{{ op.rows }}"),
  put(`${pfx}b`, [{ notion_id: "{{ op.notion }}", base: `{{ steps.${pfx}mg.base | json }}` }]),
];

const pull = {
  name: "notion.pull",
  title: "Sync from Notion",
  description:
    "What changed in Notion comes into Zeff: new and changed pages, databases and rows (under the page My Notion), merged with what you wrote in Zeff meanwhile; what Notion moved to its trash goes to Zeff's. Asked every 15 seconds whether there is anything (one small request), run only then — and every 5 minutes anyway.",
  inputs: [],
  nodes: [
    act("plan", "lambda.invoke", { name: "notion.pull", event: {} }),
    {
      id: "each",
      kind: "foreach",
      items: "steps.plan.ops",
      as: "op",
      max: 1000,
      nodes: [
        iff(
          "par",
          "op.parentNotion",
          [act("pq", "store.query", { store: LINKS, where: { notion_id: "{{ op.parentNotion }}" }, limit: 1 }), { id: "ps", kind: "set", vars: { parent: `{{ steps.pq.rows[0].zeff_id | default('${ROOT}') }}` } }],
          [{ id: "pr", kind: "set", vars: { parent: ROOT } }],
        ),
        {
          id: "which",
          kind: "switch",
          on: "op.op",
          cases: [
            {
              value: "page.create",
              nodes: [
                run("mk", "page.create", { title: "{{ op.title | default('Untitled') }}", icon: "{{ op.icon }}", cover: "{{ op.cover }}", parent: "{{ vars.parent }}", doc: "{{ op.doc }}" }),
                put("mkl", "{{ op.rows }}"),
                put("mkz", [{ notion_id: "{{ op.notion }}", zeff_id: "{{ steps.mk.id }}" }]),
                pics("mkp", "{{ steps.mk.id }}"),
              ],
            },
            {
              value: "page.update",
              nodes: [
                run("pu", "page.update", { id: "{{ op.zeff }}", title: "{{ op.title | default('Untitled') }}", icon: "{{ op.icon }}", cover: "{{ op.cover }}" }),
                iff("pum", "op.parentNotion", [run("pmv", "page.update", { id: "{{ op.zeff }}", parent: "{{ vars.parent }}" })]),
                ...merged("pc", "{{ op.zeff }}"),
                pics("pup", "{{ op.zeff }}"),
              ],
            },
            {
              value: "database.create",
              nodes: [
                run("dm", "database.create", { title: "{{ op.title }}", icon: "{{ op.icon }}", parent: "{{ vars.parent }}", titleName: "{{ op.titleName }}", properties: "{{ op.properties }}" }),
                put("dml", "{{ op.rows }}"),
                put("dmz", [{ notion_id: "{{ op.notion }}", zeff_id: "{{ steps.dm.id }}" }]),
              ],
            },
            {
              value: "database.update",
              nodes: [
                run("du", "page.update", { id: "{{ op.zeff }}", title: "{{ op.title }}", icon: "{{ op.icon }}" }),
                iff("dua", "op.alter.length > 0", [run("dal", "database.alter", { database: "{{ op.zeff }}", ops: "{{ op.alter }}" })]),
                put("dul", "{{ op.rows }}"),
              ],
            },
            {
              value: "row.create",
              nodes: [
                act("rq", "store.query", { store: LINKS, where: { notion_id: "{{ op.database }}" }, limit: 1 }),
                act("ra", "db.add", { database: "{{ steps.rq.rows[0].zeff_id }}", title: "{{ op.title | default('Untitled') }}", values: "{{ op.values }}" }),
                iff("rc", "not op.empty or op.icon", [run("rcd", "page.update", { id: "{{ steps.ra.id }}", icon: "{{ op.icon }}", doc: "{{ op.doc }}" })]),
                put("ral", "{{ op.rows }}"),
                put("raz", [{ notion_id: "{{ op.notion }}", zeff_id: "{{ steps.ra.id }}" }]),
                pics("rap", "{{ steps.ra.id }}"),
              ],
            },
            {
              value: "row.update",
              nodes: [
                act("ru", "db.update", { row: "{{ op.zeff }}", title: "{{ op.title | default('Untitled') }}", values: "{{ op.values }}" }),
                run("rui", "page.update", { id: "{{ op.zeff }}", icon: "{{ op.icon }}" }),
                iff("ruc", "op.contentChanged", merged("rm", "{{ op.zeff }}"), [put("rul", "{{ op.rows }}")]),
                pics("rup", "{{ op.zeff }}"),
              ],
            },
            { value: "archive", nodes: [run("ar", "page.archive", { id: "{{ op.zeff }}" }), act("ard", "store.delete", { store: LINKS, where: { notion_id: "{{ op.notion }}" } })] },
            { value: "unlink", nodes: [act("ul", "store.delete", { store: LINKS, where: { notion_id: "{{ op.notion }}" } })] },
            { value: "link", nodes: [put("lk", "{{ op.rows }}")] },
          ],
          default: [],
        },
      ],
    },
    act("st", "store.put", { store: STATE, rows: [{ name: "cursor", value: "{{ steps.plan.cursor }}" }, { name: "more", value: "{{ if(steps.plan.more, '1', '0') }}" }] }),
    iff("chk", "steps.plan.checked", [act("chs", "store.put", { store: STATE, rows: [{ name: "checked_at", value: "{{ env.now }}" }] })]),
    { id: "done", kind: "return", value: { ok: true, message: "{{ steps.plan.message }}" } },
  ],
  requested: {
    store: [LINKS, STATE],
    meta: ["pages", "pages-read", "databases"],
    // (Pictures and covers: Notion keeps its own on Amazon S3, an external one can be anywhere — kept in Zeff by files.keep-page.)
    web: ["*"],
    maxSteps: 20000,
  },
  triggers: [
    { kind: "watch", lambda: "notion.watch", everySeconds: 15 },
    { kind: "schedule", everyMinutes: 5 },
  ],
  sync: { label: "Notion", what: "Your Notion pages, databases and rows shared with the integration — both ways, close to live" },
};

const events = ["page.added", "page.changed", "page.removed", "row.added", "row.changed", "row.removed"];
const push = {
  name: "notion.push",
  title: "Sync to Notion",
  description:
    "What you change in Zeff under the page My Notion goes to Notion a few seconds after you stop typing: new pages, databases and rows, titles, icons, covers, a row's values, the blocks of a page's text that changed; moved to Zeff's trash, moved to Notion's.",
  inputs: [
    { name: "page", type: "number" },
    { name: "event", type: "text" },
    { name: "field", type: "text" },
  ],
  nodes: [
    read("pg", "{{ input.page }}"),
    read("root", ROOT),
    iff("sch", "steps.pg.kind == 'database' or steps.pg.database", [act("sc", "meta.read", { op: "schema", args: { database: "{{ steps.pg.database | default(steps.pg.id) }}" } })]),
    act("w", "lambda.invoke", { name: "notion.push", event: { page: "{{ steps.pg }}", schema: "{{ steps.sc }}", root: "{{ steps.root.id }}", event: "{{ input.event }}", field: "{{ input.field }}" } }),
    iff("put", "steps.w.put.length > 0", [put("p1", "{{ steps.w.put }}")]),
    { id: "rm", kind: "foreach", items: "steps.w.remove", as: "id", max: 100, nodes: [act("d1", "store.delete", { store: LINKS, where: { notion_id: "{{ id }}" } })] },
    { id: "done", kind: "return", value: { ok: true, message: "{{ steps.w.message }}" } },
  ],
  requested: { store: [LINKS], meta: ["pages-read", "read"] },
  triggers: events.map((event) => ({ kind: "event", event, under: ROOT, settle: 3 })),
};

const pkg = {
  format: 1,
  id: "notion-ext",
  version: "1.0.0",
  name: "Notion",
  description: "Your Notion workspace in Zeff, both ways: pages, databases and rows under the page My Notion, kept in step a few seconds after either side changes.",
  icon: "📓",
  localize: false,
  items: [
    {
      id: "i1",
      kind: "page",
      title: "Notion",
      icon: "🔄",
      content: {
        type: "doc",
        content: [
          p("Your Notion pages, databases and rows are kept in step with the page My Notion (below this one): what changes in Notion comes in within about 15 seconds, what you change in Zeff goes to Notion a few seconds after you stop typing."),
          h("Setting it up"),
          p("1. In Notion: Settings → Connections → Develop or manage integrations → New integration (internal). Copy its secret."),
          p("2. In Zeff: Menu → Plugins → Notion → ⚙️ Settings: paste the secret as Notion token."),
          p("3. In Notion: open each top page you want in Zeff → ••• → Connections → add your integration. Its sub-pages and databases come along."),
          p("4. Optional: a Notion page as the place for pages you make right under My Notion in Zeff (setting “New pages from Zeff go to”). Without it, pages you make under synced pages still go to Notion."),
          h("What is kept"),
          p(
            "Text with headings, lists, to-dos, toggles, quotes, callouts, code, equations, tables, columns, dividers, pictures (kept in Zeff — Notion's links expire), sub-pages and databases with their rows and fields. What only Zeff has (widgets, code cells, mentions of todos) stays in Zeff; what only Notion has (bookmarks, embeds, synced blocks, files) shows in Zeff as a link to it in Notion and stays in Notion as long as you leave that line as it is.",
          ),
          p("The two flows below do the work — open them to see each run (Studio → Flows)."),
        ],
      },
    },
    { id: "i2", parent: "i1", kind: "page", title: "My Notion", icon: "📓", content: { type: "doc", content: [p("Everything below this page is kept in step with Notion.")] } },
    { id: "i3", parent: "i1", kind: "page", title: "Sync from Notion", icon: "⬇️", flow: pull },
    { id: "i4", parent: "i1", kind: "page", title: "Sync to Notion", icon: "⬆️", flow: push },
  ],
};

fs.writeFileSync(path.join(import.meta.dirname, "..", "notion.package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
console.log("notion.package.json written.");
