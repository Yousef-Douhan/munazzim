// WhatsApp (Green-API or CallMeBot) + Email (Brevo). Both are plain HTTPS calls, no SDKs.
import { cfg } from "./env.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
let waQueue = Promise.resolve(), lastWa = 0;

// Which WhatsApp provider is configured: Green-API (if its keys exist) or CallMeBot.
const waProvider = c => (c.greenId && c.greenToken ? "greenapi" : c.waKey ? "callmebot" : null);

export const channels = () => {
  const c = cfg();
  return { whatsapp: !!(c.waPhone && waProvider(c)), email: !!(c.brevoKey && c.emailTo && c.emailFrom), whatsappProvider: waProvider(c) };
};

async function callmebot(c, text) {
  const url = `${c.waBase.replace(/\/$/, "")}/whatsapp.php?phone=${encodeURIComponent(c.waPhone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(c.waKey)}`;
  const res = await fetch(url);
  const body = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return { ok: res.ok && !/error|invalid|not\s+valid|apikey is wrong/i.test(body), status: res.status, body };
}

async function greenapi(c, text) {
  const chatId = c.waPhone.replace(/[^\d]/g, "") + "@c.us";
  const url = `${c.greenUrl.replace(/\/$/, "")}/waInstance${c.greenId}/sendMessage/${c.greenToken}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, message: text }) });
  const body = (await res.text()).slice(0, 200);
  return { ok: res.ok && /idMessage/.test(body), status: res.status, body };
}

export function sendWhatsApp(text) {
  const c = cfg(), provider = waProvider(c);
  if (!c.waPhone || !provider) return Promise.resolve({ ok: false, error: "WhatsApp غير مُعدّ" });
  // One message at a time with a short gap, so the provider never sees a burst.
  const job = waQueue.then(async () => {
    const wait = lastWa + 3000 - Date.now();
    if (wait > 0) await sleep(wait);
    lastWa = Date.now();
    try {
      return await (provider === "greenapi" ? greenapi(c, text) : callmebot(c, text));
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  waQueue = job.catch(() => {});
  return job;
}

export async function sendEmail(subject, text) {
  const c = cfg();
  if (!c.brevoKey || !c.emailTo || !c.emailFrom) return { ok: false, error: "الإيميل غير مُعدّ" };
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:#161A2B;max-width:560px;margin:auto;padding:24px;border:1px solid #E3E6EE;border-radius:14px">
    <div style="font-size:20px;font-weight:bold;color:#3D4FD8;margin-bottom:12px">مُنظِّم</div>
    ${text.split("\n").map(l => `<div>${l.replace(/[&<>]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch])) || "&nbsp;"}</div>`).join("")}
  </div>`;
  try {
    const res = await fetch(`${c.brevoBase.replace(/\/$/, "")}/v3/smtp/email`, {
      method: "POST",
      headers: { "api-key": c.brevoKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "مُنظِّم", email: c.emailFrom },
        to: [{ email: c.emailTo }],
        subject, htmlContent: html, textContent: text,
      }),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body: body.slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Send to every enabled channel.
export async function notifyAll(settings, subject, text) {
  const ch = channels(), out = {};
  if (ch.whatsapp && settings.waEnabled !== false) out.whatsapp = await sendWhatsApp(text);
  if (ch.email && settings.emailEnabled !== false) out.email = await sendEmail(subject, text);
  return out;
}
