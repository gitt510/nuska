#!/usr/bin/env node
// Download an already-signed .xpi from AMO into web-ext-artifacts/, for a
// version signed on another machine. Needs WEB_EXT_API_KEY/SECRET (op run).
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));
const id = manifest.browser_specific_settings.gecko.id;
const version = process.argv[2] || manifest.version;

// AMO API auth: a short-lived HS256 JWT signed with the API secret
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: process.env.WEB_EXT_API_KEY, jti: randomUUID(), iat, exp: iat + 60 })}`;
  return `${body}.${createHmac("sha256", process.env.WEB_EXT_API_SECRET).update(body).digest("base64url")}`;
}

async function get(url) {
  const res = await fetch(url, { headers: { Authorization: `JWT ${jwt()}` } });
  if (!res.ok) throw new Error(`${res.status} ${url}\n${await res.text()}`);
  return res;
}

const meta = await (await get(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(id)}/versions/${version}/`)).json();
const out = `web-ext-artifacts/${basename(new URL(meta.file.url).pathname)}`;
writeFileSync(out, Buffer.from(await (await get(meta.file.url)).arrayBuffer()));
console.log(`saved ${out} (${meta.file.status})`);
