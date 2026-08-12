-- Schul-Dashboard: eigene Tabellen in der GETEILTEN Datenbank `todo`.
--
-- Warum dieselbe Datenbank wie ToDo und Fokus: das Dashboard hat keine eigene
-- Anmeldung. Es liest die Sitzung aus `sessions` und den Nutzer aus `users` -
-- ohne die gemeinsame Datenbank waere das Sitzungscookie hier wertlos. Siehe
-- BETRIEB.md, Abschnitt "Geteilter Login".
--
-- Diese Datei ist fuer eine FRISCHE Datenbank. Gegen die laufende Live-DB
-- gehoert stattdessen migration-dashboard.sql - CREATE TABLE IF NOT EXISTS
-- ruehrt eine bestehende Tabelle nicht an, aber die Spalte in `users` braucht
-- ein ALTER TABLE.
--
-- Nur additiv, nie DROP. Es ist die einzige produktive Datenbank fuer alle
-- drei Apps.

-- Der Datenblock der GitHub-Action: Stundenplan, Aufgaben und Termine in einem
-- Stueck, so wie das Abrufskript sie zusammenstellt.
--
-- Warum eine einzige Zeile statt normalisierter Tabellen: der Inhalt wird nie
-- einzeln abgefragt, sortiert oder geschrieben - er wird als Ganzes ersetzt und
-- als Ganzes gelesen. Spalten dafuer anzulegen hiesse, das Format der drei
-- Quellen (WebUntis, IServ, iCal) in zwei Sprachen zu pflegen, ohne dass
-- irgendwo eine Abfrage davon profitiert.
--
-- `schluessel` ist derzeit immer 'aktuell'. Der Primaerschluessel steht da, um
-- spaeter eine zweite Quelle danebenlegen zu koennen, ohne die Tabelle
-- umzubauen.
CREATE TABLE IF NOT EXISTS dashboard_daten (
  schluessel      TEXT PRIMARY KEY,
  json            TEXT NOT NULL,
  -- UTC, 'YYYY-MM-DD HH:MM:SS'. Der Zeitpunkt, an dem die Action geliefert
  -- hat - nicht der, an dem die Quellen selbst zuletzt aktuell waren. Das
  -- Dashboard warnt daraus, wenn die Aktualisierung offenbar haengt.
  aktualisiert_am TEXT NOT NULL
);

-- Zugang. Die Spalte gehoert zu `users` und liegt deshalb hier nur als
-- Kommentar: bei einer frischen Datenbank legt ToDo/web/schema.sql die Tabelle
-- an, und diese Datei laeuft danach. Das ALTER TABLE steht in
-- migration-dashboard.sql und gilt fuer beide Faelle.
--
--   ALTER TABLE users ADD COLUMN dashboard_zugang INTEGER NOT NULL DEFAULT 0;
