// Background (Chrome: MV3 service worker / Firefox: event page).
// The overlay UIs only select; actions run here, because they die the moment
// focus moves away from them.

const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "open-url": {
          // The overlay's sender tab pins the target window; the fallback
          // window passes the original window's id instead, because the tab
          // must not open inside the fallback window itself.
          const windowId = msg.windowId ?? sender.tab?.windowId;
          try {
            await api.tabs.create({ url: msg.url, ...(windowId != null && { windowId }) });
            if (msg.windowId != null) await api.windows.update(windowId, { focused: true });
          } catch {
            await api.tabs.create({ url: msg.url }); // origin window is gone
          }
          sendResponse({ ok: true });
          break;
        }
        case "get-tree":
          sendResponse({ ok: true, tree: await api.bookmarks.getTree() });
          break;
        case "get-history":
          sendResponse({ ok: true, items: await api.history.search(msg.query) });
          break;
        case "open-options":
          // Content scripts have no runtime.openOptionsPage.
          await api.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        case "get-css":
          sendResponse({ ok: true, css: await overlayCss(msg.name) });
          break;
        case "run-tool":
          await runTool(msg.id, msg.windowId ?? sender.tab?.windowId, sender.tab, msg.screen);
          sendResponse({ ok: true });
          break;
        default:
          throw new Error(`unknown message type: ${msg.type}`);
      }
    } catch (err) {
      console.error(err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true;
});

// An overlay lives in a shadow root inside an arbitrary page, so it cannot
// <link> its stylesheets: the background reads them (an extension may fetch
// its own files without exposing them to pages) and hands the text over.
// The token file addresses :root, which never matches inside a shadow tree;
// :host is the same element from the inside.
const cssCache = new Map();
async function overlayCss(name) {
  if (!["keys", "finder"].includes(name)) throw new Error(`unknown stylesheet: ${name}`);
  if (!cssCache.has(name)) {
    const files = ["design/tokens.css", "design/theme.css", `${name}/${name}.css`];
    const texts = await Promise.all(files.map((f) => fetch(api.runtime.getURL(f)).then((r) => r.text())));
    cssCache.set(name, texts.join("\n").replaceAll(":root", ":host"));
  }
  return cssCache.get(name);
}

// Four overlays, same shape: injected into the page as content scripts, with
// a centered popup window as the fallback for pages that refuse injection
// (chrome://, the Web Store, …). All are reached by keyboard, which is what
// grants activeTab — no host permission is involved. Two engines, each with
// two sources; the source file goes in first. Bookmarks and history are the
// finder (search, move, confirm); shortcuts and tools are the keys list (the
// key is the selection).
const OVERLAYS = {
  bookmarks: { files: ["bookmarks/bookmarks.js", "finder/finder.js"], page: "bookmarks/bookmarks.html", w: 600, h: 480 },
  history: { files: ["history/history.js", "finder/finder.js"], page: "history/history.html", w: 600, h: 480 },
  shortcuts: { files: ["shortcuts/shortcuts.js", "keys/keys.js"], page: "shortcuts/shortcuts.html", w: 760, h: 480 },
  tools: { files: ["tools/tools.js", "keys/keys.js"], page: "tools/tools.html", w: 760, h: 240 },
};

// Ctrl+B (_execute_action) and the toolbar icon open the bookmarks; Ctrl+,
// the shortcuts; Ctrl+Y the history; Ctrl+T the tools. _execute_action never
// fires onCommand, so both listeners are needed.
api.action.onClicked.addListener((tab) => openOverlay("bookmarks", tab));

api.commands.onCommand.addListener((command, tab) => {
  if (command === "open-shortcuts") openOverlay("shortcuts", tab);
  if (command === "open-history") openOverlay("history", tab);
  if (command === "open-tools") openOverlay("tools", tab);
});

// Firefox puts no Options entry in the toolbar button's context menu the way
// Chrome does, so the extension supplies one. Firefox event pages drop their
// menus on restart and onInstalled does not fire then, hence both events.
api.runtime.onInstalled.addListener(setupMenus);
api.runtime.onStartup.addListener(setupMenus);

async function setupMenus() {
  await api.contextMenus.removeAll();
  api.contextMenus.create({
    id: "shortcuts-settings",
    title: "Shortcuts settings",
    contexts: ["action"],
  });
  api.contextMenus.create({
    id: "add-to-shortcuts",
    title: "Add to shortcuts",
    contexts: ["page"],
  });
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "shortcuts-settings") api.runtime.openOptionsPage();
  if (info.menuItemId === "add-to-shortcuts") {
    // openOptionsPage takes no arguments, so the page's data travels through
    // session storage; the settings page consumes it on load and via onChanged
    // (an already-open options tab is focused, not reloaded).
    await api.storage.session.set({
      pendingShortcut: { title: tab?.title ?? "", url: info.pageUrl ?? tab?.url ?? "" },
    });
    api.runtime.openOptionsPage();
  }
});

async function openOverlay(name, tab) {
  const { files, page, w, h } = OVERLAYS[name];
  // Chrome declares onCommand's tab as optional; ask for it when it's missing.
  const target = tab ?? (await api.tabs.query({ active: true, currentWindow: true }))[0];
  if (target?.id != null) {
    try {
      await api.scripting.executeScript({ target: { tabId: target.id }, files });
      return;
    } catch {
      // injection refused — fall through to the popup window
    }
  }
  const win = await api.windows.getLastFocused();
  await api.windows.create({
    url: api.runtime.getURL(`${page}?origin=${target?.windowId ?? win.id}`),
    type: "popup",
    width: w,
    height: h,
    left: Math.round((win.left ?? 0) + ((win.width ?? w) - w) / 2),
    top: Math.round((win.top ?? 0) + ((win.height ?? h) - h) * 0.22),
  });
}

// --- tools ---
// Window chores fired from the tools overlay. `windowId` is the page's window
// (the overlay's own tab, or the origin the fallback window was given);
// `screen` is that monitor's usable box, measured by the overlay because a
// service worker has no `screen`.

async function runTool(id, windowId, senderTab, screen) {
  const origin = await api.windows.get(windowId, { populate: true });
  if (id === "merge-windows") return mergeWindows(origin);
  if (id === "split-window") return splitWindow(origin, senderTab, screen);
  throw new Error(`unknown tool: ${id}`);
}

// Every other normal window's tabs move into the origin window, in window
// order, appended. Private windows stay out of non-private ones and vice
// versa (the browser refuses the move anyway). Emptied windows close by
// themselves. Chrome drops the pinned flag on a cross-window move, so it is
// put back.
async function mergeWindows(origin) {
  const windows = await api.windows.getAll({ populate: true, windowTypes: ["normal"] });
  for (const win of windows) {
    if (win.id === origin.id || win.incognito !== origin.incognito) continue;
    const tabs = win.tabs ?? [];
    if (!tabs.length) continue;
    await api.tabs.move(
      tabs.map((t) => t.id),
      { windowId: origin.id, index: -1 },
    );
    for (const t of tabs) if (t.pinned) await api.tabs.update(t.id, { pinned: true });
  }
  await api.windows.update(origin.id, { focused: true });
}

// The page's tab moves out into a new window and the two share the screen,
// origin on the left. A window that holds only that tab has nothing to split
// off, so nothing happens. A maximized or fullscreen window ignores bounds,
// hence the state reset first.
async function splitWindow(origin, senderTab, screen) {
  const tab = senderTab ?? origin.tabs?.find((t) => t.active);
  if (!tab || (origin.tabs ?? []).length < 2) return;
  const half = Math.floor(screen.width / 2);
  const left = { left: screen.left, top: screen.top, width: half, height: screen.height };
  const right = { left: screen.left + half, top: screen.top, width: screen.width - half, height: screen.height };
  if (origin.state !== "normal") await api.windows.update(origin.id, { state: "normal" });
  await api.windows.update(origin.id, left);
  await api.windows.create({ tabId: tab.id, ...right, focused: true });
}

// --- dev seed (development installs only) ---
// web-ext run starts from an empty throwaway profile every time, so a fresh
// development install with no shortcuts gets the sample set. Signed installs
// report installType "normal" and never reach this; a profile that already
// has shortcuts is left alone.
api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  try {
    const { installType } = await api.management.getSelf();
    if (installType !== "development") return;
    const { shortcuts } = await api.storage.sync.get("shortcuts");
    if (shortcuts?.length) return;
    const seed = await (await fetch(api.runtime.getURL("dev-seed.json"))).json();
    await api.storage.sync.set({ shortcuts: seed });
  } catch (err) {
    console.warn("dev seed skipped:", err); // convenience only — never fatal
  }
});

// --- dev hot-reload (unpacked builds only) ---
// An extension cannot watch its own source files, so scripts/dev-server.mjs
// serves a change stamp on localhost; we poll it and runtime.reload() when it
// changes. Store installs carry update_url, which disables all of this.
// The alarm probes every 30s while the watcher is down; once it responds,
// a fast 1s loop takes over (the API call in it also keeps this worker awake).

const DEV_URL = "http://127.0.0.1:17345/";
let devStamp = null;
let devFastTimer = null;

if (!("update_url" in api.runtime.getManifest())) {
  api.alarms.create("dev-reload-probe", { periodInMinutes: 0.5 });
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "dev-reload-probe" && devFastTimer === null) devProbe();
  });
  devProbe();
}

async function devProbe() {
  const stamp = await devFetch();
  if (stamp === null) return;
  devStamp = stamp;
  devFastTimer = setInterval(async () => {
    api.runtime.getPlatformInfo();
    const s = await devFetch();
    if (s === null) {
      clearInterval(devFastTimer);
      devFastTimer = null;
    } else if (s !== devStamp) {
      api.runtime.reload();
    }
  }, 1000);
}

async function devFetch() {
  try {
    const res = await fetch(DEV_URL, { cache: "no-store" });
    return await res.text();
  } catch {
    return null;
  }
}



