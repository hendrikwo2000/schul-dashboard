/**
 * Ob eine Gewohnheit heute dran und ob sie erledigt ist.
 *
 * SPIEGELUNG, KEIN NEUBAU. Die Regeln stehen im Original in
 * `Fokus/web/functions/_lib/tag.js` (status, istObergrenze, stillerTagZaehlt,
 * tagPlus, montagVon) und in `Fokus/web/functions/api/push/pruefen.js`
 * (istGeplant, erledigtDieseWoche, nochOffen). Aendert sich dort die Bedeutung
 * eines Rhythmus, muss sie hier mitgezogen werden - sonst zeigt das Dashboard
 * einen anderen Tagesstand als der Fokus-Tracker selbst, und das faellt
 * niemandem auf, weil beide fuer sich plausibel aussehen.
 *
 * Bewusst NICHT mitgespiegelt sind die Flammen-Rechnung (flammenZahl - bis zum
 * 14.08.2026 hiess sie straehne/straehneWochentage/straehneXProWoche/
 * straehneFuer und zaehlte Tage in Folge) und alles zum Schreiben von Tagen
 * (istDatum, pruefeHeute, pruefeLogDatum, MAX_MENGE). Das Dashboard zeigt
 * keine Flamme und schreibt nichts - toter Code waere hier nur eine zweite
 * Stelle, die beim naechsten Mal mitgepflegt werden muesste.
 */

// Datum um n Tage verschieben. Rechnung in UTC, weil hier reine Kalendertage
// gemeint sind - eine Sommerzeit-Umstellung darf daran nichts aendern.
export function tagPlus(datum, n) {
  const [j, m, t] = datum.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t) + n * 86400000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// Montag der Woche, in der `datum` liegt. getUTCDay() zaehlt ab Sonntag (0),
// deshalb die Verschiebung.
export function montagVon(datum) {
  const [j, m, t] = datum.split("-").map(Number);
  const wochentag = new Date(Date.UTC(j, m - 1, t)).getUTCDay();
  return tagPlus(datum, -((wochentag + 6) % 7));
}

/**
 * 'offen' | 'teilweise' | 'erledigt' | 'ueberschritten' aus Menge, Ziel und
 * Richtung.
 *
 * Bei richtung='hoechstens' (Obergrenze, z.B. "Instagram-Minuten") gibt es kein
 * "teilweise", und die Menge 0 ist erledigt: bei einer Obergrenze ist sie der
 * BESTE Tag, nicht der leere.
 *
 * ACHTUNG: "offen" heisst bei 'hoechstens' damit ausschliesslich "es gibt keine
 * Log-Zeile". Fuer einen Tag ohne Eintrag darf status() nicht mit menge=0
 * aufgerufen werden.
 */
export function status(typ, menge, ziel, richtung = "mindestens") {
  const m = Number(menge) || 0;
  if (typ === "binaer") return m >= 1 ? "erledigt" : "offen";
  const z = Number(ziel) || 0;

  if (richtung === "hoechstens") {
    if (m > z) return "ueberschritten";
    return "erledigt";
  }

  if (z > 0 && m >= z) return "erledigt";
  return m > 0 ? "teilweise" : "offen";
}

// Eine Gewohnheit mit Obergrenze statt Soll.
export function istObergrenze(gewohnheit) {
  return gewohnheit.typ === "menge" && gewohnheit.richtung === "hoechstens";
}

/**
 * Zaehlt ein Tag OHNE Eintrag bei dieser Gewohnheit als erledigt?
 *
 * Nur bei einer Obergrenze - wer gar nicht auf Instagram war, hat die Grenze
 * eingehalten, auch ohne das jeden Abend zu bestaetigen. Nur fuer die
 * Vergangenheit und erst ab dem Anlegetag.
 */
export function stillerTagZaehlt(gewohnheit, datum, heute) {
  if (!istObergrenze(gewohnheit)) return false;
  if (datum >= heute) return false;
  const angelegt = String(gewohnheit.created_at || "").slice(0, 10);
  return !angelegt || datum >= angelegt;
}

// Wochentag-Index eines Datums, 0=Mo .. 6=So. Bit i (1<<i) dieses Index ist die
// Position in wochentage_maske.
function wochentagIndex(datum) {
  const [j, m, t] = datum.split("-").map(Number);
  return (new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7;
}

export function istGeplant(gewohnheit, datum) {
  if (gewohnheit.rhythmus !== "wochentage") return true;
  return (gewohnheit.wochentage_maske & (1 << wochentagIndex(datum))) !== 0;
}

// Zahl der in dieser Woche (Montag bis heute) bereits erledigten Tage - fuer
// den Wochenfortschritt bei 'x_pro_woche'.
export function erledigtDieseWoche(gewohnheit, tageDerGewohnheit, heute) {
  const start = montagVon(heute);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const tag = tagPlus(start, i);
    if (tag > heute) break;
    const eintrag = tageDerGewohnheit[tag];
    if (!eintrag) {
      // Ohne Eintrag zaehlt der Tag nur bei einer Obergrenze mit.
      if (stillerTagZaehlt(gewohnheit, tag, heute)) n++;
      continue;
    }
    if (status(gewohnheit.typ, eintrag.menge, eintrag.ziel, gewohnheit.richtung) === "erledigt") n++;
  }
  return n;
}

/**
 * Wie eine Gewohnheit heute im Dashboard erscheint.
 *
 * Rueckgabe:
 *   null              - taucht heute gar nicht auf (nicht geplant, Wochenziel
 *                       schon voll, oder Obergrenze ohne Eintrag)
 *   'erledigt' | 'teilweise' | 'offen' | 'ueberschritten'
 *
 * Der null-Fall fasst zwei Dinge zusammen, die im Fokus-Tracker getrennt
 * aussehen: einen Tag, an dem nichts geplant ist, und eine ruhende Obergrenze
 * (ruhtHeute() in Fokus/web/app.js). Fuer eine Uebersichtskachel ist beides
 * dasselbe - es steht heute nichts an.
 */
export function heutigerStand(gewohnheit, tageDerGewohnheit, heute) {
  if (!istGeplant(gewohnheit, heute)) return null;

  const heutiger = tageDerGewohnheit[heute];

  // Eine Obergrenze ist mit erreichtem Wochenziel NICHT erledigt: eine Grenze
  // gilt an jedem Tag der Woche, auch am sechsten. Deshalb faellt sie hier
  // durch auf die Tagespruefung, genau wie 'taeglich'.
  if (gewohnheit.rhythmus === "x_pro_woche" && !istObergrenze(gewohnheit)) {
    if (erledigtDieseWoche(gewohnheit, tageDerGewohnheit, heute) >= gewohnheit.wochenziel) {
      return heutiger ? "erledigt" : null;
    }
  }

  // Kein Eintrag heisst offen - und zwar ohne status() zu fragen: bei einer
  // Obergrenze waere die 0 dort "erledigt", ein noch gar nicht angefasster Tag
  // wuerde also faelschlich als geschafft gelten. Bei einer Obergrenze ruht der
  // Tag stattdessen ganz.
  if (!heutiger) return istObergrenze(gewohnheit) ? null : "offen";

  return status(gewohnheit.typ, heutiger.menge, heutiger.ziel, gewohnheit.richtung);
}
