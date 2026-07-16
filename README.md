# Schul-Dashboard

Persönliches Dashboard: Stundenplan, Termine und offene Aufgaben auf einer
Seite, plus Vorlese-Funktion.

Eine GitHub-Action holt die Daten regelmäßig ab und legt sie verschlüsselt in
`data/data.json`; die Seite entschlüsselt sie im Browser. Zugangsdaten liegen
ausschließlich in den GitHub-Secrets.

Privates Hobbyprojekt — nicht zur Nachnutzung gedacht.

<!-- Details stehen dort, wo sie hingehören: Secrets und Ablauf im Docstring
     von scripts/fetch_data.py und in .github/workflows/update.yml, das
     Icon-Bauen in scripts/build_icons.py. -->
