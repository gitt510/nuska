// History source for the finder overlay (finder/finder.js is injected right
// after this file). At rest and in search alike the corpus is the last 90
// days, most recent first, one row per URL.
globalThis.__nuskaSource = {
  kind: "history",
  placeholder: "history…",

  async load(api, inPage) {
    const items = inPage ? await fromBackground(api) : await api.history.search(historyQuery());
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

// A function, not a top-level const: this file is injected into the same
// content-script sandbox every time the overlay opens, and a second `const`
// declaration throws where a second `function` declaration is allowed.
// Firefox reports that throw per frame instead of rejecting, so the overlay
// would fail silently from the second open on. Sources keep only functions
// and globalThis assignments at top level for that reason.
function historyQuery() {
  return { text: "", maxResults: 2000, startTime: Date.now() - 90 * 24 * 60 * 60 * 1000 };
}

// Content scripts have no history API; bg.js runs the query for them.
async function fromBackground(api) {
  const res = await api.runtime.sendMessage({ type: "get-history", query: historyQuery() });
  if (!res?.ok) throw new Error(res?.error ?? "no response from background");
  return res.items;
}
