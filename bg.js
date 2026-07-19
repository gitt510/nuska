// Background (Chrome: MV3 service worker / Firefox: event page).
// The popup only *selects* a command; all window manipulation happens here,
// because the popup dies the moment focus moves away from it.

const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "split":
          await splitWindows(msg.fallbackArea);
          break;
        case "merge":
          await mergeWindows();
          break;
        case "open-url":
          await api.tabs.create({ url: msg.url });
          break;
        default:
          throw new Error(`unknown message type: ${msg.type}`);
      }
      sendResponse({ ok: true });
    } catch (err) {
      console.error(err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true;
});

// chrome.system.display does not exist in Firefox; the popup sends its own
// screen dimensions as a fallback.
async function workArea(fallbackArea) {
  if (api.system?.display) {
    const displays = await api.system.display.getInfo();
    const primary = displays.find((d) => d.isPrimary) ?? displays[0];
    return primary.workArea;
  }
  return fallbackArea;
}

// Tile the current window on the left half and the most recent other
// window (if any) on the right half of the primary display.
async function splitWindows(fallbackArea) {
  const area = await workArea(fallbackArea);
  const half = Math.floor(area.width / 2);

  const current = await api.windows.getLastFocused({ windowTypes: ["normal"] });
  const other = (await api.windows.getAll())
    .filter((w) => w.type === "normal" && w.id !== current.id)
    .at(-1);

  await api.windows.update(current.id, {
    state: "normal",
    left: area.left,
    top: area.top,
    width: half,
    height: area.height,
  });
  if (other) {
    await api.windows.update(other.id, {
      state: "normal",
      left: area.left + half,
      top: area.top,
      width: area.width - half,
      height: area.height,
    });
    await api.windows.update(current.id, { focused: true });
  }
}

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

// Move every tab from every other normal window into the current one.
// Moving a pinned tab drops its pinned state, so re-pin afterwards.
async function mergeWindows() {
  const current = await api.windows.getLastFocused({ windowTypes: ["normal"] });
  const others = (await api.windows.getAll({ populate: true })).filter(
    (w) => w.type === "normal" && w.id !== current.id,
  );

  for (const w of others) {
    const pinnedIds = w.tabs.filter((t) => t.pinned).map((t) => t.id);
    await api.tabs.move(
      w.tabs.map((t) => t.id),
      { windowId: current.id, index: -1 },
    );
    for (const id of pinnedIds) {
      await api.tabs.update(id, { pinned: true });
    }
  }
}
