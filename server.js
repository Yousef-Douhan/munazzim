// مُنظِّم — personal planner with automatic WhatsApp + email reminders.
// Zero dependencies: Node.js 18+ only.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEnv, cfg } from "./lib/env.js";

loadEnv();
const { getState, setState, storageKind } = await import("./lib/store.js");
const { tick, lastTickAt, dailyText, weeklyText, nowIn } = await import("./lib/scheduler.js");
const { channels, notifyAll } = await import("./lib/notify.js");

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const C = cfg();
if (!C.password) console.warn("⚠️  APP_PASSWORD is not set — set it before deploying!");

/* ---------- auth: signed cookie, 30 days ---------- */
const sign = v => crypto.createHmac("sha256", C.secret).update(v).digest("base64url");
const makeToken = () => { const exp = Date.now() + 30 * 864e5; return `${exp}.${sign(String(exp))}`; };
function authed(req) {
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)mz=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || +exp < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ---------- helpers ---------- */
const json = (res, code, obj, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on("data", c => { size += c.length; if (size > 2e6) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new Error("bad json")); } });
  req.on("error", reject);
});
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json" };
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}
let loginFails = 0, loginLockUntil = 0;

/* ---------- routes ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"), p = url.pathname;
  try {
    if (p === "/health") return json(res, 200, { ok: true, lastTick: lastTickAt() });

    // Called by cron-job.org every few minutes: keeps the free server awake and runs reminders.
    if (p === "/api/tick") {
      if (C.cronSecret && !safeEq(url.searchParams.get("key") || "", C.cronSecret)) return json(res, 403, { error: "bad key" });
      const r = await tick();
      return json(res, 200, { ok: true, now: r.now, sent: (r.sent || []).map(s => s.key) });
    }

    if (p === "/api/login" && req.method === "POST") {
      if (Date.now() < loginLockUntil) return json(res, 429, { error: "محاولات كثيرة، انتظر دقيقة" });
      const { password } = await readBody(req);
      if (!C.password || !safeEq(password || "", C.password)) {
        if (++loginFails >= 5) { loginLockUntil = Date.now() + 60e3; loginFails = 0; }
        return json(res, 401, { error: "كلمة المرور غير صحيحة" });
      }
      loginFails = 0;
      const secure = (req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
      return json(res, 200, { ok: true }, { "Set-Cookie": `mz=${makeToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure}` });
    }
    if (p === "/api/logout") return json(res, 200, { ok: true }, { "Set-Cookie": "mz=; Path=/; Max-Age=0" });

    if (p.startsWith("/api/")) {
      if (!authed(req)) return json(res, 401, { error: "unauthorized" });

      if (p === "/api/state" && req.method === "GET") return json(res, 200, { state: await getState() });
      if (p === "/api/state" && req.method === "PUT") {
        const { state } = await readBody(req);
        if (!state || !Array.isArray(state.tasks)) return json(res, 400, { error: "bad state" });
        await setState(state);
        return json(res, 200, { ok: true });
      }
      if (p === "/api/status") {
        const c = cfg();
        return json(res, 200, {
          channels: channels(), storage: storageKind(), tz: c.tz, now: nowIn(c.tz), lastTick: lastTickAt(),
          whatsapp: c.waPhone ? c.waPhone.replace(/\d(?=\d{3})/g, "•") : "", email: c.emailTo ? c.emailTo.replace(/^(.).*(@.*)$/, "$1•••$2") : "",
        });
      }
      if (p === "/api/send" && req.method === "POST") {
        const { kind = "daily", channel } = await readBody(req);
        const state = (await getState()) || { tasks: [], settings: {} }, today = nowIn(cfg().tz).date;
        const text = kind === "weekly" ? weeklyText(state, today) : kind === "test" ? "✅ رسالة تجريبية من مُنظِّم — التذكيرات تعمل!" : dailyText(state, today);
        const subject = kind === "weekly" ? "🗓️ خطة الأسبوع — مُنظِّم" : kind === "test" ? "✅ اختبار مُنظِّم" : "☀️ جدول اليوم — مُنظِّم";
        const s = { ...(state.settings || {}), waEnabled: channel !== "email", emailEnabled: channel !== "whatsapp" };
        return json(res, 200, { result: await notifyAll(s, subject, text) });
      }
      return json(res, 404, { error: "not found" });
    }
    return serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: e.message });
  }
});

server.listen(C.port, () => {
  console.log(`✅ مُنظِّم يعمل على المنفذ ${C.port} | التخزين: ${storageKind()} | المنطقة الزمنية: ${C.tz} | القنوات: ${JSON.stringify(channels())}`);
});
// Internal scheduler (runs whenever the server is awake).
setInterval(() => tick().catch(e => console.error("tick", e.message)), 30_000);
setTimeout(() => tick().catch(e => console.error("tick", e.message)), 3_000);
