# Schul-Dashboard 2.0 — Design

Stand: 12.08.2026. Umbau des Schul-Dashboards von einer statischen Seite mit
Browser-Entschlüsselung auf eine Cloudflare-Pages-App mit dem geteilten Login
von ToDo und Fokus.

## Ausgangslage

Das Dashboard liegt als Statik-Seite im Repo `hendrikwo2000/schul-dashboard`.
Eine GitHub-Action holt alle 15 Minuten Stundenplan (WebUntis), Aufgaben
(IServ) und Termine (iCal), verschlüsselt sie mit `DASHBOARD_PASS` und
committet sie als `data/data.json`. Der Browser entschlüsselt beim Aufruf; das
Passwort liegt im `localStorage`.

Veraltet ist konkret:

- Die ToDo-Kachel zieht von **JSONBin**. Die ToDo-App ist seit dem 20.07.2026
  auf D1 umgestellt, der Bin wird nicht mehr geschrieben.
- Der Link zeigt auf `hendrikwo2000.github.io/todo-app` statt auf
  `todo.it-wolf.org`.
- Der Schutz ist ein zweites Passwort neben dem echten Login der anderen
  beiden Apps.
- Der Fokus-Tracker (seit 07.08.2026 live) taucht gar nicht auf.

## Ziel

Ein Überblick über den Tag, geschützt durch dieselbe Anmeldung wie ToDo und
Fokus, in derselben Optik, auf `schule.it-wolf.org`.

## 1. Anmeldung

Kein Anmeldeformular im Dashboard. Beim Aufruf fragt die Seite
`GET /api/dashboard`:

| Antwort | Was passiert |
|---|---|
| 200 | Dashboard rendert |
| 401 (keine Sitzung) | Weiterleitung auf `todo.it-wolf.org/?weiter=<eigene URL>` |
| 403 (Sitzung, kein Zugang) | Sperrseite mit Erklärung |

Das trägt, weil das Sitzungscookie `todo_session` seit dem 07.08.2026 auf
`Domain=.it-wolf.org` gesetzt ist und alle drei Pages-Projekte dieselbe
D1-Datenbank `todo` als `DB` binden. Wer bei ToDo angemeldet ist, ist es hier
auch — und umgekehrt.

**Warum keine eigene Anmeldemaske:** Sie hätte den Login-Code an einen dritten
Ort gelegt (Mailversand, Code-Eingabe, Warten-auf-Link-Abfrage) und
`RESEND_KEY` auf einem weiteren Projekt gebraucht. Die Weiterleitung erfüllt
„alles über ein Login" wörtlicher und ist deutlich weniger Code.

**Nebenwirkung:** Abmelden im Dashboard meldet aus allen drei Apps ab. Es ist
eine Sitzung, kein drittes Konto. Der Abmelden-Knopf sagt das dazu, wie in
Fokus.

### Zugang

Neue Spalte `users.dashboard_zugang` (0/1), unabhängig von `role`,
`todo_zugang` und `fokus_zugang`. Nur `hendrik.wolf.004@gmail.com` bekommt die
1.

**Anders als bei ToDo und Fokus gibt es keine Selbstbedienung.** Dort setzt ein
Login-Versuch die fehlende Spalte still mit; hier nicht. Ein fremder
angemeldeter Nutzer sieht die Sperrseite und bleibt draußen.

Der Umweg über eine Spalte statt einer fest verdrahteten E-Mail-Adresse im
Code kostet nichts und hält alle drei Berechtigungen an einem Ort — später
jemanden dazuzunehmen ist ein `UPDATE`, kein Deploy.

## 2. Der Datenweg

Heute committet die Action die Daten ins Repo. Gemessen: **278 Commits
zwischen dem 16.07. und dem 12.08.2026**, also rund 10 am Tag oder 310 im
Monat.

Auf Cloudflare Pages ist jeder Commit ein Deploy, und der Free Plan erlaubt
500 Builds im Monat. 310 davon nur für Daten wäre der falsche Weg — nicht,
weil es sofort bricht, sondern weil es 60 % des Kontingents für etwas
verbraucht, das gar kein Deploy sein muss, und jede echte Code-Änderung in
Deploy-Lärm untergehen lässt.

**Neu:** Die Action schickt die Daten per `POST /api/daten` an das Dashboard.
Absicherung ist ein geteiltes Geheimnis im Header (`X-Dashboard-Token`),
dasselbe Muster wie beim Anping-Endpunkt `/api/push/pruefen` im
Fokus-Tracker — kein Nutzer-Endpunkt, deshalb keine Sitzung.

Der Endpunkt legt den JSON-Block in einer Zeile der D1 ab:

```sql
CREATE TABLE IF NOT EXISTS dashboard_daten (
  schluessel     TEXT PRIMARY KEY,   -- derzeit immer 'aktuell'
  json           TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
```

Die Browser-Verschlüsselung und `DASHBOARD_PASS` fallen ersatzlos weg. Der
Schutz sitzt am Login, genau wie beim D1-Umstieg der ToDo-Liste: Was nur der
Server herausgibt, muss der Browser nicht verstecken.

**Fehlerfall:** Schlägt der POST fehl, versucht das Script es dreimal mit
wachsender Pause und bricht dann mit Exit-Code ungleich 0 ab — der
Action-Lauf wird rot, statt still nichts zu tun. Die alten Daten bleiben in
der D1 stehen, und das Dashboard warnt von selbst über ihr Alter (siehe
Stand-Warnung unten).

## 3. Kacheln

| Kachel | Quelle | Anmerkung |
|---|---|---|
| 🕗 Stundenplan | Action → D1 | Heute/Woche, Entfall und Vertretung wie bisher |
| 📝 Offene Aufgaben | Action → D1 | IServ, nach Frist sortiert |
| 📆 Termine | Action → D1 | Heute/7 Tage, Dauerläufer als Leiste |
| ✅ ToDos | D1 direkt | ersetzt JSONBin |
| 🔥 Fokus heute | D1 direkt | neu |

Alles **nur zum Lesen**. Der Kachelkopf verlinkt in die jeweilige App, auf dem
Handy zuerst in deren installierte App (die bestehende `intent:`-/
URL-Schema-Logik bleibt).

### ToDo-Kachel

Liest offene ToDos direkt aus der geteilten Datenbank, gefiltert auf die
Bereiche aus `CONFIG.todoCategories` (heute „Schule" und „Facharbeit").
Datenmodell beachten: seit dem 21.07.2026 gilt Liste (`boards`) → Bereich
(`lists`) → [Über-Thema] → ToDo, und sichtbar ist eine Liste über
`board_members`. Die Abfrage geht deshalb über `board_members`, nicht über
eine `user_id` an `lists`.

### Fokus-Kachel

Zeigt die heute fälligen Gewohnheiten mit erledigt/offen. Die Regel „was ist
heute überhaupt dran" (täglich / feste Wochentage / X Mal die Woche,
Obergrenzen ruhen ohne Eintrag) ist knifflig, existiert aber fertig
serverseitig in `Fokus/web/functions/api/push/pruefen.js` und
`Fokus/web/functions/_lib/tag.js`.

**Diese Dateien werden gespiegelt, nicht neu erfunden** — dasselbe bewusste
Duplikat wie `session.js` zwischen ToDo und Fokus. Der Kommentarkopf sagt, wo
das Original liegt und dass Änderungen dort mitgezogen werden müssen.

## 4. Optik

`index.html` und `style.css` neu auf Basis der Fokus-Vorlage:

- dieselben Farbvariablen (`--bg`, `--row`, `--accent`, `--muted` …) inklusive
  Dunkelmodus,
- `.topbar` mit Titel und `⚙️` statt der bisherigen Kopfzeile,
- Einstellungen als Popup mit Konto (Name/E-Mail), Dunkelmodus und Abmelden —
  Dunkelmodus wandert damit vom Kopfzeilen-Knopf in die Einstellungen, wie in
  beiden anderen Apps,
- Karten, Knöpfe und Leerzustände aus dem gemeinsamen Baukasten.

Erhalten bleibt die Begrüßung nach Tageszeit, die Stand-Warnung („Die Daten
sind X Stunden alt") und die Hervorhebung dringender Karten (`markUrgent`,
roter Rand, sobald ein roter Punkt in der Karte steckt).

**Ausgebaut:** Vorlesen samt Stimmenauswahl, das `🔒`-Overlay und der
gesamte Krypto-Code.

Zweispaltig ab 900 px, darunter einspaltig. Geprüft wird bei 360, 768 und
1280 px.

## 5. Struktur

Der deploybare Teil zieht nach `web/`, wie bei ToDo und Fokus. Damit liegen
`scripts/` und `.github/` außerhalb des Ausgabeverzeichnisses und werden nicht
mitgeliefert.

```
Dashboard/
  web/                     <- Cloudflare-Ausgabeverzeichnis
    index.html  style.css  app.js
    manifest.json  icon-*.png  robots.txt
    schema-dashboard.sql  migration-dashboard.sql
    functions/
      _lib/     session.js  antwort.js  tag.js  zugang.js
      api/      dashboard.js  daten.js  logout.js
  scripts/fetch_data.py
  .github/workflows/update.yml
  docs/superpowers/specs/
```

Gelöscht: `data/data.json`, `favicon.ico`, `icon.svg`,
`apple-touch-icon.png`, `site.webmanifest` (durch `manifest.json` und die
Icons im Fokus-Format ersetzt).

## 6. Änderung an der ToDo-App

`ToDo/web/app.js` bekommt Unterstützung für `?weiter=<url>`:

1. Beim Laden `weiter` aus der Adresse in `sessionStorage` legen und aus der
   URL entfernen.
2. Sobald die App angemeldet ist (der bestehende Pfad nach erfolgreichem
   Login und die Status-Abfrage, die schon alle 3 s läuft), dorthin springen.

**Reine Frontend-Änderung.** Die Anmeldekette selbst (`request-code`,
`verify-code`, `link.js`) wird nicht angefasst — das hält das Risiko für die
laufende App klein.

**Offene Weiterleitung verhindern:** Akzeptiert werden nur `https:`-Ziele,
deren Hostname `it-wolf.org` ist oder auf `.it-wolf.org` endet. Alles andere
wird verworfen, ohne Fehlermeldung.

## 7. Testen

Neuer Eintrag `schule` in der gemeinsamen `.claude/launch.json` (Port 8795,
`--d1 DB=todo`, eigenes `cwd`).

Bekannte Fallen aus den Memory-Notizen, die hier gelten:

- Lokale D1 per Python-`sqlite3` befüllen, nicht per
  `wrangler d1 execute --local` (stürzt auf Windows ab). Server vorher
  stoppen.
- Cookies ignorieren den Port: läuft ToDo auf 8790 gleichzeitig, überschreiben
  sich die `todo_session`-Cookies auf `localhost` gegenseitig. Entweder nur
  einen Server laufen lassen oder in beiden lokalen DBs denselben Token
  anlegen.
- `resize_window` immer mit ausdrücklichen `width`/`height`, sonst ist
  `innerWidth` 0 und jede Breitenmessung Unsinn. Danach von Hand ein
  `resize`-Event feuern.
- Screenshots gehen in der ausgeblendeten Ansicht nicht — Layout wird über
  `getComputedStyle` gemessen, nicht angesehen. Das steht so auch im Bericht
  am Ende.

## 8. Was Hendrik selbst tun muss

1. Cloudflare-Pages-Projekt anlegen, Repo `schul-dashboard` verbinden,
   Framework „Keine", Build-Befehl leer, **Ausgabeverzeichnis `web`**.
2. D1-Datenbank `todo` als `DB` binden.
3. Eigene Domain `schule.it-wolf.org` zuordnen.
4. `DASHBOARD_TOKEN` als Secret auf dem Pages-Projekt **und** als
   GitHub-Actions-Secret setzen (gleicher Wert).
5. Die Migration in der D1-Konsole ausführen (SQL liegt bei).
6. GitHub Pages für das Repo abschalten.

Die Migration ist rein additiv (`ALTER TABLE ADD COLUMN`, `CREATE TABLE IF NOT
EXISTS`), also nicht der Fall, bei dem im Juli über einen Tabellen-Neuaufbau
alle ToDos weggecascadet sind.

## Bewusst nicht gebaut

- **Abhaken im Dashboard.** Es bleibt ein Überblick; zum Ändern führt der
  Kachelkopf in die jeweilige App. Sonst läge die Schreib-Logik an zwei Orten.
- **Warteliste und Admin-Oberfläche.** Das Dashboard ist für eine Person.
- **Push-Benachrichtigungen.** Die hat der Fokus-Tracker, hier gäbe es
  dieselbe Meldung ein zweites Mal.
