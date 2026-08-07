// Bookmarks UI. One file, two contexts:
//  - injected into the page as a content script (bg.js, on Ctrl+B): renders
//    a centered <dialog> inside a shadow root, on the page's top layer
//  - loaded by bookmarks.html inside a centered popup window: the fallback
//    for pages that refuse injection (chrome://, the Web Store, …)
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const IN_PAGE = !api.bookmarks; // content scripts have no bookmarks API

  // Re-injecting the file toggles the already-open bookmarks instead.
  if (IN_PAGE && globalThis.__bookmarksToggle) {
    globalThis.__bookmarksToggle();
    return;
  }

  const THEMES = ["neon", "hud"];
  const CSS = `
dialog {
  /* neon (default) */
  --bg: #14111f;
  --fg: #e4e1f0;
  --muted: #7a7690;
  --accent: #ff2e88;
  --match: #26e0e0;
  --selected-bg: rgba(255, 46, 136, 0.13);
  --border: #2a2640;
  --font: system-ui, sans-serif;

  width: min(640px, 92vw);
  margin: 16vh auto auto;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: clip;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.45 var(--font);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
}

dialog::backdrop {
  background: rgba(10, 8, 18, 0.45);
  backdrop-filter: blur(3px);
}

/* neon sign */
dialog::before {
  content: "";
  display: block;
  height: 2px;
  background: linear-gradient(90deg, #ff2e88, #26e0e0);
}

dialog.hud {
  --bg: #0d1117;
  --fg: #e8f0e8;
  --muted: #66756b;
  --accent: #ff5a1f;
  --match: #ff5a1f;
  --selected-bg: rgba(232, 240, 232, 0.07);
  --border: #22302a;
  --font: ui-monospace, monospace;
  font-size: 13px;
  border-radius: 4px;
}

dialog.hud::before {
  height: 1px;
  background: var(--border);
}

dialog.windowed {
  width: 100%;
  min-height: 100vh;
  margin: 0;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.head {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
}

input {
  flex: 1;
  padding: 13px 16px;
  border: none;
  outline: none;
  background: none;
  color: var(--fg);
  caret-color: var(--match);
  font: inherit;
  font-size: 15px;
}

input::placeholder {
  color: var(--muted);
}

.count {
  padding-right: 14px;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

ul {
  margin: 0;
  padding: 4px 0;
  list-style: none;
  max-height: min(52vh, 440px);
  overflow-y: auto;
}

dialog.windowed ul {
  max-height: calc(100vh - 80px);
}

li {
  display: grid;
  align-items: center;
  column-gap: 8px;
  padding: 6px 16px;
  cursor: pointer;
}

/* fixed gutter (marker) + icon + title in tree mode; search drops the
   icon column and gains right-aligned metadata */
ul[data-mode="tree"] li {
  grid-template-columns: 12px 16px minmax(0, 1fr);
}

ul[data-mode="search"] li {
  grid-template-columns: 12px minmax(0, 1fr) max-content;
}

.marker {
  width: 11px;
  height: 11px;
  color: var(--accent);
  visibility: hidden;
}

li.selected .marker {
  visibility: visible;
}

/* hud's corner brackets carry the selection — no chevron on top of them */
dialog.hud li.selected .marker {
  visibility: hidden;
}

.kind {
  width: 14px;
  height: 14px;
  color: var(--muted);
}

li .title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

li .title b {
  font-weight: 600;
  color: var(--match);
}

li .host {
  margin-left: auto;
  flex: none;
  color: var(--muted);
  font-size: 11px;
}

li.folder {
  cursor: default;
  color: var(--muted);
  font-weight: 600;
  font-size: 11px;
  padding-top: 10px;
}

li.selected {
  position: relative;
  background-color: var(--selected-bg);
}

dialog.hud li.folder {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 10px;
}

/* targeting reticle */
dialog.hud li.selected::before,
dialog.hud li.selected::after {
  content: "";
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 6px;
}

dialog.hud li.selected::before {
  left: 4px;
  border: 1px solid var(--accent);
  border-right: none;
}

dialog.hud li.selected::after {
  right: 4px;
  border: 1px solid var(--accent);
  border-left: none;
}

.hints {
  padding: 6px 16px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}
`;

  // The fallback window must open tabs in the window it was launched from.
  const originWindowId = IN_PAGE
    ? undefined
    : Number(new URLSearchParams(location.search).get("origin")) || undefined;

  let allBookmarks = []; // every bookmark, flattened — the fuzzy search corpus
  let treeEntries = []; // bookmarks-bar tree — shown while the query is empty
  let entries = []; // whatever is currently rendered
  let rows = []; // row elements parallel to entries
  let treeCount = 0; // bookmarks (not folders) in the tree view
  let selected = 0;
  let theme = "neon";
  let ui = null; // { host, dialog, input, count, list } while open

  if (IN_PAGE) {
    globalThis.__bookmarksToggle = () => (ui ? ui.dialog.close() : open());
  } else {
    window.addEventListener("blur", () => window.close());
  }
  open();

  async function open() {
    ui = build();
    const [stored, roots] = await Promise.all([api.storage.local.get("theme"), fetchTree()]);
    if (!ui) return; // closed before the data arrived
    theme = THEMES.includes(stored.theme) ? stored.theme : "neon";
    applyTheme();
    allBookmarks = flatten(roots);
    treeEntries = buildTree(barNode(roots));
    treeCount = treeEntries.filter((e) => e.url).length;
    show(treeEntries);
  }

  function build() {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("closedby", "any");
    dialog.setAttribute("aria-label", "Bookmarks");

    const head = el("div", "head");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "bookmarks…";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "results");
    input.setAttribute("aria-label", "Search bookmarks");
    const count = el("span", "count");
    head.append(input, count);

    const list = document.createElement("ul");
    list.id = "results";
    list.setAttribute("role", "listbox");
    const hints = el("div", "hints");
    hints.textContent = "↵ open · ⌃N ⌃P move · ⌃T theme · esc close";
    dialog.append(head, list, hints);

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);

    let host = null;
    if (IN_PAGE) {
      host = document.createElement("div");
      const shadow = host.attachShadow({ mode: "closed" });
      shadow.adoptedStyleSheets = [sheet];
      shadow.append(dialog);
      document.documentElement.append(host);
    } else {
      document.adoptedStyleSheets = [sheet];
      document.body.append(dialog);
      dialog.classList.add("windowed");
    }

    dialog.addEventListener("keydown", onKeydown);
    input.addEventListener("input", () => search(input.value));
    dialog.addEventListener("close", () => {
      ui = null;
      if (IN_PAGE) host.remove();
      else window.close();
    });
    // Light-dismiss fallback for browsers without <dialog closedby>.
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      dialog.addEventListener("click", (e) => {
        if (e.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        const inside =
          r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
        if (!inside) dialog.close();
      });
    }

    dialog.showModal();
    input.focus();
    return { host, dialog, input, count, list };
  }

  function onKeydown(e) {
    e.stopPropagation(); // keep the page's own shortcuts out of the overlay
    if (e.ctrlKey && (e.key === "n" || e.key === "p")) {
      e.preventDefault();
      move(e.key === "n" ? 1 : -1);
      return;
    }
    if (e.ctrlKey && e.key === "t") {
      e.preventDefault();
      cycleTheme();
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Enter":
        e.preventDefault();
        if (entries[selected]?.url) openEntry(entries[selected]);
        break;
      case "Escape":
        // With a query, Escape only clears it; preventDefault stops the
        // dialog's native close request. An empty query lets it through.
        if (ui.input.value) {
          e.preventDefault();
          ui.input.value = "";
          show(treeEntries);
        }
        break;
    }
  }

  function cycleTheme() {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    api.storage.local.set({ theme });
    applyTheme();
  }

  function applyTheme() {
    ui.dialog.classList.toggle("hud", theme === "hud");
  }

  async function fetchTree() {
    if (!IN_PAGE) return api.bookmarks.getTree();
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

  function buildTree(node, depth = 0) {
    const out = [];
    for (const child of node?.children ?? []) {
      if (child.url) {
        out.push({ title: child.title || child.url, url: child.url, depth });
      } else {
        out.push({ title: child.title, depth, folder: true });
        out.push(...buildTree(child, depth + 1));
      }
    }
    return out;
  }

  function flatten(nodes, path = []) {
    const out = [];
    for (const node of nodes) {
      if (node.url) {
        out.push({
          title: node.title || node.url,
          url: node.url,
          // strip protocol/www noise once, so "ra" scores against "rakuten-sec.co.jp/…"
          matchUrl: node.url.replace(/^[a-z]+:\/\/(www\.)?/, ""),
          path: path.join("/"),
        });
      }
      if (node.children) {
        out.push(...flatten(node.children, node.title ? [...path, node.title] : path));
      }
    }
    return out;
  }

  function search(query) {
    if (!query) {
      show(treeEntries);
      return;
    }
    const results = allBookmarks
      .map((b) => ({ ...b, ...scoreBookmark(query, b) }))
      .filter((b) => b.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((b) => ({
        title: b.title,
        url: b.url,
        depth: 0,
        host: b.matchUrl.split("/")[0],
        path: b.path,
        at: b.at,
      }));
    show(results);
  }

  // Title, URL and parent path are scored independently and the best wins,
  // so a domain prefix ("ra" → rakuten-sec.co.jp) or a folder name
  // ("console") ranks alongside title matches; the path channel carries a
  // small penalty so it never beats a direct hit of the same quality.
  // Match positions are kept only for title matches — they are what's shown.
  function scoreBookmark(query, b) {
    const title = fuzzyMatch(query, b.title);
    const url = fuzzyMatch(query, b.matchUrl);
    const path = fuzzyMatch(query, b.path);
    const titleScore = title.score + 1;
    const best = Math.max(titleScore, url.score, path.score - 1);
    return { score: best, at: best === titleScore ? title.at : [] };
  }

  // Subsequence match: -Infinity if query chars don't appear in order,
  // otherwise higher is better (consecutive chars and word starts win).
  function fuzzyMatch(query, text) {
    if (!query) return { score: 0, at: [] };
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let score = 0;
    let ti = -1;
    let prev = -2;
    let first = -1;
    const at = [];
    for (const ch of q) {
      ti = t.indexOf(ch, ti + 1);
      if (ti === -1) return { score: -Infinity, at: [] };
      score += ti === prev + 1 ? 5 : 1;
      if (ti === 0 || " /-_.".includes(t[ti - 1])) score += 3;
      if (first === -1) first = ti;
      prev = ti;
      at.push(ti);
    }
    // matches near the start of the text beat matches buried deep in it
    return { score: score - first / 10 - t.length / 100, at };
  }

  function show(list) {
    entries = list;
    selected = entries.findIndex((e) => e.url);
    render();
  }

  // Selection moves by re-tagging two rows; the list DOM is only rebuilt
  // when the entry set itself changes.
  function move(dir) {
    for (let i = selected + dir; i >= 0 && i < entries.length; i += dir) {
      if (entries[i].url) {
        rows[selected]?.classList.remove("selected");
        rows[selected]?.setAttribute("aria-selected", "false");
        selected = i;
        applySelection();
        return;
      }
    }
  }

  function applySelection() {
    const row = rows[selected];
    if (!row) {
      ui.input.removeAttribute("aria-activedescendant");
      return;
    }
    row.classList.add("selected");
    row.setAttribute("aria-selected", "true");
    ui.input.setAttribute("aria-activedescendant", row.id);
    row.scrollIntoView({ block: "nearest" });
  }

  function render() {
    const { list, count, input } = ui;
    const mode = input.value ? "search" : "tree";
    list.dataset.mode = mode;
    rows = [];
    list.replaceChildren();
    entries.forEach((entry, i) => {
      const li = document.createElement("li");
      li.style.paddingLeft = `${16 + entry.depth * 14}px`;
      if (entry.folder) {
        li.className = "folder";
        li.setAttribute("role", "presentation");
        li.append(el("span", "marker"), icon("folder", "kind"), titleSpan(entry));
      } else {
        li.id = `row-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        li.append(icon("chevron", "marker"));
        if (mode === "tree") li.append(icon("bookmark", "kind"));
        li.append(titleSpan(entry));
        if (mode === "search") {
          const meta = el("span", "host");
          meta.textContent = entry.path ? `${entry.path} · ${entry.host}` : entry.host;
          li.append(meta);
        }
        li.addEventListener("click", () => openEntry(entry));
      }
      rows.push(li);
      list.append(li);
    });
    count.textContent =
      mode === "search" ? `${entries.length}/${allBookmarks.length}` : String(treeCount);
    applySelection();
  }

  // Title with the fuzzy-matched characters wrapped in <b>.
  function titleSpan(entry) {
    const span = el("span", "title");
    if (!entry.at?.length) {
      span.textContent = entry.title;
      return span;
    }
    const at = new Set(entry.at);
    const t = entry.title;
    let i = 0;
    while (i < t.length) {
      const hit = at.has(i);
      let j = i + 1;
      while (j < t.length && at.has(j) === hit) j++;
      const chunk = t.slice(i, j);
      if (hit) {
        const b = document.createElement("b");
        b.textContent = chunk;
        span.append(b);
      } else {
        span.append(chunk);
      }
      i = j;
    }
    return span;
  }

  // Open in the background so the overlay's death can't cut the work short.
  function openEntry(entry) {
    api.runtime.sendMessage({ type: "open-url", url: entry.url, windowId: originWindowId });
    ui.dialog.close();
  }

  function el(tag, className) {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  }

  // PrimeIcons (MIT, github.com/primefaces/primeicons), inlined — a content
  // script must not fetch assets from the page context.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICONS = {
    folder:
      "M17.5,19.25H6.5A2.75,2.75,0,0,1,3.75,16.5v-9A2.75,2.75,0,0,1,6.5,4.75H9A.77.77,0,0,1,9.57,5l2.77,3.24H17.5A2.75,2.75,0,0,1,20.25,11v5.5A2.75,2.75,0,0,1,17.5,19.25Zm-11-13A1.25,1.25,0,0,0,5.25,7.5v9A1.25,1.25,0,0,0,6.5,17.75h11a1.25,1.25,0,0,0,1.25-1.25V11A1.25,1.25,0,0,0,17.5,9.75H12a.77.77,0,0,1-.57-.26L8.66,6.25Z",
    bookmark:
      "M17.75,20.75a.83.83,0,0,1-.43-.13L12,16.91,6.68,20.62a.75.75,0,0,1-.78,0A.74.74,0,0,1,5.5,20V6A2.75,2.75,0,0,1,8.25,3.25h7.5A2.75,2.75,0,0,1,18.5,6V20a.74.74,0,0,1-.4.66A.73.73,0,0,1,17.75,20.75ZM12,15.25a.75.75,0,0,1,.43.13L17,18.56V6a1.25,1.25,0,0,0-1.25-1.25H8.25A1.25,1.25,0,0,0,7,6V18.56l4.57-3.18A.75.75,0,0,1,12,15.25Z",
    chevron:
      "M10,17.75a.74.74,0,0,1-.53-.22.75.75,0,0,1,0-1.06L13.94,12,9.47,7.53a.75.75,0,0,1,1.06-1.06l5,5a.75.75,0,0,1,0,1.06l-5,5A.74.74,0,0,1,10,17.75Z",
  };

  function icon(name, className) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", className);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICONS[name]);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
    return svg;
  }
})();
