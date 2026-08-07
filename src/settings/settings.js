// Settings page: the only place shortcuts are created or edited. The overlay
// reads storage.sync straight back, so nothing has to be told about a change.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  // storage.sync caps a single item at 8 KB and throttles writes (Chrome:
  // 120/min). The whole list is one item, so both limits are handled here:
  // a measured ceiling below the cap, and a debounce in front of every write.
  const MAX_BYTES = 7800;
  const SAVE_DELAY = 500;

  const ui = {
    rows: document.getElementById("rows"),
    add: document.getElementById("add"),
    status: document.getElementById("status"),
    binding: document.getElementById("binding"),
    importText: document.getElementById("import-text"),
    importRun: document.getElementById("import-run"),
  };

  let draft = []; // { key, title, url } in edit order — the overlay sorts
  let saveTimer = null;

  start();

  async function start() {
    const synced = await api.storage.sync.get("shortcuts");
    draft = (synced.shortcuts ?? []).map((s) => ({
      key: s.key ?? "",
      title: s.title ?? "",
      url: s.url ?? "",
    }));
    if (!draft.length) draft.push(blank());
    render();
    showBinding();
    // "Add to shortcuts" in the page context menu stashes the page here (see
    // bg.js). The onChanged listener covers the case where this tab was
    // already open and only got focused.
    await consumePending();
    api.storage.session.onChanged.addListener((changes) => {
      if (changes.pendingShortcut?.newValue) consumePending();
    });
    ui.add.addEventListener("click", () => {
      draft.push(blank());
      render();
      ui.rows.lastElementChild?.querySelector("input")?.focus();
    });
    ui.importRun.addEventListener("click", runImport);
  }

  // Import merges rather than replaces: a key already in the table is
  // overwritten, everything else is appended, so nothing unrelated is lost.
  function runImport() {
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
    draft = draft.filter((s) => s.key || s.title || s.url); // drop blank rows
    for (const s of list) {
      const at = draft.findIndex((d) => d.key === s.key);
      if (at === -1) draft.push(s);
      else draft[at] = s;
    }
    if (!draft.length) draft.push(blank());
    ui.importText.value = "";
    render();
    const skipped = raw - list.length;
    setStatus(`imported ${list.length}${skipped ? ` · ${skipped} skipped` : ""}`);
    scheduleSave();
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

  // Appends a row prefilled with the stashed page and puts the cursor on its
  // key field — the key is the one thing a right-click cannot supply.
  async function consumePending() {
    const { pendingShortcut } = await api.storage.session.get("pendingShortcut");
    if (!pendingShortcut?.url) return;
    await api.storage.session.remove("pendingShortcut");
    if (draft.length === 1 && !draft[0].key && !draft[0].title && !draft[0].url) draft.length = 0;
    draft.push({ key: "", title: pendingShortcut.title ?? "", url: pendingShortcut.url });
    render();
    ui.rows.lastElementChild?.querySelector("input.key")?.focus();
  }

  // "github.com" is what people type; only a scheme already present is taken
  // at face value, so javascript: and file: still reach the scheme check.
  function normalizeUrl(value) {
    const url = value.trim();
    if (!url) return "";
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  }

  // A shortcut only reaches storage once it is complete and legal. Everything
  // else stays on screen with the reason next to it. Entries are
  // { field, why } so the mark lands on the input at fault.
  function errorsOf(list) {
    const errors = new Array(list.length).fill(null);
    const accepted = []; // keys already cleared, in row order
    list.forEach((s, i) => {
      if (!s.key && !s.url) return; // untouched row — not an error, not saved
      if (!s.key) {
        errors[i] = { field: "key", why: "key required" };
        return;
      }
      if (!s.url) {
        errors[i] = { field: "url", why: "URL required" };
        return;
      }
      let url;
      try {
        url = new URL(normalizeUrl(s.url));
      } catch {
        errors[i] = { field: "url", why: "not a URL" };
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors[i] = { field: "url", why: "only http and https" };
        return;
      }
      // Prefix-free is what makes a completed key fire on its own. Conflicts
      // are pinned on the later row so the earlier one keeps working.
      const clash = accepted.find((k) => k === s.key || k.startsWith(s.key) || s.key.startsWith(k));
      if (clash) {
        errors[i] = {
          field: "key",
          why: clash === s.key ? "duplicate key" : `collides with "${clash}"`,
        };
        return;
      }
      accepted.push(s.key);
    });
    return errors;
  }

  function render() {
    ui.rows.replaceChildren();
    draft.forEach((s, i) => ui.rows.append(rowEl(s, i)));
    validate();
  }

  function rowEl(s, i) {
    const tr = document.createElement("tr");
    tr.append(
      cell(field("key", s.key, "ex", i)),
      cell(field("title", s.title, "Example", i)),
      cell(field("url", s.url, "https://example.com", i)),
    );

    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.textContent = "×";
    del.title = "Delete";
    del.setAttribute("aria-label", `Delete row ${i + 1}`);
    del.addEventListener("click", () => {
      draft.splice(i, 1);
      if (!draft.length) draft.push(blank());
      render();
      scheduleSave();
    });
    tr.append(cell(del));
    return tr;
  }

  function cell(child) {
    const td = document.createElement("td");
    td.append(child);
    return td;
  }

  function field(name, value, placeholder, i) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = name;
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", name);
    input.addEventListener("input", () => {
      // Keys are normalized here rather than rejected, so the overlay never
      // has to reason about case or about characters a keystroke can't send.
      if (name === "key") input.value = input.value.toLowerCase().replace(/[^a-z0-9]/g, "");
      draft[i][name] = input.value.trim();
      validate();
      scheduleSave();
    });
    if (name === "url") {
      // Show the scheme that will actually be stored, rather than saving
      // something the field never displayed.
      input.addEventListener("change", () => {
        input.value = normalizeUrl(input.value);
        draft[i].url = input.value;
        validate();
        scheduleSave();
      });
    }
    return input;
  }

  // Repaints the error state in place — rebuilding rows here would steal focus
  // from the field being typed into.
  function validate() {
    const errors = errorsOf(draft);
    [...ui.rows.children].forEach((tr, i) => {
      // Fields carry their name as their class, so the mark is a name match.
      tr.querySelectorAll("input").forEach((input) =>
        input.classList.toggle("bad", errors[i]?.field === input.classList[0]),
      );
      const urlCell = tr.children[2]; // widest column — the reason fits under it
      urlCell.querySelector(".why")?.remove();
      if (errors[i]) {
        const why = document.createElement("span");
        why.className = "why";
        why.textContent = errors[i].why;
        urlCell.append(why);
      }
    });
    return errors;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    setStatus("saving…");
    saveTimer = setTimeout(save, SAVE_DELAY);
  }

  async function save() {
    const errors = errorsOf(draft);
    const clean = draft
      .filter((s, i) => errors[i] === null && s.key && s.url)
      .map((s) => ({ key: s.key, title: s.title, url: normalizeUrl(s.url) }));
    const skipped = errors.filter((e) => e !== null).length;

    const bytes = new TextEncoder().encode(JSON.stringify({ shortcuts: clean })).length;
    if (bytes > MAX_BYTES) {
      setStatus(`too large to sync (${bytes} of ${MAX_BYTES} bytes) — nothing saved`, true);
      return;
    }
    try {
      await api.storage.sync.set({ shortcuts: clean });
      setStatus(skipped ? `saved ${clean.length} · ${skipped} with errors left out` : "saved");
    } catch (err) {
      setStatus(`not saved: ${err.message ?? err}`, true);
    }
  }

  function setStatus(text, isError = false) {
    ui.status.textContent = text;
    ui.status.classList.toggle("error", isError);
  }

  // A suggested_key is only applied at install time, and the browser, the OS or
  // another extension may already own it — so report what is actually bound.
  async function showBinding() {
    const where = navigator.userAgent.includes("Firefox")
      ? "about:addons → gear → Manage Extension Shortcuts"
      : "chrome://extensions/shortcuts";
    let bound = "";
    try {
      const all = await api.commands.getAll();
      bound = all.find((c) => c.name === "open-shortcuts")?.shortcut ?? "";
    } catch {
      // commands.getAll is unavailable on this build — fall through to the hint
    }
    ui.binding.replaceChildren();
    if (bound) {
      const kbd = document.createElement("kbd");
      kbd.textContent = bound;
      ui.binding.append("Press ", kbd, ` to open the overlay. Rebind at ${where}.`);
    } else {
      ui.binding.append(`No key is bound — assign "Open shortcuts" at ${where}.`);
    }
  }
})();
