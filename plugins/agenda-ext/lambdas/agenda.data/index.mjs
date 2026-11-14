/**
 * Agenda's sidebar (the built-in's data.ts, as a lambda): the projects by category — the archived ones not, one whose notes are all done
 * not (as in Agenda), an empty one yes, to write in — each with its open notes; and today's events of the calendar the notes relate to.
 * Read through Zeff (db.schema, db.query raw); it changes nothing.
 * @param {{ db: number, done?: string }} event  the notes' database, and the name of its "done" field
 */
const WORDS = {
  de: { "Without a category": "Ohne Kategorie", Untitled: "Ohne Titel", "all day": "ganztägig" },
  es: { "Without a category": "Sin categoría", Untitled: "Sin título", "all day": "todo el día" },
};

export async function handler(event, context) {
  const t = (s) => WORDS[context.language]?.[s] ?? s;
  const call = context.zeff.call;
  const db = Number(event.db);
  const schema = await call("db.schema", { database: db });
  const rel = schema.fields.filter((f) => f.type === "relation" && f.relation !== undefined);
  const kinds = new Map();
  for (const f of rel) kinds.set(f.name, await call("db.schema", { database: f.relation }));
  const projectField = rel.find((f) => kinds.get(f.name).dataType !== "calendar");
  const calField = rel.find((f) => kinds.get(f.name).dataType === "calendar");
  const doneName = event.done ?? schema.fields.find((f) => f.type === "checkbox" && /^(done|erledigt|hecho)$/i.test(f.name))?.name;
  const notes = (await call("db.query", { database: db, raw: true, limit: 5000 })).rows;

  const projects = [];
  if (projectField) {
    const ps = kinds.get(projectField.name);
    const category = ps.fields.find((f) => f.type === "select");
    const archived = ps.fields.find((f) => f.type === "checkbox");
    for (const r of (await call("db.query", { database: projectField.relation, raw: true, limit: 5000 })).rows) {
      if (archived && r[archived.name] === true) continue;
      const mine = notes.filter((n) => (Array.isArray(n[projectField.name]) ? n[projectField.name] : []).includes(r.id));
      const open = mine.filter((n) => !(doneName && n[doneName] === true)).length;
      if (mine.length && !open) continue;
      projects.push({ id: r.id, title: r.title || t("Untitled"), icon: r.icon || "📁", category: (category && r[category.name]) || t("Without a category"), open });
    }
    projects.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }

  const events = [];
  if (calField) {
    const cs = kinds.get(calField.name);
    const when = cs.fields.find((f) => f.type === "date");
    const today = new Date().toLocaleDateString("sv-SE");
    if (when)
      for (const r of (await call("db.query", { database: calField.relation, raw: true, limit: 5000 })).rows) {
        const v = r[when.name];
        const range = typeof v === "string" ? { start: v } : v && typeof v === "object" && v.start ? v : null;
        if (!range) continue;
        // (a time is the moment, in this computer's zone: its day and hour as they are here)
        const local = (x) => (x.includes("T") ? new Date(x) : null);
        const dayOf = (x) => local(x)?.toLocaleDateString("sv-SE") ?? x.slice(0, 10);
        if (dayOf(range.start) > today || dayOf(range.end ?? range.start) < today) continue;
        const at = local(range.start);
        const time = at && dayOf(range.start) === today ? at.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : t("all day");
        events.push({ title: r.title || t("Untitled"), time });
      }
    events.sort((a, b) => a.time.localeCompare(b.time));
  }
  // The new-note form's choice of a project ("value:Label, …"; a title's commas and colons left out).
  const label = (x) => String(x).replace(/[,:]/g, " ").trim();
  const projectOptions = [":—", ...projects.map((p) => `${label(p.title)}:${label(p.title)}`)].join(", ");
  return { projects, events, projectOptions };
}
