export async function handler(event) {
  const id = Number(event.case);
  if (!id) throw new Error("Which case?");
  const row = { id, updated_at: new Date().toISOString() };
  if (event.status !== undefined && event.status !== null && event.status !== "") {
    if (!["open", "closed", "ignored"].includes(event.status)) throw new Error("Unknown status.");
    row.status = event.status;
  }
  if (typeof event.note === "string") row.note = event.note.slice(0, 20000);
  return { rows: [row] };
}
