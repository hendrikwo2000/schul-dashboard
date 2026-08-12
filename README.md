# Schul-Dashboard

Persönliches Dashboard auf **schule.it-wolf.org**: Stundenplan, Termine,
IServ-Aufgaben, offene ToDos und die heutigen Gewohnheiten auf einer Seite.

Angemeldet wird über **todo.it-wolf.org** — dieselbe Anmeldung wie bei der
ToDo-Liste und dem Fokus-Tracker. Wer dort eingeloggt ist, ist es hier auch;
wer sich hier abmeldet, ist überall abgemeldet.

Alles nur zum Lesen. Zum Ändern führt jeder Kachelkopf in die passende App.
Welche Bereiche der ToDo-Liste erscheinen, steht in den Einstellungen.

Stundenplan und Aufgaben holt eine GitHub-Action viertelstündlich und schickt
sie an `/api/daten`; Termine, ToDos und Gewohnheiten liest das Dashboard live.
Der Google-Kalender wird in der ToDo-Liste verknüpft — hier wird nur gelesen.

Privates Hobbyprojekt — nicht zur Nachnutzung gedacht.

<!-- Technisches steht in BETRIEB.md: Aufbau, Datenweg, Einrichtung,
     lokales Testen und die Fallen. Zugangsdaten und Ablauf des Abrufs im
     Docstring von scripts/fetch_data.py. -->
