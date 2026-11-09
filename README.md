# Signalen achter de voordeur – testprototype versie 3

Testprototype van een digitaal meldformulier uit een afstudeeronderzoek bij Eigen Haard.
**Geen officieel meldsysteem.** Gebruik alleen fictieve gegevens.

## Wat het doet
- Formulier in vier talen (NL, EN, TR, PL), zoals in het onderzoek beschreven.
- Testinzendingen worden tijdelijk bewaard, zodat de onderzoeker kan zien hoe het formulier werkt.
- Beheeromgeving op `/beheer` (alleen met wachtwoord): overzicht, inzending openen, verwijderen.
- Testinzendingen worden na de bewaartermijn automatisch verwijderd (standaard 30 dagen).
- Bezoeken worden geteld met alleen datum, tijd en soort apparaat. Geen IP-adressen.

## Instellingen in Railway (Variables)
- `ADMIN_WACHTWOORD` (verplicht voor de beheeromgeving)
- `BEWAARTERMIJN_DAGEN` (optioneel, standaard 30)

Voor opslag die een nieuwe deploy overleeft: koppel een **Volume** aan de service (bijv. mount path `/data`).
Railway geeft dan zelf `RAILWAY_VOLUME_MOUNT_PATH` door. Zonder volume staan gegevens in `./data` en verdwijnen ze bij een nieuwe deploy.

Lokaal starten: `ADMIN_WACHTWOORD=test npm start` en open http://localhost:3000
