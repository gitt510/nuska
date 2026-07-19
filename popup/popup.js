const api = globalThis.browser ?? globalThis.chrome;

const searchInput = document.getElementById("search-input");
const resultList = document.getElementById("result-list");

let allBookmarks = []; // every bookmark, flattened — the fuzzy search corpus
let treeEntries = []; // bookmarks-bar tree — shown while the query is empty
let entries = []; // whatever is currently rendered
let selected = 0;

init();

async function init() {
  const roots = await api.bookmarks.getTree();
  allBookmarks = flatten(roots);
  treeEntries = buildTree(barNode(roots));
  searchInput.focus();
  show(treeEntries);
}

searchInput.addEventListener("input", () => search(searchInput.value));

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "n" || e.key === "p")) {
    e.preventDefault();
    move(e.key === "n" ? 1 : -1);
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
      if (entries[selected]?.url) open(entries[selected]);
      break;
    case "Escape":
      e.preventDefault();
      if (searchInput.value) {
        searchInput.value = "";
        show(treeEntries);
      } else {
        window.close();
      }
      break;
  }
});

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
    .map((b) => ({ ...b, score: scoreBookmark(query, b) }))
    .filter((b) => b.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((b) => ({ title: b.title, url: b.url, depth: 0, host: b.matchUrl.split("/")[0], path: b.path }));
  show(results);
}

// Title and URL are scored independently and the best wins, so a domain
// prefix ("ra" → rakuten-sec.co.jp) ranks as high as a title match.
function scoreBookmark(query, b) {
  return Math.max(fuzzyScore(query, b.title) + 1, fuzzyScore(query, b.matchUrl));
}

// Subsequence match: -Infinity if query chars don't appear in order,
// otherwise higher is better (consecutive chars and word starts win).
function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let ti = -1;
  let prev = -2;
  let first = -1;
  for (const ch of q) {
    ti = t.indexOf(ch, ti + 1);
    if (ti === -1) return -Infinity;
    score += ti === prev + 1 ? 5 : 1;
    if (ti === 0 || " /-_.".includes(t[ti - 1])) score += 3;
    if (first === -1) first = ti;
    prev = ti;
  }
  // matches near the start of the text beat matches buried deep in it
  return score - first / 10 - t.length / 100;
}

function show(list) {
  entries = list;
  selected = entries.findIndex((e) => e.url);
  render();
}

function move(dir) {
  for (let i = selected + dir; i >= 0 && i < entries.length; i += dir) {
    if (entries[i].url) {
      selected = i;
      render();
      return;
    }
  }
}

function render() {
  resultList.replaceChildren();
  entries.forEach((entry, i) => {
    const li = document.createElement("li");
    li.style.paddingLeft = `${12 + entry.depth * 14}px`;
    li.textContent = entry.title;
    if (entry.folder) {
      li.className = "folder";
    } else {
      if (entry.host) {
        const span = document.createElement("span");
        span.className = "path";
        span.textContent = entry.path ? `${entry.host} · ${entry.path}` : entry.host;
        li.append(span);
      }
      li.classList.toggle("selected", i === selected);
      li.addEventListener("click", () => open(entry));
    }
    resultList.append(li);
  });
  resultList.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

// Open in the background so the popup's death can't cut the work short.
function open(entry) {
  api.runtime.sendMessage({ type: "open-url", url: entry.url });
  window.close();
}
