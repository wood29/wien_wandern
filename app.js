/* Wiener Wanderwege – Pilot Gallitzinberg / Wilhelminenberg
   Karte: Mapbox GL JS. Wege und Orte: data/ (OpenStreetMap, per GitHub Action aktualisiert)
   plus data/curated.json (von Hand gepflegte Angaben mit Quelle). */
(function (root) {
  'use strict';

  // Der öffentliche Mapbox-Schlüssel steht in config.js oder wird einmalig in der App eingegeben.
  var TOKEN = (root.WW_CONFIG && root.WW_CONFIG.mapboxToken) || '';
  try { TOKEN = TOKEN || (root.localStorage && localStorage.getItem('ww-mapbox-token')) || ''; } catch (e) { /* ohne Speicher weiter */ }
  var CENTER = [16.2745, 48.2175];
  var DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var ICON = {
    wine: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3h8l-1 7a3 3 0 0 1-6 0zM12 13v7M8 20h8"/></svg>',
    eye: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    pin: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s-6-5.500-6-10a6 6 0 0 1 12 0c0 4.500-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>'
  };

  // ---------- reine Hilfsfunktionen ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function haversineKm(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function geometryLines(geom) {
    if (!geom) return [];
    return geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates : [];
  }
  function lineLengthKm(geom) {
    var km = 0;
    geometryLines(geom).forEach(function (line) {
      for (var i = 1; i < line.length; i++) km += haversineKm(line[i - 1], line[i]);
    });
    return km;
  }
  function bounds(geom) {
    var b = null;
    geometryLines(geom).forEach(function (line) {
      line.forEach(function (p) {
        if (!b) b = [[p[0], p[1]], [p[0], p[1]]];
        b[0][0] = Math.min(b[0][0], p[0]); b[0][1] = Math.min(b[0][1], p[1]);
        b[1][0] = Math.max(b[1][0], p[0]); b[1][1] = Math.max(b[1][1], p[1]);
      });
    });
    return b;
  }
  function fmtKm(km) { return 'ca. ' + km.toFixed(1).replace('.', ',') + ' km'; }
  function fmtDuration(min) {
    var m = Math.max(15, Math.round(min / 15) * 15);
    var h = Math.floor(m / 60), r = m % 60;
    return 'ca. ' + (h ? h + ':' + (r < 10 ? '0' + r : r) + ' Std.' : r + ' Min.');
  }
  function toMinutes(hhmm) { var p = hhmm.split(':'); return Number(p[0]) * 60 + Number(p[1]); }

  // Öffnungsstatus aus den gepflegten Zeiten (Schlüssel = Wochentag, 0 = Sonntag)
  function openStatus(place, now) {
    if (!place.hours) return null;
    var day = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    var today = place.hours[String(day)];
    if (today) {
      if (mins < toMinutes(today[0])) return { cls: 'later', text: 'Öffnet heute um ' + today[0] };
      if (!today[1]) return { cls: 'open', text: 'Heute geöffnet ab ' + today[0] };
      if (mins < toMinutes(today[1])) return { cls: 'open', text: 'Jetzt geöffnet bis ' + today[1] };
    }
    for (var i = 1; i <= 7; i++) {
      var d = (day + i) % 7, next = place.hours[String(d)];
      if (next) return { cls: 'closed', text: 'Heute geschlossen · wieder ' + (i === 1 ? 'morgen' : 'am ' + DAYS[d]) + ' ab ' + next[0] };
    }
    return null;
  }

  // Ordnet den gepflegten Orten Koordinaten aus den OSM-Daten zu
  function resolvePlaces(places, poi) {
    var feats = (poi && poi.features) || [];
    var byId = {};
    places.forEach(function (p) {
      byId[p.id] = p;
      if (!p.match) return;
      var re = new RegExp(p.match, 'i');
      var cands = feats.filter(function (f) {
        var t = f.properties;
        if (!t.name || !re.test(t.name)) return false;
        if (t.highway && !(t.highway === 'bus_stop' && p.type === 'start')) return false;
        return true;
      });
      var score = function (f) {
        var t = f.properties, s = 0;
        if (p.prefer && t[p.prefer]) s += 4;
        if (t.amenity || t.tourism) s += 2;
        if (t.name.length === p.name.length) s += 1;
        return s;
      };
      cands.sort(function (a, b) { return score(b) - score(a); });
      if (cands[0]) { p.coords = cands[0].geometry.coordinates; p.osmName = cands[0].properties.name; }
    });
    places.forEach(function (p) {
      if (!p.coords && p.nearestWaterTo && byId[p.nearestWaterTo] && byId[p.nearestWaterTo].coords) {
        var ref = byId[p.nearestWaterTo].coords, best = null, bestKm = 0.7;
        feats.forEach(function (f) {
          if (f.properties.natural !== 'water') return;
          var km = haversineKm(ref, f.geometry.coordinates);
          if (km < bestKm) { bestKm = km; best = f; }
        });
        if (best) { p.coords = best.geometry.coordinates; if (best.properties.name) p.name = best.properties.name; }
      }
      if (!p.coords && p.fallback) p.coords = p.fallback;
    });
    return byId;
  }

  function matchTrail(route, trails) {
    if (!route.osmName || !trails) return null;
    var re = new RegExp(route.osmName + '(?![0-9a-z])', 'i');
    var hits = trails.features.filter(function (f) { return re.test(f.properties.name || ''); });
    hits.sort(function (a, b) { return lineLengthKm(b.geometry) - lineLengthKm(a.geometry); });
    return hits[0] || null;
  }

  var api = { esc: esc, haversineKm: haversineKm, lineLengthKm: lineLengthKm, bounds: bounds, fmtKm: fmtKm, fmtDuration: fmtDuration, openStatus: openStatus, resolvePlaces: resolvePlaces, matchTrail: matchTrail };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ---------- App ----------
  var state = { tab: 'karte', routeId: null, placeId: null, detail: false, routes: [], places: [], byId: {}, checked: '', map: null, mapReady: false, mapError: '' };
  var sheet = document.getElementById('sheet');

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function routeById(id) { return state.routes.filter(function (r) { return r.id === id; })[0]; }

  function routeMeta(r) {
    var parts = [];
    if (r.km) parts.push(fmtKm(r.km));
    if (r.minutes) parts.push(fmtDuration(r.minutes));
    if (!parts.length) parts.push(r.pending ? 'Route wird berechnet' : 'Route folgt');
    if (r.draft && r.geometry) parts.push('Entwurf');
    return parts.join(' · ');
  }
  function chips(r) {
    return '<div class="chips">' + (r.tags || []).map(function (t) {
      return '<span class="chip' + (/Heurige/.test(t) ? ' wine' : '') + '">' + esc(t) + '</span>';
    }).join('') + '</div>';
  }
  function statusHtml(p) {
    var s = openStatus(p, new Date());
    return s ? '<div class="status ' + s.cls + '">' + esc(s.text) + '</div>' : '';
  }
  function placeIcon(p) { return p.type === 'heuriger' || p.type === 'gasthaus' ? ICON.wine : p.type === 'view' ? ICON.eye : ICON.pin; }
  function isEinkehr(p) { return p.type === 'heuriger' || p.type === 'gasthaus'; }

  function routeCard(r) {
    return '<button type="button" class="card" data-route="' + esc(r.id) + '">' +
      '<div class="kind">' + esc(r.kind) + '</div><div class="title">' + esc(r.name) + '</div>' +
      '<div class="meta">' + esc(routeMeta(r)) + '</div>' + chips(r) + '</button>';
  }
  function placeCard(p) {
    var typeLabel = p.type === 'heuriger' ? 'Heuriger' : p.type === 'gasthaus' ? 'Gasthaus' : p.type === 'view' ? 'Aussicht' : p.type === 'start' ? 'Start' : 'Besonderer Platz';
    var html = '<div class="card"><div class="kind">' + typeLabel + '</div><div class="title">' + esc(p.name) + '</div>';
    if (p.address) html += '<div class="meta">' + esc(p.address) + '</div>';
    html += statusHtml(p);
    if (p.hoursText) html += '<p class="text">' + esc(p.hoursText) + '</p>';
    else if (p.note) html += '<p class="text">' + esc(p.note) + '</p>';
    var c = [];
    if (p.payment) c.push('<span class="chip grey">' + esc(p.payment) + '</span>');
    if (!p.coords) c.push('<span class="chip grey">Noch nicht auf der Karte</span>');
    if (c.length) html += '<div class="chips">' + c.join('') + '</div>';
    html += '<div class="btn-row">';
    if (p.coords) html += '<button type="button" class="btn" data-show-place="' + esc(p.id) + '">Auf der Karte</button>';
    if (p.source) html += '<a class="btn" href="' + esc(p.source) + '" target="_blank" rel="noopener">' + esc(p.sourceLabel || 'Website') + '</a>';
    html += '</div>';
    if (isEinkehr(p) && state.checked) html += '<div class="hint">Zeiten zuletzt geprüft am ' + esc(state.checked.split('-').reverse().join('.')) + '. Bitte vor dem Besuch auf der Website nachsehen.</div>';
    return html + '</div>';
  }

  function routeDetail(r) {
    var html = '<button type="button" class="back" data-back="1">‹ Alle Wege</button>' +
      '<div class="kind">' + esc(r.kind) + '</div><h1>' + esc(r.name) + '</h1><p class="lead">' + esc(r.summary) + '</p>' +
      '<div class="stats">' +
      '<div class="stat"><div class="label">Länge</div><div class="num">' + (r.km ? esc(fmtKm(r.km)) : '–') + '</div></div>' +
      '<div class="stat"><div class="label">Gehzeit</div><div class="num">' + (r.minutes ? esc(fmtDuration(r.minutes)) : '–') + '</div></div>' +
      '<div class="stat"><div class="label">Stand</div><div class="num">' + (r.geometry ? (r.draft ? 'Entwurf' : 'Offiziell') : 'Offen') + '</div></div>' +
      '</div>' + chips(r);
    if (r.draft) html += '<div class="hint">Die Linie ist ein automatisch berechneter Entwurf entlang der kartierten Wege. Sie wird durch die aufgezeichnete Runde ersetzt.</div>';
    html += '<h2>Am Weg</h2>';
    (r.stops || []).forEach(function (id) {
      var p = state.byId[id];
      if (!p) return;
      var s = openStatus(p, new Date());
      var einkehr = isEinkehr(p);
      html += '<div class="row"><span class="dot' + (einkehr ? ' wine' : '') + '">' + placeIcon(p) + '</span><div>' +
        '<div class="name">' + esc(p.name) + '</div>' +
        '<div class="sub' + (einkehr ? ' wine' : '') + '">' + esc(s ? s.text : (p.note || '')) + '</div></div></div>';
    });
    html += '<div class="btn-row"><button type="button" class="btn primary" data-show-route="' + esc(r.id) + '">Auf der Karte zeigen</button></div>';
    return html;
  }

  function render() {
    var html = '';
    sheet.classList.toggle('is-compact', state.tab === 'karte');
    if (state.tab === 'karte') {
      if (!TOKEN) html += '<form class="card" data-token-form="1"><div class="title">Kartenschlüssel eingeben</div>' +
        '<p class="text">Füge einmalig deinen öffentlichen Mapbox-Schlüssel ein (beginnt mit „pk.“). Er bleibt nur auf diesem Gerät gespeichert.</p>' +
        '<label class="field"><span>Mapbox-Schlüssel</span><input name="token" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="pk.…"></label>' +
        '<div class="btn-row"><button type="submit" class="btn primary">Speichern</button></div></form>';
      if (state.mapError) html += '<div class="card"><div class="title">Karte nicht verfügbar</div><p class="text">' + esc(state.mapError) + '</p></div>';
      if (state.placeId && state.byId[state.placeId]) html += placeCard(state.byId[state.placeId]);
      else if (state.routeId && routeById(state.routeId)) html += routeCard(routeById(state.routeId));
      else html += '<div class="card"><div class="title">Servus!</div><p class="text">Tippe auf einen Weg oder einen Punkt auf der Karte, oder wähle unten „Wege“.</p></div>';
    } else if (state.tab === 'wege') {
      if (state.detail && routeById(state.routeId)) html = routeDetail(routeById(state.routeId));
      else html = '<h1>Wanderwege</h1><p class="lead">Vier Runden rund um Gallitzinberg und Wilhelminenberg</p>' + state.routes.map(routeCard).join('');
    } else {
      html = '<h1>Einkehr</h1><p class="lead">Heurige und Gasthäuser im Pilotgebiet</p>' + state.places.filter(isEinkehr).map(placeCard).join('');
    }
    sheet.innerHTML = html;
    sheet.scrollTop = 0;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      var on = b.getAttribute('data-tab') === state.tab;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    updateActiveRoute();
  }

  // ---------- Karte ----------
  function routesGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: state.routes.filter(function (r) { return r.geometry; }).map(function (r) {
        return { type: 'Feature', properties: { id: r.id, home: r.draft ? 1 : 0 }, geometry: r.geometry };
      })
    };
  }
  function updateRouteSource() {
    if (state.mapReady && state.map.getSource('routes')) state.map.getSource('routes').setData(routesGeoJSON());
  }
  function updateActiveRoute() {
    if (state.mapReady && state.map.getLayer('routes-active')) state.map.setFilter('routes-active', ['==', ['get', 'id'], state.routeId || '']);
  }
  function showRoute(id) {
    var r = routeById(id);
    state.routeId = id; state.placeId = null; state.tab = 'karte'; state.detail = false;
    render();
    var b = r && bounds(r.geometry);
    if (b && state.mapReady) state.map.fitBounds(b, { padding: { top: 90, bottom: 190, left: 40, right: 40 }, duration: 800 });
  }
  function showPlace(id) {
    var p = state.byId[id];
    state.placeId = id; state.tab = 'karte'; state.detail = false;
    render();
    if (p && p.coords && state.mapReady) state.map.flyTo({ center: p.coords, zoom: 15.5, offset: [0, -90], duration: 800 });
  }

  function initMap() {
    if (!TOKEN) return;
    if (!root.mapboxgl) { state.mapError = 'Die Kartenbibliothek konnte nicht geladen werden. Bitte Verbindung prüfen.'; return; }
    mapboxgl.accessToken = TOKEN;
    var map = state.map = new mapboxgl.Map({ container: 'map', style: 'mapbox://styles/mapbox/outdoors-v12', center: CENTER, zoom: 13.4, attributionControl: true });
    map.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserHeading: true }), 'top-right');
    map.on('error', function (e) {
      var status = e && e.error && e.error.status;
      if (status === 401 || status === 403) { state.mapError = 'Der Mapbox-Schlüssel wurde abgelehnt (Fehler ' + status + ').'; render(); }
    });
    map.on('load', function () {
      state.mapReady = true;
      map.addSource('routes', { type: 'geojson', data: routesGeoJSON() });
      map.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': 6, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['==', ['get', 'home'], 1], '#2F6B4A', '#3F6079'], 'line-width': 3.5, 'line-opacity': 0.75 } });
      map.addLayer({ id: 'routes-active', type: 'line', source: 'routes', filter: ['==', ['get', 'id'], ''], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8A2B45', 'line-width': 6 } });
      map.on('click', 'routes-line', function (e) {
        var f = e.features && e.features[0];
        if (f) { state.routeId = f.properties.id; state.placeId = null; state.tab = 'karte'; render(); }
      });
      map.on('mouseenter', 'routes-line', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'routes-line', function () { map.getCanvas().style.cursor = ''; });
      addMarkers();
      updateActiveRoute();
    });
  }
  function addMarkers() {
    state.places.forEach(function (p) {
      if (!p.coords) return;
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin' + (isEinkehr(p) ? ' wine' : p.type === 'start' ? ' start' : '');
      el.setAttribute('aria-label', p.name);
      el.innerHTML = p.type === 'start' ? 'S' : placeIcon(p);
      el.addEventListener('click', function (ev) { ev.stopPropagation(); showPlace(p.id); });
      new mapboxgl.Marker({ element: el }).setLngLat(p.coords).addTo(state.map);
    });
  }

  // Entwurf einer Hausrunde: Fußweg-Routing zwischen den bekannten Punkten
  function draftRoute(r) {
    var pts = (r.draftStops || []).map(function (id) { return state.byId[id] && state.byId[id].coords; }).filter(Boolean);
    if (pts.length < 3 || !TOKEN) return Promise.resolve();
    var key = 'ww-draft-' + r.id + '-' + pts.map(function (p) { return p[0].toFixed(4) + ',' + p[1].toFixed(4); }).join(';');
    var apply = function (d) { r.geometry = d.geometry; r.km = d.km; r.minutes = d.minutes; };
    try { var cached = JSON.parse(localStorage.getItem(key) || 'null'); if (cached) { apply(cached); return Promise.resolve(); } } catch (e) { /* ohne Speicher weiter */ }
    r.pending = true;
    var url = 'https://api.mapbox.com/directions/v5/mapbox/walking/' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(';') +
      '?geometries=geojson&overview=full&access_token=' + TOKEN;
    return getJSON(url).then(function (res) {
      r.pending = false;
      var best = res && res.routes && res.routes[0];
      if (!best) return;
      var d = { geometry: best.geometry, km: best.distance / 1000, minutes: best.duration / 60 };
      apply(d);
      try { localStorage.setItem(key, JSON.stringify(d)); } catch (e) { /* ohne Speicher weiter */ }
    });
  }

  // ---------- Start ----------
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-tab],[data-route],[data-back],[data-show-route],[data-show-place]');
    if (!t) return;
    if (t.hasAttribute('data-tab')) { state.tab = t.getAttribute('data-tab'); state.detail = false; if (state.tab !== 'karte') state.placeId = null; render(); }
    else if (t.hasAttribute('data-route')) { state.routeId = t.getAttribute('data-route'); state.placeId = null; state.tab = 'wege'; state.detail = true; render(); }
    else if (t.hasAttribute('data-back')) { state.detail = false; render(); }
    else if (t.hasAttribute('data-show-route')) showRoute(t.getAttribute('data-show-route'));
    else if (t.hasAttribute('data-show-place')) showPlace(t.getAttribute('data-show-place'));
  });

  document.addEventListener('submit', function (ev) {
    var form = ev.target.closest('[data-token-form]');
    if (!form) return;
    ev.preventDefault();
    var value = (form.elements.token.value || '').trim();
    if (value.indexOf('pk.') !== 0) { form.elements.token.focus(); return; }
    try { localStorage.setItem('ww-mapbox-token', value); } catch (e) { /* ohne Speicher weiter */ }
    root.location.reload();
  });

  initMap();
  render();
  Promise.all([getJSON('data/curated.json'), getJSON('data/trails.geojson'), getJSON('data/poi.geojson')]).then(function (res) {
    var curated = res[0], trails = res[1], poi = res[2];
    if (!curated) { state.mapError = 'Die Wegedaten konnten nicht geladen werden.'; render(); return; }
    state.checked = curated.checked || '';
    state.places = curated.places;
    state.byId = resolvePlaces(state.places, poi);
    state.routes = curated.routes.map(function (r) {
      var f = matchTrail(r, trails);
      if (f) { r.geometry = f.geometry; r.km = lineLengthKm(f.geometry); r.minutes = r.km / 3.6 * 60; }
      r.draft = !!r.draftStops;
      return r;
    });
    render();
    updateRouteSource();
    if (state.mapReady) addMarkers(); else if (state.map) state.map.once('load', function () { updateRouteSource(); });
    return Promise.all(state.routes.filter(function (r) { return r.draft; }).map(draftRoute)).then(function () { render(); updateRouteSource(); });
  });
})(typeof window !== 'undefined' ? window : globalThis);
