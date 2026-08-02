// Shortcuts overlay. One file, two contexts:
//  - injected into the page as a content script (bg.js, on Ctrl+,): renders a
//    centered <dialog> inside a shadow root, on the page's top layer
//  - loaded by shortcuts.html inside a centered popup window: the fallback for
//    pages that refuse injection (chrome://, the Web Store, …)
//
// Execute-only — the settings page owns the list. The whole set stays on
// screen the entire time: typing dims what no longer matches rather than
// removing it, so the keys are always in view. A lone full match fires at
// once, which makes the usual path Ctrl+, then the key, with no Enter.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  // Extension pages live under runtime.getURL(""); injected ones never do.
  const IN_PAGE = !location.href.startsWith(api.runtime.getURL(""));

  // Re-injecting the file toggles the already-open overlay instead.
  if (IN_PAGE && globalThis.__shortcutsToggle) {
    globalThis.__shortcutsToggle();
    return;
  }

  const THEMES = ["neon", "hud"];
  // Columns in the key grid. Drives both the CSS tracks and the row-wise
  // arrow keys, so the two can't drift apart.
  const COLUMNS = 3;
  // The palette is a copy of launcher.js's, deliberately: sharing it would
  // mean a fetched stylesheet or an injected shell, and neither is worth it
  // for two consumers. Next change to either look is the time to extract.
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

  width: min(660px, 94vw);
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
  color: var(--match);
  caret-color: var(--match);
  font: inherit;
  font-family: ui-monospace, monospace;
  font-size: 15px;
  letter-spacing: 0.08em;
}

input::placeholder {
  color: var(--muted);
  letter-spacing: normal;
  font-family: var(--font);
}

.count {
  padding-right: 14px;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* Alphabetical, read across then down. The point of the grid is that the whole
   key set is takeable in at a glance, which one tall column never is. */
ul {
  display: grid;
  grid-template-columns: repeat(${COLUMNS}, minmax(0, 1fr));
  align-content: start;
  gap: 1px 10px;
  margin: 0;
  padding: 10px 12px;
  list-style: none;
  max-height: min(52vh, 440px);
  overflow-y: auto;
}

dialog.windowed ul {
  max-height: calc(100vh - 80px);
}

/* A fixed key track rather than max-content: the keys have to line up down a
   column, and they cannot line up if each cell sizes its own. */
li {
  display: grid;
  grid-template-columns: 2.6em minmax(0, 1fr);
  align-items: baseline;
  column-gap: 8px;
  padding: 5px 8px;
  border-radius: 5px;
  cursor: pointer;
}

/* Narrowing never removes a row — an unreachable key stays readable so the
   whole set is still in view while typing. */
li.dim {
  opacity: 0.3;
}

.key {
  color: var(--accent);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
}

li .title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

li.selected {
  position: relative;
  background-color: var(--selected-bg);
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

.notice {
  grid-column: 1 / -1;
  display: block;
  padding: 16px;
  color: var(--muted);
  cursor: default;
}

.notice.bad {
  color: #ff7676;
}

.hints {
  display: flex;
  gap: 8px;
  padding: 6px 16px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--match);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.notice .link {
  margin: 0;
  font-size: inherit;
}
`;

  // The fallback window must open tabs in the window it was launched from.
  const originWindowId = IN_PAGE
    ? undefined
    : Number(new URLSearchParams(location.search).get("origin")) || undefined;

  let shortcuts = []; // every shortcut, sorted by key — all of them stay rendered
  let rows = []; // row elements parallel to shortcuts
  let hits = []; // indices matching the current buffer
  let selected = -1; // index into shortcuts, or -1
  let theme = "neon";
  let ui = null; // { host, dialog, input, count, list } while open

  if (IN_PAGE) {
    globalThis.__shortcutsToggle = () => (ui ? ui.dialog.close() : open());
  } else {
    window.addEventListener("blur", () => window.close());
  }
  open();

  async function open() {
    ui = build();
    try {
      const [local, synced] = await Promise.all([
        api.storage.local.get("theme"),
        api.storage.sync.get("shortcuts"),
      ]);
      if (!ui) return; // closed before the data arrived
      theme = THEMES.includes(local.theme) ? local.theme : "neon";
      applyTheme();
      shortcuts = (synced.shortcuts ?? []).map(decorate).sort((a, b) => a.key.localeCompare(b.key));
      render();
    } catch (err) {
      // Without this the overlay just sits there empty and says nothing about
      // why — the one failure mode that leaves nobody anything to go on.
      if (!ui) return;
      ui.list.replaceChildren(notice(`Could not read your shortcuts — ${err.message ?? err}`, true));
    }
  }

  function decorate(s) {
    let host = "";
    try {
      host = new URL(s.url).host.replace(/^www\./, "");
    } catch {
      // settings validates URLs; a hand-edited store just loses the host column
    }
    return { key: s.key, url: s.url, host, title: s.title || host || s.url };
  }

  function build() {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("closedby", "any");
    dialog.setAttribute("aria-label", "Shortcuts");

    const head = el("div", "head");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "key…";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "results");
    input.setAttribute("aria-label", "Shortcut key");
    const count = el("span", "count");
    head.append(input, count);

    const list = document.createElement("ul");
    list.id = "results";
    list.setAttribute("role", "listbox");

    const hints = el("div", "hints");
    hints.append("↵ open · ⌃N ⌃P move · ⌃T theme · esc close", settingsLink("⌃O settings"));
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
    input.addEventListener("input", onInput);
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

  // Keys are normalized ASCII, so anything else — IME composition included —
  // is dropped rather than left to narrow against nothing.
  function onInput() {
    const buf = ui.input.value.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (buf !== ui.input.value) ui.input.value = buf;
    narrow(buf);
  }

  function narrow(buf) {
    hits = [];
    shortcuts.forEach((s, i) => {
      const hit = s.key.startsWith(buf);
      rows[i].classList.toggle("dim", !hit);
      if (hit) hits.push(i);
    });
    ui.count.textContent = buf ? `${hits.length}/${shortcuts.length}` : String(shortcuts.length);
    select(hits.length ? hits[0] : -1);
    // Settings keeps the key set prefix-free, so a full match is the only hit
    // and can fire without waiting. The count check is what keeps a store that
    // violates that rule reachable through Enter instead of trapping it.
    if (hits.length === 1 && shortcuts[hits[0]].key === buf) fire(shortcuts[hits[0]]);
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
    if (e.ctrlKey && e.key === "o") {
      e.preventDefault();
      openSettings();
      return;
    }
    switch (e.key) {
      // A row apart on screen is COLUMNS apart in the list. Left/Right are
      // left to the caret — the buffer is still an editable text field.
      case "ArrowDown":
        e.preventDefault();
        move(COLUMNS);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-COLUMNS);
        break;
      case "Enter":
        e.preventDefault();
        if (selected >= 0) fire(shortcuts[selected]);
        break;
      case "Escape":
        // With a buffer, Escape only clears it; preventDefault stops the
        // dialog's native close request. An empty buffer lets it through.
        if (ui.input.value) {
          e.preventDefault();
          ui.input.value = "";
          narrow("");
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

  function render() {
    const { list, count } = ui;
    rows = [];
    list.replaceChildren();
    if (!shortcuts.length) {
      const empty = notice("No shortcuts yet — add one in ");
      empty.append(settingsLink("settings"));
      list.append(empty);
      count.textContent = "";
      return;
    }
    shortcuts.forEach((entry, i) => {
      const li = document.createElement("li");
      li.id = `row-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      // A cell has no room for the host, so it moves to the hover text.
      li.title = entry.host ? `${entry.title} — ${entry.host}` : entry.title;
      const key = el("span", "key");
      key.textContent = entry.key;
      const title = el("span", "title");
      title.textContent = entry.title;
      li.append(key, title);
      li.addEventListener("click", () => fire(entry));
      rows.push(li);
      list.append(li);
    });
    narrow("");
  }

  // Moves within the matching rows, so a dimmed one is never landed on.
  // A step past either end clamps to it, so a row step from the last, partly
  // filled row still moves rather than doing nothing.
  function move(step) {
    if (!hits.length) return;
    const at = hits.indexOf(selected);
    if (at === -1) return select(hits[step > 0 ? 0 : hits.length - 1]);
    const next = Math.min(Math.max(at + step, 0), hits.length - 1);
    if (next !== at) select(hits[next]);
  }

  function select(i) {
    if (selected >= 0 && rows[selected]) {
      rows[selected].classList.remove("selected");
      rows[selected].setAttribute("aria-selected", "false");
    }
    selected = i;
    if (i < 0 || !rows[i]) {
      ui.input.removeAttribute("aria-activedescendant");
      return;
    }
    rows[i].classList.add("selected");
    rows[i].setAttribute("aria-selected", "true");
    ui.input.setAttribute("aria-activedescendant", rows[i].id);
    rows[i].scrollIntoView({ block: "nearest" });
  }

  // Open in the background so the overlay's death can't cut the work short.
  function fire(entry) {
    api.runtime.sendMessage({ type: "open-url", url: entry.url, windowId: originWindowId });
    ui.dialog.close();
  }

  function openSettings() {
    api.runtime.sendMessage({ type: "open-options" });
    ui.dialog.close();
  }

  function notice(text, bad = false) {
    const li = document.createElement("li");
    li.className = bad ? "notice bad" : "notice";
    li.setAttribute("role", "presentation");
    li.textContent = text;
    return li;
  }

  function settingsLink(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link";
    button.textContent = label;
    button.addEventListener("click", openSettings);
    return button;
  }

  function el(tag, className) {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  }
})();
