// Cultural regions ("culture areas") of the Americas, used to group and colour the hundreds of
// Indigenous nations on the maps from 1492 on. These are the regions commonly used by historians,
// museums and textbooks. Their edges were drawn by anthropologists and are approximate, so a nation
// near a boundary may sit in the neighbouring region. Assignment is by the nation's location.

// hue = colour family on the map; label = fixed [lat, lng] for the region's name on the globe
// (fixed so names don't collide or drift between maps). Neighbouring regions get well-separated hues.
export const REGIONS = {
  // North America
  Arctic: { hue: 200, label: [69, -112] },
  Subarctic: { hue: 150, label: [57.5, -104] },
  'Northwest Coast': { hue: 248, label: [55.5, -131] },
  Plateau: { hue: 290, label: [48, -118] },
  California: { hue: 330, label: [36.5, -121.5] },
  'Great Basin': { hue: 30, label: [40.5, -116] },
  Southwest: { hue: 6, label: [33, -109.5] },
  Plains: { hue: 47, label: [42.5, -101] },
  Northeast: { hue: 95, label: [43.5, -79] },
  Southeast: { hue: 345, label: [32.5, -86] },
  // Mexico, Central America and the Caribbean
  'Northern Mexico': { hue: 185, label: [26.5, -104] },
  Mesoamerica: { hue: 62, label: [18, -97] },
  'Central America': { hue: 295, label: [11.5, -85] },
  Caribbean: { hue: 250, label: [20.5, -74] },
  // South America
  'Northern South America': { hue: 330, label: [6.5, -66] },
  Andes: { hue: 18, label: [-14, -73.5] },
  Amazonia: { hue: 108, label: [-4.5, -63] },
  'Gran Chaco': { hue: 48, label: [-23, -61] },
  'Eastern Brazil': { hue: 200, label: [-12, -45] },
  'Pampas and Patagonia': { hue: 275, label: [-40, -66] },
};

// Linear interpolation through [lat, value] points (used for wavy boundaries like coastlines).
function along(points, lat) {
  if (lat <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [la, va] = points[i - 1];
    const [lb, vb] = points[i];
    if (lat <= lb) return va + ((lat - la) / (lb - la)) * (vb - va);
  }
  return points[points.length - 1][1];
}

// A few nations whose mapped territory misleads a location rule.
export const REGION_BY_NAME = {
  // the source's Wallmapu includes the Argentine pampas the Mapuche expanded into after 1492
  'Wallmapu (Mapuche)': 'Andes',
  Mapuche: 'Andes',
  // the older maps' broad descriptive groupings
  'Subarctic forest hunter-gatherers': 'Subarctic',
  Athabaskan: 'Subarctic',
  Athabascan: 'Subarctic',
  'Plain bison hunters': 'Plains',
  'Plateau fichers and hunter gatherers': 'Plateau',
  'Desert hunter-gatherers': 'Great Basin',
  'North American Pacific foraging, hunting and fishing peoples': 'Northwest Coast',
  'Pampas cultures': 'Pampas and Patagonia',
  'Patagonian shellfish and marine mammal hunters': 'Pampas and Patagonia',
  'Amazon hunter-gatherers': 'Amazonia',
  'Andean hunter-gatherers': 'Andes',
  'Savanna hunter-gatherers': 'Eastern Brazil',
};

// Western edge of the Eastern Brazil region (longitude) by latitude.
const EBRAZIL_WEST = [[-17, -57.5], [-6, -54], [-2, -48]];
// Eastern edge of the Andes (longitude) by latitude.
const ANDES_EAST = [[-56, -68], [-42, -70.5], [-30, -68.5], [-22, -65], [-16, -67.5], [-10, -74], [-4, -77.5], [0, -77], [5, -74], [11, -72.5]];
// Eastern edge of the Northwest Coast strip (longitude) by latitude.
const NWC_EAST = [[40, -123], [44, -122.2], [48, -121.8], [52, -125.5], [55, -128.5], [57, -131], [59, -135], [61, -144]];
// Eastern edge of California (Sierra Nevada crest; desert south) by latitude.
const CAL_EAST = [[32.5, -115.7], [35.2, -115.7], [35.5, -118.3], [37, -118.8], [39, -120], [42, -120.6]];

export function regionOf(lat, lng) {
  if (lng > -30 && (lng < 170 || lat < 50)) return null; // not in the Americas (east of the date line: Aleutians only)
  if (lng < -150 && lat < 50) return null; // Hawaii and Polynesia
  if (lng < -82 && lat < -6) return null; // Easter Island and the open Pacific

  // ---- Arctic: tundra coasts of Alaska, northern Canada and Greenland
  if (lat >= (lng < -100 && lng > -156 ? 68.5 : 66)) return 'Arctic'; // west: only the north-slope tundra
  if (lng > -100 && lng < -30 && lat >= 60) return 'Arctic'; // Hudson Strait, Nunavik, Labrador north, Greenland
  if (lng > -66 && lng < -55 && lat >= 54.5) return 'Arctic'; // Labrador Inuit coast
  if (lng < -155 && lat >= 57.5) return 'Arctic'; // western Alaska coast
  if ((lng < -159 || lng > 170) && lat >= 50 && lat < 57.5) return 'Arctic'; // Aleutians, Alaska Peninsula

  // ---- Northwest Coast
  if (lat >= 40 && lat < 61.5 && lng < along(NWC_EAST, lat)) return 'Northwest Coast';

  // ---- Subarctic: boreal forest across Canada and interior Alaska
  if (lat >= 55) return 'Subarctic';
  if (lat >= 49 && lng > -95) return 'Subarctic'; // Canadian Shield north of the Great Lakes
  if (lat >= 46 && lng > -80 && lng < -56) return lat >= 48.5 ? 'Subarctic' : 'Northeast'; // Quebec north shore vs. Maritimes

  // ---- Plateau (Columbia and Fraser basins)
  if (lat >= 44 && lat < 55 && lng >= -122 && lng < -113.5) return 'Plateau';
  if (lat >= 52 && lat < 55 && lng < -113.5) return 'Subarctic';

  // ---- California (incl. Baja California)
  if (lat >= 32.4 && lat < 42.2 && lng < along(CAL_EAST, lat)) return 'California';
  if (lat >= 22.5 && lat < 32.4 && lng < -112.3 - (lat - 28) * 0.6) return 'California'; // Baja peninsula

  // ---- Great Basin
  if (lat >= 35 && lat < 44.5 && lng >= -121 && lng < (lat < 36.5 ? -114.8 : -109.5)) return 'Great Basin';

  // ---- Southwest (incl. Sonora and Chihuahua deserts)
  if (lat >= 27 && lat < 38 && lng >= -116 && lng < -103) return 'Southwest';

  // ---- Plains (incl. Canadian prairies)
  if (lat >= 27.5 && lat < (lng < -100 ? 53.5 : 50) && lng >= -114 && lng < (lat >= 40 ? -94 : -95.5)) return 'Plains';
  if (lat >= 49) return 'Subarctic'; // anything else in the north (e.g. Manitoba lowlands)

  // ---- Caribbean islands (checked before Southeast so Florida stays Southeast)
  if (lat >= 17.5 && lat <= 23.5 && lng >= -85 && lng <= -61) return 'Caribbean';
  if (lat >= 10 && lat < 17.5 && lng >= -65.5 && lng <= -59) return 'Caribbean';
  if (lat >= 20.5 && lat <= 27.5 && lng >= -79.4 && lng <= -72) return 'Caribbean';

  // ---- Eastern woodlands: Northeast vs. Southeast (roughly the Ohio River / Virginia line)
  if (lat >= 24 && lng >= -95.5) return lat >= 36.5 ? 'Northeast' : 'Southeast';

  // ---- Mexico and Central America
  if (lat >= (lng < -100 ? 22.5 : 21.5) && lng < -95.5) return 'Northern Mexico';
  if (lat >= 13 && lng < -86.5) return 'Mesoamerica';
  if (lat >= 7.2 && lng < -76.5) return 'Central America';

  // ---- South America
  if (lat < -38 && lng > along(ANDES_EAST, lat)) return 'Pampas and Patagonia';
  if (lng <= along(ANDES_EAST, lat)) return lat < -42 ? 'Pampas and Patagonia' : 'Andes';
  if (lat < -29) return 'Pampas and Patagonia';
  if (lat >= -29 && lat < -17 && lng < -57.5) return 'Gran Chaco';
  if (lat < -2 && lat >= -17 && lng >= along(EBRAZIL_WEST, lat)) return 'Eastern Brazil';
  if (lat >= -29 && lat < -17 && lng >= -57.5) return 'Eastern Brazil';
  if (lat >= 4.5) return 'Northern South America';
  return 'Amazonia';
}
