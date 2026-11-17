// Tiny .env loader (no dependencies). Real environment variables win.
import fs from "node:fs";
import path from "node:path";

export function loadEnv(file = path.resolve(process.cwd(), ".env")) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export const cfg = () => ({
  port: +(process.env.PORT || 3000),
  password: process.env.APP_PASSWORD || "",
  secret: process.env.SESSION_SECRET || process.env.APP_PASSWORD || "change-me",
  cronSecret: process.env.CRON_SECRET || "",
  tz: process.env.TIMEZONE || "Asia/Hebron",
  // WhatsApp via CallMeBot
  waPhone: process.env.WHATSAPP_PHONE || "",
  waKey: process.env.CALLMEBOT_APIKEY || "",
  waBase: process.env.CALLMEBOT_BASE || "https://api.callmebot.com",
  // WhatsApp via Green-API (used instead of CallMeBot when set)
  greenId: process.env.GREENAPI_ID_INSTANCE || "",
  greenToken: process.env.GREENAPI_API_TOKEN || "",
  greenUrl: process.env.GREENAPI_API_URL || "https://api.green-api.com",
  // Email via Brevo
  brevoKey: process.env.BREVO_API_KEY || "",
  brevoBase: process.env.BREVO_BASE || "https://api.brevo.com",
  emailTo: process.env.EMAIL_TO || "",
  emailFrom: process.env.EMAIL_FROM || process.env.EMAIL_TO || "",
  // Storage: Upstash Redis (persistent) or local file
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL || "",
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  dataFile: process.env.DATA_FILE || "data.json",
});
