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
import { REGIONS, REGION_BY_NAME, regionOf } from './regions.mjs';

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
    '^sa+mi$', '^samis$', '^inuit$', 'athaba', '^tupis$', 'siberians', 'slavs',
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
  Saami: 'Sámi',
  Sami: 'Sámi',
  Samis: 'Sámi',
  Nemay: 'Neman culture', // Stone Age culture of the Neman river basin (Lithuania)
  'Mexihcah (Triple Alliance)': 'Aztec Empire', // 1492 map uses the Nahuatl name
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
// Source labels that need a different name depending on the map's year.
const NAME_BY_YEAR = {
  // central China: the source's 'Sinic' and 'Zhoa' are not names of real states
  Sinic: { [-1500]: 'Shang', [-1000]: 'Western Zhou', [-700]: 'Eastern Zhou' },
  Zhoa: { [-1500]: 'Shang', [-1000]: 'Western Zhou', [-700]: 'Eastern Zhou' },
  // the 1492 map labels the Inca Empire's territory with the name of its main language/people
  Quechua: { 1492: 'Inca Empire' },
};
const renameForYear = (name, year) => (name && (NAME_BY_YEAR[name]?.[year] || (year === 1492 && RENAME_1492[name]))) || name;

// The source's 1492 map of the Americas was built from a present-day map of Indigenous territories,
// so it includes names and lands that did not exist in 1492. Fixes, checked so that every removed
// area is also covered by a correct 1492 nation (nothing is left blank):
//  - DROP: lands of nations forcibly removed to Oklahoma (1830s+), modern reservations and
//    rancherias, and groups that formed after contact (Seminole, Métis, 1855 confederated reservations)
//  - RENAME: modern governments or land-claim names standing on the nation's own traditional land
const DROP_1492 = new RegExp([
  '\\(Oklahoma\\)', '^Seminole', 'Rancheria', 'Mount Tabor Indian Community', '^Wyandot \\(Anderdon\\)',
  'Michif Piyii', '^Mountain Métis$', '^NWT Métis Nation$', 'Kelly Lake Metis', '^Confederated Tribes',
  '^Salish Kootenai', '^Salish & Kootenai Tribes$', 'Mississaugas of the Credit', '^Aseniwuche Winewak', '^Hoopa \\(Reservation\\)$',
].join('|'));
const RENAME_1492 = {
  'Teslin Tlingit Council (Yukon)': 'Inland Tlingit (Teslin)',
  'Teslin Tlingit Council (BC)': 'Inland Tlingit (Teslin)',
  'Carcross/Tagish First Nation (Yukon)': 'Tagish',
  'Carcross/Tagish First Nation (BC)': 'Tagish',
  "Gwitch'in Settlement Region": "Gwich'in Nành",
  'Tagé Cho Hudän (Little Salmon/Carmacks)': 'Northern Tutchone (Tagé Cho Hudän)',
  'Sahtu Dene and Metis': 'Sahtu Dene',
  'Confederated Villages of Lisjan': 'Lisjan Ohlone',
  'Skaruhreh/Tuscarora (North Carolina)': 'Skaruhreh (Tuscarora)',
  'Mohawk (Kalapuya)': 'Kalapuya (Mohawk River)',
};
const droppedIn1492 = (...names) => names.some((n) => n && DROP_1492.test(n));

// Short notes shown on an entry's card.
const NOTES = {
  Xia: 'The Xia dynasty is known mainly from Chinese histories written over a thousand years later, and historians debate whether it existed as a state. Many archaeologists link it to the Erlitou culture (c. 1900–1500 BC).',
};

// In the Americas from 1492 on, the source maps hundreds of Indigenous nations. They had their own
// governments but were not states in the European sense, so they get their own label. These are
// the entries there that ARE states (empires, colonies, modern countries); everything else is a nation.
const AMERICAS_STATES = new Set([
  'Kalmar Union', // 1500: its largest piece is Greenland
  'Aztec Empire', 'Inca Empire', 'Mixtec Empire', 'Maya city-states', 'Kingdom of Hawaii',
  'P’urhépecha', "K'iche'", 'Kaqchikel', // Tarascan state and highland Maya kingdoms, 1492
  'Viceroyalty of New Spain', 'Viceroyalty of the Río de la Plata', 'Cuba (Spain)', 'Hispaniola (Spain)',
  'Spanish Habsburg', 'Spain', 'Portugal', 'England', 'United Kingdom', 'France', 'Netherlands', 'Danemark',
  'Denmark', 'Denmark-Norway', 'Essequibo', 'Surinam', 'Cayenne', 'South Carolina', 'Louisiana',
  "Rupert's Land", 'Acadian Peninsula (UK)', 'Dutch Guiana', 'British Guiana', 'French Guiana',
  'Netherlands Antilles', 'Dominion of Newfoundland', 'Empire of Brazil',
  'United States', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Bolivia', 'Colombia', 'Venezuela', 'Peru',
  'Ecuador', 'Chile', 'Uruguay', 'Paraguay', 'Guyana', 'Suriname', 'Belize', 'Guatemala', 'Honduras',
  'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Cuba', 'Haiti', 'Dominican Republic', 'Jamaica',
  'Puerto Rico', 'Bahamas', 'Turks and Caicos Islands', 'Trinidad', 'Barbados', 'Martinique', 'Guadeloupe',
  'Dominica', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Antigua and Barbuda', 'Grenada',
  'Montserrat', 'Anguilla', 'Saint Martin', 'Saint Barthelemy', 'Saint Kitts and Nevis',
  'United States Virgin Islands', 'Greenland', 'Samoa', 'American Samoa', 'Niue', 'Tonga',
  'Wallis and Futuna Islands',
]);
const isAmericasNation = (name, year, lng) => year >= 1492 && lng < -30 && !AMERICAS_STATES.has(name);
// Broad descriptive groupings stay 'people' even in the Americas (they name a way of life or a language family).
const DESCRIPTIVE = /hunter|gatherer|forager|fisher|tribes|cultures|peoples|polynesians|athaba/i;

const earlyNote = (name, year) => (BECAME_STATE[name] && year < BECAME_STATE[name].from ? BECAME_STATE[name] : null);
const kindOf = (name, year) => earlyNote(name, year)?.before || KIND_OF.get(fold(name))
  || (/\b(culture|complex)\b/i.test(name) ? 'culture' : PEOPLE_RE.test(fold(name)) ? 'people' : 'state');

const hasLetters = (s) => typeof s === 'string' && /\p{L}/u.test(s);
const clean = (s) => {
  if (!hasLetters(s)) return null;
  const t = s.normalize('NFC').trim().replace(/\s+/g, ' '); // NFC: same letters, same encoding
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
    const name = renameForYear(clean(p.NAME), year);
    const top = renameForYear(clean(p.SUBJECTO), year) || name;
    const empire = PART_OF[top] || top;
    if (!empire || !f.geometry) continue; // open sea, unclaimed land, or a record with no shape
    if (year === 1492 && droppedIn1492(clean(p.NAME), clean(p.SUBJECTO))) continue;
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

  // Now that each group's location is known, label Indigenous nations of the Americas.
  for (const g of groups.values()) {
    if (!g.best || !isAmericasNation(g.name, year, g.best[0])) continue;
    if (g.kind === 'state' || (g.kind === 'people' && !DESCRIPTIVE.test(g.name))) g.kind = 'nation';
  }
  // Group Indigenous nations and peoples of the Americas into cultural regions (see regions.mjs).
  const regionTotals = new Map();
  for (const g of groups.values()) {
    if (year < 1492 || !g.best || (g.kind !== 'nation' && g.kind !== 'people')) continue;
    g.region = REGION_BY_NAME[g.name] || regionOf(g.best[1], g.best[0]);
    if (!g.region) continue;
    // label point for the region: area-weighted average of its members' locations
    const t = regionTotals.get(g.region) || { area: 0, lat: 0, lng: 0 };
    const w = Math.max(g.area, 0.01);
    t.area += w; t.lat += g.best[1] * w; t.lng += g.best[0] * w;
    regionTotals.set(g.region, t);
  }
  for (const f of features) {
    const g = groups.get(f.properties.EMPIRE);
    f.properties.KIND = g.kind;
    if (g.region) f.properties.REGION = g.region;
  }

  writeFileSync(join(outDir, file), JSON.stringify({ type: 'FeatureCollection', features }));

  snapshots.push({
    year,
    file,
    regions: [...regionTotals].map(([name, t]) => ({
      name,
      area: Math.round(t.area * 10) / 10,
      // fixed label spot if defined, otherwise the area-weighted centre of the region's nations
      lat: REGIONS[name].label?.[0] ?? Math.round((t.lat / t.area) * 100) / 100,
      lng: REGIONS[name].label?.[1] ?? Math.round((t.lng / t.area) * 100) / 100,
    })).sort((a, b) => b.area - a.area),
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
        ...(g.region && { region: g.region }),
        ...((earlyNote(g.name, year) || NOTES[g.name]) && { note: earlyNote(g.name, year)?.note || NOTES[g.name] }),
        parts: [...g.parts].sort(),
      })),
  });
  console.log(`${String(year).padStart(7)}  ${features.length} areas`);
}

snapshots.sort((a, b) => a.year - b.year);
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ regions: REGIONS, snapshots }));
console.log(`Done: ${snapshots.length} snapshots written to data/.`);
