/** What the Jobs & projects tab shows (the plugin's view reads it as data.j.*): the kernel's `time.jobs` — the Jobs and Projects pages' lists and words. */
export async function handler(_event, context) {
  return await context.zeff.call("time.jobs", {});
}
