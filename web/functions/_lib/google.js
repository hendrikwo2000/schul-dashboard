/**
 * Google-Kalender, ausschliesslich LESEND - gespiegelt aus der ToDo-Liste
 * (ToDo/web/functions/_lib/google.js), auf den Lese-Weg eingedampft.
 *
 * WARUM DAS DASHBOARD KEINEN EIGENEN OAUTH-WEG HAT
 * Verknuepft wird bei todo.it-wolf.org, und dabei bleibt es. Das Dashboard
 * benutzt dieselbe Datenbank, findet das Konto also einfach in
 * `google_konten` und erneuert das Zugriffstoken mit denselben
 * Zugangsdaten (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET muessen deshalb auch
 * auf DIESEM Pages-Projekt liegen). Eine zweite Weiterleitungs-URI in der
 * Google Cloud Console braucht es dafuer nicht - die ist nur fuer den
 * Zustimmungs-Dialog noetig, den es hier nicht gibt.
 *
 * Weggelassen sind entsprechend: zustimmungsAdresse, tauscheCode,
 * weiterleitungsZiel, speichereKonto, loescheKonto und alles Schreibende
 * (terminRumpf, schreibeTermin). Wer den Kalender verknuepfen oder trennen
 * will, tut das in der ToDo-Liste.
 *
 * WICHTIGER UNTERSCHIED zum Original: Meldet Google "getrennt", raeumt die
 * ToDo-Liste die Zeile aus `google_konten` weg. Hier NICHT. Das Dashboard
 * darf die Verknuepfung der anderen App nicht wegen eines eigenen Fehlers
 * loeschen - es meldet nur, dass gerade nichts zu holen ist.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/calendar/v3";

export function fehltEinrichtung(env) {
  return !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET;
}

// Fehler, die den Nutzer betreffen (Zugriff bei Google widerrufen, Token
// ungueltig), tragen code="getrennt" - der Aufrufer sagt dann "nicht
// verbunden" statt "Fehler".
function getrenntFehler(text) {
  const e = new Error(text);
  e.code = "getrennt";
  return e;
}

async function tokenAnfrage(felder) {
  const antwort = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(felder),
  });
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok) {
    if (daten.error === "invalid_grant") throw getrenntFehler("Google-Zugriff nicht mehr gueltig");
    throw new Error("Google-Anmeldung fehlgeschlagen: " + (daten.error || antwort.status));
  }
  return daten;
}

export async function kontoFuer(env, nutzerId) {
  return await env.DB.prepare(
    "SELECT user_id, google_email, refresh_token, zugriff_token, zugriff_bis FROM google_konten WHERE user_id = ?"
  ).bind(nutzerId).first();
}

/**
 * Gueltiges Zugriffs-Token, notfalls frisch geholt.
 *
 * 60 Sekunden Sicherheitsabstand vor dem Ablauf - sonst laeuft das Token
 * ausgerechnet zwischen Pruefung und Abruf ab.
 *
 * Das erneuerte Token wird zurueckgeschrieben, damit die ToDo-Liste es
 * mitbenutzt statt gleich noch einmal bei Google anzufragen. Beide Apps
 * teilen sich diese eine Zeile.
 */
export async function frischesZugriffToken(env, konto) {
  // zugriff_bis kommt aus SQLites datetime() und ist UTC ohne Zeitzonen-
  // Kennung ("2026-08-11 09:15:00"). Ohne das angehaengte "Z" wuerde der
  // Worker es als Ortszeit lesen und je nach Zone stundenweise danebenliegen.
  if (konto.zugriff_token && konto.zugriff_bis) {
    const bis = Date.parse(String(konto.zugriff_bis).replace(" ", "T") + "Z");
    if (bis && bis - Date.now() > 60_000) return konto.zugriff_token;
  }

  const daten = await tokenAnfrage({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: konto.refresh_token,
    grant_type: "refresh_token",
  });
  await env.DB.prepare(
    "UPDATE google_konten SET zugriff_token = ?, zugriff_bis = datetime('now', ?) WHERE user_id = ?"
  ).bind(daten.access_token, `+${Math.max(60, daten.expires_in || 3600)} seconds`, konto.user_id).run();
  return daten.access_token;
}

async function hole(pfad, token, params) {
  const url = new URL(API_BASE + pfad);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const antwort = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (antwort.status === 401 || antwort.status === 403) throw getrenntFehler("Google verweigert den Zugriff");
  if (!antwort.ok) throw new Error("Google antwortet mit " + antwort.status);
  return await antwort.json();
}

/**
 * Der Hauptkalender des Kontos.
 *
 * Nur er, wie im ToDo-Kalender: abonnierte Kalender (Feiertage, Geburtstage,
 * Kalenderwochen) tragen zur Tagesuebersicht wenig bei und wuerden die Kachel
 * zupflastern. Erkannt am `primary`-Schalter, nicht am Namen - eine Erkennung
 * an der Beschriftung braeche, sobald der Kalender anders heisst.
 */
export async function hauptKalender(token) {
  const daten = await hole("/users/me/calendarList", token, { maxResults: "250", minAccessRole: "reader" });
  const alle = daten.items || [];
  const primaer = alle.find(k => k.primary) || alle[0];
  return primaer ? primaer.id : null;
}

export async function termineVon(token, kalenderId, vonIso, bisIso) {
  const daten = await hole(`/calendars/${encodeURIComponent(kalenderId)}/events`, token, {
    timeMin: vonIso,
    timeMax: bisIso,
    singleEvents: "true",   // Google loest Serientermine selbst auf
    orderBy: "startTime",
    maxResults: "250",
  });
  return (daten.items || [])
    .filter(e => e.status !== "cancelled")
    .map(e => ({
      titel: e.summary || "(ohne Titel)",
      ganztags: !!(e.start && e.start.date),
      start: (e.start && (e.start.dateTime || e.start.date)) || null,
      ende: (e.end && (e.end.dateTime || e.end.date)) || null,
      ort: e.location || null,
      url: e.htmlLink || null,
    }))
    .filter(e => e.start);
}
