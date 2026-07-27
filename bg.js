// Background (Chrome: MV3 service worker / Firefox: event page).
// The launcher UI only selects; actions run here, because the UI dies the
// moment focus moves away from it.

const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "open-url": {
          // The overlay's sender tab pins the target window; the fallback
          // window passes the original window's id instead, because the tab
          // must not open inside the launcher window itself.
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

// Ctrl+B (_execute_action) and the toolbar icon both land here. Primary UI
// is the overlay injected into the page; pages that refuse injection
// (chrome://, the Web Store, …) get a centered popup window instead.
const FALLBACK = { width: 680, height: 480 };

api.action.onClicked.addListener(async (tab) => {
  try {
    await api.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["launcher/launcher.js"],
    });
  } catch {
    const win = await api.windows.getLastFocused();
    await api.windows.create({
      url: api.runtime.getURL(`launcher/launcher.html?origin=${tab.windowId}`),
      type: "popup",
      width: FALLBACK.width,
      height: FALLBACK.height,
      left: Math.round((win.left ?? 0) + ((win.width ?? FALLBACK.width) - FALLBACK.width) / 2),
      top: Math.round((win.top ?? 0) + ((win.height ?? FALLBACK.height) - FALLBACK.height) * 0.22),
    });
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

