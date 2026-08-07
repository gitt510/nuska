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
        case "open-options":
          // Content scripts have no runtime.openOptionsPage.
          await api.runtime.openOptionsPage();
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

// Two overlays, same shape: injected into the page as a content script, with
// a centered popup window as the fallback for pages that refuse injection
// (chrome://, the Web Store, …). Both are reached by keyboard, which is what
// grants activeTab — no host permission is involved.
const OVERLAYS = {
  launcher: { file: "launcher/launcher.js", page: "launcher/launcher.html", w: 680, h: 480 },
  shortcuts: { file: "shortcuts/shortcuts.js", page: "shortcuts/shortcuts.html", w: 680, h: 400 },
};

// Ctrl+B (_execute_action) and the toolbar icon open the launcher; Ctrl+,
// opens the shortcuts overlay. _execute_action never fires onCommand, so both
// listeners are needed.
api.action.onClicked.addListener((tab) => openOverlay("launcher", tab));

api.commands.onCommand.addListener((command, tab) => {
  if (command === "open-shortcuts") openOverlay("shortcuts", tab);
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
  const { file, page, w, h } = OVERLAYS[name];
  // Chrome declares onCommand's tab as optional; ask for it when it's missing.
  const target = tab ?? (await api.tabs.query({ active: true, currentWindow: true }))[0];
  if (target?.id != null) {
    try {
      await api.scripting.executeScript({ target: { tabId: target.id }, files: [file] });
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

