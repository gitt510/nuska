# wip-extension-cf

Keyboard launcher extension for Chrome and Firefox (working title).

## Development flow

### Install (once per browser)

Chrome:

1. `chrome://extensions` → Developer mode ON
2. "Load unpacked" → select this directory
3. Prefix is `Ctrl+B` (`⌃B` on macOS). If an older binding is already
   installed, set it manually at `chrome://extensions/shortcuts`

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
(top layer, above any page z-index). Pages that refuse injection
(`chrome://`, the Web Store) get a centered popup window with the same UI.

### Themes

`Ctrl+T` inside the launcher toggles the theme (neon / hud). Saved per browser.

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
