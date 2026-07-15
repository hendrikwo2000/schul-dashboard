"use strict";

// ------------------------------------------------------------- Einstellungen
const CONFIG = {
  // Link zu deiner ToDo-App (GitHub-Pages-URL eintragen, leer = Kachel ausblenden)
  todoAppUrl: "https://hendrikwo2000.github.io/todo-app/",
  iservUrl: "https://bea-portal.de/iserv/exercise",
  untisUrl: "https://hh5910.webuntis.com/WebUntis/?school=hh5910",
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

// ---------------------------------------------------------------- Hilfen
const $ = (sel) => document.querySelector(sel);

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
  links.push(`<a href="${esc(CONFIG.iservUrl)}" target="_blank" rel="noopener">🏫 IServ</a>`);
  links.push(`<a href="${esc(CONFIG.untisUrl)}" target="_blank" rel="noopener">📅 WebUntis</a>`);
  $("#header-links").innerHTML = links.join("");

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
  renderTasks();
}

function setView(v) {
  view = v;
  $("#btn-today").classList.toggle("active", v === "today");
  $("#btn-week").classList.toggle("active", v === "week");
  renderTimetable();
}

$("#btn-today").addEventListener("click", () => setView("today"));
$("#btn-week").addEventListener("click", () => setView("week"));

async function load() {
  try {
    const resp = await fetch("data/data.json?t=" + Date.now());
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    data = await resp.json();
  } catch (err) {
    data = {
      demo: false,
      untis: { error: "data.json fehlt (" + err.message + ")", days: [] },
      iserv: { error: "data.json fehlt", tasks: [] },
    };
  }
  renderAll();
}

load();
loadTodos();
// Alle 10 Minuten neu laden (falls die Seite offen bleibt)
setInterval(() => { load(); loadTodos(); }, 10 * 60 * 1000);
