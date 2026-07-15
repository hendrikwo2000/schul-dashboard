"use strict";

// ------------------------------------------------------------- Einstellungen
const CONFIG = {
  // Name für die Begrüßung und die Sprachausgabe
  name: "Hendrik",
  // Link zu deiner ToDo-App (GitHub-Pages-URL eintragen, leer = Kachel ausblenden)
  todoAppUrl: "https://hendrikwo2000.github.io/todo-app/",
  // ToDo-Board (JSONBin-Cloud der ToDo-App; Key ist bewusst nur für dieses Bin gültig)
  jsonbinUrl: "https://api.jsonbin.io/v3/b/6a4bf236da38895dfe36c173/latest",
  jsonbinKey: "$2a$10$BGeFi/PYFCLdZs0Bzu8PHeijV91l8JX.izcEgvuptBkIeXwePMKSu",
  todoCategories: ["Schule", "Facharbeit"],
  // Ab diesem Alter der Daten warnt das Dashboard (die Action läuft alle 30 Min.)
  staleHours: 3,
};

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MS_DAY = 24 * 60 * 60 * 1000;

let data = null;
let view = "today";
let calView = "today";
let todos = []; // vom ToDo-Board, wird auch vorgelesen

// ---------------------------------------------------------------- Hilfen
const $ = (sel) => document.querySelector(sel);
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const IS_IOS = /iPhone|iPad/i.test(navigator.userAgent);

// Auf dem Handy zuerst die App versuchen; oeffnet sie sich nicht,
// automatisch auf die Website ausweichen. Am PC: direkt Website.
// Android: intent:-Link mit Paketname (eigener Fallback eingebaut),
// iOS: URL-Schema mit Timer-Fallback.
function appUrl(a) {
  if (IS_ANDROID && a.dataset.package) {
    return "intent:#Intent;package=" + a.dataset.package +
      ";action=android.intent.action.MAIN" +
      ";S.browser_fallback_url=" + encodeURIComponent(a.href) + ";end";
  }
  return a.dataset.app || "";
}

function bindAppLinks() {
  document.querySelectorAll("a[data-app], a[data-package]").forEach((a) => {
    if (a.dataset.bound) return;
    a.dataset.bound = "1";
    a.addEventListener("click", (e) => {
      if (!IS_ANDROID && !IS_IOS) return;
      const target = appUrl(a);
      if (!target) return;
      e.preventDefault();
      const webUrl = a.href;
      // Fallback zur Website nur, wenn sich nichts tut. Sobald die Seite den
      // Fokus verliert (App-Dialog oder App-Wechsel), wird er abgebrochen.
      const timer = setTimeout(() => { window.location.href = webUrl; }, 2500);
      const cancel = () => clearTimeout(timer);
      window.addEventListener("pagehide", cancel, { once: true });
      window.addEventListener("blur", cancel, { once: true });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) cancel();
      }, { once: true });
      window.location.href = target;
    });
  });
}

// ---------------------------------------------------------------- Theme
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme-btn").textContent = theme === "dark" ? "☀" : "☾";
}

$("#theme-btn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  applyTheme(next);
});
applyTheme(document.documentElement.dataset.theme);

function esc(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function todayISO() {
  return new Date().toLocaleDateString("sv-SE"); // yyyy-mm-dd, lokale Zeit
}

// Datum in n Tagen als yyyy-mm-dd (n darf negativ sein)
function isoIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("sv-SE");
}

function fmtDate(iso) {
  const d = new Date(iso + "T00:00");
  return `${WEEKDAYS[d.getDay()]}, ${d.toLocaleDateString("de-DE")}`;
}

function fmtShort(iso) {
  return new Date(iso + "T00:00")
    .toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Ganze Tage bis zum Termin: 0 = heute, 1 = morgen, negativ = vorbei
function daysUntil(due) {
  return Math.round((startOfDay(due) - startOfDay(new Date())) / MS_DAY);
}

// ---------------------------------------------------------------- Kopf
function greeting() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 0 || day === 6) return { emoji: "🎉", text: `Schönes Wochenende, ${CONFIG.name}` };
  if (hour < 11) return { emoji: "🌅", text: `Guten Morgen, ${CONFIG.name}` };
  if (hour < 14) return { emoji: "☀️", text: `Guten Mittag, ${CONFIG.name}` };
  if (hour < 18) return { emoji: "🌇", text: `Guten Nachmittag, ${CONFIG.name}` };
  return { emoji: "🌙", text: `Guten Abend, ${CONFIG.name}` };
}

// Nur melden, wenn die Action offenbar hängt - sonst bleibt der Kopf leer.
function renderStale() {
  const el = $("#stale-banner");
  const hours = data?.updated
    ? Math.floor((Date.now() - new Date(data.updated).getTime()) / 3600000)
    : null;

  if (hours === null || Number.isNaN(hours) || hours < CONFIG.staleHours) {
    el.classList.add("hidden");
    return;
  }
  const age = hours < 24
    ? `${hours} Stunden`
    : Math.floor(hours / 24) === 1 ? "einen Tag" : `${Math.floor(hours / 24)} Tage`;
  el.textContent = `⚠️ Die Daten sind ${age} alt — die Aktualisierung läuft gerade nicht.`;
  el.classList.remove("hidden");
}

function renderHeader() {
  const g = greeting();
  $("#greeting").textContent = `${g.emoji} ${g.text}`;
  renderStale();
  $("#demo-banner").classList.toggle("hidden", !data?.demo);
}

// ---------------------------------------------------------------- Stundenplan
function lessonHTML(l) {
  const cls = l.code === "cancelled" ? "cancelled" : l.code === "irregular" ? "irregular" : "";
  const badge =
    l.code === "cancelled" ? '<span class="badge">Entfällt</span>' :
    l.code === "irregular" ? '<span class="badge">Vertretung</span>' : "";
  const detail = [l.room, l.teacher, l.info].filter(Boolean).join(" · ");
  return `
    <div class="lesson ${cls}">
      <div class="time">${esc(l.start)}–${esc(l.end)}</div>
      <div class="what">
        <div class="subject">${esc(l.subject)}</div>
        ${detail ? `<div class="detail">${esc(detail)}</div>` : ""}
      </div>
      ${badge}
    </div>`;
}

function renderTimetable() {
  const el = $("#timetable");
  const untis = data?.untis;

  if (untis?.error && !untis.days?.length) {
    el.innerHTML = `<div class="error">Stundenplan konnte nicht geladen werden: ${esc(untis.error)}</div>`;
    return;
  }

  const today = todayISO();
  const days = view === "today"
    ? (untis?.days || []).filter((d) => d.date === today)
    : (untis?.days || []);

  if (!days.length || days.every((d) => !d.lessons.length)) {
    el.innerHTML = `<div class="empty">${view === "today" ? "Heute kein Unterricht 🎉" : "Keine Stunden in dieser Woche."}</div>`;
    return;
  }

  el.innerHTML = days.map((d) => `
    ${view === "week" || d.date !== today
      ? `<div class="day-title ${d.date === today ? "today" : ""}">${esc(fmtDate(d.date))}</div>`
      : ""}
    ${d.lessons.map(lessonHTML).join("")}
  `).join("");
}

// ---------------------------------------------------------------- Aufgaben
function taskHTML(t) {
  const due = t.due ? new Date(t.due) : null;
  const daysLeft = due ? daysUntil(due) : null;

  let color = "green";
  let label = "ohne Frist";
  if (due) {
    if (daysLeft < 0) { color = "red"; label = "überfällig"; }
    else if (daysLeft === 0) { color = "red"; label = "heute fällig"; }
    else if (daysLeft === 1) { color = "red"; label = "morgen"; }
    else if (daysLeft <= 3) { color = "yellow"; label = `${daysLeft} Tage`; }
    else { color = "green"; label = `${daysLeft} Tage`; }
  }

  const dueText = due
    ? "Abgabe: " + due.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
    : "Kein Abgabetermin";

  return `
    <a class="task" href="${esc(t.url)}" target="_blank" rel="noopener">
      <span class="dot ${color}"></span>
      <span class="what">
        <div class="title">${esc(t.title)}</div>
        <div class="due">${esc(dueText)}</div>
      </span>
      <span class="left ${color}">${esc(label)}</span>
    </a>`;
}

function renderTasks() {
  const el = $("#tasks");
  const iserv = data?.iserv;

  if (iserv?.error && !iserv.tasks?.length) {
    el.innerHTML = `<div class="error">Aufgaben konnten nicht geladen werden: ${esc(iserv.error)}</div>`;
    return;
  }

  const open = (iserv?.tasks || [])
    .filter((t) => !t.done)
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  if (!open.length) {
    el.innerHTML = '<div class="empty">Keine offenen Aufgaben 🎉</div>';
    return;
  }
  el.innerHTML = open.map(taskHTML).join("");
}

// ---------------------------------------------------------------- Termine
function eventHTML(ev) {
  const time = ev.allday ? "" : `${ev.start || ""}${ev.end ? "–" + ev.end : ""}`;
  const badge =
    ev.until ? `<span class="allday">bis ${esc(fmtShort(ev.until))}</span>` :
    ev.allday ? '<span class="allday">Ganztägig</span>' : "";

  const inner = `
      <div class="time">${esc(time)}</div>
      <div class="what">
        <div class="title">${esc(ev.title)}</div>
        ${ev.location ? `<div class="detail">📍 ${esc(ev.location)}</div>` : ""}
      </div>
      ${badge}`;

  // Ohne erkennbare Termin-ID liefert das Script keine URL -> nicht verlinken
  return ev.url
    ? `<a class="event" href="${esc(ev.url)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="event">${inner}</div>`;
}

function renderCalendar() {
  const el = $("#calendar");
  const cal = data?.calendar;

  if (!cal || (cal.error && !cal.events?.length)) {
    el.innerHTML = `<div class="error">Termine konnten nicht geladen werden: ${esc(cal?.error || "keine Daten")}</div>`;
    return;
  }

  const today = todayISO();
  const events = calView === "today"
    ? (cal.events || []).filter((e) => e.date === today)
    : (cal.events || []);

  if (!events.length) {
    el.innerHTML = `<div class="empty">${calView === "today" ? "Heute keine Termine 🎉" : "Keine Termine in den nächsten 7 Tagen."}</div>`;
    return;
  }

  const byDay = new Map();
  for (const ev of events) {
    if (!byDay.has(ev.date)) byDay.set(ev.date, []);
    byDay.get(ev.date).push(ev);
  }

  el.innerHTML = [...byDay.entries()].map(([date, list]) => `
    ${calView === "week" || date !== today
      ? `<div class="day-title ${date === today ? "today" : ""}">${esc(fmtDate(date))}</div>`
      : ""}
    ${list.map(eventHTML).join("")}
  `).join("");
}

// ---------------------------------------------------------------- Entsperren
const LOCK_KEY = "dashboardPass";

function b64bytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function decryptPayload(payload, password) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64bytes(payload.salt), iterations: payload.iterations, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64bytes(payload.iv) }, key, b64bytes(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

function unlock(payload) {
  return new Promise((resolve) => {
    const overlay = $("#lock");
    const form = $("#lock-form");
    const input = $("#lock-pass");
    const msg = $("#lock-msg");

    const attempt = async (password, silent) => {
      try {
        const result = await decryptPayload(payload, password);
        localStorage.setItem(LOCK_KEY, password);
        overlay.classList.add("hidden");
        resolve(result);
        return true;
      } catch {
        localStorage.removeItem(LOCK_KEY);
        if (!silent) {
          msg.textContent = "Falsches Passwort";
          input.value = "";
          input.focus();
        }
        return false;
      }
    };

    const saved = localStorage.getItem(LOCK_KEY);
    const showPrompt = () => {
      overlay.classList.remove("hidden");
      input.focus();
      form.onsubmit = (e) => {
        e.preventDefault();
        if (input.value) attempt(input.value, false);
      };
    };

    if (saved) {
      attempt(saved, true).then((ok) => { if (!ok) showPrompt(); });
    } else {
      showPrompt();
    }
  });
}

// ---------------------------------------------------------------- ToDo-Board
function todoHTML(t, catName) {
  const due = t.due ? new Date(t.due + "T00:00") : null;
  const daysLeft = due ? daysUntil(due) : null;

  let color = "green";
  let label = "ohne Termin";
  if (due) {
    if (daysLeft < 0) { color = "red"; label = "überfällig"; }
    else if (daysLeft === 0) { color = "red"; label = "heute"; }
    else if (daysLeft === 1) { color = "red"; label = "morgen"; }
    else if (daysLeft <= 3) { color = "yellow"; label = `${daysLeft} Tage`; }
    else { color = "green"; label = `${daysLeft} Tage`; }
  }

  const sub = [catName, due ? due.toLocaleDateString("de-DE") : null, t.note]
    .filter(Boolean).join(" · ");

  return `
    <a class="task" href="${esc(CONFIG.todoAppUrl)}" target="_blank" rel="noopener">
      <span class="dot ${color}"></span>
      <span class="what">
        <div class="title">${esc(t.text)}</div>
        <div class="due">${esc(sub)}</div>
      </span>
      <span class="left ${color}">${esc(label)}</span>
    </a>`;
}

async function loadTodos() {
  const el = $("#todos");
  try {
    const resp = await fetch(CONFIG.jsonbinUrl, {
      headers: { "X-Access-Key": CONFIG.jsonbinKey },
      cache: "no-store",
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const record = (await resp.json()).record || {};
    const wanted = new Map((record.categories || [])
      .filter((c) => CONFIG.todoCategories.includes(c.name))
      .map((c) => [c.id, c.name]));
    const open = (record.todos || [])
      .filter((t) => !t.done && wanted.has(t.categoryId))
      .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    todos = open;
    el.innerHTML = open.length
      ? open.map((t) => todoHTML(t, wanted.get(t.categoryId))).join("")
      : '<div class="empty">Keine offenen ToDos 🎉</div>';
  } catch (err) {
    todos = [];
    el.innerHTML = `<div class="error">ToDo-Board nicht erreichbar: ${esc(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------- Vorlesen
// "08:00" -> "8 Uhr", "08:45" -> "8 Uhr 45" (sonst buchstabiert die Stimme
// die Ziffern einzeln vor)
function sayTime(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return m ? `${h} Uhr ${m}` : `${h} Uhr`;
}

function joinList(items) {
  if (items.length < 2) return items.join("");
  return items.slice(0, -1).join(", ") + " und " + items[items.length - 1];
}

// Termine/Aufgaben nach Fälligkeit einsortieren
function byDue(items, getDue) {
  const out = { over: [], today: [], tomorrow: [] };
  for (const item of items) {
    const due = getDue(item);
    if (!due) continue;
    const left = daysUntil(due);
    if (left < 0) out.over.push(item);
    else if (left === 0) out.today.push(item);
    else if (left === 1) out.tomorrow.push(item);
  }
  return out;
}

// Sätze für eine Aufgabenquelle; leere Töpfe werden übersprungen.
function dueSentences(items, getDue, getTitle, one, many, where) {
  const b = byDue(items, getDue);
  const names = (arr) => joinList(arr.map(getTitle));
  const out = [];

  if (b.over.length) {
    out.push(b.over.length === 1
      ? `Achtung: ${one} ${where} ist überfällig: ${names(b.over)}.`
      : `Achtung: ${b.over.length} ${many} ${where} sind überfällig: ${names(b.over)}.`);
  }
  if (b.today.length) out.push(`Heute fällig ${where}: ${names(b.today)}.`);
  if (b.tomorrow.length) out.push(`Morgen fällig ${where}: ${names(b.tomorrow)}.`);
  return out;
}

// Ein Satz pro Eintrag - die Stimme spricht sie als eigene Häppchen, damit
// Chrome lange Texte nicht mittendrin abschneidet.
function speechParts() {
  const parts = [greeting().text + "."];
  const today = todayISO();
  const tomorrow = isoIn(1);

  // --- Unterricht heute
  const lessons = ((data?.untis?.days || []).find((d) => d.date === today)?.lessons || [])
    .filter((l) => l.code !== "cancelled");

  if (!lessons.length) {
    parts.push("Heute hast du frei.");
  } else {
    const first = lessons[0];
    parts.push(`Deine erste Stunde ist ${first.subject} um ${sayTime(first.start)}` +
      (first.room ? `, in Raum ${first.room}` : "") + ".");
    const feierabend = lessons.map((l) => l.end).sort().pop();
    parts.push(`Feierabend hast du um ${sayTime(feierabend)}.`);
  }

  // --- Termine heute und morgen
  const sayEvent = (ev) =>
    ev.allday || !ev.start ? ev.title : `${ev.title} um ${sayTime(ev.start)}`;
  const eventsOn = (iso) => (data?.calendar?.events || []).filter((e) => e.date === iso);

  const evToday = eventsOn(today);
  const evTomorrow = eventsOn(tomorrow);
  if (evToday.length) {
    parts.push(evToday.length === 1
      ? `Heute steht ein Termin an: ${sayEvent(evToday[0])}.`
      : `Heute stehen ${evToday.length} Termine an: ${joinList(evToday.map(sayEvent))}.`);
  }
  if (evTomorrow.length) {
    parts.push(evTomorrow.length === 1
      ? `Morgen hast du einen Termin: ${sayEvent(evTomorrow[0])}.`
      : `Morgen hast du ${evTomorrow.length} Termine: ${joinList(evTomorrow.map(sayEvent))}.`);
  }

  // --- Aufgaben und ToDos
  parts.push(...dueSentences(
    (data?.iserv?.tasks || []).filter((t) => !t.done),
    (t) => (t.due ? new Date(t.due) : null), (t) => t.title,
    "eine Aufgabe", "Aufgaben", "bei IServ"));

  parts.push(...dueSentences(
    todos,
    (t) => (t.due ? new Date(t.due + "T00:00") : null), (t) => t.text,
    "ein ToDo", "ToDos", "auf dem ToDo-Board"));

  return parts;
}

let voices = [];
const CAN_SPEAK = "speechSynthesis" in window;

function germanVoice() {
  return voices.find((v) => v.lang === "de-DE" && v.localService)
    || voices.find((v) => v.lang === "de-DE")
    || voices.find((v) => v.lang?.startsWith("de"))
    || null;
}

function setSpeakBtn(active) {
  $("#speak-btn").textContent = active ? "⏹ Stopp" : "🔊 Vorlesen";
}

function speak() {
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    setSpeakBtn(false);
    return;
  }
  const parts = speechParts();
  const voice = germanVoice();
  setSpeakBtn(true);

  parts.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    if (voice) u.voice = voice;
    u.onerror = () => setSpeakBtn(false);
    if (i === parts.length - 1) u.onend = () => setSpeakBtn(false);
    speechSynthesis.speak(u);
  });
}

if (CAN_SPEAK) {
  voices = speechSynthesis.getVoices();
  speechSynthesis.addEventListener("voiceschanged", () => {
    voices = speechSynthesis.getVoices();
  });
  $("#speak-btn").addEventListener("click", speak);
  // Ohne das redet der Browser nach dem Verlassen der Seite weiter
  window.addEventListener("pagehide", () => speechSynthesis.cancel());
} else {
  $("#speak-btn").classList.add("hidden");
}

// ---------------------------------------------------------------- Start
function renderAll() {
  renderHeader();
  renderTimetable();
  renderCalendar();
  renderTasks();
}

function setView(v) {
  view = v;
  $("#btn-today").classList.toggle("active", v === "today");
  $("#btn-week").classList.toggle("active", v === "week");
  renderTimetable();
}

function setCalView(v) {
  calView = v;
  $("#btn-cal-today").classList.toggle("active", v === "today");
  $("#btn-cal-week").classList.toggle("active", v === "week");
  renderCalendar();
}

$("#btn-today").addEventListener("click", () => setView("today"));
$("#btn-week").addEventListener("click", () => setView("week"));
$("#btn-cal-today").addEventListener("click", () => setCalView("today"));
$("#btn-cal-week").addEventListener("click", () => setCalView("week"));

async function load() {
  try {
    const resp = await fetch("data/data.json?t=" + Date.now());
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const payload = await resp.json();
    data = payload.encrypted ? await unlock(payload) : payload;
  } catch (err) {
    data = {
      demo: false,
      untis: { error: "data.json fehlt (" + err.message + ")", days: [] },
      iserv: { error: "data.json fehlt", tasks: [] },
      calendar: { error: "data.json fehlt", events: [] },
    };
  }
  renderAll();
  if (CAN_SPEAK) $("#speak-btn").disabled = false;
  loadTodos(); // erst nach dem Entsperren laden
}

bindAppLinks(); // Kachel-Links (statisches HTML) sofort binden
load();
// Alle 10 Minuten neu laden (falls die Seite offen bleibt)
setInterval(load, 10 * 60 * 1000);
