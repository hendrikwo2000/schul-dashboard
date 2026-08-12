-- Migration fuer das neue Schul-Dashboard (12.08.2026).
--
-- Gegen die LIVE-Datenbank `todo` auszufuehren, in der D1-Konsole im
-- Cloudflare-Dashboard. Danach ist die App benutzbar.
--
-- REIN ADDITIV: nur ADD COLUMN und CREATE TABLE IF NOT EXISTS, kein DROP und
-- kein Tabellen-Neuaufbau. Das ist ausdruecklich NICHT der Fall, bei dem am
-- 21.07.2026 ein DROP TABLE lists ueber ON DELETE CASCADE alle ToDos
-- mitgerissen hat. Bestehende Zeilen werden hier nicht angefasst.
--
-- Die Reihenfolge ist egal, und ein zweiter Lauf schadet nicht - ausser bei
-- Schritt 1: ADD COLUMN kennt kein "IF NOT EXISTS" und meldet beim zweiten Mal
-- "duplicate column name: dashboard_zugang". Diese Fehlermeldung ist harmlos,
-- sie heisst nur "war schon da".


-- 1. Wer darf das Dashboard benutzen?
--
-- Eigene Spalte neben todo_zugang und fokus_zugang, unabhaengig von beiden und
-- von `role`. DEFAULT 0: eine bestehende Anmeldung bei ToDo oder Fokus oeffnet
-- das Dashboard NICHT automatisch.
--
-- Anders als bei den beiden anderen Apps gibt es hier keine Selbstbedienung -
-- kein Login-Versuch setzt die Spalte still mit. Das Dashboard ist fuer eine
-- Person, siehe functions/_lib/zugang.js.
ALTER TABLE users ADD COLUMN dashboard_zugang INTEGER NOT NULL DEFAULT 0;


-- 2. Ablage fuer den Datenblock der GitHub-Action.
CREATE TABLE IF NOT EXISTS dashboard_daten (
  schluessel      TEXT PRIMARY KEY,
  json            TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);


-- 3. Den eigenen Zugang freischalten.
--
-- Ohne diese Zeile sperrt die App auch Hendrik aus - DEFAULT 0 gilt fuer jede
-- bestehende Zeile in `users`, seine eingeschlossen.
UPDATE users SET dashboard_zugang = 1 WHERE email = 'hendrik.wolf.004@gmail.com';


-- Gegenprobe (sollte genau eine Zeile mit 1 liefern):
--   SELECT email, todo_zugang, fokus_zugang, dashboard_zugang FROM users;
