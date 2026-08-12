/**
 * Alles, was das Dashboard anzeigt, in einer Antwort.
 *
 * Vier Quellen, ein Endpunkt:
 *   - `daten`         aus dashboard_daten (Stundenplan und Aufgaben; kommen
 *                     von der GitHub-Action ueber api/daten.js)
 *   - `termine`       live aus dem Google-Kalender des verknuepften Kontos
 *   - `todos`         live aus der geteilten Datenbank, dieselben Zeilen, die
 *                     todo.it-wolf.org zeigt
 *   - `gewohnheiten`  live aus den Fokus-Tabellen
 *
 * EIN Endpunkt statt vier, weil die Seite ohnehin alles zusammen braucht:
 * mehrere Anfragen waeren mehrere Sitzungspruefungen und mehrere Chancen, dass
 * eine Kachel ohne erkennbaren Grund leer bleibt. Jede Quelle ist einzeln
 * abgesichert - faellt eine aus, bleibt der Rest stehen.
 *
 * Das Dashboard liest nur. Es gibt bewusst keinen Schreibweg fuer ToDos,
 * Gewohnheiten oder Termine - zum Aendern fuehrt der Kachelkopf in die
 * jeweilige App.
 */

import { json } from "../_lib/antwort.js";
import { nutzerOderFehler } from "../_lib/zugang.js";
import { heutigerStand, montagVon } from "../_lib/tag.js";
import { liesEinstellungen } from "../_lib/einstellungen.js";
import { fehltEinrichtung, kontoFuer, frischesZugriffToken, hauptKalender, termineVon } from "../_lib/google.js";
import { alsKachelTermine, abfrageFenster, tagPlus } from "../_lib/termine.js";

// Deckel gegen eine Kachel, die endlos scrollt. Wird er erreicht, sagt die
// Antwort das ausdruecklich (`todosGekuerzt`) - eine stille Kuerzung sieht aus
// wie "mehr ist da nicht".
const MAX_TODOS = 40;

// Soweit reicht die 7-Tage-Ansicht der Termin-Kachel.
const TERMIN_TAGE = 7;

const DATUM_MUSTER = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Das "heute" kommt vom Client, nicht vom Server.
 *
 * Der Worker laeuft in UTC, gelebt wird in UTC+1/+2. Um 0:30 Uhr waere
 * serverseitig noch gestern - der Stundenplan zeigte dann den falschen Tag.
 * Dasselbe Muster wie im Fokus-Tracker (_lib/tag.js). Frei erfinden darf der
 * Client das Datum nicht: ein Tag Spielraum deckt jede Zeitzone ab.
 */
function heuteVomClient(url) {
  const jetzt = new Date();
  const p = (x) => String(x).padStart(2, "0");
  const utcHeute = `${jetzt.getUTCFullYear()}-${p(jetzt.getUTCMonth() + 1)}-${p(jetzt.getUTCDate())}`;

  const gewuenscht = url.searchParams.get("heute") || "";
  if (!DATUM_MUSTER.test(gewuenscht)) return utcHeute;

  const abstand = Math.abs(Date.parse(gewuenscht + "T00:00:00Z") - Date.parse(utcHeute + "T00:00:00Z"));
  return Number.isFinite(abstand) && abstand <= 86400000 ? gewuenscht : utcHeute;
}

/**
 * Alle Bereiche, die der Nutzer sehen darf, mit der Zahl ihrer offenen ToDos.
 *
 * Der Weg ueber `board_members` ist nicht schmueckend: seit den geteilten
 * Listen (21.07.2026) haengt `lists` an einem Board, nicht mehr direkt an
 * einer user_id. Wer eine Liste sehen darf, steht ausschliesslich dort.
 *
 * Geliefert werden ALLE Bereiche, auch versteckte - die Einstellungen
 * brauchen die vollstaendige Liste, um sie zum Anhaken anzubieten.
 */
async function holeBereiche(env, nutzerId) {
  const zeilen = await env.DB.prepare(
    `SELECT l.id, l.name, b.name AS liste,
            (SELECT count(*) FROM todos t WHERE t.list_id = l.id AND t.done = 0) AS offene
       FROM lists l
       JOIN boards b        ON b.id = l.board_id
       JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
      ORDER BY b.name, l.position, l.name`
  ).bind(nutzerId).all();
  return zeilen.results || [];
}

/**
 * Offene ToDos aus den nicht versteckten Bereichen.
 *
 * Bis zum 12.08.2026 filterte hier eine feste Namensliste ("Schule",
 * "Facharbeit") aus einer Umgebungsvariablen. Das ging genau so lange gut, bis
 * ein Bereich umbenannt wurde: "Schule" gab es nicht mehr, und die Kachel
 * verschwieg vier von sieben ToDos, ohne dass irgendwo etwas kaputt aussah.
 * Jetzt ist alles sichtbar, was nicht ausdruecklich abgewaehlt wurde.
 */
async function holeTodos(env, nutzerId, versteckte) {
  const zeilen = await env.DB.prepare(
    `SELECT t.id, t.text, t.note, t.due, t.list_id AS bereichId,
            l.name AS bereich, b.name AS liste
       FROM todos t
       JOIN lists l         ON l.id = t.list_id
       JOIN boards b        ON b.id = l.board_id
       JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
      WHERE t.done = 0
      ORDER BY CASE WHEN t.due IS NULL OR t.due = '' THEN 1 ELSE 0 END,
               t.due, b.name, l.position, t.position`
  ).bind(nutzerId).all();

  const aus = new Set(versteckte);
  const sichtbar = (zeilen.results || []).filter((t) => !aus.has(t.bereichId));
  return { todos: sichtbar.slice(0, MAX_TODOS), gekuerzt: sichtbar.length > MAX_TODOS };
}

/**
 * Die heute faelligen Gewohnheiten mit ihrem Stand.
 *
 * Die Logik dahinter ist gespiegelt, siehe Kopf von _lib/tag.js. Geladen wird
 * die laufende Woche ab Montag, weil 'x_pro_woche' den Wochenfortschritt
 * braucht - fuer 'taeglich' allein wuerde der heutige Tag reichen.
 */
async function holeGewohnheiten(env, nutzerId, heute) {
  const gewohnheiten = (await env.DB.prepare(
    `SELECT id, name, typ, zielmenge, einheit, richtung, rhythmus,
            wochentage_maske, wochenziel, position, created_at
       FROM gewohnheiten
      WHERE user_id = ? AND archiviert = 0
      ORDER BY position, created_at`
  ).bind(nutzerId).all()).results || [];
  if (!gewohnheiten.length) return [];

  const logs = (await env.DB.prepare(
    `SELECT l.gewohnheit_id, l.datum, l.menge, l.ziel_damals
       FROM gewohnheit_logs l
       JOIN gewohnheiten g ON g.id = l.gewohnheit_id
      WHERE g.user_id = ? AND l.datum >= ? AND l.datum <= ?`
  ).bind(nutzerId, montagVon(heute), heute).all()).results || [];

  const zielVon = {};
  for (const g of gewohnheiten) zielVon[g.id] = g.zielmenge;

  const tageProGewohnheit = {};
  for (const l of logs) {
    const eimer = tageProGewohnheit[l.gewohnheit_id] || (tageProGewohnheit[l.gewohnheit_id] = {});
    eimer[l.datum] = {
      menge: l.menge,
      ziel: l.ziel_damals != null ? l.ziel_damals : zielVon[l.gewohnheit_id],
    };
  }

  const heraus = [];
  for (const g of gewohnheiten) {
    const tage = tageProGewohnheit[g.id] || {};
    const stand = heutigerStand(g, tage, heute);
    // null heisst: heute steht nichts an (nicht geplant, Wochenziel voll oder
    // ruhende Obergrenze). Die faellt aus der Kachel, statt als "erledigt"
    // durchzugehen - sie ist ja nichts, was heute jemand geschafft haette.
    if (stand === null) continue;
    heraus.push({
      id: g.id,
      name: g.name,
      typ: g.typ,
      einheit: g.einheit,
      zielmenge: g.zielmenge,
      menge: tage[heute] ? tage[heute].menge : null,
      stand,
    });
  }
  return heraus;
}

/**
 * Termine des verknuepften Google-Kontos.
 *
 * Verknuepft wird bei todo.it-wolf.org - hier wird nur gelesen. Fehlt die
 * Verknuepfung, ist das kein Fehler, sondern ein Zustand: die Kachel sagt es
 * und verlinkt dorthin.
 */
async function holeTermine(env, nutzerId, heute) {
  if (fehltEinrichtung(env)) {
    return { google: { moeglich: false, verbunden: false }, termine: [] };
  }
  const konto = await kontoFuer(env, nutzerId);
  if (!konto) return { google: { moeglich: true, verbunden: false }, termine: [] };

  const token = await frischesZugriffToken(env, konto);
  const kalenderId = await hauptKalender(token);
  if (!kalenderId) {
    return { google: { moeglich: true, verbunden: true, email: konto.google_email, fehler: "Kein Kalender gefunden" }, termine: [] };
  }

  const { vonIso, bisIso } = abfrageFenster(heute, TERMIN_TAGE);
  const roh = await termineVon(token, kalenderId, vonIso, bisIso);
  return {
    google: { moeglich: true, verbunden: true, email: konto.google_email },
    termine: alsKachelTermine(roh, heute, tagPlus(heute, TERMIN_TAGE)),
  };
}

export async function onRequestGet({ request, env }) {
  const { fehler, nutzer, nutzerId } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const heute = heuteVomClient(new URL(request.url));
  const einstellungen = await liesEinstellungen(env, nutzerId);

  const antwort = {
    nutzer: { name: nutzer.name, email: nutzer.email },
    heute,
    einstellungen,
  };

  try {
    const zeile = await env.DB.prepare(
      "SELECT json, aktualisiert_am FROM dashboard_daten WHERE schluessel = 'aktuell'"
    ).first();
    if (zeile) {
      antwort.daten = JSON.parse(zeile.json);
      antwort.aktualisiert = zeile.aktualisiert_am;
    } else {
      antwort.datenFehler = "Die Aktualisierung hat noch nie geliefert.";
    }
  } catch (e) {
    antwort.datenFehler = "Gespeicherte Daten nicht lesbar: " + e.message;
  }

  try {
    antwort.bereiche = await holeBereiche(env, nutzerId);
    const { todos, gekuerzt } = await holeTodos(env, nutzerId, einstellungen.versteckteBereiche);
    antwort.todos = todos;
    antwort.todosGekuerzt = gekuerzt;
  } catch (e) {
    antwort.bereiche = [];
    antwort.todos = [];
    antwort.todoFehler = e.message;
  }

  try {
    antwort.gewohnheiten = await holeGewohnheiten(env, nutzerId, heute);
  } catch (e) {
    antwort.gewohnheiten = [];
    antwort.fokusFehler = e.message;
  }

  try {
    const { google, termine } = await holeTermine(env, nutzerId, heute);
    antwort.google = google;
    antwort.termine = termine;
  } catch (e) {
    // "getrennt" heisst: bei Google widerrufen oder abgelaufen. Die Zeile in
    // google_konten wird hier NICHT geloescht - das ist Sache der ToDo-Liste,
    // die die Verknuepfung auch angelegt hat.
    antwort.termine = [];
    antwort.google = {
      moeglich: true,
      verbunden: e.code !== "getrennt",
      fehler: e.code === "getrennt"
        ? "Die Google-Verknüpfung ist abgelaufen — in der ToDo-Liste neu verbinden."
        : e.message,
    };
  }

  return json(antwort);
}
