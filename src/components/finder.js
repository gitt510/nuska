// Finder overlay: one search box over a list of pages, shared by bookmarks and
// history. The file injected just before this one (lib/bookmarks.js or
// lib/history.js) leaves its source on globalThis.__nuskaSource:
//   { kind, label, placeholder, load(api, inPage) → { rest, all } }
// where every entry is { title, url, host, matchUrl, path }. `rest` is what
// shows before typing; `all` is the fuzzy-search corpus.
//
// Two contexts, like the shortcuts overlay:
//  - injected into the page as a content script (background.js): a centered
//    <dialog> inside a shadow root, on the page's top layer
//  - loaded by app/overlay.html inside a popup window: the fallback for pages
//    that refuse injection (chrome://, the Web Store, …)
//
// Every element comes from components/ui.js; nothing here names a class.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const UI = globalThis.__nuskaUi;
  const source = globalThis.__nuskaSource;
  const IN_PAGE = !location.href.startsWith(api.runtime.getURL(""));

  // Re-injecting toggles the already-open finder of the same kind instead.
  const toggles = (globalThis.__nuskaToggles ??= {});
  if (IN_PAGE && toggles[source.kind]) {
    toggles[source.kind]();
    return;
  }

  // The fallback window must open tabs in the window it was launched from.
  const originWindowId = IN_PAGE
    ? undefined
    : Number(new URLSearchParams(location.search).get("origin")) || undefined;

  let all = []; // the search corpus
  let rest = []; // shown while the query is empty
  let entries = []; // whatever is currently rendered
  let rows = []; // row elements parallel to entries
  let selected = 0;
  let ui = null; // { host, dialog, input, count, list } while open

  if (IN_PAGE) {
    toggles[source.kind] = () => (ui ? ui.dialog.close() : open());
  } else {
    window.addEventListener("blur", () => window.close());
  }
  open();

  async function open() {
    // The accent is read before building: the rows are painted with it.
    const [res] = await Promise.all([
      IN_PAGE ? api.runtime.sendMessage({ type: "get-css" }) : null,
      UI.loadAccent(api),
    ]);
    const css = IN_PAGE ? (res?.ok ? res.css : "") : null;
    ui = build(css);
    try {
      const loaded = await source.load(api, IN_PAGE);
      if (!ui) return; // closed before the data arrived
      all = loaded.all;
      rest = loaded.rest;
      show(rest);
    } catch (err) {
      if (!ui) return;
      ui.list.replaceChildren(notice(`Could not read your ${source.kind} — ${err.message ?? err}`));
    }
  }

  function build(css) {
    const { root: dialog, header, body } = UI.dialog(source.label, { fill: !IN_PAGE });

    const input = UI.search(source.placeholder);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "results");
    input.setAttribute("aria-label", `Search ${source.label}`);
    const count = UI.count();
    header.append(input, count);

    const list = UI.list();
    list.id = "results";
    list.setAttribute("role", "listbox");
    body.append(list);

    let host = null;
    if (IN_PAGE) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      host = document.createElement("div");
      const shadow = host.attachShadow({ mode: "closed" });
      shadow.adoptedStyleSheets = [sheet];
      shadow.append(dialog);
      document.documentElement.append(host);
    } else {
      // app/overlay.html links the same stylesheet
      UI.theme(document.documentElement);
      document.body.append(dialog);
    }

    dialog.addEventListener("keydown", onKeydown);
    input.addEventListener("input", () => search(input.value));
    dialog.addEventListener("close", () => {
      ui = null;
      if (IN_PAGE) host.remove();
      else window.close();
    });
    // The dialog fills the viewport and the modal card sits inside it, so a
    // click that lands on the dialog itself is outside the card.
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });

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
        if (entries[selected]) openEntry(entries[selected]);
        break;
      case "Escape":
        // With a query, Escape only clears it; preventDefault stops the
        // dialog's native close request. An empty query lets it through.
        if (ui.input.value) {
          e.preventDefault();
          ui.input.value = "";
          show(rest);
        }
        break;
    }
  }

  function search(query) {
    if (!query) {
      show(rest);
      return;
    }
    const results = all
      .map((b) => ({ ...b, ...score(query, b) }))
      .filter((b) => b.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    show(results);
  }

  // Title, URL and parent path are scored independently and the best wins,
  // so a domain prefix ("ra" → rakuten-sec.co.jp) or a folder name
  // ("console") ranks alongside title matches; the path channel carries a
  // small penalty so it never beats a direct hit of the same quality.
  // Match positions are kept only for title matches — they are what's shown.
  function score(query, b) {
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
    selected = 0;
    render();
  }

  // Selection moves by re-tagging two rows; the list DOM is only rebuilt
  // when the entry set itself changes.
  function move(dir) {
    const next = selected + dir;
    if (next < 0 || next >= entries.length) return;
    if (rows[selected]) {
      UI.select(rows[selected], false);
      rows[selected].setAttribute("aria-selected", "false");
    }
    selected = next;
    applySelection();
  }

  function applySelection() {
    const row = rows[selected];
    if (!row) {
      ui.input.removeAttribute("aria-activedescendant");
      return;
    }
    UI.select(row, true);
    row.setAttribute("aria-selected", "true");
    ui.input.setAttribute("aria-activedescendant", row.id);
    row.scrollIntoView({ block: "nearest" });
  }

  function render() {
    const { list, count, input } = ui;
    rows = [];
    list.replaceChildren();
    entries.forEach((entry, i) => {
      const li = UI.option({ title: titleOf(entry), meta: entry.host });
      li.id = `row-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      li.title = entry.url;
      li.addEventListener("click", () => openEntry(entry));
      rows.push(li);
      list.append(li);
    });
    count.textContent = input.value ? `${entries.length}/${all.length}` : "";
    applySelection();
  }

  // Title with the fuzzy-matched characters wrapped in <mark>.
  function titleOf(entry) {
    const title = UI.optionTitle();
    if (!entry.at?.length) {
      title.textContent = entry.title;
      return title;
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
        title.append(UI.mark(chunk));
      } else {
        title.append(chunk);
      }
      i = j;
    }
    return title;
  }

  // Open in the background so the overlay's death can't cut the work short.
  function openEntry(entry) {
    api.runtime.sendMessage({ type: "open-url", url: entry.url, windowId: originWindowId });
    ui.dialog.close();
  }

  function notice(text) {
    const node = UI.notice(text, true);
    node.setAttribute("role", "presentation");
    return node;
  }
})();
