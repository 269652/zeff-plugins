import { CIRCLES, circleLabels, peopleAppData, agoText, initials, tFor } from "./lib.mjs";

/**
 * What the People overview shows (the plugin's app view views/people.html reads it as data.people.*): the built-in's own peopleAppData (src/plugins/people/view-data.ts,
 * bundled) over the kernel's overview of the people database (`people.screen-data`) — and, for each card, what the built-in's PersonCard works out (the lines, the
 * pills, what is open between you, how to write to or pay them), so the view language only draws it. event: { circle, only, sort, days }.
 */
const CIRCLE_COLOR = { family: "red", friends: "green", work: "blue", authorities: "orange", services: "gray" };

/** The tool of a yes or no on a thing to check — as a button's with= text. */
const VERDICTS = {
  identity: { yes: (id) => `tool=suggestion, id=${id}, accept=true`, no: (id) => `tool=suggestion, id=${id}, accept=false` },
  commitment: { yes: (id) => `tool=claim, id=${id}, action=done`, yesLabel: "Done" },
  claim: { yes: (id) => `tool=claim, id=${id}, action=confirm`, no: (id) => `tool=claim, id=${id}, action=reject` },
  link: { yes: (id) => `tool=link, id=${id}, action=confirm`, no: (id) => `tool=link, id=${id}, action=reject` },
  stale: { yes: (id) => `tool=claim, id=${id}, action=recheck`, no: (id) => `tool=claim, id=${id}, action=reject`, yesLabel: "Still true", noLabel: "Outdated" },
  date: { yes: (id) => `tool=dateConfirm, id=${id}`, no: (id) => `tool=dateDelete, id=${id}` },
};

export async function handler(event, context) {
  const t = tFor(context.language);
  const r = await context.zeff.call("people.screen-data", {});
  const o = r.overview;
  const now = Date.now();
  const state = { circle: String(event?.circle ?? "all") || "all", only: String(event?.only ?? ""), sort: String(event?.sort ?? "name") || "name" };
  const d = peopleAppData(o, r.rows, { t, state, now, locale: context.language });
  const circles = circleLabels(t);
  const today = new Date(now).toISOString().slice(0, 10);
  const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(context.language, { day: "numeric", month: "short" });
  const eur = (n) => n.toLocaleString(context.language, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const channel = (c) => (c === "Appointment" ? t("Appointment") : c);

  const cards = d.shown.map((p) => {
    const info = p.personId ? o.cards[p.personId] : undefined;
    const mine = info?.owed.filter((x) => x.direction === "mine") ?? [];
    const theirs = info?.owed.filter((x) => x.direction === "theirs") ?? [];
    const cared = p.starred || info?.circle === "family" || info?.circle === "friends";
    const quiet = !!info?.lastContact && cared && now - Date.parse(info.lastContact.at) >= o.settings.weeks * 7 * 864e5;
    const soon = !!p.next && p.next >= today && p.next <= d.soonUntil;
    const parts = [];
    if (info?.lastContact) parts.push({ text: `${channel(info.lastContact.channel)} ${agoText(t, info.lastContact.at, now)}`, tone: quiet ? "warn" : "", tip: t("Last contact: {when}", { when: new Date(info.lastContact.at).toLocaleString(context.language) }) });
    if (info?.birthdayIn != null) parts.push({ text: `🎂 ${info.birthdayIn === 0 ? t("today") : t("tomorrow")}`, tone: "bad", tip: "" });
    else if (p.next) parts.push({ text: p.nextKind ? `${p.nextKind} ${day(p.next)}` : day(p.next), tone: soon ? "warn" : "", tip: "" });
    if (info?.away) parts.push({ text: t("Away until {date}", { date: day(info.away) }), tone: "", tip: "" });
    const net = info?.debt ? info.debt.owed - info.debt.owe : 0;
    const debtShown = !!info?.debt && (info.debt.owe > 0 || info.debt.owed > 0);
    const circle = info?.circle || "";
    return {
      id: p.id,
      personId: p.personId ?? 0,
      name: p.name,
      starred: p.starred,
      circle,
      circleLabel: circle ? circles[circle] : "",
      circleColor: circle ? CIRCLE_COLOR[circle] : "gray",
      role: info?.role || p.context || "",
      parts,
      hasParts: parts.length > 0,
      unread: info?.unread || 0,
      unreadTip: !info?.unread ? "" : info.unread === 1 ? t("1 unread message") : t("{n} unread messages", { n: info.unread }),
      mailQuery: `/mail?q=${encodeURIComponent(p.name)}`,
      todos: p.todos,
      todosTip: p.todos === 1 ? t("1 todo") : t("{n} todos", { n: p.todos }),
      owedN: mine.length + theirs.length,
      owedTitle: [mine.length ? t("you owe {n}", { n: mine.length }) : "", theirs.length ? t("owes you {n}", { n: theirs.length }) : ""].filter(Boolean).join(" · "),
      owed: [...mine, ...theirs].map((x) => ({ id: x.id, mine: x.direction === "mine", who: x.direction === "mine" ? t("you") : t("they"), text: x.text, due: x.due || "" })),
      debtShown,
      debtText: debtShown ? `${net < 0 ? "−" : net > 0 ? "+" : ""}${eur(Math.abs(net))}` : "",
      debtTone: net < 0 ? "red" : "green",
      debtTip: debtShown ? [info.debt.owe > 0 ? t("Debt {amount}", { amount: eur(info.debt.owe) }) : "", info.debt.owed > 0 ? t("Claim {amount}", { amount: eur(info.debt.owed) }) : ""].filter(Boolean).join(" · ") : "",
      tickets: p.tickets,
      ticketsTip: p.tickets === 1 ? t("1 ticket") : t("{n} tickets", { n: p.tickets }),
      hasPills: !!info?.unread || p.todos > 0 || mine.length + theirs.length > 0 || debtShown || p.tickets > 0,
      email: info?.email ? `mailto:${info.email}` : "",
      chat: info?.chat ? `/mail?q=${encodeURIComponent(info.chat)}` : "",
      pay: info?.pay ? `/pay?${new URLSearchParams({ name: p.name, iban: info.pay.iban, bic: info.pay.bic })}` : "",
      circleOpts: [["", t("No circle")], ...CIRCLES.map((c) => [c, circles[c]])].map(([c, label]) => ({ label, current: c === circle, with: `tool=circle, id=${p.personId ?? 0}, circle=${c}` })),
      birthday: info?.birthdayIn != null,
      firstName: p.name.split(" ")[0],
      initials: initials(p.name) || "?",
    };
  });

  // what waits to be checked — each with the tool its yes and no run
  const groups = d.groups.map((g) => ({
    ...g,
    items: g.items.map((it) => {
      const v = VERDICTS[it.on];
      return { ...it, yes: v.yes(it.id), no: v.no ? v.no(it.id) : "", yesLabel: v.yesLabel ? t(v.yesLabel) : t("Right"), noLabel: v.noLabel ? t(v.noLabel) : t("Wrong") };
    }),
  }));

  const { overview, people, shown, groups: _g, ...rest } = d;
  return {
    ...rest,
    groups,
    cards,
    shownCount: cards.length,
    settings: { weeks: o.settings.weeks, myName: o.settings.myName, aboutMe: o.settings.aboutMe ?? "" },
  };
}
