# wip-extension-cf

Keyboard launcher extension for Chrome and Firefox (working title).

## Development flow

### Install (once per browser)

Chrome:

1. `chrome://extensions` → Developer mode ON
2. "Load unpacked" → select the `src/` directory
3. Prefixes are `Ctrl+B` and `Ctrl+,` (`⌃B` / `⌃,` on macOS). Chrome applies
   `suggested_key` only at install time, so an install that predates a
   binding never picks it up — set it manually at
   `chrome://extensions/shortcuts`. The settings page reports what is
   actually bound

Firefox (permanent install — Firefox only accepts signed extensions):

1. Store AMO API credentials
   (<https://addons.mozilla.org/developers/addon/api/key/>) in 1Password as
   item `firefox-addons` in the `Personal` vault, with fields `api-key` and
   `api-secret`. `op.env` holds only `op://` references — no secrets on disk
2. `just install-ff` — bumps the patch version, signs an unlisted build on
   AMO (credentials injected via `op run`), and opens the signed `.xpi` in
   Firefox; click "Add" in the prompt
3. For development sessions, `just dev-ff` instead runs a throwaway Firefox
   with the extension loaded and reload-on-save (no signing needed)

### How it opens

`Ctrl+B` injects the launcher as a centered modal over the current page
(top layer, above any page z-index). `Ctrl+,` opens the shortcuts overlay the
same way. Pages that refuse injection (`chrome://`, the Web Store) get a
centered popup window with the same UI.

Both are keyboard-only entry points, which is what grants `activeTab` — no
host permission is involved.

### Shortcuts

`Ctrl+,` lists your key-to-URL shortcuts. Type a key and it opens the moment
the key is complete, so the usual path is `Ctrl+,` then `gh`. A partial key
dims what no longer matches instead of removing it, so the whole set stays on
screen the entire time; a row can also be clicked. There is no selection to
move or confirm — the key is the selection.

Settings is the only place shortcuts are edited — key, title, URL, one row
each, saved to browser sync storage as you type. Three ways in: `⌃O` in the
overlay, right-click the toolbar icon → **Shortcuts settings**, or
`about:addons` → the extension → Preferences.

- Keys are lowercase letters and digits. **No key may be the start of
  another one** — that is what lets a completed key fire without `↵`. The
  settings page refuses to save a row that breaks it
- Only `http` and `https` URLs are saved. A bare `github.com` gets `https://`
  put in front of it and the field is rewritten to what will be stored
- **Import** takes a bare JSON array, this page's own `{ "shortcuts": [...] }`,
  or a ShortcutKey2URL export as-is. Keys are lowercased, a key already in the
  table is replaced, and entries without a URL — SK2U's script-only actions —
  are skipped. There is no export: browser sync already holds the list
- A row with an error stays on screen and is left out of the saved set, so
  one broken row cannot take the others down with it
- The whole list is one sync item, capped at 8 KB (roughly 80 shortcuts).
  Settings reports the overflow instead of writing

### Themes

`Ctrl+T` inside the launcher toggles the launcher theme (neon / hud), saved
per browser. The shortcuts overlay and settings are monochrome — brightness
is the only signal, full white is the alarm.

### Hot reload

```sh
just dev   # = node scripts/dev-server.mjs
```

While this runs, saving any file reloads the unpacked extension in the
browser about 1s later — no manual ⟳.

- The watcher is a plain foreground process: it dies with the terminal /
  reboot. Start it again when developing; the extension picks it up within
  30s (press ⟳ once to connect immediately)
- With the watcher stopped, the extension probes localhost at most once
  every 30s and otherwise behaves normally
- Manifest edits are also picked up, but a changed `suggested_key` never
  re-applies to an existing install (Chrome applies it only at install time)

## Credits

Toolbar/app icon: `map` from [PrimeIcons](https://github.com/primefaces/primeicons) (MIT).
