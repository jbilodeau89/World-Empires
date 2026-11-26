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
    '^sa+mi', '^samis$', '^inuit$', '^thule$', '^dorset$', 'athaba', '^tupis$', 'siberians', 'slavs',
  ].join('|'),
  'i',
);

const hasLetters = (s) => typeof s === 'string' && /\p{L}/u.test(s);
const clean = (s) => (hasLetters(s) ? s.trim().replace(/\s+/g, ' ') : null);

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
    const empire = clean(p.SUBJECTO) || name;
    if (!empire || !f.geometry) continue; // open sea, unclaimed land, or a record with no shape
    const kind = PEOPLE_RE.test(empire) ? 'people' : 'state';
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
        parts: [...g.parts].sort(),
      })),
  });
  console.log(`${String(year).padStart(7)}  ${features.length} areas`);
}

snapshots.sort((a, b) => a.year - b.year);
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ snapshots }));
console.log(`Done: ${snapshots.length} snapshots written to data/.`);
