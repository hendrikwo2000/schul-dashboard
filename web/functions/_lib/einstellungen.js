/**
 * Die Einstellungen des Dashboards - am KONTO, nicht am Geraet.
 *
 * Sie liegen als eigene Zeile in `dashboard_daten` unter dem Schluessel
 * `einstellungen:<user_id>`. Das spart eine eigene Tabelle: die Struktur
 * (Schluessel + JSON + Zeitstempel) passt genau, und es ist ohnehin ein
 * einzelner Block, der als Ganzes gelesen und als Ganzes ersetzt wird.
 *
 * Der Schluessel traegt die user_id, weil inzwischen zwei Konten
 * freigeschaltet sind - ohne sie saehen beide dieselben Filter.
 *
 * GESPEICHERT WIRD, WAS VERSTECKT IST, nicht was sichtbar ist. Der
 * Unterschied zeigt sich, sobald ein Bereich dazukommt: so taucht er von
 * selbst auf. Bei einer Liste des Sichtbaren bliebe er unsichtbar, bis man in
 * die Einstellungen geht - und niemand vermutet ein neues ToDo dort.
 *
 * Weil PUT den Block als GANZES ersetzt, schickt die Seite immer alle Felder
 * mit, auch die, die sie gerade nicht anfasst. Ein PUT mit nur einem Feld
 * wuerde die uebrigen auf ihren Standard zuruecksetzen - beim Umbenennen
 * einer Stunde also die Bereichsfilter loeschen.
 */

const SCHLUESSEL = (nutzerId) => `einstellungen:${nutzerId}`;

// Genug fuer jede denkbare Zahl an Bereichen, aber kein offenes Scheunentor
// fuer einen Client, der die Liste vollschreibt.
const MAX_VERSTECKT = 200;

// Ein Schuljahr hat rund 40 Stunden pro Woche; 200 Namen decken auch mehrere
// Stundenplanwechsel ab, ohne dass die Zeile in der Datenbank ausufert.
const MAX_STUNDEN_NAMEN = 200;
const MAX_NAME_LAENGE = 60;

// Die Kacheln, die es gibt. Ein Client darf nur aus dieser Liste waehlen -
// sonst stuenden dort irgendwann Namen von Kacheln, die nie existiert haben.
export const KARTEN_IDS = ["stundenplan", "termine", "aufgaben", "todos", "fokus"];

export const STANDARD = {
  versteckteBereiche: [],
  // "wochentag|startzeit|fachkuerzel" -> eigener Name der Stunde
  stundenNamen: {},
  // Reihenfolge der Kacheln. Leer = Standardreihenfolge (KARTEN_IDS).
  kartenReihenfolge: [],
  versteckteKarten: [],
};

export async function liesEinstellungen(env, nutzerId) {
  let zeile;
  try {
    zeile = await env.DB.prepare(
      "SELECT json FROM dashboard_daten WHERE schluessel = ?"
    ).bind(SCHLUESSEL(nutzerId)).first();
  } catch (e) {
    return { ...STANDARD };
  }
  if (!zeile) return { ...STANDARD };
  try {
    const gespeichert = JSON.parse(zeile.json);
    return { ...STANDARD, ...saeubere(gespeichert) };
  } catch (e) {
    // Kaputter Datensatz: lieber alles anzeigen als gar nichts.
    return { ...STANDARD };
  }
}

// Eine Liste von Ids: nur Zeichenketten, keine Doppelten, gedeckelt.
function idListe(wert, erlaubt, deckel) {
  if (!Array.isArray(wert)) return null;
  const heraus = [];
  for (const id of wert) {
    if (typeof id !== "string" || !id || id.length > 64) continue;
    if (erlaubt && !erlaubt.includes(id)) continue;
    if (heraus.includes(id)) continue;
    heraus.push(id);
    if (heraus.length >= deckel) break;
  }
  return heraus;
}

/**
 * Nur bekannte Felder uebernehmen und auf plausible Werte stutzen. Was der
 * Client schickt, ist erst einmal nur ein Vorschlag.
 *
 * Nicht mitgeschickte Felder fehlen auch im Ergebnis - erst
 * `speichereEinstellungen` fuellt sie aus STANDARD auf.
 */
export function saeubere(eingang) {
  const heraus = {};
  const e = eingang || {};

  const versteckt = idListe(e.versteckteBereiche, null, MAX_VERSTECKT);
  if (versteckt) heraus.versteckteBereiche = versteckt;

  const reihenfolge = idListe(e.kartenReihenfolge, KARTEN_IDS, KARTEN_IDS.length);
  if (reihenfolge) heraus.kartenReihenfolge = reihenfolge;

  const versteckteKarten = idListe(e.versteckteKarten, KARTEN_IDS, KARTEN_IDS.length);
  if (versteckteKarten) heraus.versteckteKarten = versteckteKarten;

  if (e.stundenNamen && typeof e.stundenNamen === "object" && !Array.isArray(e.stundenNamen)) {
    const namen = {};
    let zahl = 0;
    for (const [schluessel, name] of Object.entries(e.stundenNamen)) {
      if (zahl >= MAX_STUNDEN_NAMEN) break;
      if (typeof schluessel !== "string" || !schluessel || schluessel.length > 64) continue;
      if (typeof name !== "string") continue;
      const sauber = name.trim().slice(0, MAX_NAME_LAENGE);
      if (!sauber) continue;   // leerer Name heisst "wieder der Name aus Untis"
      namen[schluessel] = sauber;
      zahl++;
    }
    heraus.stundenNamen = namen;
  }

  return heraus;
}

export async function speichereEinstellungen(env, nutzerId, einstellungen) {
  const sauber = { ...STANDARD, ...saeubere(einstellungen) };
  await env.DB.prepare(
    `INSERT INTO dashboard_daten (schluessel, json, aktualisiert_am)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(schluessel) DO UPDATE
       SET json = excluded.json, aktualisiert_am = excluded.aktualisiert_am`
  ).bind(SCHLUESSEL(nutzerId), JSON.stringify(sauber)).run();
  return sauber;
}
