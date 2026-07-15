# Schul-Dashboard

Zeigt den heutigen Stundenplan (WebUntis, BS 22 / BEA Hamburg), Termine
(Google Kalender) und offene Aufgaben (IServ, bea-portal.de) auf einer Seite —
gehostet über GitHub Pages. Ein Klick auf 🔊 liest den Tag vor.

## Wie es funktioniert

```
GitHub Action (täglich alle 15 Min., 6–22 Uhr)
  └─ scripts/fetch_data.py
       ├─ WebUntis-API  → Stundenplan der Woche
       ├─ IServ-Login   → offene Aufgaben
       ├─ iCal-Feed     → Termine der nächsten 7 Tage
       └─ schreibt data/data.json
GitHub Pages zeigt index.html, die data.json anzeigt.
```

Das ToDo-Board holt die Seite direkt im Browser aus der JSONBin-Cloud, es
läuft also nicht über die Action.

Die Zugangsdaten liegen **nur** in GitHub Secrets — nie im Code oder Repo.

## Einrichtung (einmalig)

1. **Repo auf GitHub anlegen** und diesen Ordner pushen.
2. **Secrets anlegen:** Repo → *Settings → Secrets and variables → Actions →
   New repository secret*. Vier Secrets:
   | Name | Inhalt |
   |---|---|
   | `UNTIS_USER` | dein WebUntis-Benutzername |
   | `UNTIS_PASS` | dein WebUntis-Passwort |
   | `ISERV_USER` | dein IServ-Benutzername (meist `vorname.nachname`, kleingeschrieben) |
   | `ISERV_PASS` | dein IServ-Passwort |
   | `ICAL_URL` | geheime iCal-Adresse deines Google Kalenders (optional) |
   | `DASHBOARD_PASS` | Passwort (8+ Zeichen), mit dem die Daten verschlüsselt werden (optional) |

   Die iCal-Adresse findest du in Google Kalender (Web): *Einstellungen →
   [dein Kalender] → Kalender integrieren → „Privatadresse im iCal-Format"*.

   Ist `DASHBOARD_PASS` gesetzt, wird die komplette `data.json` mit
   AES-256-GCM verschlüsselt (Schlüssel per PBKDF2 aus dem Passwort). Die
   Seite fragt das Passwort beim ersten Öffnen ab und merkt es sich im
   localStorage des Geräts. Ohne `DASHBOARD_PASS` bleibt alles unverschlüsselt
   öffentlich — der Kalender wird dann aus Datenschutzgründen **nicht**
   abgerufen.
3. **GitHub Pages aktivieren:** *Settings → Pages → Source: Deploy from a
   branch → Branch: `main`, Ordner `/ (root)`*.
4. **Action einmal von Hand starten:** *Actions → „Daten aktualisieren" →
   Run workflow*. Danach läuft sie täglich 6–22 Uhr alle 15 Minuten von selbst.
   GitHub startet Cron-Jobs bei Last auch mal 5–20 Minuten später oder lässt
   einen Lauf aus — sind die Daten tagsüber älter als 3 Stunden, warnt das
   Dashboard. Nachts läuft die Action nicht, dort wird nicht gewarnt.

Fertig — das Dashboard ist unter `https://<benutzername>.github.io/<repo>/` erreichbar.

## Icon

`icon.svg` ist die einzige Quelle. Die übrigen Dateien (`favicon.ico`,
`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) werden daraus gebaut
und liegen fertig im Repo — neu bauen nur, wenn sich `icon.svg` ändert:

```
pip install pymupdf pillow
python scripts/build_icons.py
```

Zwei Fallen, die das Script abfängt bzw. die die Datei bewusst meidet:
`icon.svg` ist **einfarbig**, weil der Renderer keine SVG-Verläufe kann (die
PNGs sähen sonst anders aus als die SVG). Und der Browser parst SVG **streng
als XML** — ein Syntaxfehler und das Icon bleibt kommentarlos leer; das Script
prüft deshalb vor dem Rendern.

Über `site.webmanifest` lässt sich das Dashboard auf dem Handy als App zum
Startbildschirm hinzufügen.

## Anpassen

- **Name in der Begrüßung:** in `app.js` oben bei `CONFIG.name`.
- **ToDo-App verlinken:** in `app.js` oben bei `CONFIG.todoAppUrl` die URL eintragen.
- **Zeitplan ändern:** Cron-Zeile in `.github/workflows/update.yml`
  (Achtung: Zeiten dort sind UTC, also 1–2 Std. hinter deutscher Zeit).
- **Warnschwelle für alte Daten:** `CONFIG.staleHours` in `app.js`.

## Lokal testen

```
set UNTIS_USER=... & set UNTIS_PASS=... & set ISERV_USER=... & set ISERV_PASS=...
pip install requests beautifulsoup4 tzdata icalendar recurring-ical-events cryptography
python scripts/fetch_data.py
python -m http.server 8899
```

Dann <http://localhost:8899> öffnen.

## Hinweise

- ⚠️ Die Seite (und damit Stundenplan + Aufgabenliste) ist **öffentlich** für
  jeden, der die URL kennt. Keine Passwörter, aber persönliche Daten.
- Die WebUntis-Anbindung nutzt die inoffizielle JSON-RPC-API; die
  IServ-Anbindung liest die Aufgabenseite aus. Ändert die Schule etwas an den
  Systemen, muss ggf. `scripts/fetch_data.py` angepasst werden. Fehler werden
  im Dashboard angezeigt.
