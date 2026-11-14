# Web search

Zeff's Web search as a plugin. Zeff's AI (agents through the MCP, the Workspace chat) gets `web_search` and `web_fetch`, and Zeff's
`web.search` (flows, lookups, Learn's research) is answered by this plugin.

- **Search.** It uses an official API with your key, Brave Search or Google Programmable Search (plugin settings, kept encrypted).
  Without a key it searches through your Claude login (Zeff's `ai.websearch`). Never by scraping.
- **Reading a page.** It goes through Zeff's kernel (`web.read`): http(s) only, every redirect checked, never your own network or a
  private address, and PDFs are read too.
- **No Notebook needed.** Everything here is a lambda (`lambdas/`), a Node process of its own that reaches only the domains it names.
