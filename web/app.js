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
// Bleibt im Browser-Speicher, nicht am Konto: das Farbschema haengt am Geraet
// (heller Bildschirm im Unterricht, dunkler abends), nicht an der Person.
function setzeThema(thema) {
  document.documentElement.dataset.theme = thema;
  $("#themeSwitch").checked = thema === "dark";
  $("#themeSwitchLabel").textContent = thema === "dark" ? "Dunkel" : "Hell";
}

$("#themeSwitch").addEventListener("change", (e) => {
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
/**
 * Der Schluessel, an dem ein eigener Stundenname haengt.
 *
 * WebUntis nennt hier jedes Lernfeld gleich ("Lernfeld", Kuerzel "FST-LF") -
 * im Plan stehen dann vier Stunden mit demselben Namen, und keine sagt,
 * welches Lernfeld sie ist. Der eigene Name haengt deshalb an
 * WOCHENTAG + STARTZEIT + FACHKUERZEL: genau der Teil, der sich jede Woche
 * wiederholt. Einmal eingetragen, steht er ab dann jede Woche wieder da.
 *
 * Nicht am Datum - dann waere er naechste Woche weg. Nicht am Fach allein -
 * dann hiessen alle Lernfelder wieder gleich.
 */
function stundenSchluessel(datum, stunde) {
  const tag = new Date(datum + "T00:00:00").getDay();
  return `${tag}|${stunde.start}|${stunde.subjectShort || stunde.subject || "?"}`;
}

function eigenerName(schluessel) {
  return (stand?.einstellungen?.stundenNamen || {})[schluessel] || "";
}

function schluesselText(schluessel) {
  const [tag, start] = String(schluessel).split("|");
  const name = WOCHENTAGE[Number(tag)];
  return `${name ? name.slice(0, 2) : "?"} ${start || ""}`.trim();
}

/**
 * Doppel- und Dreifachstunden zu EINER Zeile zusammenfassen.
 *
 * Untis traegt einen Block als mehrere Stunden ein (11:45-13:15 und
 * 13:30-15:00). Auf dem Dashboard ist das ein Termin und nicht zwei - also
 * eine Zeile "11:45 / 15:00". Wie lang die Pause dazwischen ist, spielt
 * keine Rolle; nur eine ANDERE Stunde dazwischen trennt den Block.
 *
 * Zusammengefasst wird nur, was wirklich dasselbe ist: gleiches Fach,
 * gleicher Lehrer, gleicher Raum, gleicher Status. Faellt die zweite Haelfte
 * aus, bleiben die Zeilen getrennt - genau das will man dann sehen.
 */
function fasseZusammen(stunden) {
  const FELDER = ["subject", "subjectShort", "room", "teacher", "code", "info"];
  const gleich = (a, b) => FELDER.every((f) => (a[f] || "") === (b[f] || ""));

  const heraus = [];
  for (const s of stunden) {
    const letzte = heraus[heraus.length - 1];
    if (letzte && gleich(letzte, s)) {
      letzte.end = s.end;   // die Liste ist sortiert, s ist also die spaetere
      continue;
    }
    heraus.push({ ...s });
  }
  return heraus;
}

function stundeHtml(s, datum) {
  const art = s.code === "cancelled" ? "entfaellt" : s.code === "irregular" ? "vertretung" : "";
  const marke =
    s.code === "cancelled" ? '<span class="marke">Entfällt</span>' :
    s.code === "irregular" ? '<span class="marke">Vertretung</span>' : "";
  const unter = [s.room, s.teacher, s.info].filter(Boolean).join(" · ");
  const schluessel = stundenSchluessel(datum, s);
  return `
    <div class="zeile umbenennbar ${art}" data-schluessel="${esc(schluessel)}"
         title="Klicken zum Umbenennen" tabindex="0">
      <div class="uhr">${esc(s.start)}<br>${esc(s.end)}</div>
      <div class="haupt">
        <div class="titel">${esc(eigenerName(schluessel) || s.subject)}</div>
        ${unter ? `<div class="unter">${esc(unter)}</div>` : ""}
      </div>
      ${marke}
    </div>`;
}

/**
 * Eine Stunde umbenennen: der Fachname wird an Ort und Stelle zum Eingabefeld.
 *
 * Enter und der Klick daneben speichern, Escape verwirft, ein leeres Feld
 * holt den Namen aus WebUntis zurueck. Ein eigener Dialog waere fuer ein
 * einzelnes Textfeld zu viel Aufwand - und am Handy zwei Klicks mehr.
 */
function starteUmbenennen(zeile) {
  const titel = zeile.querySelector(".titel");
  if (!titel) return;
  const schluessel = zeile.dataset.schluessel;

  const eingabe = document.createElement("input");
  eingabe.type = "text";
  eingabe.className = "titel-eingabe";
  eingabe.maxLength = 60;
  eingabe.value = eigenerName(schluessel);
  eingabe.placeholder = titel.textContent;
  titel.replaceWith(eingabe);
  eingabe.focus();
  eingabe.select();

  let fertig = false;
  const beenden = (speichern) => {
    if (fertig) return;   // blur feuert auch, wenn Enter schon gespeichert hat
    fertig = true;
    if (speichern) setzeStundenName(schluessel, eingabe.value);
    zeichneStundenplan();
    markiereDringend();
  };

  eingabe.addEventListener("keydown", (e) => {
    e.stopPropagation();   // sonst faengt die Zeile das Enter gleich wieder ab
    if (e.key === "Enter") { e.preventDefault(); beenden(true); }
    if (e.key === "Escape") { e.preventDefault(); beenden(false); }
  });
  eingabe.addEventListener("blur", () => beenden(true));
}

function setzeStundenName(schluessel, name) {
  const namen = { ...(stand?.einstellungen?.stundenNamen || {}) };
  const sauber = (name || "").trim().slice(0, 60);
  if (sauber) namen[schluessel] = sauber;
  else delete namen[schluessel];   // leer heisst: wieder der Name aus Untis
  setzeEinstellung({ stundenNamen: namen });
}

$("#stundenplan").addEventListener("click", (e) => {
  const zeile = e.target.closest(".zeile.umbenennbar");
  if (zeile && zeile.isConnected && !zeile.querySelector("input")) starteUmbenennen(zeile);
});

$("#stundenplan").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const zeile = e.target.closest?.(".zeile.umbenennbar");
  if (!zeile || !zeile.isConnected || zeile.querySelector("input")) return;
  e.preventDefault();
  starteUmbenennen(zeile);
});

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
    ${fasseZusammen(t.lessons).map((s) => stundeHtml(s, t.date)).join("")}
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
  const google = stand?.google;

  // Nicht eingerichtet oder nicht verknuepft ist kein Fehler, sondern ein
  // Zustand - verbunden wird in der ToDo-Liste, deshalb der Link dorthin.
  if (google && !google.moeglich) {
    el.innerHTML = '<div class="leer-hinweis">Google-Kalender ist auf diesem Server nicht eingerichtet.</div>';
    return;
  }
  if (google && !google.verbunden) {
    el.innerHTML = `<div class="leer-hinweis">Kein Google-Kalender verknüpft.<br>
      <a class="btn" href="${esc(CONFIG.anmeldeUrl)}" target="_blank" rel="noopener" style="margin-top:10px">In der ToDo-Liste verbinden ↗</a></div>`;
    return;
  }
  if (google?.fehler) {
    el.innerHTML = `<div class="fehler-hinweis">${esc(google.fehler)}</div>`;
    return;
  }

  const heute = heuteIso();
  const alle = stand?.termine || [];
  const sichtbar = termineAnsicht === "heute"
    ? alle.filter((t) => t.date === heute)
    : alle;

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
function todoHtml(t, mitListe) {
  const faellig = t.due ? new Date(t.due + "T00:00") : null;
  const ampel = fristAmpel(faellig);
  // Der Listenname steht nur davor, wenn es ueberhaupt mehrere Listen gibt -
  // bei einer einzigen waere er in jeder Zeile dasselbe Wort.
  const unter = [mitListe ? t.liste : null, t.bereich,
                 faellig ? faellig.toLocaleDateString("de-DE") : null, t.note]
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
  const versteckt = new Set(stand?.einstellungen?.versteckteBereiche || []);

  // Im Kachelkopf steht nur etwas, wenn wirklich gefiltert wird - sonst waere
  // es eine Zahl ohne Aussage. Wird gefiltert, MUSS es dastehen: eine kurze
  // Liste soll nicht wie "mehr ist nicht offen" aussehen.
  const ausgeblendet = bereiche.filter((b) => versteckt.has(b.id)).length;
  $("#todoBereiche").textContent = ausgeblendet
    ? `${bereiche.length - ausgeblendet} von ${bereiche.length} Bereichen`
    : "";

  if (stand?.todoFehler) {
    el.innerHTML = `<div class="fehler-hinweis">ToDos nicht lesbar: ${esc(stand.todoFehler)}</div>`;
    return;
  }

  // Noch einmal filtern, obwohl der Server das schon tut: nach einem Klick in
  // den Einstellungen soll die Kachel sofort stimmen und nicht erst, wenn die
  // naechste Antwort da ist.
  const todos = (stand?.todos || []).filter((t) => !versteckt.has(t.bereichId));
  if (!todos.length) {
    el.innerHTML = ausgeblendet
      ? '<div class="leer-hinweis">Keine offenen ToDos in den sichtbaren Bereichen 🎉</div>'
      : '<div class="leer-hinweis">Keine offenen ToDos 🎉</div>';
    return;
  }

  const mehrereListen = new Set(bereiche.map((b) => b.liste)).size > 1;
  el.innerHTML = todos.map((t) => todoHtml(t, mehrereListen)).join("") +
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

// ---------------------------------------------------------------- Kacheln
/**
 * Welche Kacheln es gibt. Die Reihenfolge hier gilt, solange nichts anderes
 * eingestellt ist.
 */
const KARTEN = [
  { id: "stundenplan", el: "#karteStundenplan", name: "Stundenplan", icon: "🕗" },
  { id: "termine",     el: "#karteTermine",     name: "Termine",     icon: "📆" },
  { id: "aufgaben",    el: "#karteAufgaben",    name: "Aufgaben",    icon: "📝" },
  { id: "todos",       el: "#karteTodos",       name: "ToDos",       icon: "✅" },
  { id: "fokus",       el: "#karteFokus",       name: "Fokus heute", icon: "🔥" },
];

/**
 * Die Reihenfolge, wie sie WIRKLICH gilt: das Gespeicherte zuerst, alles
 * Unbekannte hinten dran. Kaeme je eine Kachel dazu, taucht sie damit von
 * selbst auf, statt unsichtbar zu bleiben - dasselbe Prinzip wie bei den
 * Bereichen.
 */
function kartenReihenfolge() {
  const gespeichert = (stand?.einstellungen?.kartenReihenfolge || [])
    .filter((id) => KARTEN.some((k) => k.id === id));
  return [...gespeichert, ...KARTEN.map((k) => k.id).filter((id) => !gespeichert.includes(id))];
}

/**
 * Kacheln ein- und ausblenden und auf die beiden Spalten verteilen.
 *
 * Am Handy loesen sich die Spalten per `display: contents` auf, dort zaehlt
 * allein `order` - jede Kachel bekommt ihre Nummer deshalb als Inline-Stil.
 * (Die festen order-Werte im CSS sind nur noch der Notnagel, falls das hier
 * nie laeuft.) Am grossen Bildschirm zaehlt dagegen, in WELCHER Spalte die
 * Kachel steckt: abwechselnd links und rechts, also in Leserichtung.
 *
 * Ausgeblendete Kacheln wandern ans Ende der linken Spalte. Sie sind
 * unsichtbar, aber ihr Platz im DOM soll trotzdem festliegen - sonst haengt
 * das Ergebnis davon ab, wo sie zufaellig standen, als sie abgewaehlt wurden.
 */
function ordneKarten() {
  const spalten = [...document.querySelectorAll("#tafel .spalte")];
  if (spalten.length < 2) return;

  const versteckt = new Set(stand?.einstellungen?.versteckteKarten || []);
  const soll = [[], []];
  const aus = [];
  let platz = 0;

  for (const id of kartenReihenfolge()) {
    const el = $(KARTEN.find((k) => k.id === id).el);
    if (!el) continue;
    if (versteckt.has(id)) { el.hidden = true; aus.push(el); continue; }
    el.hidden = false;
    el.style.order = String(platz + 1);
    soll[platz % 2].push(el);
    platz++;
  }
  soll[0].push(...aus);

  // Bleibt nur eine Kachel uebrig, waere die zweite Spalte leerer Platz und
  // die Kachel stuende auf halber Breite.
  $("#tafel").classList.toggle("einspaltig", platz <= 1);
  $("#tafelLeer").hidden = platz > 0;

  spalten.forEach((spalte, i) => {
    const ist = [...spalte.children];
    const stimmt = ist.length === soll[i].length && ist.every((el, n) => el === soll[i][n]);
    if (!stimmt) soll[i].forEach((el) => spalte.appendChild(el));
  });
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
  ordneKarten();
  zeichneStundenplan();
  zeichneTermine();
  zeichneAufgaben();
  zeichneTodos();
  zeichneFokus();
  markiereDringend();
  verdrahteAppLinks();
  // Steht das Popup offen (etwa beim 10-Minuten-Nachladen), die Zahlen dort
  // mitziehen - sonst zeigt es "2 offen", waehrend die Kachel daneben schon
  // drei hat.
  // Die Stundennamen bleiben absichtlich stehen: ein Neuzeichnen mitten im
  // Tippen wuerde das Feld unter den Fingern austauschen.
  if (!$("#einstellungenPopup").hidden) {
    zeichneBereiche();
    zeichneKarten();
    zeichneGoogle();
  }
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
/**
 * Immer nur EIN Abschnitt offen - dasselbe Verhalten wie in ToDo und Fokus.
 * Ohne das steht nach ein paar Klicks alles offen und man scrollt durch
 * Abschnitte, die man gar nicht sehen wollte.
 */
function resetAkkordeon() {
  document.querySelectorAll("#einstellungenPopup details.ein-abschnitt").forEach((d) => { d.open = false; });
}

document.querySelectorAll("#einstellungenPopup details.ein-abschnitt").forEach((d) => {
  d.addEventListener("toggle", () => {
    if (!d.open) return;
    document.querySelectorAll("#einstellungenPopup details.ein-abschnitt").forEach((a) => {
      if (a !== d) a.open = false;
    });
  });
});

/**
 * Der Google-Abschnitt zeigt nur den Stand - verbunden und getrennt wird in
 * der ToDo-Liste. Dort haengt die Verknuepfung am Konto, und ein zweiter
 * Zustimmungsdialog hier waere derselbe Vorgang an einem zweiten Ort.
 *
 * Fehlen die Zugangsdaten auf dem Pages-Projekt, verschwindet der Abschnitt
 * ganz: eine Einstellung anzubieten, die es nicht gibt, ist schlimmer als
 * keine.
 */
function zeichneGoogle() {
  const g = stand?.google;
  const abschnitt = $("#googleAbschnitt");

  if (!g || !g.moeglich) {
    abschnitt.hidden = true;
    return;
  }
  abschnitt.hidden = false;

  if (g.fehler) {
    $("#subGoogle").textContent = "Problem";
    $("#googleText").textContent = g.fehler;
    $("#googleKnopf").textContent = "In der ToDo-Liste neu verbinden ↗";
    return;
  }
  if (g.verbunden) {
    $("#subGoogle").textContent = g.email || "verbunden";
    $("#googleText").textContent =
      "Die Termine kommen aus dem Hauptkalender dieses Kontos. Abonnierte Kalender wie Feiertage und Geburtstage bleiben draußen.";
    $("#googleKnopf").textContent = "In der ToDo-Liste verwalten ↗";
    return;
  }
  $("#subGoogle").textContent = "nicht verbunden";
  $("#googleText").textContent =
    "Noch kein Kalender verknüpft. Das läuft über die ToDo-Liste — die Verknüpfung hängt am Konto, das Dashboard liest sie nur mit.";
  $("#googleKnopf").textContent = "In der ToDo-Liste verbinden ↗";
}

function oeffneEinstellungen() {
  resetAkkordeon();
  zeichneBereiche();
  zeichneKarten();
  zeichneStundenNamen();
  zeichneGoogle();
  $("#einstellungenPopup").hidden = false;
}

function schliesseEinstellungen() {
  $("#einstellungenPopup").hidden = true;
}

$("#einstellungenBtn").addEventListener("click", oeffneEinstellungen);
$("#einstellungenZu").addEventListener("click", schliesseEinstellungen);
// Klick auf den dunklen Rand schliesst - aber nur dort, nicht im Kasten selbst.
// Am Handy fuellt der Dialog den Bildschirm, dort gibt es diesen Rand nicht;
// deshalb ist das ✕ oben der Weg, der immer da ist.
$("#einstellungenPopup").addEventListener("click", (e) => {
  if (e.target === $("#einstellungenPopup")) schliesseEinstellungen();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") schliesseEinstellungen();
});

// ---------------------------------------------------------------- Bereiche
/**
 * Die Bereichsliste zum An- und Abwaehlen.
 *
 * Gespeichert wird, was VERSTECKT ist (siehe _lib/einstellungen.js) - ein
 * neuer Bereich taucht damit von selbst auf, statt unsichtbar zu bleiben, bis
 * jemand nachsieht.
 */
function zeichneBereiche() {
  const el = $("#bereichListe");
  const bereiche = stand?.bereiche || [];
  const versteckt = new Set(stand?.einstellungen?.versteckteBereiche || []);
  const mehrereListen = new Set(bereiche.map((b) => b.liste)).size > 1;

  $("#subBereiche").textContent = bereiche.length
    ? `${bereiche.length - [...versteckt].filter((id) => bereiche.some((b) => b.id === id)).length} von ${bereiche.length}`
    : "";

  if (!bereiche.length) {
    el.innerHTML = '<p class="ein-hinweis">Noch keine Bereiche in der ToDo-Liste.</p>';
    return;
  }

  el.innerHTML = bereiche.map((b) => `
    <label class="bereich-zeile">
      <input type="checkbox" data-bereich="${esc(b.id)}"${versteckt.has(b.id) ? "" : " checked"}>
      <span class="name">${esc(b.name)}${mehrereListen ? ` <span class="woher">${esc(b.liste)}</span>` : ""}</span>
      <span class="zahl">${b.offene} offen</span>
    </label>`).join("");

  el.querySelectorAll("input[data-bereich]").forEach((box) => {
    box.addEventListener("change", speichereBereiche);
  });
}

// Aenderungen werden gesammelt, statt jede einzeln zu schicken.
//
// FALLE, beim Testen gefunden: Ein einfaches "laeuft gerade schon" haette den
// zweiten von zwei schnellen Klicks stillschweigend verschluckt - er wurde
// uebersprungen, und das Neuladen danach setzte das Kaestchen wieder auf den
// alten Stand. Wer zwei Bereiche hintereinander abwaehlt, ist aber der
// Normalfall, nicht die Ausnahme. Jetzt zaehlt der ZULETZT gesetzte Zustand:
// jede Aenderung landet sofort in `stand.einstellungen`, die Uhr wird neu
// gestellt und schickt beim Ablauf genau das, was dort steht.
let speicherUhr = null;
let nachladenNoetig = false;

/**
 * Eine Einstellung uebernehmen: sofort in den Speicher, kurz darauf zum
 * Server.
 *
 * `nachladen` nur dort, wo der Server das Ergebnis mitbestimmt - die
 * Bereichsfilter wirken in der Datenbankabfrage, und nur von dort stimmt auch
 * die Zahl der gekuerzten Eintraege. Kachelreihenfolge und Stundennamen sind
 * reine Anzeige; ein Neuladen dafuer waere eine Anfrage ohne neue Auskunft.
 */
function setzeEinstellung(teil, { nachladen = false } = {}) {
  if (!stand) return;
  stand.einstellungen = { ...stand.einstellungen, ...teil };
  nachladenNoetig = nachladenNoetig || nachladen;
  clearTimeout(speicherUhr);
  speicherUhr = setTimeout(schickeEinstellungen, 400);
}

function aktuellVersteckte() {
  return [...document.querySelectorAll("#bereichListe input[data-bereich]")]
    .filter((box) => !box.checked)
    .map((box) => box.dataset.bereich);
}

function speichereBereiche() {
  const versteckteBereiche = aktuellVersteckte();
  const gesamt = (stand?.bereiche || []).length;
  $("#subBereiche").textContent = `${gesamt - versteckteBereiche.length} von ${gesamt}`;

  // Erst in den Speicher, dann zeichnen - die Kachel liest von dort.
  setzeEinstellung({ versteckteBereiche }, { nachladen: true });
  zeichneTodos();
  markiereDringend();
}

/**
 * PUT ersetzt den Block als GANZES. Deshalb geht immer alles mit, auch die
 * Felder, die gerade niemand angefasst hat: schickte man nur das geaenderte
 * Feld, setzte der Server die uebrigen auf ihren Standard zurueck - ein
 * umbenanntes Fach loeschte dann die Bereichsfilter.
 */
async function schickeEinstellungen() {
  const e = stand?.einstellungen || {};
  const nachladen = nachladenNoetig;
  nachladenNoetig = false;
  try {
    const antwort = await fetch("/api/einstellungen", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        versteckteBereiche: e.versteckteBereiche || [],
        stundenNamen: e.stundenNamen || {},
        kartenReihenfolge: e.kartenReihenfolge || [],
        versteckteKarten: e.versteckteKarten || [],
      }),
    });
    if (!antwort.ok) throw new Error("HTTP " + antwort.status);
  } catch (e) {
    nachladenNoetig = nachladen;   // beim naechsten Versuch nachholen
    const el = $("#ladeFehler");
    el.textContent = "⚠️ Einstellung konnte nicht gespeichert werden — sie gilt nur auf diesem Gerät, bis es wieder klappt.";
    el.classList.add("warnung");
    el.hidden = false;
    return;
  }
  if (nachladen) laden();
}

// ---------------------------------------------------------------- Kachel-Liste
/**
 * Die Kacheln zum Sortieren und Abwaehlen.
 *
 * Pfeile statt Ziehen: Drag-and-drop ist am Handy fummelig und braucht fuer
 * fuenf Zeilen deutlich mehr Code, als es hier einbringt.
 */
function zeichneKarten() {
  const el = $("#kartenListe");
  const reihe = kartenReihenfolge();
  const versteckt = new Set(stand?.einstellungen?.versteckteKarten || []);
  $("#subKarten").textContent = `${reihe.length - versteckt.size} von ${reihe.length}`;

  el.innerHTML = reihe.map((id, i) => {
    const k = KARTEN.find((x) => x.id === id);
    return `
    <div class="karten-zeile" data-karte="${esc(id)}">
      <button type="button" class="pfeil" data-richtung="hoch"
              aria-label="${esc(k.name)} nach oben"${i === 0 ? " disabled" : ""}>&#8593;</button>
      <button type="button" class="pfeil" data-richtung="runter"
              aria-label="${esc(k.name)} nach unten"${i === reihe.length - 1 ? " disabled" : ""}>&#8595;</button>
      <label class="name">
        <input type="checkbox" data-karte="${esc(id)}"${versteckt.has(id) ? "" : " checked"}>
        <span>${k.icon} ${esc(k.name)}</span>
      </label>
    </div>`;
  }).join("");

  el.querySelectorAll(".pfeil").forEach((knopf) => {
    knopf.addEventListener("click", () => {
      verschiebeKarte(knopf.closest(".karten-zeile").dataset.karte, knopf.dataset.richtung);
    });
  });

  el.querySelectorAll("input[data-karte]").forEach((box) => {
    box.addEventListener("change", () => {
      const versteckteKarten = [...el.querySelectorAll("input[data-karte]")]
        .filter((b) => !b.checked)
        .map((b) => b.dataset.karte);
      setzeEinstellung({ versteckteKarten });
      ordneKarten();
      markiereDringend();
      zeichneKarten();
    });
  });
}

function verschiebeKarte(id, richtung) {
  const reihe = kartenReihenfolge();
  const von = reihe.indexOf(id);
  const nach = von + (richtung === "hoch" ? -1 : 1);
  if (von < 0 || nach < 0 || nach >= reihe.length) return;
  [reihe[von], reihe[nach]] = [reihe[nach], reihe[von]];

  setzeEinstellung({ kartenReihenfolge: reihe });
  ordneKarten();
  markiereDringend();
  zeichneKarten();

  // Die Liste ist neu gezeichnet, der geklickte Knopf also weg. Ohne das hier
  // laege der Fokus wieder am Anfang und man muesste sich zum zweiten Klick
  // erst zurueckhangeln.
  const zeile = $(`#kartenListe .karten-zeile[data-karte="${id}"]`);
  const knopf = zeile?.querySelector(`.pfeil[data-richtung="${richtung}"]`);
  (knopf && !knopf.disabled ? knopf : zeile?.querySelector(".pfeil:not(:disabled)"))?.focus();
}

// ---------------------------------------------------------------- Stundennamen
/**
 * Jede Stunde der geladenen Woche einmal - nach Wochentag und Uhrzeit, so wie
 * der eigene Name auch daran haengt. Zwei gleiche Stunden an zwei Tagen sind
 * zwei Eintraege, zwei Bloecke desselben Tages nur einer.
 */
function stundenSlots() {
  const gesehen = new Map();
  for (const tag of stand?.daten?.untis?.days || []) {
    const wochentag = new Date(tag.date + "T00:00:00").getDay();
    for (const s of fasseZusammen(tag.lessons || [])) {
      const schluessel = stundenSchluessel(tag.date, s);
      if (!gesehen.has(schluessel)) {
        gesehen.set(schluessel, { schluessel, wochentag, start: s.start, fach: s.subject });
      }
    }
  }
  return [...gesehen.values()]
    .sort((a, b) => (a.wochentag || 7) - (b.wochentag || 7) || a.start.localeCompare(b.start));
}

function zeichneStundenNamen() {
  const el = $("#stundenListe");
  const namen = stand?.einstellungen?.stundenNamen || {};
  const slots = stundenSlots();
  const bekannt = new Set(slots.map((s) => s.schluessel));
  // Namen fuer Stunden, die es diese Woche nicht gibt: sonst waeren sie nur
  // noch loeschbar, indem man auf die Woche wartet, in der sie wieder
  // auftauchen.
  const verwaist = Object.keys(namen).filter((k) => !bekannt.has(k));
  const zahl = Object.keys(namen).length;
  $("#subStunden").textContent = zahl ? `${zahl} eigene` : "";

  if (!slots.length && !verwaist.length) {
    el.innerHTML = '<p class="ein-hinweis">Noch kein Stundenplan geladen.</p>';
    return;
  }

  el.innerHTML = slots.map((s) => `
    <label class="stunden-zeile">
      <span class="wann">${esc(WOCHENTAGE[s.wochentag].slice(0, 2))} ${esc(s.start)}</span>
      <input type="text" maxlength="60" data-schluessel="${esc(s.schluessel)}"
             value="${esc(namen[s.schluessel] || "")}" placeholder="${esc(s.fach)}">
    </label>`).join("")
    + (verwaist.length ? `
      <p class="ein-hinweis">Nicht im Plan dieser Woche:</p>
      ${verwaist.map((k) => `
        <div class="stunden-zeile">
          <span class="wann">${esc(schluesselText(k))}</span>
          <span class="alt-name">${esc(namen[k])}</span>
          <button type="button" class="pfeil" data-loeschen="${esc(k)}"
                  aria-label="Namen löschen">&#10005;</button>
        </div>`).join("")}` : "");

  el.querySelectorAll("input[data-schluessel]").forEach((feld) => {
    // "change" statt "input": gespeichert wird, wenn das Feld fertig ist,
    // nicht bei jedem Buchstaben.
    feld.addEventListener("change", () => {
      setzeStundenName(feld.dataset.schluessel, feld.value);
      zeichneStundenplan();
      $("#subStunden").textContent =
        Object.keys(stand?.einstellungen?.stundenNamen || {}).length
          ? `${Object.keys(stand.einstellungen.stundenNamen).length} eigene` : "";
    });
  });

  el.querySelectorAll("button[data-loeschen]").forEach((knopf) => {
    knopf.addEventListener("click", () => {
      setzeStundenName(knopf.dataset.loeschen, "");
      zeichneStundenplan();
      zeichneStundenNamen();
    });
  });
}

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
