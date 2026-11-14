# Local AI (Ollama, LM Studio)

An AI that runs on this computer: Ollama, LM Studio, llama.cpp or any server with an OpenAI-compatible API. The briefing, the mail
steps and the other AI tasks run without a byte leaving the computer — as the default AI, for single tasks, or only for what you marked
secret.

- **Its settings page is view language.** `settings.html` is the block `local-ai.settings` on the page *Local AI* (under System): the
  server (Ollama, LM Studio or an address), the models asked of it, a test, and whether what is marked secret goes only to it. Its
  buttons do the kernel's actions `localai.config`, `localai.probe`, `localai.test` and `localai.save`.
- **Talking to the model is Zeff's.** The client for Ollama and OpenAI-compatible servers is a driver of Zeff's kernel
  (`src/lib/ai/local`). Settings → AI keeps choosing which tasks go to it.
- **Generated.** `local-ai.package.json` is made from `settings.html` by Zeff's `scripts/port-local-ai.mts`.

**Switching:** Plugins → Local AI (built-in) → *Switch to the plugin*. Your address, model and choices stay; *Settings → Local AI* opens
the plugin's page then.
