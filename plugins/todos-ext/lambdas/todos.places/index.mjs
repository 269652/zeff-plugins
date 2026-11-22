/**
 * The buttons other plugins put on the Todos screen (views/todos.html reads them as data.places, beside the tabs): a booking system's
 * links, say — each a link (href) or a flow to run (flow, with). The kernel's read `todos.actions` (extension point todos.actions). event: {}.
 */
export async function handler(event, context) {
  try {
    const r = await context.zeff.call("todos.actions", {});
    return { actions: Array.isArray(r?.actions) ? r.actions : [] };
  } catch {
    // (nothing adds buttons, or the read is not there: none)
    return { actions: [] };
  }
}
