import { decodeBody, discoverFeeds, isPublicUrl } from "./lib.mjs";

/**
 * Feed discovery: from a website (or a profile on one) to the feeds it offers — the ones its pages announce, the usual paths and the well-known places (a subreddit, a
 * YouTube channel, a GitHub repository, a Medium or Substack author, a Mastodon account). Every candidate is fetched and parsed: only feeds that really answer with
 * items are returned, the best first. The built-in's discoverFeeds (src/plugins/news/discover.ts). event: { address }. Returns { feeds: [{ url, title, items, newest, sample }] }.
 */
const get = async (url) => {
  if (!isPublicUrl(url)) throw new Error("Not a public web address.");
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; Zeff/1.0)", accept: "text/html, application/rss+xml, application/atom+xml, application/xml, */*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.url && !isPublicUrl(res.url)) throw new Error("Redirected to a non-public address.");
  return { text: await decodeBody(res, 2_000_000), url: res.url || url };
};

export async function handler(event) {
  const address = String(event?.address ?? "").trim();
  if (!address) return { feeds: [], error: "Give an address." };
  return { feeds: await discoverFeeds(address, { get }) };
}
