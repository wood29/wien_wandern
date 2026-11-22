# Wiener Wanderwege – Pilot

Web-App für Wanderwege, Heurige und besondere Plätze in Wien.
Pilotgebiet: Gallitzinberg und Wilhelminenberg (Jubiläumswarte, Steinhofgründe).

- `index.html`, `styles.css`, `app.js` – die App (Mapbox GL JS, kein Build-Schritt)
- `data/curated.json` – von Hand gepflegte Wege und Orte, mit Quelle und Prüfdatum
- `data/trails.geojson`, `data/poi.geojson` – Wege und Orte aus OpenStreetMap,
  erzeugt von `scripts/fetch-data.mjs` über die GitHub Action „Kartendaten aktualisieren“

Kartendaten © OpenStreetMap-Mitwirkende (ODbL). Karte © Mapbox.
