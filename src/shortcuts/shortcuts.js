// Shortcuts overlay. One file, two contexts:
//  - injected into the page as a content script (bg.js, on Ctrl+,): renders a
//    centered <dialog> inside a shadow root, on the page's top layer
//  - loaded by shortcuts.html inside a centered popup window: the fallback for
//    pages that refuse injection (chrome://, the Web Store, …)
//
// Execute-only — the settings page owns the list. The whole set stays on
// screen the entire time: typing dims what no longer matches rather than
// removing it, so the keys are always in view. The buffer equalling a key IS
// the action — there is no selection to move or confirm.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  // Extension pages live under runtime.getURL(""); injected ones never do.
  const IN_PAGE = !location.href.startsWith(api.runtime.getURL(""));

  // Re-injecting the file toggles the already-open overlay instead.
  if (IN_PAGE && globalThis.__shortcutsToggle) {
    globalThis.__shortcutsToggle();
    return;
  }

  // Monochrome: brightness is the only signal. Each key is one chip; the
  // typed prefix lights white while everything unreachable falls to near-
  // black, and the header echoes the buffer as an inverted chip. The palette
  // is shared with the settings page by copy (see settings/settings.html).
  const CSS = `
dialog {
  --bg: #161616;
  --fg: #f0f0f0;
  --muted: #9c9c9c;
  --faint: #585858;
  --line: #2b2b2b;
  --chip: #3a3a3a;
  --hot: #6b6b6b;
  --font: system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, monospace;

  width: min(640px, 94vw);
  margin: 16vh auto auto;
  padding: 0;
  border: 1px solid #2e2e2e;
  border-radius: 12px;
  overflow: clip;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.45 var(--font);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 24px 80px rgba(0, 0, 0, 0.6);
}

dialog[open] {
  transition: opacity 130ms ease-out, transform 130ms ease-out;
}

@starting-style {
  dialog[open] {
    opacity: 0;
    transform: translateY(8px);
  }
}

dialog::backdrop {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(3px);
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
  gap: 5px;
  min-height: 48px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--line);
}

/* The buffer lives in a real input for free text editing (Backspace, IME
   rejection), but the echo chip is the display — the field itself is hidden. */
.buf {
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  overflow: hidden;
}

.prompt {
  display: flex;
  flex: 1;
  color: var(--muted);
  font-size: 12.5px;
  letter-spacing: 0.02em;
}

.head.typing .prompt {
  display: none;
}

.echo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.nomatch {
  color: var(--faint);
  font-size: 12px;
}

/* One chip per shortcut — "gp" is a single unit, not two keys. */
.key {
  display: inline-flex;
  justify-content: center;
  min-width: 24px;
  padding: 3px 7px;
  border: 1px solid var(--chip);
  border-radius: 5px;
  color: var(--muted);
  font: 600 12px/1.2 var(--mono);
  letter-spacing: 0.05em;
  transition: border-color 70ms;
}

.key span {
  transition: color 70ms;
}

/* the typed prefix lights up inside the chip */
.key span.on {
  color: var(--fg);
}

.key.hot {
  border-color: var(--hot);
}

/* the header echo: what was pressed, inverted */
.key.fill {
  padding: 4px 9px;
  border-color: var(--fg);
  background: var(--fg);
  color: #111;
  font-size: 13px;
}

@media (prefers-reduced-motion: reduce) {
  dialog[open],
  .key,
  .key span {
    transition: none;
  }
}

/* Alphabetical, read across then down. The point of the grid is that the whole
   key set is takeable in at a glance, which one tall column never is. */
ul {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  gap: 3px 12px;
  margin: 0;
  padding: 12px 14px;
  list-style: none;
  max-height: min(52vh, 440px);
  overflow-y: auto;
}

dialog.windowed ul {
  max-height: calc(100vh - 80px);
}

/* A fixed key track: chips have to line up down a column, and they cannot if
   each cell sizes its own. 48px fits a two-character chip. */
li {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  column-gap: 10px;
  padding: 5px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 90ms;
}

li:hover {
  background: rgba(255, 255, 255, 0.045);
}

/* Narrowing never removes a row — an unreachable key stays readable so the
   whole set is still in view while typing. */
li.dim {
  opacity: 0.18;
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.notice {
  grid-column: 1 / -1;
  display: block;
  padding: 14px 8px;
  color: var(--muted);
  cursor: default;
}

/* monochrome: full white is the alarm */
.notice.bad {
  color: var(--fg);
}

.link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--muted);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: rgba(156, 156, 156, 0.45);
}

.link:hover {
  color: var(--fg);
}

.link:focus-visible {
  outline: 1px solid var(--fg);
  outline-offset: 2px;
}

.notice .link {
  margin: 0;
  color: var(--fg);
  text-decoration-color: rgba(240, 240, 240, 0.4);
}
`;

  // The fallback window must open tabs in the window it was launched from.
  const originWindowId = IN_PAGE
    ? undefined
    : Number(new URLSearchParams(location.search).get("origin")) || undefined;

  let shortcuts = []; // every shortcut, sorted by key — all of them stay rendered
  let rows = []; // row elements parallel to shortcuts
  let rowChips = []; // the key chip of each row, parallel to shortcuts
  let rowChars = []; // per-row character spans inside the chip
  let hits = []; // indices matching the current buffer
  let ui = null; // { host, dialog, input, head, prompt, echo, list } while open

  if (IN_PAGE) {
    globalThis.__shortcutsToggle = () => (ui ? ui.dialog.close() : open());
  } else {
    window.addEventListener("blur", () => window.close());
  }
  open();

  async function open() {
    ui = build();
    try {
      const synced = await api.storage.sync.get("shortcuts");
      if (!ui) return; // closed before the data arrived
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
    input.className = "buf";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Shortcut key");
    const prompt = el("span", "prompt");
    prompt.append("type a key", settingsLink("⌃O settings"));
    const echo = el("span", "echo");
    echo.setAttribute("aria-hidden", "true");
    head.append(input, prompt, echo);

    const list = document.createElement("ul");

    dialog.append(head, list);

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
    // The input is invisible, so a stray click must not be able to unfocus it.
    dialog.addEventListener("mousedown", (e) => {
      if (e.target !== input) e.preventDefault();
    });
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
    return { host, dialog, input, head, prompt, echo, list };
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
      rowChips[i].classList.toggle("hot", hit && buf.length > 0);
      rowChars[i].forEach((c, j) => c.classList.toggle("on", hit && j < buf.length));
      if (hit) hits.push(i);
    });
    echoRender(buf, buf.length > 0 && hits.length === 0);
    // Settings keeps the key set prefix-free, so firing on an exact match is
    // firing on the only reachable meaning of the buffer. In a hand-edited
    // store that violates the rule, the shorter key wins — same as SK2U.
    const exact = shortcuts.find((s) => s.key === buf);
    if (exact) fire(exact);
  }

  // The header shows the buffer as an inverted chip — with a plain word next
  // to it when it matches nothing, which is the only state Escape must clear.
  function echoRender(buf, miss) {
    ui.head.classList.toggle("typing", buf.length > 0);
    ui.echo.replaceChildren();
    if (!buf) return;
    const chip = el("span", "key fill");
    chip.textContent = buf;
    ui.echo.append(chip);
    if (miss) {
      const label = el("span", "nomatch");
      label.textContent = "no match — esc clears";
      ui.echo.append(label);
    }
  }

  function onKeydown(e) {
    e.stopPropagation(); // keep the page's own shortcuts out of the overlay
    if (e.ctrlKey && e.key === "o") {
      e.preventDefault();
      openSettings();
      return;
    }
    // With a buffer, Escape only clears it; preventDefault stops the dialog's
    // native close request. An empty buffer lets it through.
    if (e.key === "Escape" && ui.input.value) {
      e.preventDefault();
      ui.input.value = "";
      narrow("");
    }
  }

  function render() {
    const { list } = ui;
    rows = [];
    rowChips = [];
    rowChars = [];
    list.replaceChildren();
    if (!shortcuts.length) {
      const empty = notice("No shortcuts yet — add one in ");
      empty.append(settingsLink("settings"));
      list.append(empty);
      return;
    }
    shortcuts.forEach((entry, i) => {
      const li = document.createElement("li");
      // A cell has no room for the host, so it moves to the hover text.
      li.title = entry.host ? `${entry.title} — ${entry.host}` : entry.title;
      const chip = el("span", "key");
      const chars = [...entry.key].map((ch) => {
        const c = document.createElement("span");
        c.textContent = ch;
        chip.append(c);
        return c;
      });
      const title = el("span", "title");
      title.textContent = entry.title;
      li.append(chip, title);
      li.addEventListener("click", () => fire(entry));
      rows.push(li);
      rowChips.push(chip);
      rowChars.push(chars);
      list.append(li);
    });
    narrow("");
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
