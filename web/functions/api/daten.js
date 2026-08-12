/**
 * Der Ablieferpunkt der GitHub-Action.
 *
 * KEIN Nutzer-Endpunkt: hier kommt keine Sitzung an, sondern ein geteiltes
 * Geheimnis im Header (`X-Dashboard-Token`, auf beiden Seiten derselbe Wert -
 * GitHub-Actions-Secret und Cloudflare-Secret). Dasselbe Muster wie
 * api/push/pruefen.js im Fokus-Tracker.
 *
 * WARUM DIESER UMWEG UEBERHAUPT
 * Bis zum 12.08.2026 committete die Action die Daten alle 15 Minuten als
 * verschluesselte data/data.json ins Repo, und die Seite entschluesselte sie im
 * Browser. Gemessen waren das 278 Commits in 27 Tagen. Auf Cloudflare Pages ist
 * jeder Commit ein Deploy - 310 im Monat gingen zwar noch unter das Limit von
 * 500, haetten aber 60 % des Kontingents fuer etwas verbraucht, das gar kein
 * Deploy sein muss, und jede echte Code-Aenderung im Deploy-Laerm versenkt.
 *
 * Mit dem Login davor braucht es die Verschluesselung nicht mehr: was nur der
 * Server herausgibt, muss der Browser nicht verstecken.
 */

import { json, liesJson } from "../_lib/antwort.js";
import { zeitgleich } from "../_lib/session.js";

// Reichlich Luft: der Block lag zuletzt bei rund 20 KB. Die Grenze steht gegen
// eine kaputte Schleife im Abrufskript, nicht gegen normales Wachstum.
const MAX_ZEICHEN = 1_000_000;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);
  if (!env.DASHBOARD_TOKEN) {
    return json({ error: "DASHBOARD_TOKEN fehlt im Pages-Projekt" }, 500);
  }

  const mitgebracht = request.headers.get("X-Dashboard-Token") || "";
  if (!zeitgleich(mitgebracht, env.DASHBOARD_TOKEN)) {
    return json({ error: "Nicht erlaubt" }, 403);
  }

  const { body, fehler } = await liesJson(request);
  if (fehler) return fehler;

  // Ein leeres oder unpassendes Objekt wuerde das Dashboard nicht zum Absturz
  // bringen, aber die vorhandenen Daten ueberschreiben - und der Ausfall der
  // Quelle saehe dann aus wie "heute ist wirklich nichts los".
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Erwartet wird ein JSON-Objekt" }, 400);
  }
  // Termine stehen bewusst nicht in dieser Liste: die holt das Dashboard seit
  // dem 12.08.2026 direkt aus dem Google-Kalender, nicht mehr ueber die Action.
  if (!body.untis && !body.iserv) {
    return json({ error: "Weder untis noch iserv sind enthalten" }, 400);
  }

  const text = JSON.stringify(body);
  if (text.length > MAX_ZEICHEN) {
    return json({ error: `Zu gross (${text.length} Zeichen, erlaubt sind ${MAX_ZEICHEN})` }, 413);
  }

  // aktualisiert_am setzt der Server, nicht der Absender: gemeint ist "wann
  // haben wir das bekommen". Eine falsch gehende Uhr in der Action wuerde sonst
  // die Stand-Warnung im Dashboard aushebeln.
  try {
    await env.DB.prepare(
      `INSERT INTO dashboard_daten (schluessel, json, aktualisiert_am)
       VALUES ('aktuell', ?, datetime('now'))
       ON CONFLICT(schluessel) DO UPDATE
         SET json = excluded.json, aktualisiert_am = excluded.aktualisiert_am`
    ).bind(text).run();
  } catch (e) {
    return json({ error: "Speichern fehlgeschlagen: " + e.message }, 500);
  }

  return json({ ok: true, zeichen: text.length });
}
