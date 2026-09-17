// Tools source for the keys overlay (keys/keys.js is injected right after
// this file): window chores that have no UI of their own. The set is fixed
// and prefix-free; each key names a `run-tool` action in bg.js.
globalThis.__nuskaKeys = {
  kind: "tools",
  label: "Tools",
  settings: false,

  async load() {
    return [
      { key: "m", id: "merge-windows", title: "Merge windows", hint: "gather every window's tabs into this one" },
      { key: "s", id: "split-window", title: "Split window", hint: "move this tab to a new window, side by side" },
    ];
  },

  fire(api, entry, { originWindowId, screen }) {
    api.runtime.sendMessage({ type: "run-tool", id: entry.id, windowId: originWindowId, screen });
  },
};
