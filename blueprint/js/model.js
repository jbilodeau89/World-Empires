// The plan document and every operation that changes it.
// Geometry: shared vertices, walls between two vertices, rooms as ordered vertex loops.
// Because walls reference vertices (not copies of points), connected walls stay connected.
import { dist, projectToSegment, polygonArea } from './geom.js';

export function newDoc() {
  return {
    version: 1,
    units: 'imperial',
    nextId: 1,
    vertices: {},
    walls: {},
    rooms: {},
    settings: { wallThickness: 5, partitionThickness: 4, showLengths: true, snap: true },
  };
}

const uid = (doc, p) => `${p}${doc.nextId++}`;

export function addVertex(doc, x, y) {
  const id = uid(doc, 'v');
  doc.vertices[id] = { id, x, y };
  return id;
}

export function findWall(doc, a, b) {
  for (const w of Object.values(doc.walls)) if ((w.a === a && w.b === b) || (w.a === b && w.b === a)) return w;
  return null;
}

export function addWall(doc, a, b, thickness) {
  if (a === b) return null;
  const existing = findWall(doc, a, b);
  if (existing) return existing.id;
  const id = uid(doc, 'w');
  doc.walls[id] = { id, a, b, thickness: thickness ?? doc.settings.wallThickness };
  return id;
}

export function wallsAt(doc, vid) {
  return Object.values(doc.walls).filter(w => w.a === vid || w.b === vid);
}

function roomHasEdge(room, a, b) {
  const n = room.verts.length;
  for (let i = 0; i < n; i++) {
    const p = room.verts[i], q = room.verts[(i + 1) % n];
    if ((p === a && q === b) || (p === b && q === a)) return true;
  }
  return false;
}

export function roomsUsingWall(doc, wid) {
  const w = doc.walls[wid];
  if (!w) return [];
  return Object.values(doc.rooms).filter(r => roomHasEdge(r, w.a, w.b));
}

export function roomWallIds(doc, room) {
  const ids = [];
  const n = room.verts.length;
  for (let i = 0; i < n; i++) {
    const w = findWall(doc, room.verts[i], room.verts[(i + 1) % n]);
    if (w) ids.push(w.id);
  }
  return ids;
}

export function roomPoints(doc, room) {
  return room.verts.map(v => doc.vertices[v]).filter(Boolean);
}

export function roomArea(doc, room) {
  return Math.abs(polygonArea(roomPoints(doc, room)));
}

/**
 * Existing corners that sit on the straight line from a to b, in order (a and b included).
 * Used so a new wall running along an existing wall shares it instead of overlapping it.
 */
export function pathThrough(doc, a, b, tol = 0.25) {
  const A = doc.vertices[a], B = doc.vertices[b];
  const inner = [];
  for (const v of Object.values(doc.vertices)) {
    if (v.id === a || v.id === b) continue;
    const pr = projectToSegment(v, A, B);
    if (pr.d <= tol && pr.t > 1e-4 && pr.t < 1 - 1e-4) inner.push({ id: v.id, t: pr.t });
  }
  inner.sort((p, q) => p.t - q.t);
  return [a, ...inner.map(x => x.id), b];
}

/** Add a wall from a to b, broken at any existing corners along the way. Returns the wall ids. */
export function addWallPath(doc, a, b, thickness) {
  const path = pathThrough(doc, a, b);
  const ids = [];
  for (let i = 0; i + 1 < path.length; i++) { const id = addWall(doc, path[i], path[i + 1], thickness); if (id) ids.push(id); }
  return ids;
}

export function addRoom(doc, verts, name) {
  const id = uid(doc, 'r');
  const count = Object.keys(doc.rooms).length + 1;
  const full = [];
  for (let i = 0; i < verts.length; i++) {
    const path = pathThrough(doc, verts[i], verts[(i + 1) % verts.length]);
    full.push(...path.slice(0, -1));
  }
  const loop = full.filter((v, i) => v !== full[(i + 1) % full.length]);
  doc.rooms[id] = { id, name: name || `Room ${count}`, verts: loop };
  for (let i = 0; i < loop.length; i++) addWall(doc, loop[i], loop[(i + 1) % loop.length], doc.settings.wallThickness);
  return id;
}

/** Split a wall at parameter t (0..1). Returns the new vertex id. */
export function splitWall(doc, wid, t = 0.5) {
  const w = doc.walls[wid];
  if (!w) return null;
  const A = doc.vertices[w.a], B = doc.vertices[w.b];
  const vid = addVertex(doc, A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t);
  for (const r of Object.values(doc.rooms)) {
    const n = r.verts.length;
    for (let i = 0; i < n; i++) {
      const p = r.verts[i], q = r.verts[(i + 1) % n];
      if ((p === w.a && q === w.b) || (p === w.b && q === w.a)) { r.verts.splice(i + 1, 0, vid); break; }
    }
  }
  const thickness = w.thickness;
  const { a, b } = w;
  delete doc.walls[wid];
  const w1 = addWall(doc, a, vid, thickness);
  const w2 = addWall(doc, vid, b, thickness);
  // keep any extra properties (colors etc. in later phases)
  for (const k of Object.keys(w)) if (!['id', 'a', 'b', 'thickness'].includes(k)) { doc.walls[w1][k] = w[k]; doc.walls[w2][k] = w[k]; }
  return vid;
}

export function gc(doc) {
  const used = new Set();
  for (const w of Object.values(doc.walls)) { used.add(w.a); used.add(w.b); }
  for (const r of Object.values(doc.rooms)) r.verts.forEach(v => used.add(v));
  for (const id of Object.keys(doc.vertices)) if (!used.has(id)) delete doc.vertices[id];
}

export function deleteRoom(doc, rid) {
  const room = doc.rooms[rid];
  if (!room) return;
  const wids = roomWallIds(doc, room);
  delete doc.rooms[rid];
  for (const wid of wids) if (roomsUsingWall(doc, wid).length === 0) delete doc.walls[wid];
  gc(doc);
}

/** Delete a wall. Rooms that relied on it are dissolved, but their other walls stay. */
export function deleteWall(doc, wid) {
  for (const r of roomsUsingWall(doc, wid)) delete doc.rooms[r.id];
  delete doc.walls[wid];
  gc(doc);
}

/** Delete a corner. Rooms keep their shape minus that corner; a straight run of two walls is joined. */
export function deleteVertex(doc, vid) {
  const incident = wallsAt(doc, vid);
  const thickness = incident[0]?.thickness;
  for (const r of Object.values(doc.rooms)) {
    const i = r.verts.indexOf(vid);
    if (i < 0) continue;
    const n = r.verts.length;
    const prev = r.verts[(i - 1 + n) % n], next = r.verts[(i + 1) % n];
    r.verts.splice(i, 1);
    if (r.verts.length < 3) delete doc.rooms[r.id];
    else addWall(doc, prev, next, thickness);
  }
  if (incident.length === 2) {
    const ends = incident.map(w => (w.a === vid ? w.b : w.a));
    addWall(doc, ends[0], ends[1], thickness);
  }
  for (const w of incident) delete doc.walls[w.id];
  delete doc.vertices[vid];
  // drop rooms whose edges no longer all have walls
  for (const r of Object.values(doc.rooms)) if (roomWallIds(doc, r).length !== r.verts.length) delete doc.rooms[r.id];
  gc(doc);
}

/** Merge vertex `from` into vertex `into` (e.g. a corner dropped onto another corner). */
export function mergeVertex(doc, from, into) {
  if (from === into) return;
  for (const w of Object.values(doc.walls)) {
    if (w.a === from) w.a = into;
    if (w.b === from) w.b = into;
  }
  const seen = new Map();
  for (const w of Object.values(doc.walls)) {
    if (w.a === w.b) { delete doc.walls[w.id]; continue; }
    const key = [w.a, w.b].sort().join('|');
    if (seen.has(key)) delete doc.walls[w.id];
    else seen.set(key, w.id);
  }
  for (const r of Object.values(doc.rooms)) {
    r.verts = r.verts.map(v => (v === from ? into : v));
    r.verts = r.verts.filter((v, i, arr) => v !== arr[(i + 1) % arr.length]);
    if (r.verts.length < 3 || new Set(r.verts).size !== r.verts.length) delete doc.rooms[r.id];
  }
  delete doc.vertices[from];
  gc(doc);
}

/** Find an existing vertex within tol of p. */
export function vertexNear(doc, p, tol, exclude) {
  let best = null, bd = tol;
  for (const v of Object.values(doc.vertices)) {
    if (exclude && exclude.has(v.id)) continue;
    const d = dist(p, v);
    if (d <= bd) { bd = d; best = v; }
  }
  return best;
}

export function wallNear(doc, p, tol, excludeVerts) {
  let best = null, bd = tol;
  for (const w of Object.values(doc.walls)) {
    if (excludeVerts && (excludeVerts.has(w.a) || excludeVerts.has(w.b))) continue;
    const A = doc.vertices[w.a], B = doc.vertices[w.b];
    const pr = projectToSegment(p, A, B);
    if (pr.d <= bd) { bd = pr.d; best = { wall: w, ...pr }; }
  }
  return best;
}

/**
 * Turn a point into a vertex id, reusing an existing corner or splitting a wall it lands on.
 */
export function resolvePoint(doc, p) {
  const v = vertexNear(doc, p, 0.25);
  if (v) return v.id;
  const w = wallNear(doc, p, 0.25);
  if (w && w.t > 0.001 && w.t < 0.999) {
    const vid = splitWall(doc, w.wall.id, w.t);
    doc.vertices[vid].x = p.x; doc.vertices[vid].y = p.y;
    return vid;
  }
  return addVertex(doc, p.x, p.y);
}

export function wallLength(doc, w) {
  return dist(doc.vertices[w.a], doc.vertices[w.b]);
}

export function bounds(doc) {
  const vs = Object.values(doc.vertices);
  if (!vs.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of vs) { minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); }
  return { minX, minY, maxX, maxY };
}
