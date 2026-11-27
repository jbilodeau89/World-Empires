export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const len = a => Math.hypot(a.x, a.y);
export const norm = a => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const perp = a => ({ x: -a.y, y: a.x });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;

/** Closest point on segment ab to p; returns {x,y,t,d}. */
export function projectToSegment(p, a, b) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  let t = L2 === 0 ? 0 : dot(sub(p, a), ab) / L2;
  t = Math.max(0, Math.min(1, t));
  const q = add(a, mul(ab, t));
  return { x: q.x, y: q.y, t, d: dist(p, q) };
}

/** Intersection of lines p + t*r and q + u*s. Returns point or null if parallel. */
export function lineIntersect(p, r, q, s) {
  const rxs = cross(r, s);
  if (Math.abs(rxs) < 1e-9) return null;
  const t = cross(sub(q, p), s) / rxs;
  return add(p, mul(r, t));
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polygonCentroid(pts) {
  const A = polygonArea(pts);
  if (Math.abs(A) < 1e-6) {
    const s = pts.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return mul(s, 1 / pts.length);
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Point inside polygon that is a good spot for a label (centroid, or fallback for concave shapes). */
export function labelPoint(pts) {
  const c = polygonCentroid(pts);
  if (pointInPolygon(c, pts)) return c;
  // fallback: scan horizontal line through centroid y, pick widest interior span midpoint
  const xs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a.y > c.y) !== (b.y > c.y)) xs.push(a.x + (c.y - a.y) * (b.x - a.x) / (b.y - a.y));
  }
  xs.sort((a, b) => a - b);
  let best = null, bw = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > bw) { bw = xs[i + 1] - xs[i]; best = { x: (xs[i] + xs[i + 1]) / 2, y: c.y }; }
  return best || c;
}

export const deg = r => r * 180 / Math.PI;
export const rad = d => d * Math.PI / 180;

function segCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

/** True if any two non-adjacent edges of the closed polygon cross. */
export function selfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}
