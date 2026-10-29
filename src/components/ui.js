// The one seam between Nuska and Bootstrap (styles/bootstrap.min.css): every
// Bootstrap class a script needs is named here and nowhere else, so swapping
// the library means rewriting this file and the .html pages. Engines and the
// settings page build their DOM from these and never set a class themselves.
//
// Loaded three ways: injected ahead of an overlay engine (background.js), by
// app/overlay.html in the fallback window, and by app/settings.html. Injection
// repeats on every open, hence the ??= rather than a top-level const.
globalThis.__nuskaUi ??= (() => {
  // Bootstrap's colour mode is an attribute, not a media query; follow the system.
  function theme(el) {
    el.dataset.bsTheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  // The accent is one of Bootstrap's theme colours, chosen in settings and
  // kept in storage.sync. Whatever answers the keyboard wears it: the
  // selected row, a matching key chip, the primary buttons.
  const ACCENTS = [
    { name: "primary", label: "Blue" },
    { name: "success", label: "Green" },
    { name: "info", label: "Cyan" },
    { name: "warning", label: "Yellow" },
    { name: "danger", label: "Red" },
    { name: "secondary", label: "Gray" },
  ];
  let accent = "success";

  async function loadAccent(api) {
    const stored = (await api.storage.sync.get("accent")).accent;
    accent = ACCENTS.some((a) => a.name === stored) ? stored : "success";
    return accent;
  }

  function make(tag, className = "", text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // A native <dialog> filling the viewport (so a click on it is a click
  // outside the card), holding Bootstrap's modal markup as the card. `.modal`
  // carries the width and margin variables .modal-dialog reads; d-block shows it.
  // Every overlay is the same width: modal-lg fits the keys grid's three columns.
  function dialog(label) {
    const root = make("dialog", "modal d-block mw-100 mh-100 m-0 p-0 border-0 bg-transparent text-body");
    root.setAttribute("aria-label", label);
    theme(root);
    const frame = make("div", "modal-dialog modal-dialog-scrollable modal-lg");
    const content = make("div", "modal-content shadow-lg");
    const header = make("div", "modal-header gap-2 p-2");
    const body = make("div", "modal-body p-2");
    content.append(header, body);
    frame.append(content);
    root.append(frame);
    return { root, header, body };
  }

  // --- finder -------------------------------------------------------

  function search(placeholder) {
    const input = make("input", "form-control form-control-lg border-0 shadow-none");
    input.type = "text";
    input.placeholder = placeholder;
    input.autocomplete = "off";
    return input;
  }

  function count() {
    return make("small", "text-body-secondary text-nowrap pe-2");
  }

  function list() {
    return make("div", "list-group list-group-flush");
  }

  function option(title, meta) {
    const row = make("div", "list-group-item list-group-item-action rounded border-0 d-flex justify-content-between gap-3");
    row.append(title, make("small", "opacity-75 text-nowrap", meta));
    return row;
  }

  function select(row, on) {
    row.classList.toggle(`text-bg-${accent}`, on);
  }

  function optionTitle() {
    return make("span", "text-truncate");
  }

  function mark(text) {
    return make("mark", "p-0", text);
  }

  function notice(text, bad = false) {
    return make("div", `w-100 p-3 ${bad ? "text-danger" : "text-body-secondary"}`, text);
  }

  // --- keys ---------------------------------------------------------

  // Read across then down, so the whole key set is takeable in at a glance.
  function grid() {
    return make("div", "row row-cols-3 g-1 m-0");
  }

  function keyRow(chip, title) {
    const cell = make("div", "col");
    const button = make("button", "btn border-0 w-100 d-flex align-items-center gap-2 text-start");
    button.type = "button";
    button.append(chip, make("span", "text-truncate", title));
    cell.append(button);
    return cell;
  }

  function keyChip(key) {
    const chip = make("span", "badge text-bg-secondary font-monospace fs-6");
    const chars = [...key].map((ch) => make("span", "", ch));
    chip.append(...chars);
    return { chip, chars };
  }

  // A row that no longer matches the typed prefix fades; a chip that does
  // matches lights up, with the typed characters at full strength.
  function dim(row, on) {
    row.classList.toggle("opacity-25", on);
  }

  function hot(chip, on) {
    chip.classList.toggle(`text-bg-${accent}`, on);
    chip.classList.toggle("text-bg-secondary", !on);
  }

  function typed(char, on) {
    char.classList.toggle("opacity-50", !on);
  }

  function echo(buf) {
    return make("kbd", "fs-6", buf);
  }

  function prompt(text) {
    return make("span", "flex-grow-1 text-body-secondary px-2", text);
  }

  function hidden(node) {
    node.classList.add("visually-hidden");
    return node;
  }

  function show(node, on) {
    node.classList.toggle("d-none", !on);
  }

  function linkButton(label) {
    const button = make("button", "btn btn-link p-0 align-baseline", label);
    button.type = "button";
    return button;
  }

  // --- settings -----------------------------------------------------

  // A saved shortcut as one clickable row: key chip, title, host.
  function shortcutRow(key, title, host) {
    const row = make("button", "list-group-item list-group-item-action d-flex align-items-center gap-3 py-3");
    row.type = "button";
    row.append(
      keyChip(key).chip,
      make("span", "text-truncate", title),
      make("small", "ms-auto text-body-secondary text-nowrap", host),
    );
    return row;
  }

  // The editor: a modal with a title, a form for its fields, and a footer.
  // Clicking outside the card closes it, like the overlays.
  function sheet(title) {
    const root = make("dialog", "modal d-block mw-100 mh-100 m-0 p-0 border-0 bg-transparent text-body");
    root.setAttribute("aria-label", title);
    const frame = make("div", "modal-dialog modal-dialog-centered");
    const form = make("form", "modal-content shadow-lg");
    const header = make("div", "modal-header px-4");
    header.append(make("h5", "modal-title", title));
    const body = make("div", "modal-body px-4 pt-4 pb-2");
    const footer = make("div", "modal-footer px-4 gap-2");
    form.append(header, body, footer);
    frame.append(form);
    root.append(frame);
    root.addEventListener("click", (e) => {
      if (e.target === root) root.close();
    });
    return { root, form, body, footer };
  }

  function field({ mono = false } = {}) {
    const input = make("input", `form-control${mono ? " font-monospace" : ""}`);
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    return input;
  }

  // Label, input and the slot its error goes in.
  function formField(text, input) {
    const group = make("div", "mb-3");
    const tag = make("label", "form-label", text);
    tag.htmlFor = input.id;
    group.append(tag, input, make("div", "invalid-feedback"));
    return group;
  }

  // Marks the input bad with `why`, or clears it when `why` is null.
  function invalid(input, why) {
    input.classList.toggle("is-invalid", why != null);
    input.nextElementSibling.textContent = why ?? "";
  }

  function quietButton(text) {
    const node = make("button", "btn btn-outline-secondary btn-sm", text);
    node.type = "button";
    return node;
  }

  function deleteButton(text) {
    const node = make("button", "btn btn-outline-danger btn-sm me-auto", text);
    node.type = "button";
    return node;
  }

  function label(text, htmlFor) {
    const node = make("label", "col-form-label w-25", text);
    node.htmlFor = htmlFor;
    return node;
  }

  // A command binding field: a short, centred key combination.
  function binding() {
    const input = make("input", "form-control form-control-sm font-monospace text-center w-auto");
    input.type = "text";
    return input;
  }

  function pair(left, right) {
    const row = make("div", "d-flex align-items-center gap-4");
    row.append(left, right);
    return row;
  }

  function muted(text) {
    return make("p", "text-body-secondary mb-0", text);
  }

  function status(node, bad) {
    node.classList.toggle("text-danger", bad);
    node.classList.toggle("text-body-secondary", !bad);
  }

  // A primary action button, in the accent. Kept so a new pick repaints it.
  const buttons = new Set();
  function button(text) {
    const node = make("button", `btn btn-${accent} btn-sm`, text);
    node.type = "button";
    buttons.add(node);
    return node;
  }

  // One toggle button per accent, each in its own colour; picking one
  // repaints the accent buttons and calls onPick with its name.
  function accentPicker(onPick) {
    const group = make("div", "d-flex flex-wrap gap-2");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Accent colour");
    for (const { name, label } of ACCENTS) {
      const input = make("input", "btn-check");
      input.type = "radio";
      input.name = "accent";
      input.id = `accent-${name}`;
      input.checked = name === accent;
      input.addEventListener("change", () => {
        for (const b of buttons) b.classList.replace(`btn-${accent}`, `btn-${name}`);
        accent = name;
        onPick(name);
      });
      const tag = make("label", `btn btn-outline-${name}`, label);
      tag.htmlFor = input.id;
      group.append(input, tag);
    }
    return group;
  }

  return {
    loadAccent, theme, dialog,
    search, count, list, option, optionTitle, select, mark, notice,
    grid, keyRow, keyChip, dim, hot, typed, echo, prompt, hidden, show, linkButton,
    shortcutRow, sheet, field, formField, invalid, quietButton, deleteButton,
    label, binding, pair, muted, status, button, accentPicker,
  };
})();
