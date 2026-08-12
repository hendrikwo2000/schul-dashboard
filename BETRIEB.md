# Betrieb

Technische Doku zum Schul-Dashboard (`schule.it-wolf.org`). Für die Bedienung
siehe [README.md](README.md).

Eigenes Cloudflare-Pages-Projekt, kein Build-Schritt, Vanilla JS. Der
deploybare Teil liegt in `web/`, genau wie bei ToDo und Fokus. Geteilt werden
mit den beiden nur zwei Dinge: die Anmeldung und die Datenbank.

## Geteilter Login

Wer bei `todo.it-wolf.org` angemeldet ist, ist es hier auch. Das hängt an zwei
Dingen, und beide müssen stimmen:

1. **Das Cookie heißt in allen drei Apps `todo_session`** und ist auf
   `Domain=.it-wolf.org` gesetzt (nicht host-only auf einer Subdomain).
2. **Alle drei Pages-Projekte binden dieselbe D1-Datenbank `todo` als `DB`.**
   Ein Cookie allein reicht nicht — der Token wird bei jeder Anfrage in
   `sessions` nachgeschlagen.

Die Domain wird **nur auf it-wolf.org-Hosts** gesetzt (`domainFlag` in
`web/functions/_lib/session.js`). Auf `127.0.0.1` und den
`*.pages.dev`-Adressen würde der Browser ein fremdes Domain-Attribut still
verwerfen — das Cookie käme gar nicht erst an, und die Anmeldung bräche ohne
sichtbaren Fehler.

`web/functions/_lib/session.js` ist eine **Spiegelung** der Datei aus der
ToDo-Liste. Ändert sich dort die Cookie-Mechanik, muss sie hier und im
Fokus-Tracker mitgezogen werden. Es gibt bewusst keinen gemeinsamen Ort dafür:
drei Repos, drei Deployments.

**Abmelden meldet aus allen drei Apps ab.** Es ist eine Sitzung, kein drittes
Konto. Die App fragt vorher nach und sagt das dazu.

### Kein eigenes Anmeldeformular

Anders als ToDo und Fokus hat das Dashboard **keine Anmeldemaske**. Wer nicht
angemeldet ist, wird auf `todo.it-wolf.org/?weiter=<eigene Adresse>`
geschickt und kommt nach der Anmeldung von selbst zurück.

Der Grund ist Sparsamkeit, nicht Faulheit: eine eigene Maske hätte den
Login-Code (Mailversand, Code-Eingabe, Warten-auf-Link-Abfrage) an einen
dritten Ort gelegt und `RESEND_KEY` auf einem weiteren Pages-Projekt
gebraucht.

**Die Gegenstelle sitzt in `ToDo/web/app.js`** (`merkeWeiter` /
`evtlWeiterleiten`, direkt über `init()`). Der Parameter wandert sofort in den
`sessionStorage` und aus der Adresszeile — sonst würde ein Neuladen die
Weiterleitung wiederholen, und der Anmeldelink aus der Mail landet ohnehin
ohne Parameter auf `/`. Akzeptiert werden **nur `https:`-Ziele auf
it-wolf.org**; ohne diese Prüfung wäre das eine offene Weiterleitung.

Zwei Fälle, in denen das Dashboard **nicht** von selbst springt (siehe
`zurAnmeldung()` in `web/app.js`): auf `127.0.0.1` (dort gilt das Cookie
ohnehin nicht für die Domain) und beim zweiten Versuch in derselben Sitzung
(ein Merker im `sessionStorage` bricht eine Schleife ab). In beiden Fällen
kommt ein Bildschirm mit Knopf statt eines Sprungs.

## Zugang

Angemeldet zu sein reicht nicht. Wer das Dashboard sehen darf, steht in der
geteilten `users`-Tabelle: Spalte **`users.dashboard_zugang`** (0/1),
unabhängig von `role`, `todo_zugang` und `fokus_zugang`.

**Unterschied zu ToDo und Fokus, leicht falsch zu erinnern:** Dort holt sich
jeder Nutzer die jeweils andere App selbst — ein Login-Versuch setzt die
fehlende Spalte still mit. **Hier nicht.** Es gibt keine Selbstbedienung,
keinen Knopf und keine Warteliste. Die Spalte wird von Hand in der D1-Konsole
gesetzt. Wer das ändert, öffnet das Dashboard für jeden, der ein ToDo-Konto
hat.

Geprüft wird in `web/functions/_lib/zugang.js` (`nutzerOderFehler`), und zwar
in **jedem** Daten-Endpunkt, nicht nur beim Seitenaufruf — sonst käme jemand
mit gültiger ToDo-Sitzung per curl direkt an die API.

Antworten: **401** = nicht angemeldet (die Oberfläche schickt zur Anmeldung),
**403** = angemeldet, aber gesperrt (Sperrseite). Ein 403 darf hier nie zu
einem 401 werden, sonst liefe die Anmeldung im Kreis.

## Der Datenweg

Bis zum 12.08.2026 committete die GitHub-Action die Daten alle 15 Minuten als
verschlüsselte `data/data.json` ins Repo, und die Seite entschlüsselte sie im
Browser mit `DASHBOARD_PASS`.

**Das geht auf Cloudflare Pages nicht mehr:** jeder Commit ist dort ein
Deploy. Gemessen waren es 278 Commits zwischen dem 16.07. und 12.08.2026, also
rund 310 im Monat — bei 500 erlaubten Builds. Es hätte also nicht sofort
gebrochen, aber 60 % des Kontingents für etwas verbraucht, das gar kein Deploy
sein muss, und jede echte Code-Änderung im Deploy-Lärm versenkt.

Neu geht der Weg über **`POST /api/daten`**, abgesichert mit einem geteilten
Geheimnis im Header (`X-Dashboard-Token`) — dasselbe Muster wie
`api/push/pruefen.js` im Fokus-Tracker, kein Nutzer-Endpunkt, keine Sitzung.
Der Endpunkt legt den Block in einer Zeile von `dashboard_daten` ab.

Die Verschlüsselung ist damit ersatzlos weg. Der Schutz sitzt am Login, genau
wie beim D1-Umstieg der ToDo-Liste: was nur der Server herausgibt, muss der
Browser nicht verstecken.

**`aktualisiert_am` setzt der Server** (`datetime('now')`), nicht der Absender.
Eine falsch gehende Uhr im Action-Runner würde sonst die Stand-Warnung
aushebeln.

**Schutz gegen einen leeren Überschreiber:** Hat keine einzige Quelle
geliefert (Netzausfall im Runner), sendet `scripts/fetch_data.py` gar nicht
erst und beendet sich mit Fehler — der Action-Lauf wird rot. Sonst ersetzte
ein Aussetzer einen brauchbaren Stand durch drei Fehlermeldungen, und im
Dashboard sähe das aus, als wäre heute wirklich nichts los. Der alte Stand
bleibt stehen und altert sichtbar; ab drei Stunden warnt die Seite von selbst
(nur zwischen 7 und 22 Uhr — nachts läuft die Action planmäßig nicht).

Bei einem Teilausfall (nur IServ down) wird dagegen gesendet: die betroffene
Kachel zeigt dann die Fehlermeldung der Quelle, die anderen bleiben aktuell.

## Kacheln

| Kachel | Quelle |
|---|---|
| 🕗 Stundenplan | `dashboard_daten` (WebUntis über die Action) |
| 📝 Aufgaben | `dashboard_daten` (IServ) |
| 📆 Termine | `dashboard_daten` (iCal) |
| ✅ ToDos | live aus `todos`/`lists`/`boards` |
| 🔥 Fokus heute | live aus `gewohnheiten`/`gewohnheit_logs` |

Alles in **einer** Antwort von `GET /api/dashboard`. Drei Anfragen wären drei
Sitzungsprüfungen und drei Chancen, dass eine Kachel ohne erkennbaren Grund
leer bleibt. Jede Quelle ist einzeln abgesichert: fällt eine aus, bleibt der
Rest stehen.

**ToDos** kommen über `board_members`, nicht über eine `user_id` an `lists` —
seit den geteilten Listen (21.07.2026) hängen Bereiche an einem Board, und wer
ein Board sehen darf, steht ausschließlich in `board_members`. Gefiltert wird
auf die Bereichsnamen aus `TODO_BEREICHE` (Umgebungsvariable, Komma-getrennt;
ohne sie „Schule, Facharbeit"). Ist die Kachel leer, nennt sie die gesuchten
Bereiche — eine leere Kachel kann auch heißen, dass ein Bereich umbenannt
wurde.

Höchstens 40 ToDos; wird der Deckel erreicht, sagt die Kachel das („… weitere
in der ToDo-Liste"). Eine stille Kürzung sähe aus wie „mehr ist da nicht".

**Gewohnheiten:** `web/functions/_lib/tag.js` ist eine **Spiegelung** der
Regeln aus `Fokus/web/functions/_lib/tag.js` und
`Fokus/web/functions/api/push/pruefen.js`. Ändert sich dort die Bedeutung
eines Rhythmus, muss sie hier mitgezogen werden — sonst zeigt das Dashboard
einen anderen Tagesstand als der Fokus-Tracker selbst, und das fällt niemandem
auf, weil beide für sich plausibel aussehen. Die Straehnen-Funktionen sind
bewusst **nicht** mitgespiegelt (keine Flamme auf dem Dashboard), ebenso
nichts zum Schreiben von Tagen.

`heutigerStand()` gibt `null` zurück, wenn heute nichts ansteht — nicht
geplanter Wochentag, erfülltes Wochenziel oder eine ruhende Obergrenze. Die
Gewohnheit fällt dann aus der Kachel, statt als „erledigt" durchzugehen: sie
ist ja nichts, was heute jemand geschafft hätte.

## Einrichtung (einmalig)

1. Cloudflare-Pages-Projekt anlegen, Repo `hendrikwo2000/schul-dashboard`
   verbinden. Framework **„Keine"**, Build-Befehl **leer**,
   Ausgabeverzeichnis **`web`**.
2. D1-Datenbank **`todo`** als **`DB`** binden.
3. Eigene Domain **`schule.it-wolf.org`** zuordnen.
4. `DASHBOARD_TOKEN` als **Secret** auf dem Pages-Projekt setzen und
   **denselben Wert** als GitHub-Actions-Secret im Repo.
5. `web/migration-dashboard.sql` in der D1-Konsole ausführen.
6. GitHub Pages für das Repo abschalten (die alte Adresse zeigt sonst weiter
   auf eine Seite, die es nicht mehr gibt).

Optional als Umgebungsvariablen: `TODO_BEREICHE` (Pages) und `DASHBOARD_URL`
(GitHub-Repository-Variable, falls die Adresse je wechselt).

**Falle:** Neue Umgebungsvariablen auf einem Pages-Projekt greifen erst nach
einem **frischen Deploy** — ein leerer Commit reicht.

## Lokal testen

Eintrag `schule` in der gemeinsamen `.claude/launch.json` (Port 8795,
`--d1 DB=todo`, `DASHBOARD_TOKEN=test-token-lokal`):

```
npx wrangler pages dev . --d1 DB=todo --binding DASHBOARD_TOKEN=test-token-lokal --port 8795 --ip 127.0.0.1
```

Die lokale D1 braucht das Schema aus **drei** Dateien: `ToDo/web/schema.sql`
(Login und Listen), `Fokus/web/schema-fokus.sql` (Gewohnheiten) und
`web/migration-dashboard.sql`.

Angemeldet reinkommen ohne Mailversand: Token wählen, dessen SHA-256 als
`sessions.token_hash` eintragen, dann im Browser
`document.cookie = "todo_session=<token>; path=/; max-age=86400"`.

**Fallen, die sonst je eine halbe Stunde kosten:**

- **`wrangler d1 execute --local` stürzt auf Windows ab** (libuv-Assertion).
  Schema stattdessen per Python-`sqlite3` direkt in die SQLite unter
  `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite` einspielen,
  bei **gestopptem** Server.
- **Der Dateiname hängt am D1-Namen.** `--d1 DB=todo` benutzt
  `ab42fd77…​.sqlite`; jeder andere Name legt kommentarlos eine LEERE Datenbank
  unter neuem Hash an. Der Fehler taucht erst tief im Worker als „no such
  table" auf.
- **Cookies ignorieren den Port.** Laufen ToDo (8790) und dieses Projekt
  (8795) gleichzeitig, schreiben beide `todo_session` auf `localhost` und
  überschreiben sich gegenseitig — die lokalen Datenbanken sind aber getrennt,
  man fliegt also scheinbar grundlos raus.
- **`resize_window` nur mit `preset`** lässt `window.innerWidth` auf 0 stehen,
  und jede breitenabhängige Messung wird Unsinn. Immer `width`/`height`
  mitgeben und danach von Hand ein `resize`-Event feuern.
- **Die ausgeblendete Browser-Ansicht rendert keine Frames.** Screenshots
  scheitern, `requestAnimationFrame` feuert nie, und laufende CSS-Transitions
  bleiben auf ihrem Startwert stehen. Vor jeder Messung
  `*{transition:none !important}` einhängen.

## Layout

Zwei feste Spalten ab 900 px — **kein** Karten-Gitter. Ein Gitter richtet jede
Zeile an der höchsten Kachel aus und reißt darunter Löcher; gemessen waren das
98 und 136 px, weil Termine kurz und ToDos lang sind. Die Aufteilung ist die
aus dem alten Dashboard (links Schule, rechts der eigene Kram), der neue
Fokus-Überblick hängt links an, weil diese Spalte kürzer war.

Auf schmalen Bildschirmen lösen sich die Spalten per `display: contents` auf;
die `order`-Werte auf den Kacheln legen dann die Reihenfolge fest
(Stundenplan, Termine, Aufgaben, ToDos, Fokus). Ohne das stünden auf dem Handy
erst alle drei Kacheln der linken Spalte und die Termine ganz unten.

**Die hidden-Falle aus ToDo und Fokus gilt hier genauso:** jede eigene
`display`-Regel schlägt das eingebaute `[hidden]` des Browsers. Neue Elemente,
die per `hidden` versteckt werden sollen, brauchen ihre eigene
`[hidden] { display: none }`-Zeile.

## Ausgebaut

- **Vorlesen** (Sprachausgabe des Tagesüberblicks samt Stimmenauswahl) — auf
  Hendriks ausdrückliche Entscheidung beim Umbau. Der Code steht in der
  Historie vor dem Commit „Dashboard laeuft ueber den gemeinsamen Login".
- **Die Browser-Entschlüsselung** samt `DASHBOARD_PASS` und dem
  `🔒`-Overlay — ersetzt durch die Anmeldung.
- **`data/data.json`** — die Daten stehen in der Datenbank.

## Bewusst nicht gebaut

- **Abhaken im Dashboard.** Es bleibt ein Überblick; zum Ändern führt der
  Kachelkopf in die jeweilige App. Sonst läge die Schreib-Logik an zwei Orten.
- **Warteliste und Admin-Oberfläche.** Das Dashboard ist für eine Person.
- **Push-Benachrichtigungen.** Die hat der Fokus-Tracker; hier gäbe es
  dieselbe Meldung ein zweites Mal.
