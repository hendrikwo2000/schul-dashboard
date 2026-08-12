/**
 * Eine JSON-Antwort, ueberall gleich. Gespiegelt aus dem Fokus-Tracker.
 *
 * `no-store` ist hier nicht Kosmetik: das Dashboard zeigt einen Tagesstand, und
 * ein zwischengespeicherter waere schlimmer als gar keiner - man sieht dann
 * einen Stundenplan von gestern und merkt es nicht.
 */

import { mitCookies } from "./session.js";

export function json(body, status = 200, cookies = []) {
  return new Response(JSON.stringify(body), {
    status,
    headers: mitCookies({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }, cookies),
  });
}

// Anfragekoerper lesen, ohne dass ungueltiges JSON die Function abstuerzen
// laesst (das gaebe einen Cloudflare-Fehler 1101 statt einer lesbaren Meldung).
export async function liesJson(request) {
  try {
    return { body: await request.json() };
  } catch (e) {
    return { fehler: json({ error: "Ungueltiges JSON" }, 400) };
  }
}
