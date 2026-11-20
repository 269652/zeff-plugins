/** What a job's or a project's own page shows (the Jobs tab reads it as data.d.*): the kernel's `time.job-detail`. event: { ref: "job:<id>" | "project:<id>" }. */
export async function handler(event, context) {
  const [kind, id] = String(event?.ref ?? "").split(":");
  if (!id) return { found: false };
  return await context.zeff.call("time.job-detail", { kind, id });
}
