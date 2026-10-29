// The fallback window for every overlay: background.js passes the same file
// list it would have injected, and they load here in that order. Extension
// pages refuse inline scripts, hence a file for these few lines.
const files = new URLSearchParams(location.search).get("files")?.split(",") ?? [];
for (const file of files) {
  const script = document.createElement("script");
  script.src = `../${file}`;
  script.async = false; // keep order: ui, then source, then engine
  document.body.append(script);
}

// "lib/bookmarks.js" → "Bookmarks", for the window title.
const name = files.find((f) => f.startsWith("lib/"))?.slice(4, -3) ?? "";
if (name) document.title = name[0].toUpperCase() + name.slice(1);
