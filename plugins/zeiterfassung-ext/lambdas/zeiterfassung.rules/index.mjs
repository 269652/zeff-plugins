/** What the rules sections of the Settings tab show (the plugin's view reads it as data.r.*): the kernel's `time.rules` — the type rules, the report rules, the meeting rules, the exclude rules and the entry types, with the options of their forms. */
export async function handler(_event, context) {
  return await context.zeff.call("time.rules", {});
}
