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

  // A board of backlit keycaps. Legends sit unlit on a dark warm board; the
  // typed prefix presses in and lights amber, and the header echoes each
  // keystroke as a lit cap — red when nothing matches. The launcher keeps its
  // own neon/hud look; this overlay is on screen for half a second and reads
  // better as one confident thing than as two switchable ones.
  const CSS = `
dialog {
  --bg: #211a12;
  --fg: #ede3d1;
  --muted: #8d8070;
  --legend: #a2937a;
  --amber: #ffbe5c;
  --glow: rgba(255, 174, 66, 0.55);
  --cap-edge: #453927;
  --cap-under: #0f0a05;
  --line: #322919;
  --miss: #ff8a70;
  --font: system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, monospace;

  width: min(640px, 94vw);
  margin: 16vh auto auto;
  padding: 0;
  border: 1px solid #3b3120;
  border-radius: 12px;
  overflow: clip;
  /* faint light from above, as if the board sits under a lamp */
  background:
    radial-gradient(120% 90% at 50% -20%, rgba(255, 190, 92, 0.07), transparent 60%),
    var(--bg);
  color: var(--fg);
  font: 14px/1.45 var(--font);
  box-shadow:
    inset 0 1px 0 rgba(255, 235, 200, 0.06),
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
  background: rgba(14, 10, 4, 0.5);
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
   rejection), but the echo caps are the display — the field itself is hidden. */
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
  gap: 5px;
}

.cap {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 22px;
  border: 1px solid var(--cap-edge);
  border-bottom-color: var(--cap-under);
  border-radius: 6px;
  background: linear-gradient(#352b1c, #2a2114);
  box-shadow: 0 2px 0 var(--cap-under), inset 0 1px 0 rgba(255, 235, 200, 0.07);
  color: var(--legend);
  font: 600 12px/1 var(--mono);
  transition: transform 70ms, box-shadow 70ms, color 70ms;
}

/* pressed: the cap sinks onto the board and the backlight comes through */
.cap.lit {
  transform: translateY(2px);
  border-color: #6a5121;
  background: linear-gradient(#4a3a1e, #3a2d15);
  box-shadow: 0 0 0 var(--cap-under), 0 0 14px rgba(255, 174, 66, 0.25),
    inset 0 1px 0 rgba(255, 220, 150, 0.12);
  color: var(--amber);
  text-shadow: 0 0 9px var(--glow);
}

.cap.miss {
  border-color: #6a3524;
  color: var(--miss);
  text-shadow: 0 0 9px rgba(255, 110, 80, 0.5);
  box-shadow: 0 0 0 var(--cap-under), 0 0 14px rgba(255, 110, 80, 0.2);
}

@media (prefers-reduced-motion: reduce) {
  dialog[open],
  .cap {
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

/* A fixed key track: caps have to line up down a column, and they cannot if
   each cell sizes its own. 44px fits two 20px caps and their gap. */
li {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  column-gap: 10px;
  padding: 5px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 90ms;
}

li:hover {
  background: rgba(255, 235, 200, 0.04);
}

/* Narrowing never removes a row — an unreachable key stays readable so the
   whole set is still in view while typing. */
li.dim {
  opacity: 0.28;
}

.keys {
  display: flex;
  gap: 3px;
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

.notice.bad {
  color: var(--miss);
}

/* The link whispers from the corner in the board's unlit grey; amber is
   reserved for what typing lights up. */
.link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--muted);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: rgba(141, 128, 112, 0.45);
}

.link:hover {
  color: var(--amber);
}

.notice .link {
  margin: 0;
  color: var(--amber);
  text-decoration-color: rgba(255, 190, 92, 0.4);
}

.link:focus-visible {
  outline: 1px solid var(--amber);
  outline-offset: 2px;
}
`;

  // The fallback window must open tabs in the window it was launched from.
  const originWindowId = IN_PAGE
    ? undefined
    : Number(new URLSearchParams(location.search).get("origin")) || undefined;

  let shortcuts = []; // every shortcut, sorted by key — all of them stay rendered
  let rows = []; // row elements parallel to shortcuts
  let rowCaps = []; // per-row keycap elements, parallel to shortcuts
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
      rowCaps[i].forEach((cap, j) => cap.classList.toggle("lit", hit && j < buf.length));
      if (hit) hits.push(i);
    });
    echoRender(buf, buf.length > 0 && hits.length === 0);
    // Settings keeps the key set prefix-free, so firing on an exact match is
    // firing on the only reachable meaning of the buffer. In a hand-edited
    // store that violates the rule, the shorter key wins — same as SK2U.
    const exact = shortcuts.find((s) => s.key === buf);
    if (exact) fire(exact);
  }

  // The header shows what was pressed, as pressed caps — red when it matches
  // nothing, which is also the only state that needs Escape to clear.
  function echoRender(buf, miss) {
    ui.head.classList.toggle("typing", buf.length > 0);
    ui.echo.replaceChildren(
      ...[...buf].map((ch) => {
        const cap = el("span", miss ? "cap lit miss" : "cap lit");
        cap.textContent = ch;
        return cap;
      }),
    );
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
    rowCaps = [];
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
      const keys = el("span", "keys");
      const caps = [...entry.key].map((ch) => {
        const cap = el("span", "cap");
        cap.textContent = ch;
        keys.append(cap);
        return cap;
      });
      const title = el("span", "title");
      title.textContent = entry.title;
      li.append(keys, title);
      li.addEventListener("click", () => fire(entry));
      rows.push(li);
      rowCaps.push(caps);
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
