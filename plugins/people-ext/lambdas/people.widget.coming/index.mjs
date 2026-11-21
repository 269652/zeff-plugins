/** The widget people.coming: its data as the built-in's widget works it out (the kernel's read `people.widget`). event: { config }. */
export async function handler(event, context) {
  return await context.zeff.call("people.widget", { id: "people.coming", config: event?.config ?? {} });
}
