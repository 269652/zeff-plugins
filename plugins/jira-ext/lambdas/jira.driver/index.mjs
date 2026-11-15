import { runSession, payloadOf } from "zeff:automation/mcp-client";
import { extractIssues, normalizeIssue, norm, transitionsOf, tFor } from "./lib.mjs";

const BOARD_PAGE = 50; // jira_get_board_issues caps limit at 50 and needs a jql; paged with start_at
const BOARD_MAX = 500; // the most recently updated per board, to bound huge boards

const words = (raw) => {
  const s = String(raw ?? "").trim();
  if (s.startsWith("[")) {
    try {
      const a = JSON.parse(s);
      if (Array.isArray(a)) return a.map(String);
    } catch {
      // whitespace then
    }
  }
  return s.split(/\s+/).filter(Boolean);
};
/** The server's environment: a JSON object, or KEY=value lines (a .env). */
const envOf = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return {};
  if (s.startsWith("{")) {
    try {
      return Object.fromEntries(Object.entries(JSON.parse(s)).map(([k, v]) => [k, String(v)]));
    } catch {
      return {};
    }
  }
  const out = {};
  for (const line of s.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
};

/** The key of a ticket jira_create_issue made ({ issue: { key } }, { key }, or in its words). */
function createdKey(payload) {
  const o = payload ?? {};
  const issue = o.issue ?? o;
  if (typeof issue.key === "string") return issue.key;
  return /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(typeof payload === "string" ? payload : JSON.stringify(payload ?? ""))?.[1] ?? null;
}

/** One change in Jira, in an open session: what happened, as the built-in said it (plain: the short wording the board's suggestions use). */
async function change(call, op, t, plain) {
  if (op.type === "transition") {
    const list = transitionsOf(payloadOf(await call("jira_get_transitions", { issue_key: op.ticket })));
    const want = norm(op.to);
    const hit = list.find((x) => norm(x.name) === want || norm(x.to) === want) ?? list.find((x) => !!want && (norm(x.name).includes(want) || norm(x.to).includes(want)));
    if (!hit) {
      const l = list.map((x) => x.name).join(", ") || t("none");
      throw new Error(plain ? t("No transition “{to}” from here — possible: {list}.", { to: op.to, list: l }) : t("{ticket}: no transition “{to}” from here — possible: {list}.", { ticket: op.ticket, to: op.to, list: l }));
    }
    await call("jira_transition_issue", { issue_key: op.ticket, transition_id: hit.id });
    return plain ? `→ ${hit.to ?? hit.name}` : `${op.ticket} → ${hit.to ?? hit.name}`;
  }
  if (op.type === "assign") {
    await call("jira_update_issue", { issue_key: op.ticket, fields: JSON.stringify({ assignee: op.assignee }) });
    return plain ? t("assigned: {assignee}", { assignee: op.assignee }) : t("{ticket} assigned: {assignee}", { ticket: op.ticket, assignee: op.assignee });
  }
  if (op.type === "assign-as-jira-names") {
    // (you, as Jira names you: the board shows display names)
    await call("jira_update_issue", { issue_key: op.ticket, fields: JSON.stringify({ assignee: op.assignee }) });
    const issue = payloadOf(await call("jira_get_issue", { issue_key: op.ticket, fields: "assignee" }));
    const a = issue?.fields?.assignee ?? issue?.assignee;
    return typeof a === "string" ? a : (a?.displayName ?? a?.display_name ?? a?.name ?? op.assignee);
  }
  if (op.type === "create") {
    // The description goes as Markdown; the type as asked, else as this Jira names it (the kernel lists the ones to try), till one is taken.
    const project = op.ticket.split("-")[0];
    // Its source ticket's labels and components: they put a ticket on its board.
    const source = payloadOf(await call("jira_get_issue", { issue_key: op.ticket, fields: "labels,components" })) ?? {};
    const names = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String(x?.name ?? ""))).filter(Boolean) : []);
    const labels = names(source.labels);
    const components = names(source.components);
    let created = null;
    let lastError = null;
    for (const issueType of op.issueTypes ?? []) {
      try {
        created = payloadOf(await call("jira_create_issue", { project_key: project, summary: op.summary, issue_type: issueType, description: op.body, ...(components.length ? { components: components.join(",") } : {}), ...(labels.length ? { additional_fields: JSON.stringify({ labels }) } : {}) }));
        break;
      } catch (e) {
        lastError = e;
        if (!/vorgangstyp|issue ?type|issuetype/i.test(String(e?.message ?? e))) throw e;
      }
    }
    if (!created) throw lastError ?? new Error(t("No issue type worked."));
    const key = createdKey(created);
    if (!key) throw new Error(t("Jira created the ticket but didn't return a key: {answer}", { answer: JSON.stringify(created).slice(0, 200) }));
    let assigned = "";
    if (op.assignee) {
      try {
        await call("jira_update_issue", { issue_key: key, fields: JSON.stringify({ assignee: op.assignee }) });
        assigned = ` ${t("(assigned: {assignee})", { assignee: op.assignee })}`;
      } catch {
        assigned = ` ${t("(assigning {assignee} didn't work — please set it in Jira)", { assignee: op.assignee })}`;
      }
    }
    let linked = "";
    try {
      await call("jira_create_issue_link", { link_type: "Relates", inward_issue_key: key, outward_issue_key: op.ticket });
      linked = ` ${t("(linked to {ticket})", { ticket: op.ticket })}`;
    } catch {
      linked = ` ${t("(linking to {ticket} didn't work — please set it in Jira)", { ticket: op.ticket })}`;
    }
    const url = op.browseUrl ? op.browseUrl.replace(/\/browse\/.*$/, `/browse/${key}`) : "";
    return `${t("Ticket {key} created", { key })}${assigned}${labels.length ? ` ${t("(labels: {labels})", { labels: labels.join(", ") })}` : ""}${linked}${url ? `: ${url}` : ""}`;
  }
  await call("jira_add_comment", { issue_key: op.ticket, body: op.body });
  return plain ? t("Comment posted") : t("Comment posted on {ticket}", { ticket: op.ticket });
}

/**
 * Jira's reader and writer (a driver: it starts the Jira MCP server on this computer). event.tool:
 *   read { boardIds, titleKeys } → { myTickets, boardTickets, members, titleOnly, unreadBoards } — what the kernel's jira.keep keeps;
 *   ops  { ops: [{ type: transition|assign|assign-as-jira-names|create|comment, ticket, … }], plain, reread }
 *        → { results, done, error, fresh } — the changes in one session, each as the built-in said it; on a failure what was done before it;
 *          then the tickets as Jira has them now (reread).
 */
export async function handler(event, context) {
  const s = context.secrets;
  const command = String(s.MCP_COMMAND ?? "").trim();
  if (!command) throw new Error("Jira isn't set up: the plugin's settings name the Jira MCP server (its command, e.g. uvx mcp-atlassian) — Plugins → Jira → Settings.");
  const env = envOf(s.MCP_ENV);
  const baseUrl = String(s.BASE_URL ?? "").trim() || env.JIRA_URL || undefined;
  const tool = String(s.TOOL ?? "").trim() || "jira_search";
  const jql = String(s.JQL ?? "").trim() || "assignee = currentUser() ORDER BY updated DESC";
  const fields = String(s.FIELDS ?? "").trim() || "summary,description,status,created,updated,resolutiondate,issuetype,priority,assignee";
  const limit = Number(s.LIMIT) > 0 ? Number(s.LIMIT) : 100;
  const normalize = (issues) => issues.map((i) => normalizeIssue(i, baseUrl)).filter((x) => x !== null);
  const boardIds = Array.isArray(event?.boardIds) ? event.boardIds.map(Number).filter(Number.isFinite) : [];
  const titleKeys = Array.isArray(event?.titleKeys) ? event.titleKeys.map(String) : [];

  if (event?.tool === "session") {
    // A session Zeff's code holds with the Jira MCP server: the server started once; Zeff asks for one call after another
    // (session.next), this runs each in the server and answers (session.reply), until Zeff is done.
    const sessionId = String(event.sessionId ?? "");
    return runSession(
      { command: context.resolveCommand(command), args: words(s.MCP_ARGS), env, label: "Jira MCP" },
      async (call) => {
        for (;;) {
          const n = await context.zeff.call("session.next", { sessionId });
          if (n?.done) break;
          if (!n || n.idle) continue;
          try {
            const value = await call(n.tool, n.args ?? {});
            await context.zeff.call("session.reply", { sessionId, id: n.id, ok: true, value });
          } catch (e) {
            await context.zeff.call("session.reply", { sessionId, id: n.id, ok: false, error: String(e?.message ?? e) });
          }
        }
        return { ok: true };
      },
      Number(event.timeoutMs) > 0 ? Number(event.timeoutMs) + 30000 : 180000,
    );
  }

  if (event?.tool === "boards") {
    // The Agile boards of the projects the tickets belong to, and which of the given tickets each board has (membership only for the boards asked
    // for: the enabled ones and those seen for the first time). event: { byProject: { PROJ: [keys] }, enabledIds, knownIds }.
    const asArray = (v, keys) => {
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object") for (const k of keys) if (Array.isArray(v[k])) return v[k];
      return [];
    };
    const enabled = new Set((event.enabledIds ?? []).map(Number));
    const known = new Set((event.knownIds ?? []).map(Number));
    return runSession(
      { command: context.resolveCommand(command), args: words(s.MCP_ARGS), env, label: "Jira MCP" },
      async (call) => {
        const discovered = [];
        for (const [proj, keys] of Object.entries(event.byProject ?? {})) {
          let list = [];
          try {
            list = asArray(payloadOf(await call("jira_get_agile_boards", { project_key: proj })), ["values", "boards"]);
          } catch {
            continue; // a project without boards / no access
          }
          for (const raw of list) {
            if (!raw || typeof raw !== "object") continue;
            const id = Number(raw.id);
            if (!Number.isFinite(id)) continue;
            discovered.push({ id, name: typeof raw.name === "string" ? raw.name : String(id), type: typeof raw.type === "string" ? raw.type : null, projectKey: proj, keys });
          }
        }
        const counts = {};
        const owner = {};
        for (const b of discovered) {
          const isEnabled = enabled.has(b.id);
          if (!isEnabled && known.has(b.id)) continue; // a disabled board seen before: skipped
          const members = new Set();
          for (let i = 0; i < b.keys.length; i += 50) {
            const part = b.keys.slice(i, i + 50);
            try {
              const ip = payloadOf(await call("jira_get_board_issues", { board_id: String(b.id), jql: "key in (" + part.join(",") + ")", fields: "key", limit: 50 }));
              for (const raw2 of asArray(ip, ["issues"])) if (typeof raw2?.key === "string") members.add(raw2.key.toUpperCase());
            } catch {
              // (this board's membership skipped on an error)
            }
          }
          counts[b.id] = members.size;
          if (isEnabled) for (const k of members) if (owner[k] === undefined) owner[k] = b.id;
        }
        return { boards: discovered.map((b) => ({ id: b.id, name: b.name, type: b.type, projectKey: b.projectKey })), counts, owner };
      },
      180000,
    );
  }

  if (event?.tool === "calls") {
    // Comments and attachments on Jira tickets, in ONE session; each call answers for itself (a failure doesn't stop the next).
    const GONE = /not found|does not exist|doesn't exist|no such|404|existiert nicht|nicht gefunden/i;
    const idOf = (v) => {
      if (!v || typeof v !== "object") return null;
      for (const x of [v.comment, v.result, v.data]) {
        const id = idOf(x);
        if (id) return id;
      }
      return typeof v.id === "string" || typeof v.id === "number" ? String(v.id) : null;
    };
    const post = async (call, ticket, body) => idOf(payloadOf(await call("jira_add_comment", { issue_key: ticket, body: body })));
    return runSession(
      { command: context.resolveCommand(command), args: words(s.MCP_ARGS), env, label: "Jira" },
      async (call) => {
        const results = [];
        for (const c of Array.isArray(event.calls) ? event.calls : []) {
          try {
            if (c.type === "attach") {
              await call("jira_update_issue", { issue_key: c.ticket, fields: "{}", attachments: JSON.stringify(c.paths ?? []) });
              results.push({ ok: true });
            } else if (c.type === "post") {
              results.push({ ok: true, commentId: await post(call, c.ticket, c.body) });
            } else if (c.type === "edit") {
              await call("jira_edit_comment", { issue_key: c.ticket, comment_id: c.commentId, body: c.body });
              results.push({ ok: true, commentId: c.commentId });
            } else if (c.type === "upsert") {
              // edited when it is there, made again when it was deleted on Jira, posted the first time
              if (!c.commentId) results.push({ ok: true, commentId: await post(call, c.ticket, c.body), state: "posted" });
              else {
                try {
                  await call("jira_edit_comment", { issue_key: c.ticket, comment_id: c.commentId, body: c.body });
                  results.push({ ok: true, commentId: c.commentId, state: "edited" });
                } catch (e) {
                  if (!GONE.test(String(e?.message ?? e))) throw e;
                  results.push({ ok: true, commentId: await post(call, c.ticket, c.body), state: "reposted" });
                }
              }
            } else throw new Error("Unknown call " + String(c.type));
          } catch (e) {
            results.push({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
          }
        }
        return { results };
      },
      300000,
    );
  }

  if (event?.tool === "ops") {
    const t = tFor(context.language);
    const results = [];
    return runSession(
      { command: context.resolveCommand(command), args: words(s.MCP_ARGS), env, label: "Jira" },
      async (call) => {
        let error = null;
        for (const op of Array.isArray(event.ops) ? event.ops : []) {
          try {
            results.push(await change(call, op, t, event.plain === true));
          } catch (e) {
            error = String(e?.message ?? e);
            break;
          }
        }
        let fresh = [];
        if (event.reread !== false && results.length) {
          const keys = [...new Set((event.ops ?? []).map((o) => String(o.ticket).toUpperCase()))];
          try {
            fresh = normalize(extractIssues(payloadOf(await call(tool, { jql: `key in (${keys.join(",")})`, limit: keys.length, fields }))));
          } catch {
            // (the next sync gets it)
          }
        }
        return { results, done: results.length, error, fresh };
      },
      120000,
    );
  }

  // mcp-atlassian cold-starts in ~30 s: every fetch over ONE session.
  return runSession(
    { command: context.resolveCommand(command), args: words(s.MCP_ARGS), env, label: "Jira MCP" },
    async (call) => {
      // 1. My assigned tickets (expand=changelog brings the history for the time to respond).
      const myRaw = extractIssues(payloadOf(await call(tool, { jql, limit, fields, expand: "changelog" })));
      const myTickets = normalize(myRaw);

      // 2. All issues on each enabled board (any assignee); the first enabled board wins per ticket.
      const members = [];
      const seen = new Set();
      const boardTickets = [];
      // Boards not read to the end (a timeout, an error): their tickets aren't known — nothing is deactivated then.
      const unread = [];
      for (const boardId of boardIds) {
        for (let startAt = 0; startAt < BOARD_MAX; startAt += BOARD_PAGE) {
          let payload;
          try {
            payload = payloadOf(await call("jira_get_board_issues", { board_id: String(boardId), jql: "ORDER BY updated DESC", fields, limit: BOARD_PAGE, start_at: startAt }));
          } catch {
            unread.push(boardId);
            break;
          }
          const raw = extractIssues(payload);
          if (raw.length === 0) break;
          for (const x of normalize(raw)) {
            boardTickets.push(x);
            if (!seen.has(x.key)) {
              seen.add(x.key);
              members.push({ key: x.key, boardId });
            }
          }
          const total = Number(payload?.total ?? 0);
          if (raw.length < BOARD_PAGE || (total > 0 && startAt + BOARD_PAGE >= total)) break;
        }
      }
      if (myTickets.length === 0 && boardTickets.length === 0) throw new Error(`The Jira MCP tool "${tool}" / jira_get_board_issues returned no recognizable issues. Check the plugin's settings.`);

      // 3. Titles for tickets booked in Zeff but in neither set above.
      const known = new Set([...boardTickets, ...myTickets].map((x) => x.key));
      const missing = titleKeys.filter((k) => !known.has(k));
      const titleOnly = [];
      for (let i = 0; i < missing.length; i += 50) {
        const chunk = missing.slice(i, i + 50);
        try {
          titleOnly.push(...normalize(extractIssues(payloadOf(await call(tool, { jql: `key in (${chunk.join(",")})`, limit: chunk.length, fields })))));
        } catch {
          // (tickets you can't view)
        }
      }
      return { myTickets, boardTickets, members, titleOnly, unreadBoards: unread.length };
    },
    180000,
  );
}
