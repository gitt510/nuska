// Bookmarks source for the finder overlay (finder/finder.js is injected right
// after this file). At rest: the bookmarks bar, folders flattened, in bar
// order. Search: every bookmark, matched on title, URL and folder path.
globalThis.__shukuchiSource = {
  kind: "bookmarks",
  placeholder: "bookmarks…",

  async load(api, inPage) {
    const roots = inPage ? await fromBackground(api) : await api.bookmarks.getTree();
    return { rest: flatten([barNode(roots)]), all: flatten(roots) };
  },
};

// Content scripts have no bookmarks API; bg.js reads the tree for them.
async function fromBackground(api) {
  const res = await api.runtime.sendMessage({ type: "get-tree" });
  if (!res?.ok) throw new Error(res?.error ?? "no response from background");
  return res.tree;
}

// The bookmarks bar folder: Chrome id "1" / Firefox id "toolbar_____".
function barNode(roots) {
  const top = roots[0].children ?? [];
  return (
    top.find((n) => n.folderType === "bookmarks-bar") ??
    top.find((n) => n.id === "1" || n.id === "toolbar_____") ??
    top[0]
  );
}

function flatten(nodes, path = []) {
  const out = [];
  for (const node of nodes) {
    if (node.url) {
      // strip protocol/www noise once, so "ra" scores against "rakuten-sec.co.jp/…"
      const matchUrl = node.url.replace(/^[a-z]+:\/\/(www\.)?/, "");
      out.push({
        title: node.title || node.url,
        url: node.url,
        host: matchUrl.split("/")[0],
        matchUrl,
        path: path.join("/"),
      });
    }
    if (node.children) {
      out.push(...flatten(node.children, node.title ? [...path, node.title] : path));
    }
  }
  return out;
}
