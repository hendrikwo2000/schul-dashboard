/**
 * Google-Termine in die Form bringen, die die Kachel anzeigt.
 *
 * Bis zum 12.08.2026 kam diese Umformung aus `scripts/fetch_data.py` (iCal
 * ueber die GitHub-Action). Das Ausgabeformat ist bewusst dasselbe geblieben -
 * `{date, title, start, end, allday, location, url, until, spanDays}` -, damit
 * die Anzeige unveraendert bleibt.
 *
 * ZWEI EIGENHEITEN, die den Code laenger machen, als er aussieht:
 *
 * 1. **Zeitzone.** Der Worker laeuft in UTC, Google liefert Zeitpunkte mit
 *    Offset ("2026-08-12T15:30:00+02:00"). Welcher KALENDERTAG das ist, haengt
 *    an Europe/Berlin - ein Termin um 00:30 Uhr gehoert sonst auf den Vortag.
 *    Deshalb geht jede Umrechnung ueber Intl mit fester Zeitzone.
 *
 * 2. **Mehrtaegige Termine.** Google gibt ganztaegige Termine als {date} an,
 *    und das Ende ist der erste Tag DANACH (exklusiv). Ferien vom 12. bis 25.
 *    kommen also als start=12., ende=26. Die Kachel bekommt daraus einen
 *    Eintrag pro Tag - dieselbe Struktur wie vorher, damit `istDauerlaeufer`
 *    im Frontend sie ab drei Tagen zu einer Leiste zusammenfasst.
 */

const ZONE = "Europe/Berlin";

const TAG_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
const ZEIT_FORMAT = new Intl.DateTimeFormat("de-DE", {
  timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
});

// "2026-08-12T15:30:00+02:00" -> "2026-08-12" (in Berlin)
function tagVon(zeitpunkt) {
  return TAG_FORMAT.format(new Date(zeitpunkt));
}

// "2026-08-12T15:30:00+02:00" -> "15:30" (in Berlin)
function uhrzeitVon(zeitpunkt) {
  return ZEIT_FORMAT.format(new Date(zeitpunkt));
}

// Reine Kalendertag-Rechnung, deshalb in UTC - eine Zeitumstellung darf daran
// nichts aendern.
export function tagPlus(datum, n) {
  const [j, m, t] = datum.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t) + n * 86400000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Ein Google-Termin wird zu einem Eintrag pro Tag, den er beruehrt - begrenzt
 * auf [vonTag, bisTag].
 */
function verteileAufTage(termin, vonTag, bisTag) {
  if (!termin.ganztags) {
    const tag = tagVon(termin.start);
    if (tag < vonTag || tag > bisTag) return [];
    return [{
      date: tag,
      title: termin.titel,
      start: uhrzeitVon(termin.start),
      end: termin.ende ? uhrzeitVon(termin.ende) : null,
      allday: false,
      location: termin.ort,
      url: termin.url,
    }];
  }

  // Ganztaegig: `start` und `ende` sind reine Datumsangaben, `ende` ist
  // exklusiv. Ohne Ende gilt der Termin fuer einen Tag.
  const erster = termin.start.slice(0, 10);
  const letzter = termin.ende ? tagPlus(termin.ende.slice(0, 10), -1) : erster;
  // Ein kaputter Datensatz mit Ende vor Anfang wuerde sonst endlos zaehlen.
  if (letzter < erster) return [];

  const laenge = Math.round(
    (Date.parse(letzter + "T00:00:00Z") - Date.parse(erster + "T00:00:00Z")) / 86400000
  ) + 1;

  const eintraege = [];
  for (let tag = erster; tag <= letzter; tag = tagPlus(tag, 1)) {
    if (tag < vonTag || tag > bisTag) continue;
    eintraege.push({
      date: tag,
      title: termin.titel,
      start: null,
      end: null,
      allday: true,
      location: termin.ort,
      url: termin.url,
      // Beides nur bei mehrtaegigen: daran erkennt die Kachel den Dauerlaeufer
      // und schreibt "noch bis ...".
      spanDays: laenge,
      until: laenge > 1 ? letzter : null,
    });
  }
  return eintraege;
}

/**
 * Alle Termine des Zeitraums, nach Tag und Uhrzeit sortiert.
 * Ganztaegige zuerst - sie gelten fuer den ganzen Tag und stehen deshalb oben.
 */
export function alsKachelTermine(termine, vonTag, bisTag) {
  const heraus = [];
  for (const t of termine) heraus.push(...verteileAufTage(t, vonTag, bisTag));
  heraus.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    (a.allday === b.allday ? String(a.start || "").localeCompare(String(b.start || "")) : (a.allday ? -1 : 1))
  );
  return heraus;
}

/**
 * Abfragefenster fuer Google. Bewusst je einen Tag groesser als gebraucht:
 * ein Termin, der in einer anderen Zeitzone knapp ausserhalb liegt, gehoert in
 * Berlin womoeglich noch dazu. Was zu viel kommt, faellt beim Verteilen weg.
 */
export function abfrageFenster(heute, tage) {
  return {
    vonIso: tagPlus(heute, -1) + "T00:00:00Z",
    bisIso: tagPlus(heute, tage + 1) + "T00:00:00Z",
  };
}
