# wip-extension-cf

Keyboard launcher extension for Chrome and Firefox (working title).

One prefix shortcut opens the launcher popup; a single key then runs a command:

| Key | Command |
|-----|---------|
| `b` | Fuzzy-search bookmarks (type to filter, `Ctrl+n`/`Ctrl+p` or arrows, `Enter` to open) |
| `s` | Tile current window left, most recent other window right |
| `m` | Merge all windows into the current one |

Default prefix: `Ctrl+.` (`⌃.` on macOS). Change it at `chrome://extensions/shortcuts`
or Firefox's Manage Extension Shortcuts.

## Development

### Chrome

1. Open `chrome://extensions`, enable Developer mode
2. "Load unpacked" → select this directory
3. After editing files, press the reload (⟳) button on the extension card

### Hot reload (daily-driver browser)

```sh
node scripts/dev-server.mjs
```

While this runs, the unpacked extension reloads itself about 1s after any file
is saved — no ⟳ needed. The extension polls `http://127.0.0.1:17345` for a
change stamp and calls `runtime.reload()` when it changes. With the watcher
stopped, it probes at most once every 30s and behaves normally; starting the
watcher takes up to 30s to be picked up.

Firefox MV3 treats host permissions as opt-in: enable the `127.0.0.1`
permission in about:addons → this extension → Permissions, or hot reload
stays silently inactive there.

Chrome may warn about the `background.scripts` manifest key — it is for Firefox
and safely ignored (Chrome 121+).

### Firefox

```sh
npx web-ext run
```

Auto-reloads on file change. Firefox ignores `background.service_worker` and the
`system.display` permission (the popup passes screen dimensions instead).

`npx web-ext run --target chromium` also works for Chrome with auto-reload.

## Layout

- `manifest.json` — cross-browser MV3 manifest
- `bg.js` — background; performs all window/tab operations
- `popup/` — launcher UI; selects a command and messages `bg.js`

The popup closes (and its JS dies) the moment focus leaves it, so it never does
the work itself — it only dispatches to the background.
