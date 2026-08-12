/**
 * Wer darf das Dashboard sehen?
 *
 * Die Anmeldung teilt sich diese App mit ToDo und Fokus - wer dort ein Konto
 * hat, hat also eine gueltige Sitzung, sobald er hier vorbeikommt. Das reicht
 * bewusst NICHT: das Dashboard zeigt Hendriks Stundenplan, seine Aufgaben und
 * seine Termine. Es ist fuer eine Person.
 *
 * Erlaubt ist, wer in der GETEILTEN users-Tabelle mit dashboard_zugang=1 steht.
 *
 * UNTERSCHIED ZU ToDo UND FOKUS, wichtig: dort holt sich jeder Nutzer die
 * jeweils andere App selbst - ein Login-Versuch setzt die fehlende Spalte
 * still mit. Hier NICHT. Es gibt keine Selbstbedienung, keinen Knopf und
 * keine Warteliste; die Spalte wird von Hand in der D1-Konsole gesetzt
 * (migration-dashboard.sql). Wer das aendert, oeffnet das Dashboard fuer jeden,
 * der ein ToDo-Konto hat.
 */

import { angemeldeterNutzer } from "./session.js";
import { json } from "./antwort.js";

/**
 * Angemeldet UND freigeschaltet - oder eine fertige Fehlerantwort in `fehler`.
 *
 * Die Pruefung sitzt in JEDEM Daten-Endpunkt, nicht nur beim Seitenaufruf.
 * Sonst kaeme jemand mit einer gueltigen ToDo-Sitzung per curl direkt an die
 * API, ohne die Oberflaeche je gesehen zu haben.
 */
export async function nutzerOderFehler(request, env) {
  if (!env.DB) return { fehler: json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500) };

  let nutzer, zeile;
  try {
    nutzer = await angemeldeterNutzer(request, env);
    if (nutzer) {
      zeile = await env.DB.prepare(
        "SELECT dashboard_zugang FROM users WHERE id = ?"
      ).bind(nutzer.id).first();
    }
  } catch (e) {
    return { fehler: json({ error: "Datenbankfehler" }, 500) };
  }

  // 401 heisst fuer die Oberflaeche: ab zur Anmeldung bei todo.it-wolf.org.
  if (!nutzer) return { fehler: json({ error: "Nicht angemeldet" }, 401) };

  // 403, nicht 401: angemeldet ist die Person ja. Ein 401 wuerde sie in eine
  // Anmeldung schicken, aus der sie hierher zurueckkaeme, um wieder abgewiesen
  // zu werden - eine Schleife statt einer Antwort.
  if (!zeile || !zeile.dashboard_zugang) {
    return { fehler: json({ error: "Dieses Konto ist für das Dashboard nicht freigeschaltet." }, 403) };
  }
  return { nutzer, nutzerId: nutzer.id };
}
