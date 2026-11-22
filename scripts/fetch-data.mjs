// Holt Wege und Orte für das Pilotgebiet aus OpenStreetMap (Overpass API)
// und schreibt sie als statische Dateien nach data/. Läuft in GitHub Actions.
import { writeFileSync, mkdirSync } from 'node:fs';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const AREA = '48.195,16.235,48.235,16.32';

const TRAILS_QUERY = `[out:json][timeout:120];
relation["route"="hiking"]["name"~"Stadtwanderweg 4"](48.18,16.20,48.25,16.34);
out geom;`;

const POI_QUERY = `[out:json][timeout:120];
(
  nwr["name"~"Jubiläumswarte|Kreuzeichenwiese|Leitner|Herrmann|Schutzhaus|10er Marie|Schloss Wilhelminenberg|Kirche am Steinhof|Otto-Wagner-Kirche|Steinhofgründe|Feuerwache"](${AREA});
  nwr["natural"="water"](48.210,16.250,48.230,16.290);
  node["highway"="bus_stop"](48.210,16.265,48.222,16.290);
);
out center tags;`;

async function overpass(query) {
  let lastError;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'wien_wandern pilot (github.com/wood29/wien_wandern)' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`${url} antwortet mit ${res.status}`);
        return await res.json();
      } catch (err) {
        lastError = err;
        console.error(String(err));
        await new Promise((r) => setTimeout(r, 8000));
      }
    }
  }
  throw lastError;
}

function trailsToGeoJSON(osm) {
  const features = [];
  for (const rel of osm.elements || []) {
    if (rel.type !== 'relation') continue;
    const lines = [];
    for (const m of rel.members || []) {
      if (m.type === 'way' && Array.isArray(m.geometry) && m.geometry.length > 1) {
        lines.push(m.geometry.map((p) => [p.lon, p.lat]));
      }
    }
    if (!lines.length) continue;
    features.push({
      type: 'Feature',
      properties: { osmId: rel.id, name: rel.tags?.name || '', ref: rel.tags?.ref || '', operator: rel.tags?.operator || '' },
      geometry: { type: 'MultiLineString', coordinates: lines },
    });
  }
  return { type: 'FeatureCollection', features };
}

function poisToGeoJSON(osm) {
  const keep = ['name', 'amenity', 'tourism', 'natural', 'water', 'man_made', 'highway', 'leisure', 'landuse', 'website', 'opening_hours', 'cuisine', 'route_ref'];
  const features = [];
  for (const el of osm.elements || []) {
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lon == null || lat == null) continue;
    const properties = { osmType: el.type, osmId: el.id };
    for (const k of keep) if (el.tags?.[k]) properties[k] = el.tags[k];
    features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lon, lat] } });
  }
  return { type: 'FeatureCollection', features };
}

const trails = trailsToGeoJSON(await overpass(TRAILS_QUERY));
const pois = poisToGeoJSON(await overpass(POI_QUERY));
if (!trails.features.length && !pois.features.length) throw new Error('Keine Daten erhalten');

mkdirSync('data', { recursive: true });
writeFileSync('data/trails.geojson', JSON.stringify(trails));
writeFileSync('data/poi.geojson', JSON.stringify(pois));
writeFileSync('data/meta.json', JSON.stringify({ updated: new Date().toISOString(), trails: trails.features.length, pois: pois.features.length }, null, 2));
console.log(`Wege: ${trails.features.length}, Orte: ${pois.features.length}`);
