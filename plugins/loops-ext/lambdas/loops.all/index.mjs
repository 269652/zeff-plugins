import { allLoops } from "./_loops.mjs";

/** Every open loop (overdue and soonest due first), the closed ones of the last two weeks and the rest — what the Today page, the inbox chips, the people's pages and the MCP read (through the kernel's snapshot of this answer). */
export async function handler(event, context) {
  const now = new Date();
  const { open, closed, settled } = await allLoops(context.zeff, now);
  return { open, closed, settled, at: now.toISOString() };
}
