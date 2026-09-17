// Shortcuts source for the keys overlay (keys/keys.js is injected right after
// this file). Execute-only — the settings page owns the list, kept in browser
// sync storage as one item.
globalThis.__shukuchiKeys = {
  kind: "shortcuts",
  label: "Shortcuts",
  settings: true,

  async load(api) {
    const synced = await api.storage.sync.get("shortcuts");
    return (synced.shortcuts ?? []).map(decorate);
  },

  fire(api, entry, { originWindowId }) {
    api.runtime.sendMessage({ type: "open-url", url: entry.url, windowId: originWindowId });
  },
};

function decorate(s) {
  let host = "";
  try {
    host = new URL(s.url).host.replace(/^www\./, "");
  } catch {
    // settings validates URLs; a hand-edited store just loses the host column
  }
  return { key: s.key, url: s.url, title: s.title || host || s.url, hint: host };
}
