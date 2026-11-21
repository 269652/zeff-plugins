/** The review source people-followup: what waits, as the built-in lists it (the kernel's read `people.review-list`). */
export async function handler(event, context) {
  return (await context.zeff.call("people.review-list", { source: "people-followup" })).entries;
}
