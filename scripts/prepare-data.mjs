// Rebuilds everything in data/ from the historical-basemaps project
// (https://github.com/aourednik/historical-basemaps, GPL-3.0).
//
//   1. downloads each snapshot into .cache/raw (skipped if already there)
//   2. simplifies the borders so the globe stays fast
//   3. cleans up names and tags each area as an organized state or a people/culture
//   4. writes data/<snapshot>.geojson and data/index.json (used for search + the legend)
//
// Run with: npm run prepare-data
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';
import { geoArea } from 'd3-geo';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(root, '.cache', 'raw');
const outDir = join(root, 'data');
const SOURCE = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master';
mkdirSync(rawDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

// Groups that the source maps as a people, culture or way of life rather than an organized state.
const PEOPLE_RE = new RegExp(
  [
    'hunter', 'gatherer', 'forager', 'nomad', 'pastoral', 'farmers', 'people', 'tribes', 'culture',
    'aborigin', 'herder', 'fisher', 'khoisan', 'neanderthal', 'homo ', 'mesolithic', 'neolithic',
    'horticultur', 'cultivators', 'agricultur', 'hunting', 'austronesian', 'bantu', 'dravidian',
    'semites', '^celts$', 'berbers', 'tuareg', 'touareg', 'bedouin', '^arabs$', '^malays?$', 'papuans?$',
    '^sa+mi', '^samis$', '^inuit$', 'athaba', '^tupis$', 'siberians', 'slavs',
  ].join('|'),
  'i',
);

// The source sometimes spells or labels the same state differently from map to map.
// Mapping variants to one name keeps one colour and one search result per state.
// Only unambiguous cases belong here (same polity, different spelling/label).
const SAME_AS = {
  Han: 'Han Empire',
  Rome: 'Roman Republic', // the "Rome" entries are 500–200 BC, i.e. the Republic
  Parthia: 'Parthian Empire',
  Persi: 'Sasanian Empire', // AD 400 Persia
  'Tufan Empire': 'Tibetan Empire', // Tufan = the Chinese name for the Tibetan Empire
  'Kievan Rus': 'Kyivan Rus',
  'Ming Chinese Empire': 'Ming Empire',
  'Khanate of the Golden Horde': 'Golden Horde',
  'Buwayhid Emirates': 'Buyid Emirates',
  'Buyid Emirate': 'Buyid Emirates',
  'Rashtrakuta state': 'Rashtrakuta',
  'Chalukya Empire': 'Western Chalukyas', // the AD 1000 entry is the Western Chalukya dynasty
  'Kingdom of Sukhotai': 'Sukhothai',
  Oghuz: 'Oghuz Turks',
  'Mahratta states': 'Maratha Confederacy',
  Castille: 'Castile',
  'Chinese warlords': 'Chinese Warlords',
  Neterlands: 'Netherlands',
  UK: 'United Kingdom',
  'United Kingdom of Great Britain and Ireland': 'United Kingdom',
  USA: 'United States',
  'United States of America': 'United States',
  'Austria Hungary': 'Austria-Hungary',
  'Austro-Hungarian Empire': 'Austria-Hungary',
  'Imperial Japan': 'Empire of Japan',
  'Kingdom of Brazil': 'Empire of Brazil', // source error: Brazil was an empire 1822–1889
  Nemay: 'Neman culture', // Stone Age culture of the Neman river basin (Lithuania)
};

// Areas the source draws as separate rulers that belong under one empire.
// The area keeps its own name (shown as a part of the empire).
const PART_OF = {
  'Rome (Diocletianus)': 'Roman Empire', // AD 300: the Tetrarchy's four shares of one empire
  'Rome (Maximian)': 'Roman Empire',
  'Rome (Galerius)': 'Roman Empire',
  'Rome (Constantinus)': 'Roman Empire',
};

// ---- What kind of group is each area? ----------------------------------------------
// state   = an organized political power (kingdom, empire, city-state, khaganate, ...)
// culture = an archaeological culture: named by archaeologists for shared pottery, tools or
//           burial customs; known from material remains, not as a political unit
// people  = an ethnic, language or tribal group shown without a state of its own
// Hand-checked lists come first; the keyword rule (PEOPLE_RE) catches the rest.
const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const KIND_LIST = {
  culture: [
    // Neolithic, Chalcolithic and Bronze Age Eurasia
    'Jōmon', 'Funnel-Beaker', 'Early combware', 'Narva', 'Kelteminar', 'Volga-Kamm', 'Ubaid', 'Namazga',
    'Amuq D', 'Naquada I', 'Dimini', 'Ghassul', 'Indus valley civilization', 'Minoan', 'Cycladic',
    'Afanasevo', 'Andronovo', 'Oxus', 'Beaker', 'Sintashta', 'Únětice', 'Yayoi',
    // the Americas
    'Norte Chico', 'Valdivia', 'Chorrera', 'El Paraiso', 'Chinchoros', 'Chavin', 'Olmec', 'Paracas',
    'Wankarani', 'Nazca', 'Moche', 'Veracruz civilization', 'Anasazi', 'Mogollon',
    'Laurel complex', 'Point Peninsula', 'Couture Complex', 'Goodall Focus', 'Porter', 'Copena', 'Miller',
    'Saugeen Complex', 'Thule', 'Dorset',
    // northern Russian lake cultures
    'Lake Segozerskoye', 'Lake Vygozero',
  ],
  people: [
    // ancient Eurasia
    'Thai', 'Tibeto-Burmanese', 'Koreans', 'Paleo-Koreans', 'Tibetans', 'Burmese', 'Vedic Aryans',
    'Cimerians', 'Celtiberians', 'Arameans', 'Illyrians', 'Phrygians', 'Boii', 'Curonians', 'Samnites',
    'Sabini', 'Sabines', 'Scythians', 'Yuezhi', 'Mon-Khmer', 'Tungus', 'Norsemen', 'Northmen', 'Sarmates',
    'Saces', 'Dacians', 'Alans', 'Blemmyes', 'Iron Age chieftainships',
    // migration-period and early medieval Europe
    'Heruli', 'Geats', 'Swedes', 'Swedes and Goths', 'Alamans', 'Franks', 'Saxons', 'Anglo-Saxons',
    'Basques', 'Frisians', 'Danes', 'Picts', 'Welsh', 'Scots', 'Balts', 'Prussians', 'Kurs', 'Ests',
    'Kryvichs', 'Polanes', 'Polyanians', 'Severians', 'Moravians', 'Huns', 'Sabirs', 'West Getaes',
    'East Getaes', 'Magyars', 'Pechenegs',
    // Inner Asia, Siberia, Volga and the Caucasus
    'Kurykans', 'Karluks', 'Oghuz Turks', 'Khitans', 'Mongols', 'Karakalpaks', 'Samoyèdes', 'Permians',
    'Bashkirs', 'Finns', 'Mordvinians', 'Veps', 'Mari', 'Karelians', 'Chuds', 'Leks', 'Khundzi', 'Durdzuks',
    // Africa, the Pacific, the Americas and the Arctic
    'Kushites', 'Cushites', 'Mandes', 'Azandes', 'Malagasy', 'Guanches', 'Polynesians', 'Maori',
    'Paleo-Inuit', 'Ainu', 'Ainus', 'Sámi', 'Ciboney', 'Guanahatabeyes', 'Arawaks', 'Taino', 'Kalinago',
    'Beothuk', 'Boethuk', 'Innu', 'Shuar', 'Ibadites',
  ],
};
// The source uses some names for their region long before a state existed there.
// Before `from` (approximate year the state formed) the area is shown as `before`, with a note.
const BECAME_STATE = {
  Egypt: { from: -3100, before: 'culture', note: 'Predynastic Egypt: Egypt was unified into one kingdom around 3100 BC.' },
  Elam: { from: -3200, before: 'culture', note: 'Before Elam: the first Elamite state appears around 3200 BC.' },
  Ur: { from: -2900, before: 'culture', note: 'Before the city-state: Ur became a Sumerian city-state around 2900 BC.' },
  Kerma: { from: -2500, before: 'culture', note: 'Before the Kingdom of Kerma, which formed around 2500 BC.' },
  'Hurrian Kingdoms': { from: -2300, before: 'people', note: 'Hurrian kingdoms only appear around 2300 BC.' },
  Hittites: { from: -1650, before: 'people', note: 'The Hittite kingdom was founded around 1650 BC.' },
};

const KIND_OF = new Map(Object.entries(KIND_LIST).flatMap(([kind, names]) => names.map((n) => [fold(n), kind])));
const earlyNote = (name, year) => (BECAME_STATE[name] && year < BECAME_STATE[name].from ? BECAME_STATE[name] : null);
const kindOf = (name, year) => earlyNote(name, year)?.before || KIND_OF.get(fold(name))
  || (/\b(culture|complex)\b/i.test(name) ? 'culture' : PEOPLE_RE.test(fold(name)) ? 'people' : 'state');

const hasLetters = (s) => typeof s === 'string' && /\p{L}/u.test(s);
const clean = (s) => {
  if (!hasLetters(s)) return null;
  const t = s.trim().replace(/\s+/g, ' ');
  return SAME_AS[t] || t;
};

const yearFromFile = (f) => {
  const m = f.match(/^world_(bc)?(\d+)\.geojson$/);
  return m ? (m[1] ? -Number(m[2]) : Number(m[2])) : null;
};

// Rough area of a lon/lat ring (scaled by latitude) — only used to rank sizes.
function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += (x2 - x1) * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
  }
  return Math.abs(a / 2);
}
const ringCentroid = (ring) => {
  let x = 0, y = 0;
  for (const [lng, lat] of ring) { x += lng; y += lat; }
  return [x / ring.length, y / ring.length];
};
const polygonsOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

// The globe treats a ring's direction as meaning: outer edges clockwise, holes counter-clockwise.
// A reversed outer edge is drawn as "the whole world except this shape", so force the right direction.
const isClockwise = (ring) => {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    s += (x2 - x1) * (y2 + y1);
  }
  return s > 0;
};
function orient(geometry) {
  for (const poly of polygonsOf(geometry)) {
    poly.forEach((ring, i) => {
      if (isClockwise(ring) !== (i === 0)) ring.reverse();
    });
    // Double-check on the sphere: no single piece of territory can cover more than half the planet.
    if (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) poly.forEach((ring) => ring.reverse());
  }
  return geometry;
}

async function download(file) {
  const dest = join(rawDir, file);
  if (existsSync(dest)) return readFileSync(dest, 'utf8');
  const res = await fetch(`${SOURCE}/geojson/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(dest, text);
  return text;
}

const sourceIndex = await (await fetch(`${SOURCE}/index.json`)).json();
const snapshots = [];

for (const { filename: file } of sourceIndex.years) {
  const year = yearFromFile(file);
  if (year === null) continue;
  const raw = await download(file);

  const out = await mapshaper.applyCommands(
    '-i in.geojson -simplify 12% keep-shapes -o out.geojson precision=0.01 format=geojson',
    { 'in.geojson': raw },
  );
  const gj = JSON.parse(out['out.geojson']);

  const features = [];
  const groups = new Map();
  for (const f of gj.features) {
    const p = f.properties || {};
    const name = clean(p.NAME);
    const top = clean(p.SUBJECTO) || name;
    const empire = PART_OF[top] || top;
    if (!empire || !f.geometry) continue; // open sea, unclaimed land, or a record with no shape
    const kind = kindOf(empire, year);
    features.push({
      type: 'Feature',
      properties: { NAME: name || empire, EMPIRE: empire, KIND: kind, PREC: p.BORDERPRECISION || 1 },
      geometry: orient(f.geometry),
    });

    const g = groups.get(empire) || { name: empire, kind, area: 0, best: null, bestArea: -1, parts: new Set(), prec: 0 };
    for (const poly of polygonsOf(f.geometry)) {
      const outer = poly[0];
      if (!outer || outer.length < 3) continue;
      const a = ringArea(outer);
      g.area += a;
      if (a > g.bestArea) { g.bestArea = a; g.best = ringCentroid(outer); }
    }
    g.prec = Math.max(g.prec, p.BORDERPRECISION || 1);
    if (name && name !== empire) g.parts.add(name);
    groups.set(empire, g);
  }

  writeFileSync(join(outDir, file), JSON.stringify({ type: 'FeatureCollection', features }));

  snapshots.push({
    year,
    file,
    empires: [...groups.values()]
      .filter((g) => g.best)
      .sort((a, b) => b.area - a.area)
      .map((g) => ({
        name: g.name,
        kind: g.kind,
        area: Math.round(g.area * 10) / 10,
        lng: Math.round(g.best[0] * 100) / 100,
        lat: Math.round(g.best[1] * 100) / 100,
        prec: g.prec,
        ...(earlyNote(g.name, year) && { note: earlyNote(g.name, year).note }),
        parts: [...g.parts].sort(),
      })),
  });
  console.log(`${String(year).padStart(7)}  ${features.length} areas`);
}

snapshots.sort((a, b) => a.year - b.year);
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ snapshots }));
console.log(`Done: ${snapshots.length} snapshots written to data/.`);
