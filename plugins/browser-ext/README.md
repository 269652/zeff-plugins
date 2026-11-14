# Browser

Zeff's Browser as a plugin. Zeff's AI (agents through the MCP, the Workspace chat) gets `browser_open`: a public page opened in an
automated Chrome, including pages that only load with JavaScript, read as text, links and pictures, with optional steps (click, fill,
press, wait, scroll).

- **The Chrome is Zeff's kernel's** (`web.browse`, Playwright on Chrome or Edge installed on this computer). Each call gets an empty
  profile with no logins. The machine's own network and private addresses stay out of reach, also for what a page loads.
- **It needs the `browser` permission**, which you grant when you switch the plugin on: the AI can click and type on public sites.
- It browses with Chrome's normal User-Agent but hides nothing else. A site that refuses it (403, a human check) is not got round.
