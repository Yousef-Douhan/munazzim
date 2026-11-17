// Storage: Upstash Redis REST (persists on free hosting) or a local JSON file.
import fs from "node:fs";
import { cfg } from "./env.js";

const KEY_STATE = "munazzim:state";
const KEY_SENT = "munazzim:sent";

async function upstash(cmd) {
  const c = cfg();
  const res = await fetch(c.upstashUrl.replace(/\/$/, ""), {
    method: "POST",
    headers: { Authorization: `Bearer ${c.upstashToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error("Upstash: " + (data.error || res.status));
  return data.result;
}

function readFile() {
  try { return JSON.parse(fs.readFileSync(cfg().dataFile, "utf8")); } catch { return {}; }
}
function writeFile(obj) {
  const f = cfg().dataFile;
  fs.writeFileSync(f + ".tmp", JSON.stringify(obj));
  fs.renameSync(f + ".tmp", f);
}

const useUpstash = () => !!(cfg().upstashUrl && cfg().upstashToken);
export const storageKind = () => (useUpstash() ? "upstash" : "file");

async function get(key) {
  if (useUpstash()) { const v = await upstash(["GET", key]); return v ? JSON.parse(v) : null; }
  return readFile()[key] ?? null;
}
async function set(key, value) {
  if (useUpstash()) return upstash(["SET", key, JSON.stringify(value)]);
  const all = readFile(); all[key] = value; writeFile(all);
}

// In-memory cache so the scheduler doesn't hit storage every tick.
let stateCache = null, sentCache = null;
export async function getState() { if (!stateCache) stateCache = await get(KEY_STATE); return stateCache; }
export async function setState(s) { stateCache = s; await set(KEY_STATE, s); }
export async function getSent() { if (!sentCache) sentCache = (await get(KEY_SENT)) || {}; return sentCache; }
export async function setSent(s) { sentCache = s; await set(KEY_SENT, s); }
