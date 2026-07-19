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

renderCommandList();

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
  bookmarks = flatten(await api.bookmarks.getTree());
  rootView.hidden = true;
  searchView.hidden = false;
  searchInput.focus();
  search("");
}

function flatten(nodes, path = []) {
  const out = [];
  for (const node of nodes) {
    if (node.url) {
      out.push({ title: node.title || node.url, url: node.url, path: path.join("/") });
    }
    if (node.children) {
      out.push(...flatten(node.children, node.title ? [...path, node.title] : path));
    }
  }
  return out;
}

function search(query) {
  results = bookmarks
    .map((b) => ({ ...b, score: fuzzyScore(query, `${b.title} ${b.url}`) }))
    .filter((b) => b.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  selected = 0;
  renderResults();
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
  for (const ch of q) {
    ti = t.indexOf(ch, ti + 1);
    if (ti === -1) return -Infinity;
    score += ti === prev + 1 ? 5 : 1;
    if (ti === 0 || " /-_.".includes(t[ti - 1])) score += 3;
    prev = ti;
  }
  return score - t.length / 100;
}

function renderResults() {
  resultList.replaceChildren();
  results.forEach((b, i) => {
    const li = document.createElement("li");
    li.textContent = b.title;
    if (b.path) {
      const span = document.createElement("span");
      span.className = "path";
      span.textContent = b.path;
      li.append(span);
    }
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
    default:
      // let the input update first, then re-filter
      requestAnimationFrame(() => search(searchInput.value));
  }
}

function open(bookmark) {
  dispatch({ type: "open-url", url: bookmark.url });
}
