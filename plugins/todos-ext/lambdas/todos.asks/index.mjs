/**
 * What the workers on a todo ask of you right now (views/todos.html reads it as data.asks): a permission to allow, a question, a plan — with the answers to give and
 * the modes to switch to (Auto …). The kernel's read `work.asks`; the buttons run the flow `work.live` of the Code plugin. event: { id }.
 */
export async function handler(event, context) {
  const id = Number(event?.id);
  if (!Number.isInteger(id) || id <= 0) return { asks: [], codePage: 0 };
  try {
    const r = await context.zeff.call("work.asks", { todo: id });
    return { asks: r.asks ?? [], codePage: r.codePage ?? 0 };
  } catch {
    // (the Code plugin is off: nothing asks)
    return { asks: [], codePage: 0 };
  }
}
