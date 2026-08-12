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
 */

const SCHLUESSEL = (nutzerId) => `einstellungen:${nutzerId}`;

// Genug fuer jede denkbare Zahl an Bereichen, aber kein offenes Scheunentor
// fuer einen Client, der die Liste vollschreibt.
const MAX_VERSTECKT = 200;

export const STANDARD = {
  versteckteBereiche: [],
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

/**
 * Nur bekannte Felder uebernehmen und auf plausible Werte stutzen. Was der
 * Client schickt, ist erst einmal nur ein Vorschlag.
 */
export function saeubere(eingang) {
  const heraus = {};
  const versteckt = (eingang && eingang.versteckteBereiche) || [];
  if (Array.isArray(versteckt)) {
    heraus.versteckteBereiche = versteckt
      .filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64)
      .slice(0, MAX_VERSTECKT);
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
