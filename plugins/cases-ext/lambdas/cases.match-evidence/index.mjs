export async function handler(event) {
  return { rows: (event.settled ?? []).length ? [{ id: event.tx, matched_at: new Date().toISOString() }] : [] };
}
