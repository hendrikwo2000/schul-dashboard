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
| 📆 Termine | live aus dem Google-Kalender |
| ✅ ToDos | live aus `todos`/`lists`/`boards` |
| 🔥 Fokus heute | live aus `gewohnheiten`/`gewohnheit_logs` |

Alles in **einer** Antwort von `GET /api/dashboard`. Mehrere Anfragen wären
mehrere Sitzungsprüfungen und mehrere Chancen, dass eine Kachel ohne
erkennbaren Grund leer bleibt. Jede Quelle ist einzeln abgesichert: fällt eine
aus, bleibt der Rest stehen.

**ToDos** kommen über `board_members`, nicht über eine `user_id` an `lists` —
seit den geteilten Listen (21.07.2026) hängen Bereiche an einem Board, und wer
ein Board sehen darf, steht ausschließlich in `board_members`.

**Gezeigt wird alles, was nicht ausdrücklich abgewählt wurde.** Bis zum
12.08.2026 filterte hier eine feste Namensliste aus der Umgebungsvariablen
`TODO_BEREICHE` („Schule, Facharbeit"). Das ging genau so lange gut, bis ein
Bereich umbenannt wurde: „Schule" gab es nicht mehr, und die Kachel verschwieg
vier von sieben ToDos, ohne dass irgendwo etwas kaputt aussah. Die Variable
ist ersatzlos weg, gefiltert wird in den Einstellungen.

Der Listenname steht nur vor dem Bereich, wenn es überhaupt mehrere Listen
gibt — bei einer einzigen wäre er in jeder Zeile dasselbe Wort.

Höchstens 40 ToDos; wird der Deckel erreicht, sagt die Kachel das („… weitere
in der ToDo-Liste"). Eine stille Kürzung sähe aus wie „mehr ist da nicht".
Ebenso nennt der Kachelkopf die Zahl der sichtbaren Bereiche, sobald gefiltert
wird — eine kurze Liste soll nicht wie „mehr ist nicht offen" aussehen.

## Google-Kalender

Die Termine kommen **live** aus dem Google-Kalender des verknüpften Kontos,
nicht mehr per iCal über die GitHub-Action.

**Verknüpft wird ausschließlich bei todo.it-wolf.org.** Das Dashboard hat
keinen eigenen OAuth-Weg: Es benutzt dieselbe Datenbank, findet das Konto also
in `google_konten` und erneuert das Zugriffstoken mit denselben Zugangsdaten.
Deshalb müssen `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` auch auf **diesem**
Pages-Projekt liegen — mit exakt denselben Werten wie bei `todo-app`.

Eine zweite Weiterleitungs-URI in der Google Cloud Console braucht es **nicht**:
die ist nur für den Zustimmungsdialog nötig, den es hier nicht gibt.

`web/functions/_lib/google.js` ist eine Spiegelung des Lese-Teils aus
`ToDo/web/functions/_lib/google.js`. **Ein Unterschied ist Absicht:** Meldet
Google „getrennt", räumt die ToDo-Liste die Zeile aus `google_konten` weg —
hier nicht. Das Dashboard darf die Verknüpfung der anderen App nicht wegen
eines eigenen Fehlers löschen; es meldet nur, dass gerade nichts zu holen ist.

Gezeigt wird **nur der Hauptkalender**, erkannt am `primary`-Schalter und
nicht am Namen — genau wie im ToDo-Kalender. Abonnierte Kalender (Feiertage,
Geburtstage, Kalenderwochen) würden die Kachel zupflastern.

Die Umformung in das Anzeigeformat steht in `web/functions/_lib/termine.js`
und hat zwei Fallen, die den Code länger machen, als er aussieht:

- **Zeitzone.** Google liefert Zeitpunkte mit Offset, der Worker läuft in UTC.
  Welcher Kalendertag das ist, hängt an Europe/Berlin — ein Termin um 0:30 Uhr
  gehörte sonst auf den Vortag. Jede Umrechnung geht über `Intl` mit fester
  Zeitzone.
- **Das Ende ganztägiger Termine ist exklusiv.** Ferien vom 12. bis 25. kommen
  von Google als start=12., ende=26.

Beides ist mit 24 Proben abgedeckt (Sommer-/Winterzeit, Mitternachtssprung,
mehrtägig, Ende vor Anfang) — der Testlauf liegt nicht im Repo, die Fälle
stehen in den Kommentaren der Datei.

## Einstellungen

Liegen **am Konto**, nicht am Gerät: als eigene Zeile in `dashboard_daten`
unter dem Schlüssel `einstellungen:<user_id>`. Das spart eine eigene Tabelle,
die Struktur passt genau. Der Schlüssel trägt die user_id, weil zwei Konten
freigeschaltet sind — ohne sie sähen beide dieselben Filter.

**Gespeichert wird, was VERSTECKT ist**, nicht was sichtbar ist. Der
Unterschied zeigt sich, sobald ein Bereich dazukommt: so taucht er von selbst
auf. Bei einer Liste des Sichtbaren bliebe er unsichtbar, bis jemand in die
Einstellungen sieht — und niemand vermutet ein neues ToDo dort.

Ausnahme ist das **Farbschema**: das bleibt im Browser-Speicher, weil es am
Gerät hängt (heller Bildschirm im Unterricht, dunkler abends) und nicht an der
Person.

**Falle, beim Testen gefunden:** Ein einfaches „läuft gerade schon" beim
Speichern verschluckte den zweiten von zwei schnellen Klicks — er wurde
übersprungen, und das Neuladen danach setzte das Kästchen wieder auf den alten
Stand. Zwei Bereiche hintereinander abzuwählen ist aber der Normalfall.
Jetzt sammelt eine Uhr die Klicks (400 ms) und liest beim Ablauf frisch aus
dem DOM, statt einen laufenden Vorgang zu blockieren.

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

## Einrichtung

Am 12.08.2026 erledigt, bis auf den DNS-Eintrag (siehe unten). Steht hier für
den Fall, dass das Projekt je neu aufgesetzt werden muss.

1. Pages-Projekt `schul-dashboard`, Repo `hendrikwo2000/schul-dashboard`,
   Produktionszweig `main`, kein Build-Befehl.
2. **Stammverzeichnis (`root_dir`) = `web`** — nicht das Ausgabeverzeichnis!
   Der Unterschied ist keine Wortklauberei: Pages sucht den `functions`-Ordner
   relativ zum Stammverzeichnis. Stünde `web` stattdessen als
   *Ausgabeverzeichnis* und das Stammverzeichnis bliebe leer, würden die
   statischen Dateien zwar ausgeliefert, aber `/api/*` liefe ins Leere.
   Bei `todo-app` und `fokus-app` steht `root_dir` auf leer, weil dort `web/`
   selbst das Repo-Root ist — hier liegt es eine Ebene tiefer.
3. D1-Datenbank **`todo`** als **`DB`** binden (Produktion und Vorschau).
4. `DASHBOARD_TOKEN` als **Secret** auf dem Pages-Projekt setzen und
   **denselben Wert** als GitHub-Actions-Secret im Repo. Ebenso
   `GOOGLE_CLIENT_ID` (Variable) und `GOOGLE_CLIENT_SECRET` (Secret) mit
   exakt den Werten aus dem `todo-app`-Projekt — ohne sie bleibt die
   Termin-Kachel bei „nicht eingerichtet".
5. `web/migration-dashboard.sql` gegen die Live-D1 laufen lassen.
6. Eigene Domain **`schule.it-wolf.org`** zuordnen — **und den CNAME
   anlegen.** Über das Dashboard macht Cloudflare das selbst; über die API
   **nicht**, dort bleibt die Domain auf `pending` stehen, bis der Eintrag
   von Hand kommt: `CNAME schule → schul-dashboard.pages.dev`, **Proxied**.
7. GitHub Pages für das Repo abschalten (die alte Adresse zeigt sonst weiter
   auf eine Seite, die es nicht mehr gibt).

Optional: `DASHBOARD_URL` als GitHub-Repository-Variable, falls die Adresse je
wechselt.

**Falle:** Neue Umgebungsvariablen auf einem Pages-Projekt greifen erst nach
einem **frischen Deploy** — ein leerer Commit reicht.

**Was per API/Wrangler geht und was nicht** (12.08.2026 durchgespielt):

- Ein Pages-Projekt **mit** Git-Anbindung lässt sich sehr wohl über die API
  anlegen (`POST /pages/projects` mit `source.type = "github"`), obwohl die
  Doku nahelegt, das ginge nur im Dashboard, und `wrangler pages project
  create` keine Git-Option hat. Es funktioniert, weil die GitHub-Installation
  durch die anderen Projekte schon mit dem Account verknüpft ist — Cloudflare
  löst `owner_id` und `repo_id` selbst auf.
- **DNS geht nicht.** Der OAuth-Zugang von Wrangler hat `zone (read)`, was
  für DNS-Einträge nicht reicht — weder lesend noch schreibend.

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
