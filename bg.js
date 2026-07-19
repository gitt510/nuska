// Background (Chrome: MV3 service worker / Firefox: event page).
// The popup only selects; actions run here, because the popup dies the
// moment focus moves away from it.

const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
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

