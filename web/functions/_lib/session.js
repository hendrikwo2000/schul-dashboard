/**
 * Sitzungen - gespiegelt aus der ToDo-Liste (ToDo/web/functions/_lib/session.js),
 * genau wie im Fokus-Tracker.
 *
 * Bewusst dieselbe Mechanik und vor allem DERSELBE Cookie-Name: alle drei Apps
 * teilen sich eine Anmeldung. Wer bei todo.it-wolf.org eingeloggt ist, ist es
 * hier auch. Das haengt an zwei Dingen:
 *
 *   1. Domain=.it-wolf.org am Cookie (statt host-only auf einer Subdomain)
 *   2. alle Pages-Projekte binden dieselbe D1-Datenbank `todo` als `DB`
 *
 * Ein Cookie allein reicht nicht - der Token wird bei jeder Anfrage in
 * `sessions` nachgeschlagen. Ohne die Datenbank-Bindung waere er wertlos.
 *
 * Wer das Dashboard sehen DARF, entscheidet zusaetzlich _lib/zugang.js. Eine
 * gueltige ToDo-Sitzung oeffnet es also nicht automatisch.
 *
 * ACHTUNG: Diese Datei ist eine KOPIE. Aendert sich die Cookie-Mechanik in der
 * ToDo-Liste, muss sie hier und im Fokus-Tracker mitgezogen werden. Es gibt
 * bewusst keinen gemeinsamen Ort dafuer - drei Repos, drei Deployments.
 */

export const COOKIE_NAME = "todo_session";

// Das Cookie gilt fuer die ganze Domain, nicht nur fuer diese Subdomain -
// sonst gaebe es keinen geteilten Login. Muss mit der ToDo-Liste
// uebereinstimmen, sonst schreiben sich die Apps gegenseitig um.
const COOKIE_DOMAIN = ".it-wolf.org";

export async function hashHex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Vergleich ohne fruehen Ausstieg: die Laufzeit soll nicht verraten, ab
// welcher Stelle zwei Zeichenketten auseinandergehen. Hier fuer den
// Action-Token in api/daten.js, im Original fuer Anmeldecodes.
export function zeitgleich(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function liesCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const teil of header.split(";")) {
    const gleich = teil.indexOf("=");
    if (gleich === -1) continue;
    if (teil.slice(0, gleich).trim() === name) return teil.slice(gleich + 1).trim();
  }
  return null;
}

// Secure nur bei HTTPS setzen - sonst wuerde der Browser das Cookie beim
// lokalen Testen mit "wrangler pages dev" (http://127.0.0.1) verwerfen.
function secureFlag(request) {
  return new URL(request.url).protocol === "https:" ? " Secure;" : "";
}

/**
 * Domain nur auf der echten Domain setzen.
 *
 * Auf 127.0.0.1 und den *.pages.dev-Vorschauadressen wuerde der Browser ein
 * fremdes Domain-Attribut still verwerfen: das Cookie kaeme gar nicht erst an,
 * und die Anmeldung braeche ohne sichtbaren Fehler.
 */
function domainFlag(request) {
  const host = new URL(request.url).hostname;
  const eigen = host === "it-wolf.org" || host.endsWith(".it-wolf.org");
  return eigen ? ` Domain=${COOKIE_DOMAIN};` : "";
}

// Dasselbe Cookie ohne Domain-Attribut, sofort abgelaufen. Raeumt die alte
// host-only-Variante ab, die es vor der Umstellung gab - laegen beide
// nebeneinander, schickt der Browser beide und welches gewinnt, ist offen.
function altesHostCookieWeg(request) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly;${secureFlag(request)} SameSite=Lax; Max-Age=0`;
}

// Beim Abmelden beide Varianten entwerten.
//
// Achtung, gewollt: Abmelden hier meldet auch aus ToDo und Fokus ab. Es ist
// EINE Sitzung, kein drittes Konto - alles andere waere eine Halbwahrheit
// ("abgemeldet", aber der Nebenan-Tab laeuft weiter).
export function loescheSessionCookies(request) {
  const domain = domainFlag(request);
  const weg = [altesHostCookieWeg(request)];
  if (domain) {
    weg.push(`${COOKIE_NAME}=; Path=/;${domain} HttpOnly;${secureFlag(request)} SameSite=Lax; Max-Age=0`);
  }
  return weg;
}

/**
 * Antwort-Header aus einem Objekt bauen und die Cookie-Zeilen einzeln
 * anhaengen. `new Headers({...})` allein wuerde bei zwei Set-Cookie-Werten
 * einen davon verschlucken.
 */
export function mitCookies(basis, cookies = []) {
  const headers = new Headers(basis);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

/**
 * Liefert { id, email, name } der aktuellen Sitzung, oder null.
 *
 * Prueft NICHT, ob die Person das Dashboard sehen darf - das macht
 * _lib/zugang.js. Hier steht nur, wer angemeldet ist.
 *
 * Diese App legt selbst keine Sitzungen an (kein Anmeldeformular, siehe
 * _lib/zugang.js), deshalb fehlen hier setzeSessionCookies() und neuesToken()
 * aus dem Original. Geloescht wird dagegen sehr wohl - Abmelden gibt es.
 */
export async function angemeldeterNutzer(request, env) {
  const token = liesCookie(request, COOKIE_NAME);
  if (!token) return null;
  const hash = await hashHex(token);
  const sitzung = await env.DB.prepare(
    "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')"
  ).bind(hash).first();
  if (!sitzung) return null;
  return await env.DB.prepare(
    "SELECT id, email, name FROM users WHERE id = ?"
  ).bind(sitzung.user_id).first();
}
