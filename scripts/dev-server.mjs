#!/usr/bin/env node
// Dev hot-reload watcher. Serves a change stamp on 127.0.0.1; the extension
// polls it and reloads itself when the stamp changes (see bg.js).
import { createServer } from "node:http";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = 17345;
const root = fileURLToPath(new URL("../src/", import.meta.url));
let stamp = String(Date.now());

watch(root, { recursive: true }, (_event, file) => {
  if (!file) return;
  stamp = String(Date.now());
  console.log(`changed: ${file}`);
});

createServer((_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(stamp);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`watching ${root}`);
  console.log(`extension reloads on save (http://127.0.0.1:${PORT})`);
});
