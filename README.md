# Schul-Dashboard

Persönliches Dashboard auf **schule.it-wolf.org**: Stundenplan, Termine,
IServ-Aufgaben, offene ToDos und die heutigen Gewohnheiten auf einer Seite.

Angemeldet wird über **todo.it-wolf.org** — dieselbe Anmeldung wie bei der
ToDo-Liste und dem Fokus-Tracker. Wer dort eingeloggt ist, ist es hier auch;
wer sich hier abmeldet, ist überall abgemeldet.

Alles nur zum Lesen. Zum Ändern führt jeder Kachelkopf in die passende App.

Eine GitHub-Action holt Stundenplan, Aufgaben und Termine viertelstündlich und
schickt sie an `/api/daten`; das Dashboard gibt sie nur an angemeldete Konten
heraus.

Privates Hobbyprojekt — nicht zur Nachnutzung gedacht.

<!-- Technisches steht in BETRIEB.md: Aufbau, Datenweg, Einrichtung,
     lokales Testen und die Fallen. Zugangsdaten und Ablauf des Abrufs im
     Docstring von scripts/fetch_data.py. -->
