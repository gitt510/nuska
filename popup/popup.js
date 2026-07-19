const api = globalThis.browser ?? globalThis.chrome;

// prefix + key bindings. Edit here for now; an options page comes later.
const COMMANDS = [
  { key: "b", label: "search bookmarks", run: enterSearchMode },
  { key: "s", label: "split windows left / right", run: () => dispatch({ type: "split", fallbackArea: screenArea() }) },
  { key: "m", label: "merge all windows", run: () => dispatch({ type: "merge" }) },
];

const rootView = document.getElementById("root-view");
const searchView = document.getElementById("search-view");
const searchInput = document.getElementById("search-input");
const resultList = document.getElementById("result-list");

let bookmarks = [];
let results = [];
let selected = 0;

// Start fetching immediately so search mode is ready by the time `b` is hit.
const bookmarksPromise = api.bookmarks.getTree().then(flatten);

renderCommandList();
searchInput.addEventListener("input", () => search(searchInput.value));

document.addEventListener("keydown", (e) => {
  if (!searchView.hidden) {
    onSearchKeydown(e);
    return;
  }
  const cmd = COMMANDS.find((c) => c.key === e.key);
  if (cmd) {
    e.preventDefault();
    cmd.run();
  }
});

function renderCommandList() {
  const list = document.getElementById("command-list");
  for (const c of COMMANDS) {
    const li = document.createElement("li");
    const kbd = document.createElement("kbd");
    kbd.textContent = c.key;
    li.append(kbd, c.label);
    list.append(li);
  }
}

// Fire the command in the background and close. The background does the
// actual work — this popup is gone as soon as focus moves.
function dispatch(msg) {
  api.runtime.sendMessage(msg);
  window.close();
}

// Firefox has no system.display API; pass this popup's screen as fallback.
function screenArea() {
  return { left: 0, top: 0, width: screen.availWidth, height: screen.availHeight };
}

// --- bookmark fuzzy search ---

async function enterSearchMode() {
  bookmarks = await bookmarksPromise;
  rootView.hidden = true;
  searchView.hidden = false;
  searchInput.focus();
  search("");
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
  results = bookmarks
    .map((b) => ({ ...b, score: scoreBookmark(query, b) }))
    .filter((b) => b.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  selected = 0;
  renderResults();
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

function renderResults() {
  resultList.replaceChildren();
  results.forEach((b, i) => {
    const li = document.createElement("li");
    li.textContent = b.title;
    const host = b.matchUrl.split("/")[0];
    const span = document.createElement("span");
    span.className = "path";
    span.textContent = b.path ? `${host} · ${b.path}` : host;
    li.append(span);
    li.classList.toggle("selected", i === selected);
    li.addEventListener("click", () => open(b));
    resultList.append(li);
  });
}

function onSearchKeydown(e) {
  if (e.ctrlKey && (e.key === "n" || e.key === "p")) {
    e.preventDefault();
    selected = e.key === "n"
      ? Math.min(selected + 1, results.length - 1)
      : Math.max(selected - 1, 0);
    renderResults();
    return;
  }
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      selected = Math.min(selected + 1, results.length - 1);
      renderResults();
      break;
    case "ArrowUp":
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
      renderResults();
      break;
    case "Enter":
      e.preventDefault();
      if (results[selected]) open(results[selected]);
      break;
    case "Escape":
      e.preventDefault();
      window.close();
      break;
    // typing is handled by the input's "input" event
  }
}

function open(bookmark) {
  dispatch({ type: "open-url", url: bookmark.url });
}
