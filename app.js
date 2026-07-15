"use strict";

// ------------------------------------------------------------- Einstellungen
const CONFIG = {
  // Link zu deiner ToDo-App (GitHub-Pages-URL eintragen, leer = Kachel ausblenden)
  todoAppUrl: "https://hendrikwo2000.github.io/todo-app/",
  iservUrl: "https://bea-portal.de/iserv/exercise",
  iservApp: "iserv://",
  untisUrl: "https://hh5910.webuntis.com/WebUntis/?school=hh5910",
  untisApp: "untis://",
  repoUrl: "https://github.com/hendrikwo2000/schul-dashboard",
  // ToDo-Board (JSONBin-Cloud der ToDo-App; Key ist bewusst nur für dieses Bin gültig)
  jsonbinUrl: "https://api.jsonbin.io/v3/b/6a4bf236da38895dfe36c173/latest",
  jsonbinKey: "$2a$10$BGeFi/PYFCLdZs0Bzu8PHeijV91l8JX.izcEgvuptBkIeXwePMKSu",
  todoCategories: ["Schule", "Facharbeit"],
};

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MS_DAY = 24 * 60 * 60 * 1000;

let data = null;
let view = "today";
let calView = "today";

// ---------------------------------------------------------------- Hilfen
const $ = (sel) => document.querySelector(sel);
const IS_MOBILE = /Android|iPhone|iPad/i.test(navigator.userAgent);

// Auf dem Handy zuerst die App versuchen; oeffnet sie sich nicht,
// nach 1,5 s automatisch auf die Website ausweichen. Am PC: Website.
function bindAppLinks() {
  document.querySelectorAll("a[data-app]").forEach((a) => {
    if (a.dataset.bound) return;
    a.dataset.bound = "1";
    a.addEventListener("click", (e) => {
      if (!IS_MOBILE) return;
      e.preventDefault();
      const webUrl = a.href;
      const timer = setTimeout(() => { window.location.href = webUrl; }, 1500);
      const cancel = () => clearTimeout(timer);
      window.addEventListener("pagehide", cancel, { once: true });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) cancel();
      }, { once: true });
      window.location.href = a.dataset.app;
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

function fmtDate(iso) {
  const d = new Date(iso + "T00:00");
  return `${WEEKDAYS[d.getDay()]}, ${d.toLocaleDateString("de-DE")}`;
}

// ---------------------------------------------------------------- Kopf
function renderHeader() {
  $("#today-label").textContent = fmtDate(todayISO());

  if (data?.updated) {
    const upd = new Date(data.updated);
    $("#updated-label").textContent =
      "Stand: " + upd.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  }

  $("#demo-banner").classList.toggle("hidden", !data?.demo);

  const links = [];
  if (CONFIG.todoAppUrl) links.push(`<a href="${esc(CONFIG.todoAppUrl)}" target="_blank" rel="noopener">✅ ToDo-Board</a>`);
  links.push(`<a href="${esc(CONFIG.iservUrl)}" data-app="${esc(CONFIG.iservApp)}" target="_blank" rel="noopener">🏫 IServ</a>`);
  links.push(`<a href="${esc(CONFIG.untisUrl)}" data-app="${esc(CONFIG.untisApp)}" target="_blank" rel="noopener">📅 WebUntis</a>`);
  $("#header-links").innerHTML = links.join("");
  bindAppLinks();

  if (CONFIG.repoUrl) $("#repo-link").href = CONFIG.repoUrl;
  else $("#repo-link").parentElement.lastElementChild.style.display = "none";
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
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const due = t.due ? new Date(t.due) : null;
  const daysLeft = due
    ? Math.round((startOfDay(due) - startOfDay(new Date())) / MS_DAY)
    : null;

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
  const time = ev.allday ? "" : `${ev.start}${ev.end ? "–" + ev.end : ""}`;
  return `
    <div class="event">
      <div class="time">${esc(time)}</div>
      <div class="what">
        <div class="title">${esc(ev.title)}</div>
        ${ev.location ? `<div class="detail">📍 ${esc(ev.location)}</div>` : ""}
      </div>
      ${ev.allday ? '<span class="allday">Ganztägig</span>' : ""}
    </div>`;
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
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const due = t.due ? new Date(t.due + "T00:00") : null;
  const daysLeft = due
    ? Math.round((startOfDay(due) - startOfDay(new Date())) / MS_DAY)
    : null;

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
    el.innerHTML = open.length
      ? open.map((t) => todoHTML(t, wanted.get(t.categoryId))).join("")
      : '<div class="empty">Keine offenen ToDos 🎉</div>';
  } catch (err) {
    el.innerHTML = `<div class="error">ToDo-Board nicht erreichbar: ${esc(err.message)}</div>`;
  }
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
  loadTodos(); // erst nach dem Entsperren laden
}

bindAppLinks(); // Kachel-Links (statisches HTML) sofort binden
load();
// Alle 10 Minuten neu laden (falls die Seite offen bleibt)
setInterval(load, 10 * 60 * 1000);
