# Nuska

Keyboard-driven bookmarks, history, and shortcuts for Chrome and Firefox.
One key opens a fuzzy finder over your bookmarks bar, one over your history,
one a list of key-to-URL shortcuts that fire the moment the key is typed,
and one a few window tools. Everything is an overlay on the current page:
no popup, no new tab, no mouse.

| Key | Opens |
| --- | --- |
| `Ctrl+B` | bookmarks bar, flattened, fuzzy-searched |
| `Ctrl+Y` | history, last 90 days |
| `Ctrl+,` | key-to-URL shortcuts (`gh` → GitHub, and so on) |
| `Alt+Shift+T` (`⌃T` on macOS) | window tools: merge, split |

Runs on `activeTab`, so it reads no page; the only host permission is
`127.0.0.1`, for the development hot-reload watcher.
Shortcuts are stored in browser sync storage. Named after Nuska, the
Mesopotamian god of light and messenger of the gods, whose bird is the
rooster that calls the day in.

## Install

There is no store listing yet. Chrome loads `src/` unpacked; Firefox needs a
signed build. Both are covered under [Development flow](#development-flow).

## Development flow

### Install (once per browser)

Chrome:

1. `chrome://extensions` → Developer mode ON
2. "Load unpacked" → select the `src/` directory
3. Prefixes are `Ctrl+B`, `Ctrl+,`, `Ctrl+Y` and `Alt+Shift+T` (`⌃B` / `⌃,` / `⌃Y` / `⌃T` on macOS). Chrome applies
   `suggested_key` only at install time, so an install that predates a
   binding never picks it up — set it manually at
   `chrome://extensions/shortcuts`. The settings page reports what is
   actually bound

Firefox (permanent install — Firefox only accepts signed extensions):

1. Store AMO API credentials
   (<https://addons.mozilla.org/developers/addon/api/key/>) in 1Password as
   item `firefox-addons` in the `Personal` vault, with fields `api-key` and
   `api-secret`. `op.env` holds only `op://` references — no secrets on disk
2. Release from main only:
   - `just bump` in the PR that ships the change; AMO burns a version number
     on every sign, so a version is signed once
   - after the merge, `just install-ff` on a clean `main` signs an unlisted
     build on AMO (credentials injected via `op run`), tags and pushes
     `v<version>`, and opens the signed `.xpi` in Firefox; click "Add"
   - `sign` refuses another branch, uncommitted changes, or a version that is
     already tagged
   - on another machine, where the version is already signed and tagged,
     `just fetch-xpi` downloads the signed `.xpi` from AMO (default: the
     manifest's version), then `just install-xpi`
3. For development sessions, `just dev-ff` instead runs a throwaway Firefox
   with the extension loaded and reload-on-save (no signing needed). The
   empty profile seeds itself with `src/dev-seed.json` on install —
   development installs only. Shortcuts go in only when there are none, and
   sample bookmarks only into a bar holding none of your own, so a Chrome
   "Load unpacked" into a real profile leaves both alone

### How it opens

`Ctrl+B` injects the bookmarks overlay as a centered modal over the current page
(top layer, above any page z-index). `Ctrl+Y` opens history, `Ctrl+,` the
shortcuts and `Alt+Shift+T` (`⌃T` on macOS) the tools the same way. Pages that refuse injection
(`chrome://`, the Web Store) get a centered popup window with the same UI.

All four are keyboard-only entry points, which is what grants `activeTab` —
no host permission is involved.

### Bookmarks and history

One finder, two sources. Before typing, bookmarks shows the bookmarks bar
with its folders flattened, in bar order; history shows the last 90 days,
most recent first. Typing fuzzy-searches everything — title, URL and, for
bookmarks, folder name — and highlights the matched characters. `↑` `↓` or
`⌃N` `⌃P` move, `↵` opens, `esc` clears the query and then closes.

### Shortcuts

`Ctrl+,` lists your key-to-URL shortcuts. Type a key and it opens the moment
the key is complete, so the usual path is `Ctrl+,` then `gh`. A partial key
dims what no longer matches instead of removing it, so the whole set stays on
screen the entire time; a row can also be clicked. There is no selection to
move or confirm — the key is the selection.

Settings is the only place shortcuts are edited. They show as a list; a row
(or **Add shortcut**) opens an editor for key, title and URL, and **Save**
writes to browser sync storage. Three ways in: `⌃O` inside
the overlay, right-click the toolbar icon → **Shortcuts settings**, or
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
- The editor refuses to save a shortcut with an error and marks the field at
  fault, so storage never holds a broken one. Import skips such entries
- The whole list is one sync item, capped at 8 KB (roughly 80 shortcuts).
  Settings reports the overflow instead of writing

### Tools

`⌃T` (`Alt+Shift+T` on Windows and Linux, where `Ctrl+T` is the browser's own
new-tab key and off limits to extensions) lists a fixed set of window chores,
driven like the shortcuts: the key fires the moment it is typed.

A key Firefox already uses never reaches an extension: the browser's own
key fires first, though `about:addons` still shows the binding as taken.
The settings page refuses those instead of saving a binding that cannot
work. On macOS the trap is the bare-Control four — `⌃U` `⌃X` `⌃Z` `⌃M`
(sidebars and mute) — which look free and are not; the `⌘` letters and, on
Windows and Linux, the `Ctrl` and `Ctrl+Shift` letters are the familiar
browser shortcuts.

- `m` **Merge windows** — every other normal window's tabs move into this
  one, appended in window order; the emptied windows close on their own.
  Private windows and normal ones never mix. Pinned tabs stay pinned
- `s` **Split window** — this tab moves out to a new window and the two share
  the screen side by side, the original on the left. Uses the monitor the
  page is on; a window with a single tab has nothing to split and is left
  alone

The browser exposes its own split view (Firefox 149, Chrome 145) to
extensions read-only, so this is done with plain windows.

### Styling

Bootstrap 5.3 (`src/styles/bootstrap.min.css`) is the whole design: Nuska
ships no CSS and no tokens of its own. The layout follows shadcn's:

- `components/ui.js` — the one seam to Bootstrap. Every class a script needs
  is named here; the engines and the settings page build their DOM from it.
  Static class names otherwise appear only in `app/*.html`
- `components/finder.js`, `components/keys.js` — the two overlay engines:
  finder (bookmarks, history — search, move, confirm) and keys (shortcuts,
  tools — the key is the selection)
- `lib/` — each overlay's data source, one file injected ahead of its engine
- `app/` — pages: `settings.html`, and `overlay.html`, the fallback window
  that loads the same files the background would have injected
- Light or dark follows the system, set as Bootstrap's `data-bs-theme`
- The accent is one of Bootstrap's theme colours (green by default; also
  blue, cyan, yellow, red, gray), picked in settings and kept in sync storage; `ui.js` turns it
  into `text-bg-*` / `btn-*` classes, so no stylesheet is involved

Overlays live in a shadow root inside an arbitrary page, so they cannot
`<link>` a stylesheet; `background.js` reads Bootstrap and hands the text over
(`get-css`), rewriting `:root` and the base `body` rule to `:host`.
`just check-css` keeps it that way: no stylesheet outside `src/styles/` and
no inline styles.

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

Toolbar/app icon: original — a small bird in open line strokes, drawn
from `src/public/icons/icon.svg` with `rsvg-convert` at 16, 32, 48 and 128.
