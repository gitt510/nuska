// Settings page: the only place shortcuts are created or edited. The overlay
// reads storage.sync straight back, so nothing has to be told about a change.
//
// Shortcuts read as a list; a row (or Add) opens an editor dialog, and only
// a complete, legal shortcut leaves it. Storage therefore never holds a bad
// one, and the list never has to show errors of its own.
//
// Every element it builds comes from components/ui.js; nothing here names a class.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const UI = globalThis.__nuskaUi;
  UI.theme(document.documentElement);

  // storage.sync caps a single item at 8 KB. The whole list is one item, so
  // every save is measured against a ceiling just below the cap.
  const MAX_BYTES = 7800;

  const ui = {
    rows: document.getElementById("rows"),
    addBar: document.getElementById("add-bar"),
    status: document.getElementById("status"),
    bindings: document.getElementById("bindings"),
    importText: document.getElementById("import-text"),
    importBar: document.getElementById("import-bar"),
    accent: document.getElementById("accent"),
  };

  let saved = []; // { key, title, url }, sorted by key — what storage holds
  let editor = null; // the open editor dialog, if any

  start();

  async function start() {
    // The accent paints the buttons, so it is read before any are made.
    await UI.loadAccent(api);
    ui.accent.append(UI.accentPicker((name) => api.storage.sync.set({ accent: name })));
    const add = UI.button("Add shortcut");
    const importRun = UI.button("Import");
    ui.addBar.prepend(add);
    ui.importBar.append(importRun);

    const synced = await api.storage.sync.get("shortcuts");
    saved = sorted(
      (synced.shortcuts ?? []).map((s) => ({ key: s.key ?? "", title: s.title ?? "", url: s.url ?? "" })),
    );
    render();
    renderBindings();
    // "Add to shortcuts" in the page context menu stashes the page here (see
    // background.js). The onChanged listener covers the case where this tab was
    // already open and only got focused.
    await consumePending();
    api.storage.session.onChanged.addListener((changes) => {
      if (changes.pendingShortcut?.newValue) consumePending();
    });
    add.addEventListener("click", () => edit(null, blank()));
    importRun.addEventListener("click", runImport);
  }

  function sorted(list) {
    return [...list].sort((a, b) => a.key.localeCompare(b.key));
  }

  function render() {
    ui.rows.replaceChildren();
    if (!saved.length) {
      ui.rows.append(UI.notice("No shortcuts yet — add one below."));
      return;
    }
    for (const s of saved) {
      const row = UI.option({
        chip: UI.keyChip(s.key).chip,
        title: s.title || hostOf(s.url),
        meta: hostOf(s.url),
        button: true,
      });
      row.title = s.url;
      row.addEventListener("click", () => edit(s, s));
      ui.rows.append(row);
    }
  }

  function hostOf(url) {
    try {
      return new URL(url).host.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  // Opens the editor on `values`. `original` is the saved entry being edited,
  // or null for a new one; it is what Save replaces and Delete removes.
  function edit(original, values) {
    editor?.root.close();
    const sheet = UI.sheet(original ? "Edit shortcut" : "New shortcut");
    const fields = {
      key: UI.field({ mono: true }),
      title: UI.field(),
      url: UI.field(),
    };
    fields.key.id = "edit-key";
    fields.title.id = "edit-title";
    fields.url.id = "edit-url";
    fields.key.placeholder = "ex";
    fields.title.placeholder = "Example";
    fields.url.placeholder = "https://example.com";
    for (const [name, input] of Object.entries(fields)) input.value = values[name] ?? "";
    // Keys are normalized as typed rather than rejected, so the overlay never
    // has to reason about case or about characters a keystroke can't send.
    fields.key.addEventListener("input", () => {
      fields.key.value = fields.key.value.toLowerCase().replace(/[^a-z0-9]/g, "");
    });
    // Show the scheme that will actually be stored.
    fields.url.addEventListener("change", () => {
      fields.url.value = normalizeUrl(fields.url.value);
    });
    sheet.body.append(
      UI.formField("Key", fields.key),
      UI.formField("Title", fields.title),
      UI.formField("URL", fields.url),
    );

    const cancel = UI.quietButton("Cancel");
    const save = UI.button("Save");
    save.type = "submit";
    cancel.addEventListener("click", () => sheet.root.close());
    if (original) {
      const del = UI.deleteButton("Delete");
      del.addEventListener("click", async () => {
        if (await store(saved.filter((s) => s !== original), `deleted "${original.key}"`)) sheet.root.close();
      });
      sheet.footer.append(del);
    }
    sheet.footer.append(cancel, save);

    sheet.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const entry = {
        key: fields.key.value.trim(),
        title: fields.title.value.trim(),
        url: normalizeUrl(fields.url.value),
      };
      const others = saved.filter((s) => s !== original);
      const error = problemOf(entry, others);
      for (const [name, input] of Object.entries(fields)) UI.invalid(input, error?.field === name ? error.why : null);
      if (error) {
        fields[error.field].focus();
        return;
      }
      if (await store([...others, entry], `saved "${entry.key}"`)) sheet.root.close();
    });

    sheet.root.addEventListener("close", () => {
      sheet.root.remove();
      if (editor === sheet) editor = null;
    });
    document.body.append(sheet.root);
    sheet.root.showModal();
    fields.key.focus();
    editor = sheet;
  }

  // Import merges rather than replaces: a key already in the list is
  // overwritten, everything else is appended, so nothing unrelated is lost.
  // An entry that would break the list (a clash, a bad URL) is skipped.
  async function runImport() {
    let parsed;
    try {
      parsed = JSON.parse(ui.importText.value);
    } catch (err) {
      setStatus(`import failed: ${err.message ?? err}`, true);
      return;
    }
    const { raw, list } = shortcutsIn(parsed);
    if (!list.length) {
      setStatus("import found no shortcuts with a key and a URL", true);
      return;
    }
    let next = [...saved];
    let taken = 0;
    for (const s of list) {
      const others = next.filter((d) => d.key !== s.key);
      if (problemOf(s, others)) continue;
      next = [...others, s];
      taken++;
    }
    const skipped = raw - taken;
    if (await store(next, `imported ${taken}${skipped ? ` · ${skipped} skipped` : ""}`)) ui.importText.value = "";
  }

  // Accepts a bare array, this page's own { shortcuts: [...] }, or a
  // ShortcutKey2URL export, which splits its list over shortcutKeysNNN keys.
  function shortcutsIn(parsed) {
    let source = [];
    if (Array.isArray(parsed)) source = parsed;
    else if (Array.isArray(parsed?.shortcuts)) source = parsed.shortcuts;
    else if (parsed && typeof parsed === "object") {
      source = Object.entries(parsed)
        .filter(([name, value]) => name.startsWith("shortcutKeys") && Array.isArray(value))
        .flatMap(([, value]) => value);
    }
    const list = source
      .filter((s) => s && typeof s.key === "string" && typeof s.url === "string")
      .map((s) => ({
        key: s.key.toLowerCase().replace(/[^a-z0-9]/g, ""),
        title: typeof s.title === "string" ? s.title : "",
        url: normalizeUrl(s.url),
      }))
      .filter((s) => s.key && s.url);
    return { raw: source.length, list };
  }

  function blank() {
    return { key: "", title: "", url: "" };
  }

  // Opens the editor prefilled with the stashed page, cursor on the key — the
  // one thing a right-click cannot supply.
  async function consumePending() {
    const { pendingShortcut } = await api.storage.session.get("pendingShortcut");
    if (!pendingShortcut?.url) return;
    await api.storage.session.remove("pendingShortcut");
    edit(null, { key: "", title: pendingShortcut.title ?? "", url: pendingShortcut.url });
  }

  // "github.com" is what people type; only a scheme already present is taken
  // at face value, so javascript: and file: still reach the scheme check.
  function normalizeUrl(value) {
    const url = value.trim();
    if (!url) return "";
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  }

  // Why `s` cannot join `others`, as { field, why } so the mark lands on the
  // input at fault — or null when it can.
  function problemOf(s, others) {
    if (!s.key) return { field: "key", why: "key required" };
    if (!s.url) return { field: "url", why: "URL required" };
    let url;
    try {
      url = new URL(s.url);
    } catch {
      return { field: "url", why: "not a URL" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { field: "url", why: "only http and https" };
    // Prefix-free is what makes a completed key fire on its own.
    const clash = others.find((o) => o.key === s.key || o.key.startsWith(s.key) || s.key.startsWith(o.key));
    if (clash) return { field: "key", why: clash.key === s.key ? "duplicate key" : `collides with "${clash.key}"` };
    return null;
  }

  // Writes the whole list, or reports why not. True when it was written.
  async function store(list, done) {
    const clean = sorted(list);
    const bytes = new TextEncoder().encode(JSON.stringify({ shortcuts: clean })).length;
    if (bytes > MAX_BYTES) {
      setStatus(`too large to sync (${bytes} of ${MAX_BYTES} bytes) — nothing saved`, true);
      return false;
    }
    try {
      await api.storage.sync.set({ shortcuts: clean });
    } catch (err) {
      setStatus(`not saved: ${err.message ?? err}`, true);
      return false;
    }
    saved = clean;
    render();
    setStatus(done);
    return true;
  }

  function setStatus(text, isError = false) {
    ui.status.textContent = text;
    UI.status(ui.status, isError);
  }

  // The browser owns command shortcuts; edits go through commands.update,
  // which Firefox has and Chrome does not (chrome://extensions/shortcuts is
  // the only writer there) — hence the feature test and the static fallback.
  const COMMANDS = [
    { name: "_execute_action", label: "Bookmarks" },
    { name: "open-shortcuts", label: "Shortcuts" },
    { name: "open-history", label: "History" },
    { name: "open-tools", label: "Tools" },
  ];

  async function renderBindings() {
    let bound;
    try {
      bound = new Map((await api.commands.getAll()).map((c) => [c.name, c.shortcut ?? ""]));
    } catch {
      return; // commands.getAll is unavailable on this build — show nothing
    }
    ui.bindings.replaceChildren();
    if (typeof api.commands.update !== "function") {
      ui.bindings.append(UI.muted("Rebind keys at chrome://extensions/shortcuts."));
      return;
    }
    for (const { name, label } of COMMANDS) {
      ui.bindings.append(UI.pair(UI.label(label, `bind-${name}`), bindingField(name, bound.get(name) ?? "")));
    }
  }

  function bindingField(name, current) {
    const input = UI.binding();
    input.id = `bind-${name}`;
    input.readOnly = true; // keys are captured, never typed as text
    input.value = current;
    input.placeholder = "press keys";
    input.setAttribute("aria-label", `${name} shortcut`);
    input.addEventListener("keydown", async (e) => {
      e.preventDefault();
      if (e.key === "Escape") {
        input.blur();
        return;
      }
      if (e.key === "Backspace") {
        await rebind(name, "", input);
        return;
      }
      const combo = comboFrom(e);
      if (combo) await rebind(name, combo, input);
    });
    return input;
  }

  // Firefox's own letter shortcuts, read off browser-sets.inc.xhtml and
  // browserSets.ftl (Firefox 155). The browser's <key> fires first, so an
  // extension bound to one of these never hears the press — yet
  // commands.update accepts it and about:addons shows it as bound. On macOS
  // the bare-Control four are the trap: they look free and are not.
  const FIREFOX_KEYS = navigator.platform.includes("Mac")
    ? new Set([
        ...["M", "U", "X", "Z"].map((k) => `MacCtrl+${k}`),
        ..."B D E F G H I K L M N O P Q R S T U W Y".split(" ").map((k) => `Command+${k}`),
      ])
    : new Set([
        ..."B D E F G H I K L M N O P Q R S T U W Y".split(" ").map((k) => `Ctrl+${k}`),
        ..."A B D F G H N O P R T W X".split(" ").map((k) => `Ctrl+Shift+${k}`),
      ]);

  async function rebind(name, shortcut, input) {
    if (FIREFOX_KEYS.has(shortcut)) {
      setStatus(`not rebound: ${pretty(shortcut)} is one of Firefox's own shortcuts and would never reach the extension`, true);
      return;
    }
    try {
      await api.commands.update({ name, shortcut });
      input.value = shortcut;
      setStatus(shortcut ? `${name} → ${shortcut}` : `${name} unbound`);
    } catch (err) {
      setStatus(`not rebound: ${err.message ?? err}`, true);
    }
  }

  function pretty(shortcut) {
    if (!navigator.platform.includes("Mac")) return shortcut;
    return shortcut.replace("MacCtrl+", "⌃").replace("Command+", "⌘").replace("Shift+", "⇧").replace("Alt+", "⌥");
  }

  // Builds a manifest-syntax shortcut ("MacCtrl+Comma") from a keydown, or
  // null while the combination is still incomplete. Commands demand exactly
  // one primary modifier (Shift only rides along); function keys stand alone.
  function comboFrom(e) {
    const isMac = navigator.platform.includes("Mac");
    const mods = [];
    if (e.metaKey && isMac) mods.push("Command");
    if (e.ctrlKey) mods.push(isMac ? "MacCtrl" : "Ctrl");
    if (e.altKey) mods.push("Alt");
    const key = keyFrom(e.code);
    if (!key) return null;
    if (/^F([1-9]|1[0-2])$/.test(key)) return [...mods, ...(e.shiftKey ? ["Shift"] : []), key].join("+");
    if (mods.length !== 1) return null;
    return [mods[0], ...(e.shiftKey ? ["Shift"] : []), key].join("+");
  }

  function keyFrom(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-2])$/.test(code)) return code;
    const named = {
      Comma: "Comma",
      Period: "Period",
      Space: "Space",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      Insert: "Insert",
      Delete: "Delete",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
    };
    return named[code] ?? null;
  }
})();
