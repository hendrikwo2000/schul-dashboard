"use strict";

/**
 * Schul-Dashboard.
 *
 * Holt alles in EINER Anfrage von /api/dashboard und zeichnet fuenf Kacheln.
 * Geschrieben wird nichts - zum Aendern fuehrt der Kachelkopf in die jeweilige
 * App (ToDo, Fokus, WebUntis, IServ, Kalender).
 *
 * Die Anmeldung passiert nicht hier, sondern bei todo.it-wolf.org: alle drei
 * Apps teilen sich ein Sitzungscookie auf .it-wolf.org. Siehe zurAnmeldung().
 */

const CONFIG = {
  // Wo angemeldet wird. Ein Ort fuer alle drei Apps.
  anmeldeUrl: "https://todo.it-wolf.org/",
  // Zeitfenster, in dem die GitHub-Action laeuft (lokale Uhrzeit, siehe
  // .github/workflows/update.yml). Nachts laeuft sie absichtlich nicht - dann
  // sind alte Daten normal und keine Warnung wert.
  laufAb: 6,
  laufBis: 22,
  // Ab diesem Alter warnt das Dashboard, aber nur innerhalb des Zeitfensters.
  warnAbStunden: 3,
  // Ganztaegige Termine ab dieser Laenge kommen als Leiste statt an jedem Tag.
  dauerlaeuferAbTagen: 3,
  // Wie oft die offene Seite von selbst nachlaedt.
  nachladenMs: 10 * 60 * 1000,
};

const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MS_TAG = 24 * 60 * 60 * 1000;

let stand = null;           // die letzte Antwort von /api/dashboard
let planAnsicht = "heute";  // Stundenplan: heute | woche
let termineAnsicht = "heute";

// ---------------------------------------------------------------- Hilfen
const $ = (wahl) => document.querySelector(wahl);
const IST_ANDROID = /Android/i.test(navigator.userAgent);
const IST_IOS = /iPhone|iPad/i.test(navigator.userAgent);

function esc(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

// yyyy-mm-dd in LOKALER Zeit. Nicht toISOString() - das rechnet nach UTC um
// und liefert abends den falschen Tag.
function heuteIso() {
  return new Date().toLocaleDateString("sv-SE");
}

function isoIn(tage) {
  const d = new Date();
  d.setDate(d.getDate() + tage);
  return d.toLocaleDateString("sv-SE");
}

function langesDatum(iso) {
  const d = new Date(iso + "T00:00");
  return `${WOCHENTAGE[d.getDay()]}, ${d.toLocaleDateString("de-DE")}`;
}

function kurzesDatum(iso) {
  return new Date(iso + "T00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function tagesBeginn(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Ganze Tage bis zum Termin: 0 = heute, 1 = morgen, negativ = vorbei.
function tageBis(ziel) {
  return Math.round((tagesBeginn(ziel) - tagesBeginn(new Date())) / MS_TAG);
}

/**
 * Farbe und Beschriftung fuer eine Frist. Eine Stelle fuer Aufgaben UND ToDos,
 * damit "morgen" in beiden Kacheln dasselbe Rot hat.
 */
function fristAmpel(datum) {
  if (!datum) return { farbe: "", text: "ohne Frist" };
  const tage = tageBis(datum);
  if (tage < 0) return { farbe: "rot", text: "überfällig" };
  if (tage === 0) return { farbe: "rot", text: "heute" };
  if (tage === 1) return { farbe: "rot", text: "morgen" };
  if (tage <= 3) return { farbe: "gelb", text: `${tage} Tage` };
  return { farbe: "", text: `${tage} Tage` };
}

// ---------------------------------------------------------------- App-Links
/**
 * Auf dem Handy zuerst die installierte App versuchen, sonst die Website.
 * Android: intent:-Link mit Paketname (eigener Fallback eingebaut),
 * iOS: URL-Schema mit Timer-Fallback. Am PC passiert nichts Besonderes.
 */
function appZiel(a) {
  if (IST_ANDROID && a.dataset.package) {
    return "intent:#Intent;package=" + a.dataset.package +
      ";action=android.intent.action.MAIN" +
      ";S.browser_fallback_url=" + encodeURIComponent(a.href) + ";end";
  }
  return a.dataset.app || "";
}

function verdrahteAppLinks() {
  document.querySelectorAll("a[data-app], a[data-package]").forEach((a) => {
    if (a.dataset.verdrahtet) return;
    a.dataset.verdrahtet = "1";
    a.addEventListener("click", (e) => {
      if (!IST_ANDROID && !IST_IOS) return;
      const ziel = appZiel(a);
      if (!ziel) return;
      e.preventDefault();
      const website = a.href;
      // Auf die Website ausweichen nur, wenn sich nichts tut. Sobald die Seite
      // den Fokus verliert (App-Dialog oder App-Wechsel), wird das abgebrochen.
      const uhr = setTimeout(() => { window.location.href = website; }, 2500);
      const ab = () => clearTimeout(uhr);
      window.addEventListener("pagehide", ab, { once: true });
      window.addEventListener("blur", ab, { once: true });
      document.addEventListener("visibilitychange", () => { if (document.hidden) ab(); }, { once: true });
      window.location.href = ziel;
    });
  });
}

// ---------------------------------------------------------------- Darstellung
function setzeThema(thema) {
  document.documentElement.dataset.theme = thema;
  $("#dunkelSchalter").checked = thema === "dark";
}

$("#dunkelSchalter").addEventListener("change", (e) => {
  const thema = e.target.checked ? "dark" : "light";
  localStorage.setItem("theme", thema);
  setzeThema(thema);
});

// ---------------------------------------------------------------- Kopf
function begruessung() {
  const jetzt = new Date();
  const tag = jetzt.getDay();
  const stunde = jetzt.getHours();
  const name = stand?.nutzer?.name || "";
  const anrede = name ? `, ${name}` : "";
  if (tag === 0 || tag === 6) return `🎉 Schönes Wochenende${anrede}`;
  if (stunde < 11) return `🌅 Guten Morgen${anrede}`;
  if (stunde < 14) return `☀️ Guten Mittag${anrede}`;
  if (stunde < 18) return `🌇 Guten Nachmittag${anrede}`;
  return `🌙 Guten Abend${anrede}`;
}

/**
 * Nur melden, wenn die Aktualisierung offenbar haengt - sonst bleibt der Kopf
 * leer. Nachts laeuft die Action planmaessig nicht, da sind alte Daten kein
 * Fehler.
 */
function zeichneStandWarnung() {
  const el = $("#standWarnung");
  const stunde = new Date().getHours();
  // Erst eine Stunde nach dem ersten geplanten Lauf warnen: um 6 Uhr sind die
  // Daten von gestern Abend normal, der erste Lauf ist gerade erst dran
  // (GitHub startet Cron-Jobs gern 5-20 Minuten spaeter).
  const imFenster = stunde >= CONFIG.laufAb + 1 && stunde < CONFIG.laufBis;

  if (stand?.datenFehler) {
    el.textContent = "⚠️ " + stand.datenFehler;
    el.classList.add("warnung");
    el.hidden = false;
    return;
  }

  // SQLite liefert 'YYYY-MM-DD HH:MM:SS' in UTC, ohne Zeitzonen-Kennung.
  // Ohne das angehaengte Z laese der Browser den Wert als LOKALE Zeit und die
  // Daten waeren im Sommer zwei Stunden zu jung.
  const gemessen = stand?.aktualisiert
    ? (Date.now() - Date.parse(stand.aktualisiert.replace(" ", "T") + "Z")) / 3600000
    : null;

  if (!imFenster || gemessen === null || Number.isNaN(gemessen) || gemessen < CONFIG.warnAbStunden) {
    el.hidden = true;
    return;
  }
  const stunden = Math.floor(gemessen);
  const alter = stunden < 24
    ? `${stunden} Stunden`
    : Math.floor(stunden / 24) === 1 ? "einen Tag" : `${Math.floor(stunden / 24)} Tage`;
  el.textContent = `⚠️ Die Daten sind ${alter} alt — die Aktualisierung läuft gerade nicht.`;
  el.classList.add("warnung");
  el.hidden = false;
}

// ---------------------------------------------------------------- Stundenplan
function stundeHtml(s) {
  const art = s.code === "cancelled" ? "entfaellt" : s.code === "irregular" ? "vertretung" : "";
  const marke =
    s.code === "cancelled" ? '<span class="marke">Entfällt</span>' :
    s.code === "irregular" ? '<span class="marke">Vertretung</span>' : "";
  const unter = [s.room, s.teacher, s.info].filter(Boolean).join(" · ");
  return `
    <div class="zeile ${art}">
      <div class="uhr">${esc(s.start)}<br>${esc(s.end)}</div>
      <div class="haupt">
        <div class="titel">${esc(s.subject)}</div>
        ${unter ? `<div class="unter">${esc(unter)}</div>` : ""}
      </div>
      ${marke}
    </div>`;
}

function zeichneStundenplan() {
  const el = $("#stundenplan");
  const untis = stand?.daten?.untis;

  if (untis?.error && !untis.days?.length) {
    el.innerHTML = `<div class="fehler-hinweis">Stundenplan konnte nicht geladen werden: ${esc(untis.error)}</div>`;
    return;
  }

  const heute = heuteIso();
  const tage = planAnsicht === "heute"
    ? (untis?.days || []).filter((t) => t.date === heute)
    : (untis?.days || []);

  if (!tage.length || tage.every((t) => !t.lessons.length)) {
    el.innerHTML = `<div class="leer-hinweis">${planAnsicht === "heute"
      ? "Heute kein Unterricht 🎉"
      : "Keine Stunden in dieser Woche."}</div>`;
    return;
  }

  el.innerHTML = tage.map((t) => `
    ${planAnsicht === "woche" || t.date !== heute
      ? `<div class="tag-titel ${t.date === heute ? "heute" : ""}">${esc(langesDatum(t.date))}</div>`
      : ""}
    ${t.lessons.map(stundeHtml).join("")}
  `).join("");
}

// ---------------------------------------------------------------- Aufgaben
function aufgabeHtml(a) {
  const faellig = a.due ? new Date(a.due) : null;
  const ampel = fristAmpel(faellig);
  const wann = faellig
    ? "Abgabe: " + faellig.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
    : "Kein Abgabetermin";

  return `
    <a class="zeile" href="${esc(a.url)}" target="_blank" rel="noopener">
      <span class="punkt ${ampel.farbe}"></span>
      <span class="haupt">
        <div class="titel">${esc(a.title)}</div>
        <div class="unter">${esc(wann)}</div>
      </span>
      <span class="frist ${ampel.farbe}">${esc(ampel.text)}</span>
    </a>`;
}

function zeichneAufgaben() {
  const el = $("#aufgaben");
  const iserv = stand?.daten?.iserv;

  if (iserv?.error && !iserv.tasks?.length) {
    el.innerHTML = `<div class="fehler-hinweis">Aufgaben konnten nicht geladen werden: ${esc(iserv.error)}</div>`;
    return;
  }

  const offen = (iserv?.tasks || [])
    .filter((a) => !a.done)
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));

  el.innerHTML = offen.length
    ? offen.map(aufgabeHtml).join("")
    : '<div class="leer-hinweis">Keine offenen Aufgaben 🎉</div>';
}

// ---------------------------------------------------------------- Termine
// Ganztaegige Dauerlaeufer (Ferien, Praktikum, Urlaub) stehen sonst an jedem
// einzelnen Tag in der Liste -> einmal als Leiste ueber den Kalender.
function istDauerlaeufer(t) {
  return t.allday && (t.spanDays || 1) >= CONFIG.dauerlaeuferAbTagen;
}

function dauerlaeuferHtml(t) {
  const innen = `<span>${esc(t.title)}</span>` +
    (t.until ? `<span class="bis">noch bis ${esc(kurzesDatum(t.until))}</span>` : "");
  return t.url
    ? `<a class="dauer" href="${esc(t.url)}" target="_blank" rel="noopener">${innen}</a>`
    : `<div class="dauer">${innen}</div>`;
}

function terminHtml(t) {
  const zeit = t.allday ? "" : `${t.start || ""}${t.end ? "<br>" + t.end : ""}`;
  const marke =
    t.until ? `<span class="marke">bis ${esc(kurzesDatum(t.until))}</span>` :
    t.allday ? '<span class="marke">Ganztägig</span>' : "";

  const innen = `
      <div class="uhr">${zeit}</div>
      <div class="haupt">
        <div class="titel">${esc(t.title)}</div>
        ${t.location ? `<div class="unter">📍 ${esc(t.location)}</div>` : ""}
      </div>
      ${marke}`;

  // Ohne erkennbare Termin-ID liefert das Abrufskript keine URL -> nicht verlinken.
  return t.url
    ? `<a class="zeile" href="${esc(t.url)}" target="_blank" rel="noopener">${innen}</a>`
    : `<div class="zeile">${innen}</div>`;
}

function zeichneTermine() {
  const el = $("#termine");
  const kalender = stand?.daten?.calendar;

  if (!kalender || (kalender.error && !kalender.events?.length)) {
    el.innerHTML = `<div class="fehler-hinweis">Termine konnten nicht geladen werden: ${esc(kalender?.error || "keine Daten")}</div>`;
    return;
  }

  const heute = heuteIso();
  const sichtbar = termineAnsicht === "heute"
    ? (kalender.events || []).filter((t) => t.date === heute)
    : (kalender.events || []);

  // Dauerlaeufer aussortieren und je Termin nur einmal zeigen.
  const laeufer = [];
  const gesehen = new Set();
  const termine = [];
  for (const t of sichtbar) {
    if (!istDauerlaeufer(t)) { termine.push(t); continue; }
    const schluessel = `${t.title}|${t.until}`;
    if (!gesehen.has(schluessel)) { gesehen.add(schluessel); laeufer.push(t); }
  }
  const laeuferHtml = laeufer.map(dauerlaeuferHtml).join("");

  if (!termine.length) {
    // "weitere" nur, wenn oben schon eine Leiste steht.
    const w = laeufer.length ? "weiteren " : "";
    el.innerHTML = laeuferHtml + `<div class="leer-hinweis">${termineAnsicht === "heute"
      ? `Heute keine ${w}Termine 🎉`
      : `Keine ${w}Termine in den nächsten 7 Tagen.`}</div>`;
    return;
  }

  const nachTag = new Map();
  for (const t of termine) {
    if (!nachTag.has(t.date)) nachTag.set(t.date, []);
    nachTag.get(t.date).push(t);
  }

  el.innerHTML = laeuferHtml + [...nachTag.entries()].map(([datum, liste]) => `
    ${termineAnsicht === "woche" || datum !== heute
      ? `<div class="tag-titel ${datum === heute ? "heute" : ""}">${esc(langesDatum(datum))}</div>`
      : ""}
    ${liste.map(terminHtml).join("")}
  `).join("");
}

// ---------------------------------------------------------------- ToDos
function todoHtml(t) {
  const faellig = t.due ? new Date(t.due + "T00:00") : null;
  const ampel = fristAmpel(faellig);
  const unter = [t.bereich, faellig ? faellig.toLocaleDateString("de-DE") : null, t.note]
    .filter(Boolean).join(" · ");

  return `
    <a class="zeile" href="${esc(CONFIG.anmeldeUrl)}" target="_blank" rel="noopener">
      <span class="punkt ${ampel.farbe}"></span>
      <span class="haupt">
        <div class="titel">${esc(t.text)}</div>
        ${unter ? `<div class="unter">${esc(unter)}</div>` : ""}
      </span>
      <span class="frist ${ampel.farbe}">${esc(ampel.text)}</span>
    </a>`;
}

function zeichneTodos() {
  const el = $("#todos");
  const bereiche = stand?.bereiche || [];
  $("#todoBereiche").textContent = bereiche.join(" & ");

  if (stand?.todoFehler) {
    el.innerHTML = `<div class="fehler-hinweis">ToDos nicht lesbar: ${esc(stand.todoFehler)}</div>`;
    return;
  }

  const todos = stand?.todos || [];
  if (!todos.length) {
    // Die Bereichsnamen mit ausgeben: eine leere Kachel kann auch heissen,
    // dass ein Bereich umbenannt wurde. Ohne den Hinweis sucht man den Fehler
    // in der Datenbank statt im Namen.
    el.innerHTML = `<div class="leer-hinweis">Keine offenen ToDos in ${esc(bereiche.join(" und ") || "den gewählten Bereichen")} 🎉</div>`;
    return;
  }

  el.innerHTML = todos.map(todoHtml).join("") +
    (stand?.todosGekuerzt ? '<div class="leer-hinweis">… weitere in der ToDo-Liste</div>' : "");
}

// ---------------------------------------------------------------- Fokus
function gewohnheitHtml(g) {
  const erledigt = g.stand === "erledigt";
  const teil = g.typ === "menge" && g.zielmenge
    ? `${g.menge || 0} / ${g.zielmenge}${g.einheit ? " " + g.einheit : ""}`
    : "";

  return `
    <div class="zeile ${esc(g.stand)}">
      <span class="haken ${erledigt ? "" : "aus"}">${erledigt ? "✔" : "○"}</span>
      <span class="haupt">
        <div class="titel">${esc(g.name)}</div>
        ${teil ? `<div class="unter">${esc(teil)}</div>` : ""}
      </span>
    </div>`;
}

function zeichneFokus() {
  const el = $("#fokus");

  if (stand?.fokusFehler) {
    el.innerHTML = `<div class="fehler-hinweis">Gewohnheiten nicht lesbar: ${esc(stand.fokusFehler)}</div>`;
    return;
  }

  const gewohnheiten = stand?.gewohnheiten || [];
  if (!gewohnheiten.length) {
    el.innerHTML = '<div class="leer-hinweis">Heute steht nichts an 🎉</div>';
    return;
  }

  const geschafft = gewohnheiten.filter((g) => g.stand === "erledigt").length;
  const bilanz = geschafft === gewohnheiten.length
    ? "Alles erledigt 🎉"
    : `${geschafft} von ${gewohnheiten.length} erledigt`;

  el.innerHTML = `<div class="tag-titel">${esc(bilanz)}</div>` +
    gewohnheiten.map(gewohnheitHtml).join("");
}

// ---------------------------------------------------------------- Zeichnen
/**
 * Der rote Punkt steckt schon in den Eintraegen (ueberfaellig/heute/morgen) -
 * die Kachel drumherum erbt ihn, damit das Auge zuerst dort landet.
 */
function markiereDringend() {
  document.querySelectorAll("main .karte").forEach((karte) => {
    karte.classList.toggle("dringend", !!karte.querySelector(".punkt.rot"));
  });
}

function zeichneAlles() {
  $("#begruessung").textContent = begruessung();
  zeichneStandWarnung();
  zeichneStundenplan();
  zeichneTermine();
  zeichneAufgaben();
  zeichneTodos();
  zeichneFokus();
  markiereDringend();
  verdrahteAppLinks();
}

// ---------------------------------------------------------------- Umschalter
function verdrahteUmschalter(auswahl, setzen) {
  document.querySelectorAll(auswahl).forEach((knopf) => {
    knopf.addEventListener("click", () => {
      document.querySelectorAll(auswahl).forEach((k) => k.setAttribute("aria-selected", String(k === knopf)));
      setzen(knopf.dataset.plan || knopf.dataset.termine);
    });
  });
}

verdrahteUmschalter("[data-plan]", (wert) => { planAnsicht = wert; zeichneStundenplan(); markiereDringend(); });
verdrahteUmschalter("[data-termine]", (wert) => { termineAnsicht = wert; zeichneTermine(); markiereDringend(); });

// ---------------------------------------------------------------- Einstellungen
$("#einstellungenBtn").addEventListener("click", () => { $("#einstellungen").hidden = false; });
$("#einstellungenZu").addEventListener("click", () => { $("#einstellungen").hidden = true; });
// Klick auf den dunklen Rand schliesst - aber nur dort, nicht im Kasten selbst.
$("#einstellungen").addEventListener("click", (e) => {
  if (e.target === $("#einstellungen")) $("#einstellungen").hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#einstellungen").hidden = true;
});

$("#abmeldenBtn").addEventListener("click", async () => {
  if (!confirm("Abmelden? Das gilt auch für die ToDo-Liste und den Fokus-Tracker — es ist eine gemeinsame Anmeldung.")) return;
  try {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
  } catch (e) {
    // Auch wenn der Server nicht antwortet: zur Anmeldung schicken. Dort
    // merkt man sofort, ob die Sitzung noch steht.
  }
  location.href = CONFIG.anmeldeUrl;
});

// ---------------------------------------------------------------- Anmeldung
const ANMELDE_VERSUCH = "dashboardAnmeldeVersuch";

function aufEigenerDomain() {
  const host = location.hostname;
  return host === "it-wolf.org" || host.endsWith(".it-wolf.org");
}

function anmeldeLink() {
  return CONFIG.anmeldeUrl + "?weiter=" + encodeURIComponent(location.origin + location.pathname);
}

function zeigeSperre(icon, titel, text, knopfText, knopfZiel) {
  $("#tafel").hidden = true;
  $("#einstellungenBtn").hidden = true;
  $("#sperreIcon").textContent = icon;
  $("#sperreTitel").textContent = titel;
  $("#sperreText").textContent = text;
  $("#sperreKnopf").textContent = knopfText;
  $("#sperreKnopf").href = knopfZiel;
  $("#sperre").hidden = false;
}

/**
 * Nicht angemeldet: ab zur gemeinsamen Anmeldung.
 *
 * Zwei Faelle, in denen NICHT von selbst gesprungen wird:
 *
 * 1. Lokales Testen (127.0.0.1). Dort gilt das Sitzungscookie ohnehin nicht
 *    fuer .it-wolf.org, ein Sprung auf die echte Seite haette also keinen
 *    Zweck und wuerde nur aus der Testumgebung hinausfuehren.
 * 2. Der zweite Versuch in derselben Sitzung. Kaeme man von der Anmeldung
 *    zurueck und waere immer noch nicht angemeldet, liefe die Seite sonst im
 *    Kreis - der Merker im sessionStorage bricht das nach einem Durchgang ab.
 */
function zurAnmeldung() {
  if (aufEigenerDomain() && !sessionStorage.getItem(ANMELDE_VERSUCH)) {
    sessionStorage.setItem(ANMELDE_VERSUCH, "1");
    location.replace(anmeldeLink());
    return;
  }
  zeigeSperre("🔒", "Nicht angemeldet",
    "Das Dashboard benutzt dieselbe Anmeldung wie ToDo-Liste und Fokus-Tracker. "
    + "Melde dich dort an, danach geht es hier von selbst weiter.",
    "Zur Anmeldung", anmeldeLink());
}

// ---------------------------------------------------------------- Laden
async function laden() {
  let antwort;
  try {
    antwort = await fetch("/api/dashboard?heute=" + heuteIso(), {
      credentials: "include",
      cache: "no-store",
    });
  } catch (e) {
    // Netzfehler: den bisherigen Stand stehen lassen, falls einer da ist -
    // ein leergeraeumtes Dashboard waere die schlechtere Auskunft.
    const el = $("#ladeFehler");
    el.textContent = "⚠️ Keine Verbindung — angezeigt wird der zuletzt geladene Stand.";
    el.classList.add("warnung");
    el.hidden = false;
    return;
  }

  if (antwort.status === 401) { zurAnmeldung(); return; }

  if (antwort.status === 403) {
    let text = "Dieses Konto ist für das Dashboard nicht freigeschaltet.";
    try { text = (await antwort.json()).error || text; } catch (e) { /* Standardtext */ }
    zeigeSperre("⛔", "Kein Zugang", text, "Zur ToDo-Liste", CONFIG.anmeldeUrl);
    return;
  }

  if (!antwort.ok) {
    let text = "HTTP " + antwort.status;
    try { text = (await antwort.json()).error || text; } catch (e) { /* Statuszeile */ }
    const el = $("#ladeFehler");
    el.textContent = "⚠️ " + text;
    el.classList.add("warnung");
    el.hidden = false;
    return;
  }

  stand = await antwort.json();
  sessionStorage.removeItem(ANMELDE_VERSUCH);

  $("#ladeFehler").hidden = true;
  $("#sperre").hidden = true;
  $("#tafel").hidden = false;
  $("#einstellungenBtn").hidden = false;

  $("#kontoName").textContent = stand.nutzer?.name || "Angemeldet";
  $("#kontoMail").textContent = stand.nutzer?.email || "";
  $("#kontoSub").textContent = stand.nutzer?.name || stand.nutzer?.email || "";

  zeichneAlles();
}

setzeThema(document.documentElement.dataset.theme);
laden();
setInterval(laden, CONFIG.nachladenMs);
