// Keys overlay: a list of key → action pairs where the key IS the selection,
// shared by shortcuts and tools. The file injected just before this one
// (lib/shortcuts.js or lib/tools.js) leaves its source on
// globalThis.__nuskaKeys:
//   { kind, label, placeholder, settings, load(api) → [{ key, title, hint }], fire(api, entry, ctx) }
// `settings` says whether ⌃O and the empty notice lead to the options page.
// `ctx` is { originWindowId, screen } — what an action needs to act on the
// page's window from the background.
//
// Two contexts, like the finder:
//  - injected into the page as a content script (background.js): a centered
//    <dialog> inside a shadow root, on the page's top layer
//  - loaded by app/overlay.html inside a centered popup window: the fallback
//    for pages that refuse injection (chrome://, the Web Store, …)
//
// Every element comes from components/ui.js; nothing here names a class.
//
// Execute-only. The whole set stays on screen the entire time: typing dims
// what no longer matches rather than removing it, so the keys are always in
// view. The buffer equalling a key fires it — there is no selection to move
// or confirm.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const UI = globalThis.__nuskaUi;
  const source = globalThis.__nuskaKeys;
  // Extension pages live under runtime.getURL(""); injected ones never do.
  const IN_PAGE = !location.href.startsWith(api.runtime.getURL(""));

  // Re-injecting the file toggles the already-open overlay of the same kind.
  const toggles = (globalThis.__nuskaToggles ??= {});
  if (IN_PAGE && toggles[source.kind]) {
    toggles[source.kind]();
    return;
  }

  // The fallback window must act on the window it was launched from.
  const originWindowId = IN_PAGE
    ? undefined
    : Number(new URLSearchParams(location.search).get("origin")) || undefined;

  let entries = []; // every entry, sorted by key — all of them stay rendered
  let rows = []; // row elements parallel to entries
  let rowChips = []; // the key chip of each row, parallel to entries
  let rowChars = []; // per-row character spans inside the chip
  let hits = []; // indices matching the current buffer
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
    const { root: dialog, header: head, body } = UI.dialog(source.label, { fill: !IN_PAGE });

    // The same search field as the finder: the buffer is typed, and shown, here.
    const input = UI.search(source.placeholder);
    input.setAttribute("aria-label", `${source.label} key`);
    const count = UI.count();
    head.append(input, count);

    const list = UI.list();
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
    input.addEventListener("input", onInput);
    // Typing is the only way in, so a stray click must not unfocus the field.
    dialog.addEventListener("mousedown", (e) => {
      if (e.target !== input) e.preventDefault();
    });
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
      UI.dim(rows[i], !hit);
      UI.hot(rowChips[i], hit && buf.length > 0);
      rowChars[i].forEach((c, j) => UI.typed(c, !buf || (hit && j < buf.length)));
      if (hit) hits.push(i);
    });
    // A miss is the only state Escape must clear, so it says so.
    ui.count.textContent = buf && !hits.length ? "no match — esc clears" : "";
    // The key set is prefix-free (settings enforces it for shortcuts; tools is
    // fixed), so firing on an exact match is firing on the only reachable
    // meaning of the buffer. In a hand-edited store that violates the rule,
    // the shorter key wins — same as SK2U.
    const exact = entries.find((s) => s.key === buf);
    if (exact) fire(exact);
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
      const { chip, chars } = UI.keyChip(entry.key);
      const li = UI.option({ chip, title: entry.title, meta: entry.hint });
      li.title = entry.hint ? `${entry.title} — ${entry.hint}` : entry.title;
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
    const node = UI.notice(text, bad);
    node.setAttribute("role", "presentation");
    return node;
  }

  function settingsLink(label) {
    const button = UI.linkButton(label);
    button.addEventListener("click", openSettings);
    return button;
  }
})();
