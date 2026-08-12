/**
 * Die Einstellungen speichern. Gelesen werden sie mit allem anderen ueber
 * /api/dashboard - ein eigener GET waere eine zweite Anfrage fuer Daten, die
 * ohnehin bei jedem Seitenaufruf mitkommen.
 *
 * PUT, nicht POST: der Block wird als Ganzes ersetzt, nicht ergaenzt.
 */

import { json, liesJson } from "../_lib/antwort.js";
import { nutzerOderFehler } from "../_lib/zugang.js";
import { speichereEinstellungen } from "../_lib/einstellungen.js";

export async function onRequestPut({ request, env }) {
  const { fehler, nutzerId } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: jsonFehler } = await liesJson(request);
  if (jsonFehler) return jsonFehler;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Erwartet wird ein JSON-Objekt" }, 400);
  }

  try {
    const gespeichert = await speichereEinstellungen(env, nutzerId, body);
    return json({ ok: true, einstellungen: gespeichert });
  } catch (e) {
    return json({ error: "Speichern fehlgeschlagen: " + e.message }, 500);
  }
}
