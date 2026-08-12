/**
 * Alles, was das Dashboard anzeigt, in einer Antwort.
 *
 * Drei Quellen, ein Endpunkt:
 *   - `daten`         aus dashboard_daten (Stundenplan, Aufgaben, Termine;
 *                     kommt von der GitHub-Action ueber api/daten.js)
 *   - `todos`         live aus der geteilten Datenbank, dieselben Zeilen, die
 *                     todo.it-wolf.org zeigt
 *   - `gewohnheiten`  live aus den Fokus-Tabellen
 *
 * EIN Endpunkt statt drei, weil die Seite ohnehin alles zusammen braucht: drei
 * Anfragen waeren drei Sitzungspruefungen und drei Chancen, dass eine Kachel
 * ohne erkennbaren Grund leer bleibt.
 *
 * Das Dashboard liest nur. Es gibt bewusst keinen Schreibweg fuer ToDos oder
 * Gewohnheiten - zum Aendern fuehrt der Kachelkopf in die jeweilige App.
 */

import { json } from "../_lib/antwort.js";
import { nutzerOderFehler } from "../_lib/zugang.js";
import { heutigerStand, montagVon } from "../_lib/tag.js";

/**
 * Welche Bereiche der ToDo-Liste auf dem Dashboard landen.
 *
 * Als Umgebungsvariable ueberschreibbar (`TODO_BEREICHE`, Komma-getrennt),
 * damit ein umbenannter Bereich keinen Deploy braucht. Gemeint sind die
 * BEREICHE (Spalten) innerhalb einer Liste, nicht die Listen selbst.
 */
const BEREICHE_STANDARD = ["Schule", "Facharbeit"];

// Deckel gegen eine Kachel, die endlos scrollt. Wird er erreicht, sagt die
// Antwort das ausdruecklich (`todosGekuerzt`) - eine stille Kuerzung sieht aus
// wie "mehr ist da nicht".
const MAX_TODOS = 40;

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

  const grenze = 86400000;
  const abstand = Math.abs(Date.parse(gewuenscht + "T00:00:00Z") - Date.parse(utcHeute + "T00:00:00Z"));
  return Number.isFinite(abstand) && abstand <= grenze ? gewuenscht : utcHeute;
}

/**
 * Offene ToDos aus den gewuenschten Bereichen.
 *
 * Der Weg ueber `board_members` ist nicht schmueckend: seit den geteilten
 * Listen (21.07.2026) haengt `lists` an einem Board, nicht mehr direkt an
 * einer user_id. Wer eine Liste sehen darf, steht ausschliesslich in
 * board_members - eine Abfrage ueber `lists.user_id` gaebe es nicht mehr.
 */
async function holeTodos(env, nutzerId, bereiche) {
  if (!bereiche.length) return { todos: [], gekuerzt: false };

  const platzhalter = bereiche.map(() => "?").join(",");
  const zeilen = await env.DB.prepare(
    `SELECT t.id, t.text, t.note, t.due, l.name AS bereich
       FROM todos t
       JOIN lists l         ON l.id = t.list_id
       JOIN boards b        ON b.id = l.board_id
       JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
      WHERE t.done = 0
        AND l.name IN (${platzhalter})
      ORDER BY CASE WHEN t.due IS NULL OR t.due = '' THEN 1 ELSE 0 END,
               t.due,
               l.position,
               t.position
      LIMIT ?`
  ).bind(nutzerId, ...bereiche, MAX_TODOS + 1).all();

  const alle = zeilen.results || [];
  return { todos: alle.slice(0, MAX_TODOS), gekuerzt: alle.length > MAX_TODOS };
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

export async function onRequestGet({ request, env }) {
  const { fehler, nutzer, nutzerId } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const heute = heuteVomClient(new URL(request.url));
  const bereiche = String(env.TODO_BEREICHE || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  const antwort = {
    nutzer: { name: nutzer.name, email: nutzer.email },
    heute,
    bereiche: bereiche.length ? bereiche : BEREICHE_STANDARD,
  };

  // Jede Quelle einzeln absichern: faellt eine aus, bleibt der Rest stehen.
  // Ohne das wuerde ein Tippfehler in einem Bereichsnamen die ganze Seite
  // leeren, obwohl Stundenplan und Termine voellig in Ordnung sind.
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
    const { todos, gekuerzt } = await holeTodos(env, nutzerId, antwort.bereiche);
    antwort.todos = todos;
    antwort.todosGekuerzt = gekuerzt;
  } catch (e) {
    antwort.todos = [];
    antwort.todoFehler = e.message;
  }

  try {
    antwort.gewohnheiten = await holeGewohnheiten(env, nutzerId, heute);
  } catch (e) {
    antwort.gewohnheiten = [];
    antwort.fokusFehler = e.message;
  }

  return json(antwort);
}
