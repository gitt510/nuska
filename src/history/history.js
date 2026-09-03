// History source for the finder overlay (finder/finder.js is injected right
// after this file). At rest and in search alike the corpus is the last 90
// days, most recent first, one row per URL.
globalThis.__shukuchiSource = {
  kind: "history",
  placeholder: "history…",

  async load(api, inPage) {
    const items = inPage ? await fromBackground(api) : await api.history.search(HISTORY_QUERY);
    const all = items.map((item) => {
      const matchUrl = item.url.replace(/^[a-z]+:\/\/(www\.)?/, "");
      return {
        title: item.title || item.url,
        url: item.url,
        host: matchUrl.split("/")[0],
        matchUrl,
        path: "",
      };
    });
    return { rest: all, all };
  },
};

const HISTORY_QUERY = { text: "", maxResults: 2000, startTime: Date.now() - 90 * 24 * 60 * 60 * 1000 };

// Content scripts have no history API; bg.js runs the query for them.
async function fromBackground(api) {
  const res = await api.runtime.sendMessage({ type: "get-history", query: HISTORY_QUERY });
  if (!res?.ok) throw new Error(res?.error ?? "no response from background");
  return res.items;
}
