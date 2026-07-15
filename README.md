# Schul-Dashboard

Zeigt den heutigen Stundenplan (WebUntis, BS 22 / BEA Hamburg) und offene
Aufgaben (IServ, bea-portal.de) auf einer Seite — gehostet über GitHub Pages.

## Wie es funktioniert

```
GitHub Action (werktags alle 30 Min.)
  └─ scripts/fetch_data.py
       ├─ WebUntis-API  → Stundenplan der Woche
       ├─ IServ-Login   → offene Aufgaben
       └─ schreibt data/data.json
GitHub Pages zeigt index.html, die data.json anzeigt.
```

Die Zugangsdaten liegen **nur** in GitHub Secrets — nie im Code oder Repo.

## Einrichtung (einmalig)

1. **Repo auf GitHub anlegen** und diesen Ordner pushen.
2. **Secrets anlegen:** Repo → *Settings → Secrets and variables → Actions →
   New repository secret*. Vier Secrets:
   | Name | Inhalt |
   |---|---|
   | `UNTIS_USER` | dein WebUntis-Benutzername |
   | `UNTIS_PASS` | dein WebUntis-Passwort |
   | `ISERV_USER` | dein IServ-Benutzername (meist `vorname.nachname`) |
   | `ISERV_PASS` | dein IServ-Passwort |
3. **GitHub Pages aktivieren:** *Settings → Pages → Source: Deploy from a
   branch → Branch: `main`, Ordner `/ (root)`*.
4. **Action einmal von Hand starten:** *Actions → „Daten aktualisieren" →
   Run workflow*. Danach läuft sie werktags 6–18 Uhr alle 30 Minuten von selbst.

Fertig — das Dashboard ist unter `https://<benutzername>.github.io/<repo>/` erreichbar.

## Anpassen

- **ToDo-App verlinken:** in `app.js` oben bei `CONFIG.todoAppUrl` die URL eintragen.
- **Zeitplan ändern:** Cron-Zeile in `.github/workflows/update.yml`
  (Achtung: Zeiten dort sind UTC, also 1–2 Std. hinter deutscher Zeit).

## Lokal testen

```
set UNTIS_USER=... & set UNTIS_PASS=... & set ISERV_USER=... & set ISERV_PASS=...
pip install requests beautifulsoup4 tzdata
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
