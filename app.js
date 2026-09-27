/* Walk Tracker - single page, no build step. Data lives only in this phone's localStorage. */
(function () {
  'use strict';
  var STOPS_KEY = 'wt_stops_v1', STATUS_KEY = 'wt_status_v1', WALK_KEY = 'wt_walk_v1';
  var STATUSES = [
    { id: 'not_home', label: 'Not home', color: '#8a8a8a', fg: '#fff' },
    { id: 'talked', label: 'Talked', color: '#1565c0', fg: '#fff' },
    { id: 'inspection', label: 'Inspection set', color: '#1b8a2e', fg: '#fff' },
    { id: 'not_interested', label: 'Not interested', color: '#c62828', fg: '#fff' },
    { id: 'dpc', label: 'DPC-interest', sub: 'solar / high bill / outage', color: '#6a1b9a', fg: '#fff' },
    { id: 'come_back', label: 'Come back', color: '#ef6c00', fg: '#fff' }
  ];
  var ST = {}; STATUSES.forEach(function (s) { ST[s.id] = s; });
  var TALKED = { talked: 1, inspection: 1, not_interested: 1, dpc: 1 };

  var stops = load(STOPS_KEY, {});      // lead_id -> stop
  var status = load(STATUS_KEY, {});    // lead_id -> {status, note, ts, history:[]}
  var curWalk = null, curList = [], markers = {}, line = null, curIdx = -1, pick = null, meMarker = null;
  var $ = function (id) { return document.getElementById(id); };

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast('Could not save on this phone: ' + e.message); return false; }
  }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 2200);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowStamp() { var d = new Date(); return today() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function prettyDate(iso) {
    var p = iso.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    var rows = [], row = [], f = '', q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; rows.push(row); row = [];
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ''; }); });
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    return rows.slice(1).map(function (r) { var o = {}; head.forEach(function (h, j) { o[h] = (r[j] || '').trim(); }); return o; });
  }
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  var EXTRA = ['owner_name', 'year_built', 'sqft', 'stories', 'est_value', 'last_sale_date', 'roof_note', 'pin', 'data_source'];
  function importRows(rows) {
    var need = ['lead_id', 'date', 'route_seq', 'walk', 'address', 'latitude', 'longitude'];
    if (!rows.length) throw new Error('File has no rows.');
    var missing = need.filter(function (k) { return !(k in rows[0]); });
    if (missing.length) throw new Error('Missing column(s): ' + missing.join(', '));
    var added = 0, updated = 0, skipped = 0, enriched = 0;
    rows.forEach(function (r) {
      var lat = parseFloat(r.latitude), lon = parseFloat(r.longitude);
      if (!r.lead_id || !r.date || !r.walk || isNaN(lat) || isNaN(lon)) { skipped++; return; }
      var old = stops[r.lead_id] || {};
      var s = {
        lead_id: r.lead_id, date: r.date, walk: r.walk, route_seq: parseInt(r.route_seq, 10) || 0,
        address: r.address, zip: r.zip || '', neighborhood: r.neighborhood || '', lat: lat, lon: lon
      };
      // Home/owner details: a non-blank value in the file fills or updates; blank or missing keeps what is already on the phone.
      EXTRA.forEach(function (k) { var v = (r[k] || '').trim(); s[k] = v !== '' ? v : (old[k] || ''); });
      if (s.owner_name || s.year_built) enriched++;
      if (stops[r.lead_id]) updated++; else added++;
      stops[r.lead_id] = s;                 // stop details replaced; statuses untouched
    });
    save(STOPS_KEY, stops);
    return { added: added, updated: updated, skipped: skipped, enriched: enriched };
  }
  function fmtNum(v) { var n = parseInt(String(v).replace(/[^0-9]/g, ''), 10); return isNaN(n) ? '' : n.toLocaleString('en-US'); }
  function fmtValue(v) {
    var n = parseInt(String(v).replace(/[^0-9]/g, ''), 10); if (isNaN(n) || !n) return '';
    return n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : '$' + Math.round(n / 1000) + 'k';
  }
  function fmtStories(v) {
    v = String(v || '').trim(); if (!v) return '';
    return /^[0-9.]+$/.test(v) ? v + (v === '1' ? ' story' : ' stories') : v;
  }
  function detailsLine(s) {
    var p = [];
    if (s.year_built) p.push('Built ' + s.year_built);
    if (fmtNum(s.sqft)) p.push(fmtNum(s.sqft) + ' sq ft');
    if (fmtStories(s.stories)) p.push(fmtStories(s.stories));
    if (fmtValue(s.est_value)) p.push('Est. value ' + fmtValue(s.est_value));
    if (s.last_sale_date) p.push('Last sale ' + String(s.last_sale_date).slice(0, 4));
    return p.join(' · ');
  }

  function exportCSV() {
    var cols = ['lead_id', 'date', 'walk', 'route_seq', 'address', 'zip', 'neighborhood', 'latitude', 'longitude', 'status', 'notes', 'updated_at', 'history'].concat(EXTRA);
    var ids = Object.keys(stops).concat(Object.keys(status).filter(function (k) { return !stops[k]; }));
    ids.sort(function (a, b) {
      var x = stops[a] || {}, y = stops[b] || {};
      return (x.date || '').localeCompare(y.date || '') || (x.walk || '').localeCompare(y.walk || '') || (x.route_seq || 0) - (y.route_seq || 0);
    });
    var lines = [cols.join(',')];
    ids.forEach(function (id) {
      var s = stops[id] || { lead_id: id }, st = status[id] || {};
      var hist = (st.history || []).map(function (h) { return h.ts + ' ' + (ST[h.status] ? ST[h.status].label : h.status || '-'); }).join(' | ');
      lines.push([id, s.date, s.walk, s.route_seq, s.address, s.zip, s.neighborhood, s.lat, s.lon,
        st.status ? ST[st.status].label : '', st.note || '', st.ts || '', hist].concat(EXTRA.map(function (k) { return s[k] || ''; })).map(csvCell).join(','));
    });
    var name = 'walk-results_' + today() + '.csv';
    var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv' });
    var file = null;
    try { file = new File([blob], name, { type: 'text/csv' }); } catch (e) { }
    // Phones: prefer the share sheet (AirDrop / Mail / Save to Files); fall back to a download.
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(function (e) { if (e.name !== 'AbortError') download(blob, name); });
    } else download(blob, name);
  }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Saved ' + name);
  }

  /* ---------- walks ---------- */
  function walks() {
    var m = {};
    Object.keys(stops).forEach(function (id) { var s = stops[id]; var k = s.date + '|' + s.walk; (m[k] = m[k] || { key: k, date: s.date, walk: s.walk, n: 0, hood: s.neighborhood }).n++; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.date.localeCompare(b.date) || a.walk.localeCompare(b.walk); });
  }
  function fillWalks() {
    var ws = walks(), sel = $('walkSel');
    $('empty').hidden = ws.length > 0;
    sel.innerHTML = ws.map(function (w) {
      var hood = (w.hood || '').split(':')[0];
      return '<option value="' + esc(w.key) + '">' + esc(prettyDate(w.date) + ' · ' + w.walk + (hood ? ' · ' + hood : '') + ' (' + w.n + ')') + '</option>';
    }).join('');
    if (!ws.length) { curWalk = null; return; }
    var saved = sessionStorage.getItem(WALK_KEY), t = today(), def = null;
    ws.forEach(function (w) { if (!def && w.date >= t) def = w.key; });
    if (!def) def = ws[ws.length - 1].key;
    var pickKey = (saved && ws.some(function (w) { return w.key === saved; })) ? saved : def;
    sel.value = pickKey; setWalk(pickKey);
  }
  function setWalk(key) {
    curWalk = key; sessionStorage.setItem(WALK_KEY, key);
    curList = Object.keys(stops).map(function (id) { return stops[id]; })
      .filter(function (s) { return s.date + '|' + s.walk === key; })
      .sort(function (a, b) { return a.route_seq - b.route_seq; });
    drawMap(true); drawList(); drawProgress();
  }

  /* ---------- map ---------- */
  var map = L.map('map', { zoomControl: true, tap: true }).setView([41.75, -88.05], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  function zoomClass() { $('map').classList.toggle('zsmall', map.getZoom() <= 17); }
  map.on('zoomend', zoomClass); zoomClass();

  function pinIcon(s, i, n) {
    var st = status[s.lead_id], c = st && st.status ? ST[st.status] : null;
    var flag = i === 0 ? '<span class="flag">START</span>' : (i === n - 1 ? '<span class="flag">END</span>' : '');
    var style = c ? 'background:' + c.color + ';color:' + c.fg : '';
    return L.divIcon({
      className: '', iconSize: [34, 34], iconAnchor: [17, 17],
      html: '<div class="pin' + (i === curIdx ? ' cur' : '') + '" style="' + style + '">' + (i + 1) + flag + '</div>'
    });
  }
  function drawMap(fit) {
    Object.keys(markers).forEach(function (k) { map.removeLayer(markers[k]); }); markers = {};
    if (line) { map.removeLayer(line); line = null; }
    if (!curList.length) return;
    var pts = curList.map(function (s) { return [s.lat, s.lon]; });
    line = L.polyline(pts, { color: '#111', weight: 2, opacity: 0.7, dashArray: '4 5' }).addTo(map);
    curList.forEach(function (s, i) {
      var m = L.marker([s.lat, s.lon], { icon: pinIcon(s, i, curList.length), zIndexOffset: (i === 0 || i === curList.length - 1) ? 500 : 0 })
        .on('click', function () { openSheet(i); }).addTo(map);
      markers[s.lead_id] = m;
    });
    if (fit) map.fitBounds(line.getBounds(), { padding: [30, 30] });
  }
  function refreshPin(i) {
    var s = curList[i]; if (s && markers[s.lead_id]) markers[s.lead_id].setIcon(pinIcon(s, i, curList.length));
  }

  /* ---------- list & progress ---------- */
  function drawList() {
    $('list').innerHTML = curList.map(function (s, i) {
      var st = status[s.lead_id] || {}, c = st.status ? ST[st.status] : null;
      var style = c ? 'background:' + c.color + ';color:' + c.fg : '';
      return '<button class="item" data-i="' + i + '"><span class="num" style="' + style + '">' + (i + 1) + '</span><span class="txt">' +
        '<div class="a">' + esc(s.address) + '</div>' + (s.owner_name ? '<div class="o">' + esc(s.owner_name) + '</div>' : '') + '<div class="s">' + (c ? esc(c.label) + ' · ' + esc((st.ts || '').slice(11, 16)) : 'Not knocked') +
        (i === 0 ? ' · START' : i === curList.length - 1 ? ' · END' : '') + '</div>' +
        (st.note ? '<div class="n">' + esc(st.note) + '</div>' : '') + '</span></button>';
    }).join('');
  }
  function drawProgress() {
    var k = 0, t = 0, ins = 0;
    curList.forEach(function (s) { var st = status[s.lead_id]; if (st && st.status) { k++; if (TALKED[st.status]) t++; if (st.status === 'inspection') ins++; } });
    $('progress').innerHTML = '<span>Knocked <b>' + k + '</b>/' + curList.length + '</span><span>Talked <b>' + t + '</b></span><span>Inspections <b>' + ins + '</b></span>';
  }

  /* ---------- sheet ---------- */
  function openSheet(i) {
    var prev = curIdx; curIdx = i; refreshPin(prev); refreshPin(i);
    var s = curList[i], st = status[s.lead_id] || {};
    pick = st.status || null;
    $('shStop').textContent = 'Stop ' + (i + 1) + ' of ' + curList.length + (i === 0 ? ' · START' : i === curList.length - 1 ? ' · END' : '');
    $('shAddr').textContent = s.address;
    $('shOwner').textContent = s.owner_name || ''; $('shOwner').hidden = !s.owner_name;
    var dl = detailsLine(s);
    $('shDetails').textContent = dl; $('shRoof').textContent = s.roof_note || '';
    $('shPR').hidden = !(dl || s.owner_name || s.roof_note);
    $('shRec').hidden = !(dl || s.roof_note);
    $('shMeta').textContent = [s.zip, (s.neighborhood || '').split(':')[0]].filter(Boolean).join(' · ');
    $('shNote').value = st.note || '';
    $('shLast').textContent = st.ts ? 'Last saved ' + st.ts + (st.history && st.history.length > 1 ? ' · ' + st.history.length + ' saves' : '') : 'Not saved yet';
    drawStatusBtns();
    $('shPrev').disabled = i === 0; $('shNext').disabled = i === curList.length - 1;
    $('sheet').hidden = false; $('sheetBg').hidden = false;
    // keep the pin visible above the sheet
    var mr = $('map').getBoundingClientRect(), vis = Math.max(60, $('sheet').getBoundingClientRect().top - mr.top);
    var pt = map.project([s.lat, s.lon]).add([0, mr.height / 2 - vis / 2]);
    map.panTo(map.unproject(pt));
  }
  function drawStatusBtns() {
    $('shStatuses').innerHTML = STATUSES.map(function (s) {
      var sel = pick === s.id;
      return '<button class="st' + (sel ? ' sel' : '') + '" data-s="' + s.id + '" style="border-color:' + s.color + ';' + (sel ? 'background:' + s.color : '') + '">' +
        esc(s.label) + (s.sub ? '<small>' + esc(s.sub) + '</small>' : '') + '</button>';
    }).join('');
  }
  function closeSheet() {
    $('sheet').hidden = true; $('sheetBg').hidden = true;
    var p = curIdx; curIdx = -1; refreshPin(p);
  }
  function saveStop() {
    var s = curList[curIdx]; if (!s) return;
    var note = $('shNote').value.trim();
    if (!pick && !note) { toast('Pick a status first'); return; }
    var old = status[s.lead_id] || { history: [] }, ts = nowStamp();
    var rec = { status: pick, note: note, ts: ts, history: (old.history || []).concat([{ status: pick, ts: ts }]) };
    status[s.lead_id] = rec;
    if (!save(STATUS_KEY, status)) return;
    refreshPin(curIdx); drawList(); drawProgress();
    toast('Saved #' + (curIdx + 1) + (pick ? ' – ' + ST[pick].label : ''));
    closeSheet();
  }

  /* ---------- wiring ---------- */
  $('walkSel').addEventListener('change', function () { closeSheet(); setWalk(this.value); });
  $('tabMap').onclick = function () { showTab('map'); };
  $('tabList').onclick = function () { showTab('list'); };
  function showTab(t) {
    $('list').hidden = t !== 'list'; $('map').style.visibility = t === 'list' ? 'hidden' : '';
    $('tabMap').classList.toggle('active', t === 'map'); $('tabList').classList.toggle('active', t === 'list');
    $('locBtn').hidden = t === 'list';
    if (t === 'map') setTimeout(function () { map.invalidateSize(); }, 50);
  }
  $('list').addEventListener('click', function (e) {
    var b = e.target.closest('.item'); if (!b) return;
    var i = +b.getAttribute('data-i'), s = curList[i];
    showTab('map'); map.setView([s.lat, s.lon], 18); openSheet(i);
  });
  $('shStatuses').addEventListener('click', function (e) {
    var b = e.target.closest('.st'); if (!b) return;
    var id = b.getAttribute('data-s'); pick = pick === id ? null : id; drawStatusBtns();
  });
  $('shSave').onclick = saveStop;
  $('shClose').onclick = closeSheet; $('sheetBg').onclick = closeSheet;
  $('shPrev').onclick = function () { if (curIdx > 0) openSheet(curIdx - 1); };
  $('shNext').onclick = function () { if (curIdx < curList.length - 1) openSheet(curIdx + 1); };

  $('menuBtn').onclick = function () {
    var m = $('menu'); m.hidden = !m.hidden;
    var n = Object.keys(status).filter(function (k) { return status[k].status || status[k].note; }).length;
    $('storeInfo').textContent = Object.keys(stops).length + ' doors loaded · ' + n + ' with results saved on this phone. Export often.';
  };
  $('menuClose').onclick = function () { $('menu').hidden = true; };
  $('exportBtn').onclick = function () { $('menu').hidden = true; exportCSV(); };
  $('importBtn').onclick = $('emptyImport').onclick = function () { $('menu').hidden = true; $('fileIn').value = ''; $('fileIn').click(); };
  $('fileIn').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var res = importRows(parseCSV(String(r.result)));
        fillWalks();
        toast('Imported: ' + res.added + ' new, ' + res.updated + ' updated' + (res.enriched ? ', ' + res.enriched + ' with owner/home info' : '') + (res.skipped ? ', ' + res.skipped + ' skipped (no walk/date)' : '') + '. Results kept.', 4000);
      } catch (e) { toast('Import failed: ' + e.message, 5000); }
    };
    r.readAsText(f);
  });

  $('locBtn').onclick = function () {
    if (!navigator.geolocation) { toast('GPS not available'); return; }
    toast('Finding you…');
    navigator.geolocation.getCurrentPosition(function (p) {
      var ll = [p.coords.latitude, p.coords.longitude];
      if (!meMarker) meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 1000 }).addTo(map);
      else meMarker.setLatLng(ll);
      map.setView(ll, Math.max(map.getZoom(), 17)); toast('You are here (±' + Math.round(p.coords.accuracy) + ' m)');
    }, function (e) { toast('Location error: ' + e.message + '. Allow location for this site.', 4000); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  };

  /* Standalone build: seed embedded data on first open (never overwrites results). */
  if (window.EMBEDDED_CSV && !Object.keys(stops).length) {
    try { importRows(parseCSV(window.EMBEDDED_CSV)); } catch (e) { }
  }
  fillWalks();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !window.EMBEDDED_CSV) {
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { });
  window.__wt = { map: map, list: function () { return curList; }, stops: function () { return stops; }, status: function () { return status; } };
})();
