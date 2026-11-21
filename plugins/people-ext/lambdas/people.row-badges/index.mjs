/** The badges of the people's rows in the Workspace tree (open and overdue todos, promises past their day, unread messages) — as the built-in works them out (the kernel's read \`people.row-badges\`). */
export async function handler(event, context) {
  return await context.zeff.call("people.row-badges", {});
}
