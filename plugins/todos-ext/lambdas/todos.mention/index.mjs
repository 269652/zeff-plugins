/**
 * The @ in a note being typed (views/todos.html reads it as data.men): the person tagged — the word after the last @ — found among the people (the kernel's read
 * `people.search`: the People plugin's own search), each with the text the note becomes when you pick them ("… @Name "). event: { text }.
 */
export async function handler(event, context) {
  const text = String(event?.text ?? "");
  const before = text;
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && /[\p{L}\p{N}_.@]/u.test(before[at - 1]))) return { hits: [] };
  const word = before.slice(at + 1);
  if (/\n/.test(word) || word.length > 40) return { hits: [] };
  const { people } = await context.zeff.call("people.search", { q: word });
  return { hits: people.map((p) => ({ name: p.name, jira: p.jira ?? "", next: `${before.slice(0, at)}@${p.name} ` })) };
}
