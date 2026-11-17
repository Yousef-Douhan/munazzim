// Decides what to send and when, in the user's time zone.
import { cfg } from "./env.js";
import { getState, getSent, setSent } from "./store.js";
import { sendWhatsApp, sendEmail, channels } from "./notify.js";

export const CATS = {
  study: { name: "دراسة", icon: "📚" }, work: { name: "عمل", icon: "💼" },
  family: { name: "أسرة", icon: "🏠" }, personal: { name: "شخصي", icon: "🌱" },
};
const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const fmtTime = t => { if (!t) return ""; let [h, m] = t.split(":").map(Number); const s = h < 12 ? "ص" : "م"; h = h % 12 || 12; return `${h}:${pad(m)} ${s}`; };
const fmtLong = d => `${DAYS[d.getDay()]}، ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// "Now" as wall-clock date + minutes in the configured time zone.
export function nowIn(tz, at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, minutes: (+p.hour % 24) * 60 + +p.minute, dow: parse(date).getDay(), day: +p.day };
}

// Same rules as the web page.
export function occursOn(t, ds) {
  if (ds < t.date) return false;
  if (t.skip && t.skip.includes(ds)) return false;
  if (t.until && ds > t.until) return false;
  const d = parse(ds), s = parse(t.date);
  switch (t.rec) {
    case "none": return ds === t.date;
    case "daily": return true;
    case "weekly": return (t.days && t.days.length ? t.days : [s.getDay()]).includes(d.getDay());
    case "monthly": return d.getDate() === s.getDate();
    case "yearly": return d.getDate() === s.getDate() && d.getMonth() === s.getMonth();
  }
  return false;
}
const tasksOn = (state, ds) => (state.tasks || []).filter(t => occursOn(t, ds)).sort((a, b) => (a.start || "99").localeCompare(b.start || "99"));
const line = t => `${CATS[t.cat]?.icon || "•"} ${t.title}${t.start ? ` — ${fmtTime(t.start)}${t.end ? " إلى " + fmtTime(t.end) : ""}` : ""}${t.pri === "high" ? " ⚡" : ""}`;

export function dailyText(state, ds) {
  const list = tasksOn(state, ds), name = state.settings?.name ? ` ${state.settings.name}` : "";
  let txt = `صباح الخير${name} ☀️\n📅 جدول ${fmtLong(parse(ds))}\n\n`;
  txt += list.length ? list.map((t, i) => `${i + 1}. ${line(t)}`).join("\n") : "لا توجد مهام اليوم. استمتع بيومك 🌿";
  return txt + `\n\nالمجموع: ${list.length} مهام\n— مُنظِّم`;
}
export function weeklyText(state, ds) {
  const start = parse(ds); let txt = `🗓️ خطة الأسبوع (${start.getDate()} ${MONTHS[start.getMonth()]} – ${addDays(start, 6).getDate()} ${MONTHS[addDays(start, 6).getMonth()]})\n`;
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), list = tasksOn(state, ymd(d)); total += list.length;
    txt += `\n*${DAYS[d.getDay()]} ${d.getDate()}*\n` + (list.length ? list.map(t => "  " + line(t)).join("\n") : "  —");
  }
  return txt + `\n\nالمجموع: ${total} مهمة هذا الأسبوع\n— مُنظِّم`;
}
export function monthlyText(state, ds) {
  const d = parse(ds), days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const counts = { study: 0, work: 0, family: 0, personal: 0 }, special = [];
  for (let i = 1; i <= days; i++) {
    const cur = ymd(new Date(d.getFullYear(), d.getMonth(), i));
    tasksOn(state, cur).forEach(t => { counts[t.cat] = (counts[t.cat] || 0) + 1; if (t.rec === "none" || t.rec === "yearly" || t.rec === "monthly") special.push(`  ${i} ${MONTHS[d.getMonth()]}: ${line(t)}`); });
  }
  let txt = `📆 شهر ${MONTHS[d.getMonth()]} ${d.getFullYear()}\n\n` + Object.entries(counts).map(([k, n]) => `${CATS[k].icon} ${CATS[k].name}: ${n}`).join("\n");
  if (special.length) txt += `\n\nمواعيد مهمة هذا الشهر:\n` + special.slice(0, 25).join("\n");
  const goals = state.goals || [];
  if (goals.length) txt += `\n\n🎯 أهدافك السنوية:\n` + goals.map(g => `  ${g.title} — ${g.progress}%`).join("\n");
  return txt + `\n\n— مُنظِّم`;
}

const CATCH_UP = 20; // minutes: still send if the server woke up a little late
let lastTick = null, running = false;
export const lastTickAt = () => lastTick;

export async function tick(at = new Date()) {
  if (running) return { skipped: "busy" };
  running = true;
  const sent = [];
  try {
    const state = await getState();
    if (!state) return { sent };
    const s = state.settings || {}, tz = cfg().tz, now = nowIn(tz, at);
    const log = await getSent();
    let changed = false;
    const ch = channels();
    // Each channel is logged separately, so a failure on one never re-sends the other.
    const fire = async (key, subject, text) => {
      const jobs = [];
      if (ch.whatsapp && s.waEnabled !== false) jobs.push(["wa", () => sendWhatsApp(text)]);
      if (ch.email && s.emailEnabled !== false) jobs.push(["mail", () => sendEmail(subject, text)]);
      for (const [c, send] of jobs) {
        const k = `${c}:${key}`;
        if (log[k]?.ok || (log[k]?.tries || 0) >= 3) continue;
        const res = await send();
        log[k] = { ok: !!res.ok, tries: (log[k]?.tries || 0) + 1, at: at.toISOString(), res };
        await setSent(log); // persist right away so a restart never re-sends
        sent.push({ key: k, res });
        console.log(`[send] ${k}`, JSON.stringify(res));
      }
    };
    const due = target => now.minutes >= target && now.minutes <= target + CATCH_UP;

    // 1) Task reminders
    for (const t of tasksOn(state, now.date)) {
      if (!t.start || t.remind == null || +t.remind < 0 || t.done?.[now.date]) continue;
      const startMin = toMin(t.start);
      if (due(startMin - +t.remind)) {
        const r = +t.remind;
        const when = r === 0 ? "الآن" : r === 60 ? "بعد ساعة" : r === 120 ? "بعد ساعتين" : `بعد ${r} ${r <= 10 ? "دقائق" : "دقيقة"}`;
        await fire(`task:${t.id}:${now.date}`, `🔔 تذكير: ${t.title}`,
          `🔔 تذكير — ${CATS[t.cat]?.name || ""}\n*${t.title}*\nتبدأ ${when} (${fmtTime(t.start)}${t.end ? " – " + fmtTime(t.end) : ""})${t.notes ? `\n📝 ${t.notes}` : ""}`);
      }
    }
    // 2) Daily / weekly / monthly summaries at the chosen time
    const sumMin = toMin(s.summaryTime || "07:00");
    if (due(sumMin)) {
      if (s.daily !== false) await fire(`daily:${now.date}`, "☀️ جدول اليوم — مُنظِّم", dailyText(state, now.date));
      if (s.weekly !== false && now.dow === 6) await fire(`weekly:${now.date}`, "🗓️ خطة الأسبوع — مُنظِّم", weeklyText(state, now.date));
      if (s.monthly !== false && now.day === 1) await fire(`monthly:${now.date}`, "📆 خطة الشهر — مُنظِّم", monthlyText(state, now.date));
    }
    // 3) Evening review (optional)
    if (s.evening && due(toMin(s.eveningTime || "21:00"))) {
      const list = tasksOn(state, now.date), left = list.filter(t => !t.done?.[now.date]);
      await fire(`evening:${now.date}`, "🌙 مراجعة المساء — مُنظِّم",
        `🌙 مراجعة اليوم\nأنجزت ${list.length - left.length} من ${list.length}\n` + (left.length ? `\nلم تُنجز بعد:\n${left.map(t => "  " + line(t)).join("\n")}` : "\nأحسنت! أنجزت كل شيء 👏"));
    }
    // Keep the log small: drop entries older than 3 days.
    const cutoff = ymd(addDays(parse(now.date), -3));
    for (const k of Object.keys(log)) { const d = k.split(":").pop(); if (d < cutoff) { delete log[k]; changed = true; } }
    if (changed) await setSent(log);
    return { now, sent, channels: ch };
  } finally {
    lastTick = new Date().toISOString();
    running = false;
  }
}
