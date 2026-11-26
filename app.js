/* World Empires — a 3D globe of historical borders.
 * Data: data/index.json (list of maps + empires on each) and data/world_*.geojson (borders). */

const DEFAULT_YEAR = 100; // first view: AD 100 (Roman Empire, Han China, Parthia, Kushan)
const LABEL_COUNT = 14; // how many of the largest states get their name drawn on the globe
const PLAY_DELAY_MS = 2600;

const $ = (id) => document.getElementById(id);
const els = {
  globe: $('globe'), search: $('search'), form: $('search-form'), suggestions: $('suggestions'),
  status: $('status'), legendTitle: $('legend-title'), legendList: $('legend-list'), legendBody: $('legend-body'),
  legendToggle: $('legend-toggle'), showPeoples: $('show-peoples'), showLabels: $('show-labels'),
  info: $('info'), infoBody: $('info-body'), infoClose: $('info-close'),
  era: $('era-label'), slider: $('slider'), prev: $('prev'), next: $('next'), play: $('play'), loading: $('loading'),
};

const state = {
  snapshots: [], // [{year, file, empires:[{name, kind, area, lat, lng, prec, parts}]}]
  index: 0, // which snapshot is on screen
  features: [], // borders currently on the globe
  selected: null, // selected empire name
  hovered: null,
  playing: null,
  cache: new Map(),
  empireHistory: new Map(), // empire name -> [{index, area}]
  regionHues: {}, // cultural region name -> { hue }
};

/* ---------------- helpers ---------------- */

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function formatYear(y) {
  if (y < 0) return `${y <= -10000 ? Math.abs(y).toLocaleString('en-US') : -y} BC`;
  if (y < 1000) return `AD ${y}`;
  return String(y);
}

// Index areas are in square degrees of arc on a sphere; convert to km² (Earth radius 6371 km).
function formatArea(area) {
  const km2 = area * (Math.PI / 180) * 6371 * 6371;
  if (km2 >= 1e6) return `${(km2 / 1e6).toFixed(km2 >= 1e7 ? 0 : 1)} million km²`;
  if (km2 >= 1e4) return `${Math.round(km2 / 1e3).toLocaleString('en-US')},000 km²`;
  return `${Math.round(km2).toLocaleString('en-US')} km²`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// What each kind of area is, in plain words (kinds are assigned in scripts/prepare-data.mjs).
const KIND_TEXT = {
  state: { tag: '', card: 'State or empire' },
  nation: {
    tag: 'nation or confederacy',
    card: 'A nation or confederacy: a people with its own government and territory (a tribal nation or an alliance of nations), but not a state in the European sense',
  },
  people: { tag: 'people', card: 'A people: an ethnic, language or tribal group, not shown here as an organized state' },
  culture: {
    tag: 'archaeological culture',
    card: 'An archaeological culture: named by archaeologists for shared pottery, tools or burial customs. Known from what it left behind, not as a state',
  },
};
// States and nations are political communities: drawn solid and never hidden by the peoples/cultures toggle.
const isPolity = (kind) => kind === 'state' || kind === 'nation';

// The globe's label font only has plain English letters, so names written in other scripts or with
// special characters would show as "???". Make a plain-letter version for the globe only
// (the side panel and cards always show the full name).
function globeLabel(name) {
  const plain = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[ŋŊ]/g, 'n').replace(/[ʔɁˀ]/g, "'").replace(/[ɬƚł]/g, 'l').replace(/Ł/g, 'L').replace(/Đ/g, 'D').replace(/[đð]/g, 'd').replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae')
    .replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
  const full = plain(name);
  const lostLetters = name.normalize('NFD').replace(/[\u0300-\u036f\s]/g, '').length - full.replace(/\s/g, '').length > 0;
  const english = name.match(/\(([^)]*)\)\s*$/);
  if (lostLetters && english && plain(english[1])) return plain(english[1]);
  return full.replace(/\(\s*\)/g, '').trim() || name;
}

function hash(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Each empire keeps the same colour on every map, so you can follow it through time.
// Cultural regions of the Americas (hues come from data/index.json; see scripts/regions.mjs).
function regionColor(region, { alpha = 1, light = 55 } = {}) {
  const hue = state.regionHues[region]?.hue ?? 0;
  return `hsla(${hue}, 70%, ${light}%, ${alpha})`;
}

// Nations in a cultural region share their region's colour family (varied shades), so the region
// reads as one block from far away while each nation stays distinguishable up close.
function colorFor(name, kind, { alpha, solid = false } = {}, region = null) {
  const h = hash(name);
  if (region && state.regionHues[region]) {
    const hue = (state.regionHues[region].hue + ((h % 17) - 8) + 360) % 360;
    const sat = 45 + ((h >>> 9) % 30);
    const light = 38 + ((h >>> 17) % 26);
    const a = alpha ?? (solid ? 1 : kind === 'people' ? 0.4 : 0.82);
    return `hsla(${hue}, ${sat}%, ${light}%, ${a})`;
  }
  const hue = h % 360;
  if (kind === 'people') return `hsla(${hue}, 14%, ${solid ? 55 : 62}%, ${alpha ?? (solid ? 1 : 0.32)})`;
  if (kind === 'culture') return `hsla(${hue}, 28%, ${solid ? 50 : 58}%, ${alpha ?? (solid ? 1 : 0.3)})`;
  const sat = 55 + ((h >>> 9) % 30);
  const light = 46 + ((h >>> 17) % 16);
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha ?? (solid ? 1 : 0.8)})`;
}

/* ---------------- understanding what the user typed ---------------- */

// Turns "500 BC", "AD 100", "1492", "-300", "5th century BC", "1400s" into a year.
function parseYear(input) {
  let s = fold(input).replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(the )?(year )?(of )?/, '').replace(/\bb ?c ?e?\b/g, 'bc').replace(/\bc ?e\b/g, 'ad').replace(/\ba ?d\b/g, 'ad');

  let m = s.match(/^(\d{1,3})(st|nd|rd|th)? ?(century|cent|c)( (bc|ad))?$/);
  if (m) {
    const c = Number(m[1]);
    if (c < 1) return null;
    const bc = m[5] === 'bc';
    return { year: bc ? -(c * 100 - 50) : (c - 1) * 100 + 50, label: `the ${ordinal(c)} century${bc ? ' BC' : ''}` };
  }
  m = s.match(/^(\d+)s( (bc|ad))?$/);
  if (m) {
    const n = Number(m[1]);
    const mid = n % 100 === 0 ? 50 : 5;
    const bc = m[3] === 'bc';
    return { year: bc ? -(n + mid) : n + mid, label: `the ${n}s${bc ? ' BC' : ''}` };
  }
  m = s.match(/^(bc|ad)? ?(-?\d+) ?(bc|ad|years? ago)?$/);
  if (m) {
    let n = Number(m[2]);
    if (m[3] && m[3].includes('ago')) n = new Date().getFullYear() - n;
    else if ((m[1] || m[3]) === 'bc') n = -Math.abs(n);
    return { year: n, label: formatYear(n) };
  }
  return null;
}

function nearestIndex(year) {
  let best = 0;
  state.snapshots.forEach((s, i) => {
    if (Math.abs(s.year - year) < Math.abs(state.snapshots[best].year - year)) best = i;
  });
  return best;
}

// Everyday words students use that don't appear in the dataset's names.
const SYNONYMS = {
  rome: ['roman', 'rome'], romans: ['roman', 'rome'], persia: ['persia', 'achaemenid', 'parthia', 'sasanian', 'safavid'],
  persians: ['persia', 'achaemenid', 'parthia', 'sasanian', 'safavid'],
  china: ['han', 'qin', 'zhou', 'sui', 'tang', 'song', 'yuan', 'ming', 'qing', 'xia', 'shang', 'jin empire', 'manchu', 'china'],
  greece: ['greek', 'alexander', 'macedon', 'seleucid', 'ptolemaic', 'byzantine', 'greece', 'minoan', 'mycenae'],
  greeks: ['greek', 'alexander', 'macedon', 'minoan', 'mycenae'], mongols: ['mongol'], aztecs: ['aztec'], incas: ['inca'],
  india: ['maurya', 'gupta', 'mughal', 'magadha', 'indus', 'india', 'chola', 'delhi'],
  mesopotamia: ['ur', 'akkad', 'babylon', 'assyria', 'sumer', 'elam', 'hurrian', 'mitanni'],
  egyptians: ['egypt', 'ptolemaic'], ottomans: ['ottoman'], vikings: ['denmark', 'norway', 'sweden'],
  islam: ['caliphate', 'umayyad', 'abbasid'], arabs: ['caliphate', 'umayyad', 'abbasid', 'arab'],
};

function searchEmpires(query) {
  const q = fold(query).trim();
  if (q.length < 2) return [];
  const terms = SYNONYMS[q] || [q];
  const results = [];
  for (const [name, history] of state.empireHistory) {
    const f = fold(name);
    let score = -1;
    for (const t of terms) {
      if (f === t) score = Math.max(score, 3);
      else if (f.startsWith(t)) score = Math.max(score, 2);
      else if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(f)) score = Math.max(score, 1);
      else if (t.length > 3 && f.includes(t)) score = Math.max(score, 0);
    }
    if (score < 0) continue;
    const peak = history.reduce((a, b) => (b.area > a.area ? b : a));
    const kind = state.snapshots[peak.index].empires.find((e) => e.name === name).kind;
    results.push({ name, history, peak, kind, score });
  }
  // States before peoples and cultures, better matches first, then the biggest.
  results.sort((a, b) => (isPolity(a.kind) === isPolity(b.kind) ? 0 : isPolity(a.kind) ? -1 : 1) || b.score - a.score || b.peak.area - a.peak.area);
  return results.slice(0, 8);
}

function spanText(history) {
  const first = state.snapshots[history[0].index].year;
  const last = state.snapshots[history[history.length - 1].index].year;
  return first === last ? `on the ${formatYear(first)} map` : `on maps from ${formatYear(first)} to ${formatYear(last)}`;
}

/* ---------------- the globe ---------------- */

const world = Globe({ animateIn: true })(els.globe)
  .globeImageUrl('assets/earth-blue-marble.jpg')
  .bumpImageUrl('assets/earth-topology.png')
  .backgroundImageUrl('assets/night-sky.png')
  .showAtmosphere(true)
  .atmosphereColor('#8fb7ff')
  .atmosphereAltitude(0.18)
  .polygonsTransitionDuration(350)
  .polygonCapColor((f) => {
    const p = f.properties;
    if (p.EMPIRE === state.selected) return colorFor(p.EMPIRE, p.KIND, { alpha: 0.97 }, p.REGION);
    if (p.EMPIRE === state.hovered) return colorFor(p.EMPIRE, p.KIND, { alpha: isPolity(p.KIND) ? 0.92 : 0.55 }, p.REGION);
    return colorFor(p.EMPIRE, p.KIND, {}, p.REGION);
  })
  .polygonSideColor(() => 'rgba(0, 0, 0, 0.25)')
  .polygonStrokeColor((f) => (isPolity(f.properties.KIND) ? 'rgba(15, 15, 20, 0.7)' : 'rgba(255,255,255,0.12)'))
  .polygonAltitude((f) => {
    const e = f.properties.EMPIRE;
    if (e === state.selected) return 0.03;
    if (e === state.hovered) return 0.016;
    return isPolity(f.properties.KIND) ? 0.008 : 0.004;
  })
  .polygonLabel((f) => {
    const p = f.properties;
    const tag = [KIND_TEXT[p.KIND].tag, p.REGION && `${p.REGION} region`].filter(Boolean).join(' · ');
    const sub = p.NAME !== p.EMPIRE ? `<small>part of ${escapeHtml(p.EMPIRE)}</small>` : tag ? `<small>${escapeHtml(tag)}</small>` : '';
    return `<div class="tip"><b>${escapeHtml(p.NAME)}</b>${sub}</div>`;
  })
  .onPolygonHover((f) => {
    const name = f ? f.properties.EMPIRE : null;
    if (name === state.hovered) return;
    state.hovered = name;
    els.globe.style.cursor = f ? 'pointer' : 'grab';
    refreshPolygonStyles();
  })
  .onPolygonClick((f) => selectEmpire(f.properties.EMPIRE, { fly: false }))
  .onGlobeClick(() => selectEmpire(null))
  .labelLat('lat')
  .labelLng('lng')
  .labelText((d) => (d.isRegion ? d.name.toUpperCase() : globeLabel(d.name)))
  .labelSize((d) => (d.isRegion ? 1.3 : Math.min(2, 0.8 + Math.sqrt(d.area) * 0.3)))
  .labelDotRadius(0)
  .labelColor((d) => (d.isRegion ? regionColor(d.name, { light: 86 }) : 'rgba(255, 255, 255, 0.95)'))
  .labelResolution(3)
  .labelAltitude(0.035)
  .labelsTransitionDuration(0);

world.pointOfView({ lat: 30, lng: 30, altitude: 2.3 });

const resize = () => world.width(window.innerWidth).height(window.innerHeight);
window.addEventListener('resize', resize);
resize();

function refreshPolygonStyles() {
  // Re-assigning the accessors makes the globe re-evaluate colours/heights without reloading shapes.
  world.polygonCapColor(world.polygonCapColor()).polygonAltitude(world.polygonAltitude());
}

function visibleFeatures() {
  return els.showPeoples.checked ? state.features : state.features.filter((f) => isPolity(f.properties.KIND));
}

function updateLabels() {
  if (!els.showLabels.checked) return world.labelsData([]);
  const snap = state.snapshots[state.index];
  // Nations grouped into a cultural region are named by their region instead (too many to label one by one).
  const labels = snap.empires.filter((e) => isPolity(e.kind) && !e.region).slice(0, LABEL_COUNT);
  labels.push(...(snap.regions || []).map((r) => ({ ...r, isRegion: true })));
  const sel = snap.empires.find((e) => e.name === state.selected);
  if (sel && !labels.includes(sel)) labels.push(sel);
  world.labelsData(labels);
}

/* ---------------- loading a time period ---------------- */

async function loadSnapshot(i) {
  const snap = state.snapshots[i];
  if (!state.cache.has(snap.file)) {
    state.cache.set(snap.file, fetch(`data/${snap.file}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${snap.file}`);
      return r.json();
    }));
  }
  try {
    return (await state.cache.get(snap.file)).features;
  } catch (err) {
    state.cache.delete(snap.file);
    throw err;
  }
}

async function goTo(i, { message, empire, fly = true } = {}) {
  i = Math.max(0, Math.min(state.snapshots.length - 1, i));
  state.index = i;
  const snap = state.snapshots[i];
  els.slider.value = i;
  els.era.textContent = formatYear(snap.year);
  els.legendTitle.textContent = `On the map in ${formatYear(snap.year)}`;
  if (message !== undefined) setStatus(message);

  let features;
  try {
    features = await loadSnapshot(i);
  } catch {
    setStatus('Sorry — that map could not be loaded. Check your connection and try again.');
    return;
  }
  if (state.index !== i) return; // the user moved on while this was loading
  state.features = features;

  // Keep the selected empire if it still exists in this period.
  const keep = empire ?? state.selected;
  state.selected = keep && snap.empires.some((e) => e.name === keep) ? keep : null;
  state.hovered = null;

  world.polygonsData(visibleFeatures());
  updateLabels();
  renderLegend();
  renderInfo();
  if (state.selected && fly) flyTo(state.selected);
  writeHash();

  // Quietly fetch the neighbouring maps so stepping through time feels instant.
  [i - 1, i + 1].forEach((j) => j >= 0 && j < state.snapshots.length && loadSnapshot(j).catch(() => {}));
}

function setStatus(text) { els.status.textContent = text || ''; }

function flyTo(name) {
  const e = state.snapshots[state.index].empires.find((x) => x.name === name);
  if (!e) return;
  const altitude = Math.min(2.4, Math.max(1.1, 0.9 + Math.sqrt(e.area) / 25));
  world.pointOfView({ lat: e.lat, lng: e.lng, altitude }, 1200);
}

function flyToRegion(name) {
  const r = (state.snapshots[state.index].regions || []).find((x) => x.name === name);
  if (r) world.pointOfView({ lat: r.lat, lng: r.lng, altitude: 1.3 }, 1200);
}

// Regions exist on the maps from 1492 on; stay on the current map if it has the region.
async function goToRegion(name) {
  let i = state.index;
  if (!(state.snapshots[i].regions || []).some((r) => r.name === name)) {
    i = state.snapshots.findIndex((sn) => (sn.regions || []).some((r) => r.name === name));
  }
  await goTo(i, { message: `${name}: a cultural region of the Indigenous Americas, ${formatYear(state.snapshots[i].year)} map.`, empire: null });
  state.selected = null;
  selectEmpire(null);
  flyToRegion(name);
}

function selectEmpire(name, { fly = true } = {}) {
  state.selected = name;
  refreshPolygonStyles();
  updateLabels();
  renderLegend();
  renderInfo();
  if (name && fly) flyTo(name);
  writeHash();
}

/* ---------------- side panels ---------------- */

function renderLegend() {
  const snap = state.snapshots[state.index];
  const states = snap.empires.filter((e) => e.kind === 'state');
  const nations = snap.empires.filter((e) => e.kind === 'nation' && !e.region);
  const others = (kind) => (els.showPeoples.checked ? snap.empires.filter((e) => e.kind === kind && !e.region) : []);
  const inRegion = (r) => snap.empires.filter((e) => e.region === r.name && (e.kind === 'nation' || els.showPeoples.checked));
  const peoples = others('people');
  const cultures = others('culture');
  const item = (e) => `
    <li class="${e.kind}${e.name === state.selected ? ' active' : ''}" data-name="${escapeHtml(e.name)}" tabindex="0">
      <span class="swatch" style="background:${colorFor(e.name, e.kind, { solid: true }, e.region)}"></span>${escapeHtml(e.name)}
    </li>`;
  const regionGroup = (r) => {
    const members = inRegion(r);
    if (!members.length) return '';
    return `<li class="legend-region" data-region="${escapeHtml(r.name)}" tabindex="0" title="Show this region on the globe">
        <span class="swatch" style="background:${regionColor(r.name)}"></span>${escapeHtml(r.name)}<small>${members.length}</small>
      </li>${members.map(item).join('')}`;
  };
  const regionsHtml = (snap.regions || []).map(regionGroup).join('');
  els.legendList.innerHTML =
    `<li class="legend-sub">States &amp; empires (largest first)</li>${states.map(item).join('')}` +
    (regionsHtml ? `<li class="legend-sub">Indigenous nations of the Americas, by cultural region</li>${regionsHtml}` : '') +
    (nations.length ? `<li class="legend-sub">Nations &amp; confederacies</li>${nations.map(item).join('')}` : '') +
    (peoples.length ? `<li class="legend-sub">Peoples</li>${peoples.map(item).join('')}` : '') +
    (cultures.length ? `<li class="legend-sub">Archaeological cultures</li>${cultures.map(item).join('')}` : '');
  const active = els.legendList.querySelector('.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function renderInfo() {
  const snap = state.snapshots[state.index];
  const e = state.selected && snap.empires.find((x) => x.name === state.selected);
  document.body.classList.toggle('has-info', Boolean(e));
  if (!e) { els.info.hidden = true; return; }
  const history = state.empireHistory.get(e.name);
  const peak = history.reduce((a, b) => (b.area > a.area ? b : a));
  const precision = ['', 'approximate', 'moderately precise', 'precise'][e.prec] || 'approximate';
  const parts = e.parts.length
    ? `<p class="muted">Includes or controls:</p><ul>${e.parts.slice(0, 12).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}${e.parts.length > 12 ? `<li>…and ${e.parts.length - 12} more</li>` : ''}</ul>`
    : '';
  const peakBtn = peak.index !== state.index
    ? `<button data-go="${peak.index}">See it at its largest (${formatYear(state.snapshots[peak.index].year)})</button>` : '';
  els.infoBody.innerHTML = `
    <h3><span class="swatch" style="background:${colorFor(e.name, e.kind, { solid: true }, e.region)}"></span>${escapeHtml(e.name)}</h3>
    <p class="muted">${KIND_TEXT[e.kind].card} · ${formatYear(snap.year)} map</p>
    ${e.region ? `<p>Cultural region: <strong>${escapeHtml(e.region)}</strong></p>
      <p class="muted small">Cultural regions group peoples who shared an environment and way of life. They were drawn by anthropologists and their edges are approximate.</p>` : ''}
    ${e.note ? `<p>${escapeHtml(e.note)}</p>` : ''}
    <p>Appears ${spanText(history)}${history.length > 1 ? ` (${history.length} maps)` : ''}.
      ${peak.index === state.index && history.length > 1 ? '<strong>This is its largest extent on these maps.</strong>' : ''}</p>
    ${isPolity(e.kind) ? `<p>Size on this map: roughly ${formatArea(e.area)}.</p>` : ''}
    ${parts}
    <p class="muted">Border accuracy: ${precision}.</p>
    <div class="actions">
      ${peakBtn}
      <a href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(e.name)}" target="_blank" rel="noopener">Read more ↗</a>
    </div>`;
  els.info.hidden = false;
}

/* ---------------- search box ---------------- */

let suggestionItems = [];
let activeSuggestion = -1;

function buildSuggestions(text) {
  const items = [];
  const parsed = parseYear(text);
  if (parsed) {
    const i = nearestIndex(parsed.year);
    const snapYear = state.snapshots[i].year;
    items.push({
      title: `Go to ${parsed.label}`,
      detail: snapYear === parsed.year ? 'Map available' : `Closest map: ${formatYear(snapYear)}`,
      run: () => goToYear(parsed),
    });
  }
  const q = fold(text).trim();
  if (q.length >= 3) {
    for (const name of Object.keys(state.regionHues)) {
      if (!fold(name).includes(q)) continue;
      items.push({ title: `${name} (cultural region)`, detail: 'Indigenous nations of the Americas, 1492 on', run: () => goToRegion(name) });
    }
  }
  for (const r of searchEmpires(text)) {
    items.push({
      title: r.name,
      detail: `${KIND_TEXT[r.kind].tag ? `${KIND_TEXT[r.kind].tag[0].toUpperCase()}${KIND_TEXT[r.kind].tag.slice(1)} · ` : ''}${spanText(r.history)} · largest ${formatYear(state.snapshots[r.peak.index].year)}`,
      run: () => goToEmpire(r),
    });
  }
  return items;
}

function showSuggestions() {
  const text = els.search.value.trim();
  suggestionItems = text ? buildSuggestions(text) : [];
  activeSuggestion = suggestionItems.length ? 0 : -1;
  els.suggestions.innerHTML = suggestionItems
    .map((s, i) => `<li role="option" id="sug-${i}" aria-selected="${i === activeSuggestion}" data-i="${i}">${escapeHtml(s.title)}<small>${escapeHtml(s.detail)}</small></li>`)
    .join('');
  els.suggestions.hidden = !suggestionItems.length;
}

function hideSuggestions() { els.suggestions.hidden = true; }

function runSuggestion(i) {
  const s = suggestionItems[i];
  if (!s) return;
  hideSuggestions();
  els.search.blur();
  s.run();
}

function goToYear(parsed) {
  const i = nearestIndex(parsed.year);
  const snapYear = state.snapshots[i].year;
  const msg = snapYear === parsed.year
    ? `Showing the world in ${formatYear(snapYear)}.`
    : `There's no map for exactly ${parsed.label}, so this is the closest one: ${formatYear(snapYear)}.`;
  goTo(i, { message: msg });
}

function goToEmpire(r) {
  const here = r.history.find((h) => h.index === state.index);
  const target = here ? state.index : r.peak.index;
  const msg = here
    ? `${r.name} on the ${formatYear(state.snapshots[target].year)} map.`
    : `${r.name} at its largest on these maps (${formatYear(state.snapshots[target].year)}).`;
  goTo(target, { message: msg, empire: r.name });
}

/* ---------------- "Try:" starting points for first-time visitors ---------------- */

const starters = document.getElementById('starters');
function hideStarters() { starters.hidden = true; }
starters.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  hideStarters();
  const { empire, year } = b.dataset;
  if (empire && state.empireHistory.has(empire)) {
    const history = state.empireHistory.get(empire);
    const at = year !== undefined
      ? history.reduce((a, h) => (Math.abs(state.snapshots[h.index].year - year) < Math.abs(state.snapshots[a.index].year - year) ? h : a))
      : history.reduce((a, h) => (h.area > a.area ? h : a));
    const when = formatYear(state.snapshots[at.index].year);
    goTo(at.index, { empire, message: year !== undefined ? `${empire}, ${when}.` : `${empire} at its largest on these maps (${when}).` });
  } else if (year !== undefined) {
    goToYear({ year: Number(year), label: formatYear(Number(year)) });
  }
});
// Once someone starts exploring on their own, the suggestions get out of the way.
['input', 'focus'].forEach((t) => els.search.addEventListener(t, hideStarters));
els.slider.addEventListener('input', hideStarters);
[els.prev, els.next, els.play].forEach((b) => b.addEventListener('click', hideStarters));
els.globe.addEventListener('pointerdown', hideStarters, { once: true });

els.search.addEventListener('input', showSuggestions);
els.search.addEventListener('focus', showSuggestions);
els.search.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    if (!suggestionItems.length) return;
    ev.preventDefault();
    activeSuggestion = (activeSuggestion + (ev.key === 'ArrowDown' ? 1 : -1) + suggestionItems.length) % suggestionItems.length;
    [...els.suggestions.children].forEach((li, i) => li.setAttribute('aria-selected', i === activeSuggestion));
    els.suggestions.children[activeSuggestion]?.scrollIntoView({ block: 'nearest' });
  } else if (ev.key === 'Escape') {
    hideSuggestions();
  }
});
els.form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!els.search.value.trim()) return;
  if (!suggestionItems.length) showSuggestions();
  if (suggestionItems.length) runSuggestion(Math.max(0, activeSuggestion));
  else setStatus(`Couldn't find “${els.search.value.trim()}”. Try a year like “300 BC”, a century like “12th century”, or an empire like “Mongol Empire”.`);
});
els.suggestions.addEventListener('mousedown', (ev) => {
  const li = ev.target.closest('li[data-i]');
  if (li) { ev.preventDefault(); runSuggestion(Number(li.dataset.i)); }
});
document.addEventListener('click', (ev) => { if (!els.form.contains(ev.target)) hideSuggestions(); });

/* ---------------- other controls ---------------- */

els.slider.addEventListener('input', () => goTo(Number(els.slider.value), { message: '' }));
els.prev.addEventListener('click', () => goTo(state.index - 1, { message: '' }));
els.next.addEventListener('click', () => goTo(state.index + 1, { message: '' }));

function stopPlaying() {
  clearInterval(state.playing);
  state.playing = null;
  els.play.textContent = '▶';
  els.play.title = 'Play through time';
}
els.play.addEventListener('click', () => {
  if (state.playing) return stopPlaying();
  if (state.index >= state.snapshots.length - 1) goTo(0, { message: '' });
  els.play.textContent = '❚❚';
  els.play.title = 'Pause';
  state.playing = setInterval(() => {
    if (state.index >= state.snapshots.length - 1) return stopPlaying();
    goTo(state.index + 1, { message: '', fly: false });
  }, PLAY_DELAY_MS);
});

document.addEventListener('keydown', (ev) => {
  if (ev.target.closest('input, textarea')) return;
  if (ev.key === 'ArrowLeft') goTo(state.index - 1, { message: '' });
  else if (ev.key === 'ArrowRight') goTo(state.index + 1, { message: '' });
  else if (ev.key === 'Escape') selectEmpire(null);
  else if (ev.key === '/') { ev.preventDefault(); els.search.focus(); }
});

els.legendList.addEventListener('click', (ev) => {
  const region = ev.target.closest('li[data-region]');
  if (region) return flyToRegion(region.dataset.region);
  const li = ev.target.closest('li[data-name]');
  if (li) selectEmpire(li.dataset.name === state.selected ? null : li.dataset.name);
});
els.legendList.addEventListener('keydown', (ev) => {
  const li = ev.target.closest('li[data-name]');
  if (li && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); selectEmpire(li.dataset.name); }
});
function setLegendOpen(open) {
  els.legendBody.hidden = !open;
  els.legendToggle.textContent = open ? '–' : '+';
  els.legendToggle.setAttribute('aria-expanded', String(open));
  els.legendToggle.title = open ? 'Hide list' : 'Show list';
}
els.legendToggle.addEventListener('click', () => setLegendOpen(els.legendBody.hidden));
const isPhone = window.matchMedia('(max-width: 760px)').matches;
if (isPhone) {
  setLegendOpen(false);
  els.search.placeholder = 'A year (500 BC) or an empire';
}
els.showPeoples.addEventListener('change', () => {
  const selKind = state.snapshots[state.index].empires.find((e) => e.name === state.selected)?.kind;
  if (!els.showPeoples.checked && selKind && !isPolity(selKind)) state.selected = null;
  world.polygonsData(visibleFeatures());
  renderLegend();
  renderInfo();
});
els.showLabels.addEventListener('change', updateLabels);
els.infoClose.addEventListener('click', () => selectEmpire(null));
els.infoBody.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-go]');
  if (b) goTo(Number(b.dataset.go), { message: `${state.selected} at its largest on these maps.`, empire: state.selected });
});

/* ---------------- shareable links: #year=-500&empire=Achaemenid%20Empire ---------------- */

function writeHash() {
  const params = new URLSearchParams({ year: state.snapshots[state.index].year });
  if (state.selected) params.set('empire', state.selected);
  history.replaceState(null, '', `#${params}`);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const year = Number(params.get('year'));
  return { year: params.has('year') && Number.isFinite(year) ? year : DEFAULT_YEAR, empire: params.get('empire') };
}

/* ---------------- start ---------------- */

async function init() {
  const res = await fetch('data/index.json');
  const data = await res.json();
  state.snapshots = data.snapshots;
  state.regionHues = data.regions || {};
  state.snapshots.forEach((s, index) =>
    s.empires.forEach((e) => {
      if (!state.empireHistory.has(e.name)) state.empireHistory.set(e.name, []);
      state.empireHistory.get(e.name).push({ index, area: e.area });
    }));
  els.slider.max = state.snapshots.length - 1;

  const { year, empire } = readHash();
  if (location.hash) hideStarters(); // arrived from a shared link
  await goTo(nearestIndex(year), { empire, message: 'Type a year, century, or empire above, or drag the timeline.' });
  els.loading.classList.add('done');
}

init().catch((err) => {
  console.error(err);
  els.loading.textContent = 'Sorry — the maps could not be loaded. If you opened this file directly, run it through a web server (see README).';
});
