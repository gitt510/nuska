// Keys overlay: a list of key → action pairs where the key IS the selection,
// shared by shortcuts and tools. The file injected just before this one
// (shortcuts/shortcuts.js or tools/tools.js) leaves its source on
// globalThis.__shukuchiKeys:
//   { kind, label, settings, load(api) → [{ key, title, hint }], fire(api, entry, ctx) }
// `settings` says whether ⌃O and the empty notice lead to the options page.
// `ctx` is { originWindowId, screen } — what an action needs to act on the
// page's window from the background.
//
// Two contexts, like the finder:
//  - injected into the page as a content script (bg.js): a centered <dialog>
//    inside a shadow root, on the page's top layer
//  - loaded by <kind>.html inside a centered popup window: the fallback for
//    pages that refuse injection (chrome://, the Web Store, …)
//
// Execute-only. The whole set stays on screen the entire time: typing dims
// what no longer matches rather than removing it, so the keys are always in
// view. The buffer equalling a key fires it — there is no selection to move
// or confirm.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const source = globalThis.__shukuchiKeys;
  // Extension pages live under runtime.getURL(""); injected ones never do.
  const IN_PAGE = !location.href.startsWith(api.runtime.getURL(""));

  // Re-injecting the file toggles the already-open overlay of the same kind.
  const toggles = (globalThis.__shukuchiToggles ??= {});
  if (IN_PAGE && toggles[source.kind]) {
    toggles[source.kind]();
    return;
  }

  // Styles come from design/tokens.css + design/theme.css + keys.css.
  // The page-injected copy has no <link>, so bg.js hands the text over.

  // The fallback window must act on the window it was launched from.
  const originWindowId = IN_PAGE
    ? undefined
    : Number(new URLSearchParams(location.search).get("origin")) || undefined;

  let entries = []; // every entry, sorted by key — all of them stay rendered
  let rows = []; // row elements parallel to entries
  let rowChips = []; // the key chip of each row, parallel to entries
  let rowChars = []; // per-row character spans inside the chip
  let hits = []; // indices matching the current buffer
  let ui = null; // { host, dialog, input, head, prompt, echo, list } while open

  if (IN_PAGE) {
    toggles[source.kind] = () => (ui ? ui.dialog.close() : open());
  } else {
    window.addEventListener("blur", () => window.close());
  }
  open();

  async function open() {
    let css = null;
    if (IN_PAGE) {
      const res = await api.runtime.sendMessage({ type: "get-css", name: "keys" });
      css = res?.ok ? res.css : "";
    }
    ui = build(css);
    try {
      const loaded = await source.load(api);
      if (!ui) return; // closed before the data arrived
      entries = loaded.sort((a, b) => a.key.localeCompare(b.key));
      render();
    } catch (err) {
      // Without this the overlay just sits there empty and says nothing about
      // why — the one failure mode that leaves nobody anything to go on.
      if (!ui) return;
      ui.list.replaceChildren(notice(`Could not read your ${source.kind} — ${err.message ?? err}`, true));
    }
  }

  function build(css) {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    dialog.setAttribute("closedby", "any");
    dialog.setAttribute("aria-label", source.label);

    const head = el("div", "head divider");
    const input = document.createElement("input");
    input.type = "text";
    // The buffer lives in a real input for free text editing (Backspace, IME
    // rejection), but the echo chip is the display — the field itself is hidden.
    input.className = "visually-hidden";
    input.autocomplete = "off";
    input.setAttribute("aria-label", `${source.label} key`);
    const prompt = el("span", "prompt muted");
    prompt.textContent = "type a key";
    const echo = el("span", "echo");
    echo.setAttribute("aria-hidden", "true");
    head.append(input, prompt, echo);

    const list = document.createElement("ul");

    dialog.append(head, list);

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
      // <kind>.html links the same three files
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
    entries.forEach((s, i) => {
      const hit = s.key.startsWith(buf);
      rows[i].classList.toggle("dim", !hit);
      rowChips[i].classList.toggle("hot", hit && buf.length > 0);
      rowChars[i].forEach((c, j) => c.classList.toggle("on", hit && j < buf.length));
      if (hit) hits.push(i);
    });
    echoRender(buf, buf.length > 0 && hits.length === 0);
    // The key set is prefix-free (settings enforces it for shortcuts; tools is
    // fixed), so firing on an exact match is firing on the only reachable
    // meaning of the buffer. In a hand-edited store that violates the rule,
    // the shorter key wins — same as SK2U.
    const exact = entries.find((s) => s.key === buf);
    if (exact) fire(exact);
  }

  // The header shows the buffer as an inverted chip — with a plain word next
  // to it when it matches nothing, which is the only state Escape must clear.
  function echoRender(buf, miss) {
    ui.head.classList.toggle("typing", buf.length > 0);
    ui.echo.replaceChildren();
    if (!buf) return;
    const chip = el("span", "inlineCode fill");
    chip.textContent = buf;
    ui.echo.append(chip);
    if (miss) {
      const label = el("span", "muted");
      label.textContent = "no match — esc clears";
      ui.echo.append(label);
    }
  }

  function onKeydown(e) {
    e.stopPropagation(); // keep the page's own shortcuts out of the overlay
    if (source.settings && e.ctrlKey && e.key === "o") {
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
    if (!entries.length) {
      const empty = notice(`No ${source.kind} yet`);
      if (source.settings) {
        empty.textContent += " — add one in ";
        empty.append(settingsLink("settings"));
      }
      list.append(empty);
      return;
    }
    entries.forEach((entry, i) => {
      const li = el("li", "row");
      // A cell has no room for more than the title, so the rest is hover text.
      li.title = entry.hint ? `${entry.title} — ${entry.hint}` : entry.title;
      const chip = el("span", "inlineCode");
      const chars = [...entry.key].map((ch) => {
        const c = document.createElement("span");
        c.textContent = ch;
        chip.append(c);
        return c;
      });
      const title = el("span", "title small");
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

  // Actions run in the background so the overlay's death can't cut the work
  // short. The screen box travels along: a service worker has no `screen`,
  // and this is the only place that knows which monitor the page is on.
  function fire(entry) {
    source.fire(api, entry, {
      originWindowId,
      screen: {
        left: screen.availLeft ?? 0,
        top: screen.availTop ?? 0,
        width: screen.availWidth,
        height: screen.availHeight,
      },
    });
    ui.dialog.close();
  }

  function openSettings() {
    api.runtime.sendMessage({ type: "open-options" });
    ui.dialog.close();
  }

  function notice(text, bad = false) {
    const li = document.createElement("li");
    li.className = bad ? "notice muted destructive" : "notice muted";
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
