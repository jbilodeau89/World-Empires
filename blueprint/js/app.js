import * as M from './model.js';
import { formatLen, formatLenInput, formatArea, parseLen, gridLevels } from './units.js';
import { dist, sub, add, mul, norm, perp, dot, lineIntersect, projectToSegment, pointInPolygon, labelPoint, polygonArea, selfIntersects, deg, rad } from './geom.js';

// ---------------------------------------------------------------- state
const STORE_KEY = 'blueprint.autosave.v1';
const PREFS_KEY = 'blueprint.prefs.v1';

const prefs = Object.assign({ units: 'imperial', snap: true, showLengths: true }, loadJSON(PREFS_KEY));
let doc = M.newDoc();
const view = { cx: 180, cy: 120, scale: 2 }; // scale = screen px per inch
{
  const saved = loadJSON(STORE_KEY);
  if (saved && saved.doc && saved.doc.vertices) {
    doc = Object.assign(M.newDoc(), saved.doc);
    doc.settings = Object.assign(M.newDoc().settings, saved.doc.settings);
    if (saved.view) Object.assign(view, saved.view);
  }
}

const ui = {
  tool: 'select',
  selection: null,      // {type: 'wall'|'vertex'|'room', id}
  hover: null,
  hoverWall: null,      // wall highlighted from the panel
  mouse: null,          // {x,y} world, raw
  screen: null,         // {x,y} screen
  snap: null,
  draw: null,
  drag: null,
  pan: null,
  space: false, alt: false, shift: false,
};
const undoStack = [], redoStack = [];

function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveJSON(STORE_KEY, { doc, view }), 250);
}

// ---------------------------------------------------------------- history
const snapshot = () => JSON.stringify(doc);
function commit(before) {
  if (before !== snapshot()) {
    undoStack.push(before);
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
  }
  afterChange();
}
function afterChange() {
  validateSelection();
  persist();
  updateChrome();
  buildPanel();
  render();
}
function undo() {
  if (!undoStack.length) return;
  cancelDraw();
  redoStack.push(snapshot());
  doc = JSON.parse(undoStack.pop());
  afterChange();
}
function redo() {
  if (!redoStack.length) return;
  cancelDraw();
  undoStack.push(snapshot());
  doc = JSON.parse(redoStack.pop());
  afterChange();
}
function validateSelection() {
  const s = ui.selection;
  if (!s) return;
  const coll = { wall: doc.walls, vertex: doc.vertices, room: doc.rooms }[s.type];
  if (!coll || !coll[s.id]) ui.selection = null;
}

// ---------------------------------------------------------------- canvas & view
const stage = document.getElementById('stage');
const canvas = document.getElementById('plan');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize() {
  const r = stage.getBoundingClientRect();
  DPR = window.devicePixelRatio || 1;
  W = r.width; H = r.height;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  render();
}
new ResizeObserver(resize).observe(stage);

const toScreen = p => ({ x: (p.x - view.cx) * view.scale + W / 2, y: (p.y - view.cy) * view.scale + H / 2 });
const toWorld = (sx, sy) => ({ x: (sx - W / 2) / view.scale + view.cx, y: (sy - H / 2) / view.scale + view.cy });

function zoomAt(factor, sx, sy) {
  const before = toWorld(sx, sy);
  view.scale = Math.min(60, Math.max(0.08, view.scale * factor));
  const after = toWorld(sx, sy);
  view.cx += before.x - after.x;
  view.cy += before.y - after.y;
  updateChrome(); persist(); render();
}

function fitView() {
  const b = M.bounds(doc);
  if (!b) { view.cx = 180; view.cy = 120; view.scale = 2; }
  else {
    const w = Math.max(b.maxX - b.minX, 60), h = Math.max(b.maxY - b.minY, 60);
    view.scale = Math.min(60, Math.max(0.08, Math.min((W - 120) / w, (H - 120) / h)));
    view.cx = (b.minX + b.maxX) / 2; view.cy = (b.minY + b.maxY) / 2;
  }
  updateChrome(); persist(); render();
}

function gridInfo() {
  const levels = gridLevels(prefs.units);
  let i = levels.findIndex(l => l * view.scale >= 12);
  if (i < 0) i = levels.length - 1;
  const minor = levels[i];
  let major = levels[i + 1] ?? minor * 10;
  if (major * view.scale < 48 && levels[i + 2]) major = levels[i + 2];
  return { minor, major };
}

// ---------------------------------------------------------------- snapping
/**
 * Snap a raw world point. Order: existing corner > existing wall > grid (with alignment guides).
 * Holding Alt turns snapping off; holding Shift locks the angle to 15° steps from `from`.
 */
function snapPoint(raw, opts = {}) {
  const exclude = opts.exclude || new Set();
  const px = 1 / view.scale;
  const step = gridInfo().minor;
  const snapping = prefs.snap && !ui.alt;

  if (opts.from && ui.shift) {
    const d = sub(raw, opts.from);
    let a = Math.atan2(d.y, d.x);
    a = Math.round(a / rad(15)) * rad(15);
    let L = Math.hypot(d.x, d.y);
    if (snapping) L = Math.round(L / step) * step;
    return { x: opts.from.x + Math.cos(a) * L, y: opts.from.y + Math.sin(a) * L, type: 'angle' };
  }
  if (!snapping) return { ...raw, type: 'free' };

  // pending points of the shape being drawn
  for (const p of opts.extra || []) if (dist(p, raw) <= 10 * px) return { x: p.x, y: p.y, type: 'vertex', pending: true };
  const v = M.vertexNear(doc, raw, 10 * px, exclude);
  if (v) return { x: v.x, y: v.y, type: 'vertex', id: v.id };
  if (!opts.noWall) {
    const w = M.wallNear(doc, raw, 8 * px, exclude);
    if (w) return { x: w.x, y: w.y, type: 'wall', wallId: w.wall.id, t: w.t };
  }
  let x = Math.round(raw.x / step) * step, y = Math.round(raw.y / step) * step;
  const guides = [];
  const tol = 6 * px;
  let bx = tol, by = tol, gx = null, gy = null;
  const cands = [...Object.values(doc.vertices).filter(v => !exclude.has(v.id)), ...(opts.extra || [])];
  for (const c of cands) {
    const dx = Math.abs(c.x - raw.x), dy = Math.abs(c.y - raw.y);
    if (dx < bx) { bx = dx; gx = c; }
    if (dy < by) { by = dy; gy = c; }
  }
  if (gx) { x = gx.x; guides.push({ from: gx, axis: 'x' }); }
  if (gy) { y = gy.y; guides.push({ from: gy, axis: 'y' }); }
  return { x, y, type: 'grid', guides };
}

// ---------------------------------------------------------------- wall geometry for drawing
function wallPolygons() {
  const ends = {};
  for (const w of Object.values(doc.walls)) {
    (ends[w.a] ||= []).push({ w, other: w.b });
    (ends[w.b] ||= []).push({ w, other: w.a });
  }
  const corner = {};
  for (const [vid, list] of Object.entries(ends)) {
    const v = doc.vertices[vid];
    for (const e of list) {
      const o = doc.vertices[e.other];
      e.d = norm(sub(o, v));
      e.ang = Math.atan2(e.d.y, e.d.x);
      e.h = e.w.thickness / 2;
    }
    list.sort((a, b) => a.ang - b.ang);
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      const nl = perp(e.d), nr = mul(nl, -1);
      let left = add(v, mul(nl, e.h)), right = add(v, mul(nr, e.h));
      if (n > 1) {
        const ccw = list[(i + 1) % n], cw = list[(i - 1 + n) % n];
        const lim = 6 * Math.max(e.h, ccw.h, cw.h);
        const L = lineIntersect(left, e.d, add(v, mul(perp(ccw.d), -ccw.h)), ccw.d);
        if (L && dist(L, v) < lim) left = L;
        const R = lineIntersect(right, e.d, add(v, mul(perp(cw.d), cw.h)), cw.d);
        if (R && dist(R, v) < lim) right = R;
      }
      corner[`${e.w.id}:${vid}`] = { left, right };
    }
  }
  const polys = {};
  for (const w of Object.values(doc.walls)) {
    const ca = corner[`${w.id}:${w.a}`], cb = corner[`${w.id}:${w.b}`];
    polys[w.id] = [ca.left, cb.right, doc.vertices[w.b], cb.left, ca.right, doc.vertices[w.a]];
  }
  return polys;
}

// ---------------------------------------------------------------- hit testing
function hitTest(sx, sy) {
  const p = toWorld(sx, sy);
  const px = 1 / view.scale;
  const v = M.vertexNear(doc, p, 7 * px);
  if (v) return { type: 'vertex', id: v.id };
  let best = null, bd = Infinity;
  for (const w of Object.values(doc.walls)) {
    const pr = projectToSegment(p, doc.vertices[w.a], doc.vertices[w.b]);
    const tol = Math.max(w.thickness / 2, 5 * px);
    if (pr.d <= tol && pr.d < bd) { bd = pr.d; best = { type: 'wall', id: w.id }; }
  }
  if (best) return best;
  let room = null, ra = Infinity;
  for (const r of Object.values(doc.rooms)) {
    const pts = M.roomPoints(doc, r);
    if (pointInPolygon(p, pts)) {
      const a = Math.abs(polygonArea(pts));
      if (a < ra) { ra = a; room = r; }
    }
  }
  return room ? { type: 'room', id: room.id } : null;
}

// ---------------------------------------------------------------- rendering
let raf = 0;
function render() { if (!raf) raf = requestAnimationFrame(draw); }

const COLORS = {
  bg: '#fbfbfc', gridMinor: '#eef0f3', gridMajor: '#dde1e7', axis: '#c9cfd8',
  wall: '#2f3640', partition: '#5f6875', wallSel: '#2563eb', wallHover: '#4b5563',
  room: 'rgba(37, 99, 235, 0.045)', roomSel: 'rgba(37, 99, 235, 0.13)', roomHover: 'rgba(37, 99, 235, 0.08)',
  accent: '#2563eb', label: '#1f2430', muted: '#6b7280', guide: '#f97316',
};

function draw() {
  raf = 0;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  drawGrid();

  const sel = ui.selection, hov = ui.hover;
  const isSel = (t, id) => sel && sel.type === t && sel.id === id;
  const isHov = (t, id) => hov && hov.type === t && hov.id === id;

  // rooms
  for (const r of Object.values(doc.rooms)) {
    const pts = M.roomPoints(doc, r);
    if (pts.length < 3) continue;
    pathPoly(pts);
    ctx.fillStyle = isSel('room', r.id) ? COLORS.roomSel : isHov('room', r.id) ? COLORS.roomHover : COLORS.room;
    ctx.fill();
  }

  // walls
  const roomWalls = new Set();
  for (const r of Object.values(doc.rooms)) M.roomWallIds(doc, r).forEach(id => roomWalls.add(id));
  const polys = wallPolygons();
  const selRoomWalls = sel && sel.type === 'room' && doc.rooms[sel.id] ? new Set(M.roomWallIds(doc, doc.rooms[sel.id])) : null;
  for (const w of Object.values(doc.walls)) {
    pathPoly(polys[w.id]);
    let c = roomWalls.has(w.id) ? COLORS.wall : COLORS.partition;
    if (isSel('wall', w.id) || ui.hoverWall === w.id) c = COLORS.wallSel;
    else if (isHov('wall', w.id)) c = COLORS.wallHover;
    ctx.fillStyle = c;
    ctx.fill();
    if (selRoomWalls && selRoomWalls.has(w.id)) { ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  // room labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const r of Object.values(doc.rooms)) {
    const pts = M.roomPoints(doc, r);
    if (pts.length < 3) continue;
    const c = toScreen(labelPoint(pts));
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = COLORS.label;
    ctx.fillText(r.name, c.x, c.y);
  }

  if (prefs.showLengths) drawWallLengths(roomWalls);

  // corners
  const showCorners = ui.tool !== 'pan';
  for (const v of Object.values(doc.vertices)) {
    const s = toScreen(v);
    const on = isSel('vertex', v.id), h = isHov('vertex', v.id);
    if (!showCorners && !on) continue;
    ctx.beginPath();
    ctx.arc(s.x, s.y, on || h ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = on ? COLORS.accent : '#fff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = on || h ? COLORS.accent : '#8a93a0';
    ctx.stroke();
  }

  drawToolPreview();
  document.getElementById('emptyHint').hidden = Object.keys(doc.vertices).length > 0 || !!ui.draw;
}

function pathPoly(pts) {
  ctx.beginPath();
  pts.forEach((p, i) => { const s = toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
  ctx.closePath();
}

function drawGrid() {
  const { minor, major } = gridInfo();
  const tl = toWorld(0, 0), br = toWorld(W, H);
  const lines = (step, color, width) => {
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) { const sx = Math.round((x - view.cx) * view.scale + W / 2) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) { const sy = Math.round((y - view.cy) * view.scale + H / 2) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  if (minor * view.scale >= 6) lines(minor, COLORS.gridMinor, 1);
  lines(major, COLORS.gridMajor, 1);
}

function pill(text, x, y, angle = 0, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = opts.font || '500 11px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = opts.bg || 'rgba(255,255,255,0.92)';
  roundRect(-w / 2, -9, w, 18, 4);
  ctx.fill();
  if (opts.border) { ctx.strokeStyle = opts.border; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.fillStyle = opts.color || COLORS.muted;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0.5);
  ctx.restore();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Readable angle for text running along a segment (never upside down). */
function textAngle(a, b) {
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang < -Math.PI / 2) ang += Math.PI;
  return ang;
}

function drawWallLengths(roomWalls) {
  const owner = {};
  for (const r of Object.values(doc.rooms)) for (const id of M.roomWallIds(doc, r)) (owner[id] ||= []).push(r);
  for (const w of Object.values(doc.walls)) {
    const A = doc.vertices[w.a], B = doc.vertices[w.b];
    const sa = toScreen(A), sb = toScreen(B);
    const sl = dist(sa, sb);
    if (sl < 44) continue;
    let mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    const rooms = owner[w.id] || [];
    if (rooms.length === 1) {
      // put the label on the outside of the room
      const c = labelPoint(M.roomPoints(doc, rooms[0]));
      const n = norm(perp(sub(B, A)));
      const wm = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      const side = dot(sub(c, wm), n) > 0 ? -1 : 1;
      const off = w.thickness / 2 * view.scale + 11;
      mid = add(mid, mul(n, side * off));
    }
    pill(formatLen(dist(A, B), prefs.units), mid.x, mid.y, textAngle(sa, sb));
  }
}

function drawToolPreview() {
  const d = ui.draw;
  const s = ui.snap;
  // alignment guides
  if (s && s.guides) {
    ctx.save();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = COLORS.guide; ctx.lineWidth = 1;
    for (const g of s.guides) {
      const a = toScreen(g.from), b = toScreen(s);
      ctx.beginPath();
      if (g.axis === 'x') { ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, b.y); }
      else { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, a.y); }
      ctx.stroke();
    }
    ctx.restore();
  }

  if (d && (d.kind === 'poly' || d.kind === 'wall')) {
    const pts = d.kind === 'poly' ? d.points : (d.start ? [d.start] : []);
    if (pts.length) {
      const cur = d.cursor || pts[pts.length - 1];
      ctx.save();
      ctx.beginPath();
      pts.forEach((p, i) => { const q = toScreen(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      const c = toScreen(cur);
      ctx.lineTo(c.x, c.y);
      if (d.kind === 'poly' && pts.length >= 2) {
        ctx.fillStyle = 'rgba(37,99,235,0.06)';
        ctx.fill();
      }
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = Math.max(2, (d.kind === 'wall' ? doc.settings.partitionThickness : doc.settings.wallThickness) * view.scale);
      ctx.globalAlpha = 0.35; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.stroke();
      if (d.kind === 'poly' && pts.length >= 2) {
        const f = toScreen(pts[0]);
        ctx.setLineDash([5, 5]); ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(f.x, f.y); ctx.stroke();
      }
      ctx.restore();
      // segment lengths
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = toScreen(pts[i]), b = toScreen(pts[i + 1]);
        if (dist(a, b) > 40) pill(formatLen(dist(pts[i], pts[i + 1]), prefs.units), (a.x + b.x) / 2, (a.y + b.y) / 2, textAngle(a, b));
      }
      const last = pts[pts.length - 1];
      const L = dist(last, cur);
      if (L > 0.01) {
        const a = toScreen(last);
        const ang = (deg(Math.atan2(-(cur.y - last.y), cur.x - last.x)) + 360) % 360;
        pill(`${formatLen(L, prefs.units)}  ·  ${Math.round(ang * 10) / 10}°`, (a.x + c.x) / 2, (a.y + c.y) / 2 - 16, 0,
          { bg: COLORS.accent, color: '#fff', font: '600 11px system-ui, sans-serif' });
      }
      for (const p of pts) { const q = toScreen(p); dot5(q, '#fff', COLORS.accent); }
      if (d.kind === 'poly' && pts.length >= 3 && dist(toScreen(pts[0]), c) < 10) {
        const f = toScreen(pts[0]);
        ctx.beginPath(); ctx.arc(f.x, f.y, 9, 0, Math.PI * 2); ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2; ctx.stroke();
      }
    }
  }

  if (d && d.kind === 'rect' && d.start) {
    const a = d.start, b = d.cursor || a;
    const pts = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    ctx.save();
    pathPoly(pts);
    ctx.fillStyle = 'rgba(37,99,235,0.06)'; ctx.fill();
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = Math.max(2, doc.settings.wallThickness * view.scale);
    ctx.globalAlpha = 0.35; ctx.lineJoin = 'miter'; ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    const sa = toScreen(a), sb = toScreen(b);
    const wdt = Math.abs(b.x - a.x), hgt = Math.abs(b.y - a.y);
    if (wdt > 0.01) pill(formatLen(wdt, prefs.units), (sa.x + sb.x) / 2, Math.min(sa.y, sb.y) - 16, 0, { bg: COLORS.accent, color: '#fff', font: '600 11px system-ui, sans-serif' });
    if (hgt > 0.01) pill(formatLen(hgt, prefs.units), Math.max(sa.x, sb.x) + 14, (sa.y + sb.y) / 2, -Math.PI / 2, { bg: COLORS.accent, color: '#fff', font: '600 11px system-ui, sans-serif' });
  }

  // split preview
  if (ui.tool === 'split' && ui.splitAt) {
    const { wall, point } = ui.splitAt;
    const A = doc.vertices[wall.a], B = doc.vertices[wall.b];
    const q = toScreen(point);
    const n = norm(perp(sub(B, A)));
    const h = (wall.thickness / 2) * view.scale + 6;
    ctx.save();
    ctx.strokeStyle = COLORS.guide; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(q.x - n.x * h, q.y - n.y * h); ctx.lineTo(q.x + n.x * h, q.y + n.y * h); ctx.stroke();
    ctx.restore();
    const sa = toScreen(A), sb = toScreen(B);
    const ang = textAngle(sa, sb);
    const o = mul(n, -(h + 12));
    pill(formatLen(dist(A, point), prefs.units), (sa.x + q.x) / 2 + o.x, (sa.y + q.y) / 2 + o.y, ang, { color: COLORS.guide, border: COLORS.guide });
    pill(formatLen(dist(point, B), prefs.units), (q.x + sb.x) / 2 + o.x, (q.y + sb.y) / 2 + o.y, ang, { color: COLORS.guide, border: COLORS.guide });
  }

  // snap marker
  if (s && (ui.draw || ui.drag || ['rect', 'poly', 'wall'].includes(ui.tool))) {
    const q = toScreen(s);
    ctx.save();
    ctx.strokeStyle = s.type === 'grid' || s.type === 'free' ? COLORS.muted : COLORS.guide;
    ctx.lineWidth = 1.5;
    if (s.type === 'vertex') { ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.stroke(); }
    else if (s.type === 'wall') { ctx.beginPath(); ctx.moveTo(q.x, q.y - 6); ctx.lineTo(q.x + 6, q.y); ctx.lineTo(q.x, q.y + 6); ctx.lineTo(q.x - 6, q.y); ctx.closePath(); ctx.stroke(); }
    else if (!ui.drag) { ctx.beginPath(); ctx.moveTo(q.x - 5, q.y); ctx.lineTo(q.x + 5, q.y); ctx.moveTo(q.x, q.y - 5); ctx.lineTo(q.x, q.y + 5); ctx.stroke(); }
    ctx.restore();
  }
}
function dot5(q, fill, stroke) {
  ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
}

// ---------------------------------------------------------------- tools
const HINTS = {
  select: 'Click to select. Drag a corner to reshape, drag a wall to push it in or out (Shift: move freely). Delete removes.',
  pan: 'Drag to move around the plan. Scroll to zoom.',
  rect: 'Drag out a room, or click two corners. After the first click you can type a size like 12\' x 10\' and press Enter.',
  poly: 'Click each corner. Type a length + Enter for an exact wall (add @45 for an angle). Click the first corner or press Enter to close. Backspace removes the last corner.',
  wall: 'Click to start, click to end. Type a length + Enter for an exact length. Ends when you connect to another wall; Esc stops.',
  split: 'Click a wall where you want to divide it into two walls. You can then drag the new corner to bend it.',
};

const VIEW_ONLY = matchMedia('(max-width: 900px), (pointer: coarse) and (hover: none)');
VIEW_ONLY.addEventListener?.('change', () => updateChrome());

function setTool(t) {
  cancelDraw();
  ui.tool = t;
  ui.splitAt = null;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  updateCursor();
  updateChrome();
  render();
}

function cancelDraw() {
  ui.draw = null;
  hideLenInput();
}

function updateCursor() {
  let c = 'default';
  if (ui.pan || (ui.space && !ui.drag)) c = ui.pan ? 'grabbing' : 'grab';
  else if (ui.tool === 'pan') c = 'grab';
  else if (['rect', 'poly', 'wall', 'split'].includes(ui.tool)) c = 'crosshair';
  else if (ui.hover && ui.hover.type !== 'room') c = 'move';
  else if (ui.hover) c = 'pointer';
  canvas.style.cursor = c;
}

/** Commit a polygon room from a list of world points. */
function finishPoly(points) {
  const pts = points.filter((p, i) => dist(p, points[(i + 1) % points.length]) > 0.05);
  if (pts.length >= 3 && selfIntersects(pts)) { flash('That shape crosses over itself. Keep going or press Backspace to remove corners.'); return; }
  if (pts.length < 3 || Math.abs(polygonArea(pts)) < 1) { cancelDraw(); render(); return; }
  const before = snapshot();
  const ids = pts.map(p => M.resolvePoint(doc, p));
  if (new Set(ids).size !== ids.length) { doc = JSON.parse(before); cancelDraw(); render(); return; }
  const rid = M.addRoom(doc, ids);
  cancelDraw();
  ui.selection = { type: 'room', id: rid };
  commit(before);
}

function addWallSegment(p) {
  const d = ui.draw;
  if (dist(p, d.start) < 0.05) { cancelDraw(); render(); return; }
  const before = snapshot();
  const endExisting = !!(M.vertexNear(doc, p, 0.25) || M.wallNear(doc, p, 0.25));
  const a = d.startVid && doc.vertices[d.startVid] ? d.startVid : M.resolvePoint(doc, d.start);
  const b = M.resolvePoint(doc, p);
  const wid = M.addWallPath(doc, a, b, doc.settings.partitionThickness).pop();
  commit(before);
  if (endExisting) { ui.selection = wid ? { type: 'wall', id: wid } : null; cancelDraw(); buildPanel(); }
  else { d.start = { x: p.x, y: p.y }; d.startVid = b; }
  render();
}

function finishRect(a, b) {
  if (Math.abs(b.x - a.x) < 1 || Math.abs(b.y - a.y) < 1) { cancelDraw(); render(); return; }
  finishPoly([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]);
}

// ---------------------------------------------------------------- pointer input
const touches = new Map();
let pinch = null;

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerdown', e => {
  canvas.focus();
  const sx = e.offsetX, sy = e.offsetY;
  ui.alt = e.altKey; ui.shift = e.shiftKey;

  if (e.pointerType === 'touch') {
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, { x: sx, y: sy });
    if (touches.size === 2) {
      const [p, q] = [...touches.values()];
      pinch = { d: dist(p, q), mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
    }
    return;
  }

  if (e.button === 1 || e.button === 2 || (e.button === 0 && (ui.space || ui.tool === 'pan'))) {
    e.preventDefault();
    ui.pan = { sx, sy, cx: view.cx, cy: view.cy };
    canvas.setPointerCapture(e.pointerId);
    updateCursor();
    return;
  }
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  const raw = toWorld(sx, sy);
  const tool = ui.tool;

  if (tool === 'select') {
    const hit = hitTest(sx, sy);
    ui.selection = hit;
    hideLenInput();
    if (hit) {
      const drag = { hit, start: raw, sx, sy, moved: false, before: snapshot() };
      if (hit.type === 'vertex') {
        const v = doc.vertices[hit.id];
        drag.offset = sub(v, raw);
      } else if (hit.type === 'wall') {
        const w = doc.walls[hit.id];
        drag.orig = { a: { ...doc.vertices[w.a] }, b: { ...doc.vertices[w.b] } };
      } else if (hit.type === 'room') {
        drag.orig = Object.fromEntries(doc.rooms[hit.id].verts.map(id => [id, { ...doc.vertices[id] }]));
      }
      ui.drag = drag;
    }
    buildPanel();
    render();
    return;
  }

  if (tool === 'split') {
    if (ui.splitAt) {
      const before = snapshot();
      const vid = M.splitWall(doc, ui.splitAt.wall.id, ui.splitAt.t);
      ui.selection = { type: 'vertex', id: vid };
      ui.splitAt = null;
      commit(before);
    }
    return;
  }

  if (tool === 'rect') {
    const s = snapPoint(raw);
    if (!ui.draw) { ui.draw = { kind: 'rect', start: { x: s.x, y: s.y }, cursor: { x: s.x, y: s.y }, downAt: { sx, sy } }; }
    else finishRect(ui.draw.start, { x: s.x, y: s.y });
    render();
    return;
  }

  if (tool === 'poly') {
    const pts = ui.draw?.points || [];
    const s = snapPoint(raw, { from: pts[pts.length - 1], extra: pts });
    const p = { x: s.x, y: s.y };
    if (!ui.draw) { ui.draw = { kind: 'poly', points: [p], cursor: p }; render(); return; }
    if (pts.length >= 3 && dist(toScreen(pts[0]), toScreen(p)) < 10) { finishPoly(pts); return; }
    if (dist(toScreen(pts[pts.length - 1]), toScreen(p)) < 4) { if (pts.length >= 3) finishPoly(pts); return; } // double-click
    pts.push(p);
    render();
    return;
  }

  if (tool === 'wall') {
    const s = snapPoint(raw, { from: ui.draw?.start });
    const p = { x: s.x, y: s.y };
    if (!ui.draw) { ui.draw = { kind: 'wall', start: p, cursor: p, startVid: s.type === 'vertex' ? s.id : null }; render(); return; }
    if (dist(toScreen(ui.draw.start), toScreen(p)) < 4) { cancelDraw(); render(); return; } // double-click ends
    addWallSegment(p);
  }
});

canvas.addEventListener('pointermove', e => {
  const sx = e.offsetX, sy = e.offsetY;
  ui.alt = e.altKey; ui.shift = e.shiftKey;

  if (e.pointerType === 'touch') {
    if (!touches.has(e.pointerId)) return;
    const prev = touches.get(e.pointerId);
    touches.set(e.pointerId, { x: sx, y: sy });
    if (touches.size === 1) {
      view.cx -= (sx - prev.x) / view.scale; view.cy -= (sy - prev.y) / view.scale;
    } else if (touches.size === 2 && pinch) {
      const [p, q] = [...touches.values()];
      const d = dist(p, q), mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      view.cx -= (mid.x - pinch.mid.x) / view.scale; view.cy -= (mid.y - pinch.mid.y) / view.scale;
      zoomAt(d / pinch.d, mid.x, mid.y);
      pinch = { d, mid };
    }
    updateChrome(); persist(); render();
    return;
  }

  const raw = toWorld(sx, sy);
  ui.mouse = raw; ui.screen = { x: sx, y: sy };
  updateCoords(raw);

  if (ui.pan) {
    view.cx = ui.pan.cx - (sx - ui.pan.sx) / view.scale;
    view.cy = ui.pan.cy - (sy - ui.pan.sy) / view.scale;
    persist(); render();
    return;
  }

  if (ui.drag) { dragMove(raw, sx, sy); return; }
  hoverUpdate(sx, sy, raw);
});

function hoverUpdate(sx, sy, raw) {
  const tool = ui.tool;
  ui.snap = null;
  if (tool === 'select') {
    const h = hitTest(sx, sy);
    if (JSON.stringify(h) !== JSON.stringify(ui.hover)) { ui.hover = h; render(); }
    updateCursor();
    return;
  }
  if (tool === 'split') {
    const p = raw;
    const w = M.wallNear(doc, p, Math.max(12 / view.scale, 1));
    if (w) {
      const A = doc.vertices[w.wall.a], B = doc.vertices[w.wall.b];
      const L = dist(A, B);
      let along = w.t * L;
      if (prefs.snap && !ui.alt) {
        const step = gridInfo().minor;
        along = Math.round(along / step) * step;
        if (Math.abs(along - L / 2) < 8 / view.scale) along = L / 2; // easy midpoint
      }
      const t = Math.min(0.98, Math.max(0.02, along / L));
      ui.splitAt = { wall: w.wall, t, point: { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t } };
    } else ui.splitAt = null;
    render();
    return;
  }
  if (tool === 'rect') {
    ui.snap = snapPoint(raw, { extra: ui.draw ? [ui.draw.start] : [] });
    if (ui.draw) ui.draw.cursor = { x: ui.snap.x, y: ui.snap.y };
  } else if (tool === 'poly') {
    const pts = ui.draw?.points || [];
    ui.snap = snapPoint(raw, { from: pts[pts.length - 1], extra: pts });
    if (ui.draw) ui.draw.cursor = { x: ui.snap.x, y: ui.snap.y };
  } else if (tool === 'wall') {
    ui.snap = snapPoint(raw, { from: ui.draw?.start, extra: ui.draw ? [ui.draw.start] : [] });
    if (ui.draw) ui.draw.cursor = { x: ui.snap.x, y: ui.snap.y };
  }
  positionLenInput();
  render();
}

function dragMove(raw, sx, sy) {
  const d = ui.drag;
  if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 3) return;
  d.moved = true;
  const step = gridInfo().minor;
  const snapping = prefs.snap && !ui.alt;
  const { hit } = d;
  if (hit.type === 'vertex') {
    const target = add(raw, d.offset);
    const s = snapPoint(target, { exclude: new Set([hit.id]) });
    ui.snap = s;
    Object.assign(doc.vertices[hit.id], { x: s.x, y: s.y });
  } else if (hit.type === 'wall') {
    const w = doc.walls[hit.id];
    const { a, b } = d.orig;
    let delta;
    if (ui.shift) {
      delta = sub(raw, d.start);
      if (snapping) delta = { x: Math.round(delta.x / step) * step, y: Math.round(delta.y / step) * step };
    } else {
      const n = norm(perp(sub(b, a)));
      let off = dot(sub(raw, d.start), n);
      if (snapping) off = Math.round(off / step) * step;
      delta = mul(n, off);
    }
    Object.assign(doc.vertices[w.a], add(a, delta));
    Object.assign(doc.vertices[w.b], add(b, delta));
    ui.snap = null;
  } else if (hit.type === 'room') {
    let delta = sub(raw, d.start);
    if (snapping) delta = { x: Math.round(delta.x / step) * step, y: Math.round(delta.y / step) * step };
    for (const [id, o] of Object.entries(d.orig)) Object.assign(doc.vertices[id], add(o, delta));
  }
  render();
}

canvas.addEventListener('pointerup', e => {
  if (e.pointerType === 'touch') {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    return;
  }
  if (ui.pan) { ui.pan = null; updateCursor(); return; }

  if (ui.drag) {
    const d = ui.drag;
    ui.drag = null;
    if (d.moved && d.hit.type === 'vertex' && ui.snap) {
      const s = ui.snap;
      if (s.type === 'vertex' && s.id && doc.vertices[s.id]) {
        M.mergeVertex(doc, d.hit.id, s.id);
        ui.selection = { type: 'vertex', id: s.id };
      } else if (s.type === 'wall' && doc.walls[s.wallId]) {
        const nv = M.splitWall(doc, s.wallId, s.t);
        M.mergeVertex(doc, d.hit.id, nv);
        ui.selection = { type: 'vertex', id: nv };
      }
    }
    ui.snap = null;
    commit(d.before);
    return;
  }

  // rectangle: drag-release finishes; a click starts click-click mode
  if (ui.draw && ui.draw.kind === 'rect' && ui.draw.downAt) {
    const moved = Math.hypot(e.offsetX - ui.draw.downAt.sx, e.offsetY - ui.draw.downAt.sy);
    ui.draw.downAt = null;
    if (moved > 6) finishRect(ui.draw.start, ui.draw.cursor);
  }
});

canvas.addEventListener('pointerleave', () => {
  if (ui.hover) { ui.hover = null; render(); }
  if (ui.tool === 'split') { ui.splitAt = null; render(); }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.offsetX, e.offsetY);
  } else {
    view.cx += e.deltaX / view.scale;
    persist(); render();
  }
}, { passive: false });

// ---------------------------------------------------------------- typed lengths while drawing
const lenInput = document.getElementById('lenInput');

function drawingAcceptsLength() {
  const d = ui.draw;
  return d && ((d.kind === 'poly' && d.points.length) || (d.kind === 'wall' && d.start) || (d.kind === 'rect' && d.start));
}
function showLenInput(initial) {
  lenInput.hidden = false;
  lenInput.value = initial;
  lenInput.placeholder = ui.draw.kind === 'rect' ? (prefs.units === 'metric' ? '4 x 3.5' : "12' x 10'") : (prefs.units === 'metric' ? '3.5  or  3.5@45' : "10' 6\"  or  10'@45");
  lenInput.classList.remove('bad');
  positionLenInput();
  lenInput.focus();
  lenInput.setSelectionRange(initial.length, initial.length);
}
function hideLenInput() { lenInput.hidden = true; if (document.activeElement === lenInput) canvas.focus(); }
function positionLenInput() {
  if (lenInput.hidden || !ui.screen) return;
  lenInput.style.left = Math.min(W - 160, ui.screen.x + 16) + 'px';
  lenInput.style.top = Math.min(H - 40, ui.screen.y + 16) + 'px';
}
function badInput(el) { el.classList.remove('bad'); void el.offsetWidth; el.classList.add('bad'); }

lenInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') { hideLenInput(); return; }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const d = ui.draw;
  if (!d) { hideLenInput(); return; }
  const text = lenInput.value.trim();

  if (d.kind === 'rect') {
    const parts = text.split(/\s*(?:x|×|\*|,|by)\s*/i).filter(Boolean);
    const wv = parseLen(parts[0], prefs.units);
    const hv = parts[1] != null ? parseLen(parts[1], prefs.units) : wv;
    if (!wv || !hv || wv <= 0 || hv <= 0) { badInput(lenInput); return; }
    const cur = d.cursor || d.start;
    const sxn = cur.x >= d.start.x ? 1 : -1, syn = cur.y >= d.start.y ? 1 : -1;
    hideLenInput();
    finishRect(d.start, { x: d.start.x + sxn * wv, y: d.start.y + syn * hv });
    return;
  }

  const [lenPart, angPart] = text.split(/\s*[@<]\s*/);
  const L = parseLen(lenPart, prefs.units);
  if (!L || L <= 0) { badInput(lenInput); return; }
  const last = d.kind === 'poly' ? d.points[d.points.length - 1] : d.start;
  let dir;
  if (angPart != null && angPart !== '') {
    const a = parseFloat(angPart);
    if (isNaN(a)) { badInput(lenInput); return; }
    dir = { x: Math.cos(rad(a)), y: -Math.sin(rad(a)) };
  } else {
    const cur = d.cursor || last;
    dir = dist(cur, last) > 1e-6 ? norm(sub(cur, last)) : { x: 1, y: 0 };
  }
  const p = add(last, mul(dir, L));
  hideLenInput();
  if (d.kind === 'poly') {
    if (d.points.length >= 3 && dist(p, d.points[0]) < 1) { finishPoly(d.points); return; }
    d.points.push(p);
    d.cursor = add(p, mul(dir, 0.001));
    render();
  } else addWallSegment(p);
});

// ---------------------------------------------------------------- keyboard
const isTyping = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
const TOOL_KEYS = { v: 'select', h: 'pan', r: 'rect', p: 'poly', w: 'wall', s: 'split' };

window.addEventListener('keydown', e => {
  if (e.key === 'Alt') { e.preventDefault(); ui.alt = true; refreshSnapPreview(); updateChrome(); }
  if (e.key === 'Shift') { ui.shift = true; refreshSnapPreview(); }
  if (isTyping(e)) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod) return;

  if (e.key === ' ') { e.preventDefault(); if (!ui.space) { ui.space = true; updateCursor(); } return; }

  if (drawingAcceptsLength() && /^[0-9.]$/.test(e.key)) { e.preventDefault(); showLenInput(e.key); return; }

  if (e.key === 'Escape') {
    if (ui.draw) cancelDraw();
    else { ui.selection = null; buildPanel(); }
    render(); return;
  }
  if (e.key === 'Enter') {
    if (ui.draw?.kind === 'poly' && ui.draw.points.length >= 3) finishPoly(ui.draw.points);
    else if (ui.draw?.kind === 'wall') { cancelDraw(); render(); }
    return;
  }
  if (e.key === 'Backspace' && ui.draw?.kind === 'poly') {
    e.preventDefault();
    ui.draw.points.pop();
    if (!ui.draw.points.length) cancelDraw();
    render(); return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selection) { e.preventDefault(); deleteSelection(); return; }
  if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
  if (k === 'f') { fitView(); return; }
  if (e.key === '+' || e.key === '=') { zoomAt(1.25, W / 2, H / 2); return; }
  if (e.key === '-' || e.key === '_') { zoomAt(0.8, W / 2, H / 2); return; }
});
window.addEventListener('keyup', e => {
  if (e.key === 'Alt') { ui.alt = false; refreshSnapPreview(); updateChrome(); }
  if (e.key === 'Shift') { ui.shift = false; refreshSnapPreview(); }
  if (e.key === ' ') { ui.space = false; updateCursor(); }
});
window.addEventListener('blur', () => { ui.alt = ui.shift = ui.space = false; updateChrome(); });

function refreshSnapPreview() {
  if (!ui.mouse || !ui.screen || ui.pan) return;
  if (ui.drag) dragMove(ui.mouse, ui.screen.x, ui.screen.y);
  else hoverUpdate(ui.screen.x, ui.screen.y, ui.mouse);
}

function deleteSelection() {
  const s = ui.selection;
  if (!s) return;
  const before = snapshot();
  if (s.type === 'wall') M.deleteWall(doc, s.id);
  else if (s.type === 'vertex') M.deleteVertex(doc, s.id);
  else if (s.type === 'room') M.deleteRoom(doc, s.id);
  ui.selection = null;
  commit(before);
}

// ---------------------------------------------------------------- chrome (top & status bars)
const undoBtn = document.getElementById('undoBtn'), redoBtn = document.getElementById('redoBtn');
undoBtn.onclick = undo; redoBtn.onclick = redo;
document.getElementById('zoomIn').onclick = () => zoomAt(1.25, W / 2, H / 2);
document.getElementById('zoomOut').onclick = () => zoomAt(0.8, W / 2, H / 2);
document.getElementById('zoomLabel').onclick = fitView;
document.querySelectorAll('.tool').forEach(b => (b.onclick = () => setTool(b.dataset.tool)));
document.querySelectorAll('[data-units]').forEach(b => (b.onclick = () => {
  prefs.units = b.dataset.units; saveJSON(PREFS_KEY, prefs);
  updateChrome(); buildPanel(); render();
}));

function updateChrome() {
  undoBtn.disabled = !undoStack.length;
  redoBtn.disabled = !redoStack.length;
  document.getElementById('zoomLabel').textContent = Math.round(view.scale / 2 * 100) + '%';
  document.querySelectorAll('[data-units]').forEach(b => b.classList.toggle('on', b.dataset.units === prefs.units));
  document.getElementById('hint').textContent = VIEW_ONLY.matches ? 'Viewing mode: drag to move around, pinch to zoom. Use a computer with a mouse to edit.' : HINTS[ui.tool];
  const snapEl = document.getElementById('snapState');
  snapEl.innerHTML = !prefs.snap ? 'Snapping <b>off</b>' : ui.alt ? 'Snapping <b>paused</b> (Alt)' : 'Snapping <b>on</b> · hold <kbd>Alt</kbd> to turn off';
}
let flashTimer = null;
function flash(msg) {
  const el = document.getElementById('hint');
  el.textContent = msg; el.classList.add('flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.classList.remove('flash'); updateChrome(); }, 3500);
}
function updateCoords(p) {
  const f = v => formatLen(v, prefs.units);
  document.getElementById('coords').textContent = `x ${f(p.x)}   y ${f(p.y)}`;
}

// ---------------------------------------------------------------- properties panel
const panel = document.getElementById('panel');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const L = v => formatLen(v, prefs.units);
const LI = v => formatLenInput(v, prefs.units);

/** Bind a length input: on Enter/blur, parse and call apply(inches). */
function bindLen(el, apply, { min = 0.01 } = {}) {
  const go = () => {
    const v = parseLen(el.value, prefs.units);
    if (v == null || v < min) { badInput(el); return; }
    el.classList.remove('bad');
    apply(v);
  };
  el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); el.blur(); } if (e.key === 'Escape') { buildPanel(); } });
  el.addEventListener('change', go);
}

function visualAngle(a, b) { return (deg(Math.atan2(-(b.y - a.y), b.x - a.x)) + 360) % 360; }

/** Set a wall's length, keeping one end (or the middle) fixed. */
function setWallLength(w, newLen, anchor, fromVid) {
  let A = doc.vertices[w.a], B = doc.vertices[w.b];
  if (fromVid && fromVid === w.b) [A, B] = [B, A];
  const dir = norm(sub(B, A));
  if (anchor === 'end') Object.assign(A, sub(B, mul(dir, newLen)));
  else if (anchor === 'center') {
    const m = mul(add(A, B), 0.5);
    Object.assign(A, sub(m, mul(dir, newLen / 2)));
    Object.assign(B, add(m, mul(dir, newLen / 2)));
  } else Object.assign(B, add(A, mul(dir, newLen)));
}

let lengthAnchor = 'start';

function buildPanel() {
  const s = ui.selection;
  if (!s) return panelPlan();
  if (s.type === 'wall') return panelWall(doc.walls[s.id]);
  if (s.type === 'vertex') return panelVertex(doc.vertices[s.id]);
  if (s.type === 'room') return panelRoom(doc.rooms[s.id]);
}

function panelPlan() {
  const rooms = Object.values(doc.rooms).length, walls = Object.values(doc.walls).length;
  panel.innerHTML = `
    <h2>Plan</h2>
    <p class="sub">${rooms} room${rooms === 1 ? '' : 's'} · ${walls} wall${walls === 1 ? '' : 's'}. Select something to edit it.</p>
    <h3>New walls</h3>
    <div class="field"><label for="pWall">Room walls</label><input id="pWall" type="text" value="${esc(LI(doc.settings.wallThickness))}"></div>
    <div class="field"><label for="pPart">Standalone</label><input id="pPart" type="text" value="${esc(LI(doc.settings.partitionThickness))}"></div>
    <p class="note">Thickness used for walls you draw next.</p>
    <h3>View</h3>
    <label class="toggle">Snap to grid &amp; walls <input id="pSnap" type="checkbox" ${prefs.snap ? 'checked' : ''}></label>
    <label class="toggle">Show wall lengths <input id="pLen" type="checkbox" ${prefs.showLengths ? 'checked' : ''}></label>
    <h3>Shortcuts</h3>
    <ul class="keys">
      <li>Select / Pan <span><kbd>V</kbd> <kbd>H</kbd></span></li>
      <li>Room / Shape / Wall <span><kbd>R</kbd> <kbd>P</kbd> <kbd>W</kbd></span></li>
      <li>Split wall <kbd>S</kbd></li>
      <li>Turn off snapping (hold) <kbd>Alt</kbd></li>
      <li>Lock to 15° angles (hold) <kbd>Shift</kbd></li>
      <li>Pan (hold + drag) <kbd>Space</kbd></li>
      <li>Undo / Redo <span><kbd>Ctrl Z</kbd> <kbd>Ctrl ⇧ Z</kbd></span></li>
      <li>Delete selected <kbd>Del</kbd></li>
      <li>Fit plan to screen <kbd>F</kbd></li>
    </ul>
    <p class="note">While drawing, just start typing a length (like <b>12'6"</b> or <b>3.8m</b>) and press Enter.</p>`;
  bindLen(panel.querySelector('#pWall'), v => { const b = snapshot(); doc.settings.wallThickness = v; commit(b); });
  bindLen(panel.querySelector('#pPart'), v => { const b = snapshot(); doc.settings.partitionThickness = v; commit(b); });
  panel.querySelector('#pSnap').onchange = e => { prefs.snap = e.target.checked; saveJSON(PREFS_KEY, prefs); updateChrome(); };
  panel.querySelector('#pLen').onchange = e => { prefs.showLengths = e.target.checked; saveJSON(PREFS_KEY, prefs); render(); };
}

function panelWall(w) {
  const A = doc.vertices[w.a], B = doc.vertices[w.b];
  const rooms = M.roomsUsingWall(doc, w.id);
  panel.innerHTML = `
    <h2>${rooms.length ? 'Wall' : 'Standalone wall'}</h2>
    <p class="sub">${rooms.length ? 'Part of ' + rooms.map(r => esc(r.name)).join(' and ') : 'Not part of a room (half wall, partition…)'}</p>
    <div class="field"><label for="wLen">Length</label><input id="wLen" type="text" value="${esc(LI(dist(A, B)))}"></div>
    <div class="field"><label for="wAnchor">Keep fixed</label>
      <select id="wAnchor">
        <option value="start">Start corner</option>
        <option value="end">End corner</option>
        <option value="center">Middle</option>
      </select></div>
    <div class="field"><label for="wAng">Angle</label><input id="wAng" type="text" value="${Math.round(visualAngle(A, B) * 100) / 100}°"></div>
    <div class="field"><label for="wThick">Thickness</label><input id="wThick" type="text" value="${esc(LI(w.thickness))}"></div>
    <p class="note">Lengths are measured along the center of the wall. Connected walls stretch to stay attached.</p>
    <div class="btn-row">
      <button class="btn" id="wSplit">Split in half</button>
      <button class="btn danger" id="wDel">Delete</button>
    </div>`;
  const anchorSel = panel.querySelector('#wAnchor');
  anchorSel.value = lengthAnchor;
  anchorSel.onchange = () => (lengthAnchor = anchorSel.value);
  bindLen(panel.querySelector('#wLen'), v => { const b = snapshot(); setWallLength(w, v, lengthAnchor); commit(b); });
  const ang = panel.querySelector('#wAng');
  const applyAng = () => {
    const a = parseFloat(ang.value);
    if (isNaN(a)) { badInput(ang); return; }
    const b = snapshot();
    const len = dist(A, B);
    const dir = { x: Math.cos(rad(a)), y: -Math.sin(rad(a)) };
    if (lengthAnchor === 'end') Object.assign(A, sub(B, mul(dir, len)));
    else if (lengthAnchor === 'center') { const m = mul(add(A, B), 0.5); Object.assign(A, sub(m, mul(dir, len / 2))); Object.assign(B, add(m, mul(dir, len / 2))); }
    else Object.assign(B, add(A, mul(dir, len)));
    commit(b);
  };
  ang.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyAng(); ang.blur(); } });
  ang.addEventListener('change', applyAng);
  bindLen(panel.querySelector('#wThick'), v => { const b = snapshot(); w.thickness = v; commit(b); });
  panel.querySelector('#wSplit').onclick = () => { const b = snapshot(); const vid = M.splitWall(doc, w.id, 0.5); ui.selection = { type: 'vertex', id: vid }; commit(b); };
  panel.querySelector('#wDel').onclick = deleteSelection;
}

function panelVertex(v) {
  const walls = M.wallsAt(doc, v.id);
  let angleInfo = '';
  if (walls.length === 2) {
    const [p, q] = walls.map(w => doc.vertices[w.a === v.id ? w.b : w.a]);
    const a1 = Math.atan2(p.y - v.y, p.x - v.x), a2 = Math.atan2(q.y - v.y, q.x - v.x);
    let d = Math.abs(deg(a1 - a2)) % 360;
    if (d > 180) d = 360 - d;
    angleInfo = `<div class="field"><label>Corner angle</label><span class="readout">${Math.round(d * 10) / 10}°</span></div>`;
  }
  panel.innerHTML = `
    <h2>Corner</h2>
    <p class="sub">${walls.length} wall${walls.length === 1 ? '' : 's'} meet here. Drag it to reshape; drop it on another corner or wall to join them.</p>
    <div class="field"><label for="vX">X</label><input id="vX" type="text" value="${esc(LI(v.x))}"></div>
    <div class="field"><label for="vY">Y</label><input id="vY" type="text" value="${esc(LI(v.y))}"></div>
    ${angleInfo}
    <div class="btn-row"><button class="btn danger" id="vDel">Delete corner</button></div>
    <p class="note">Deleting a corner joins the walls on either side into one straight wall.</p>`;
  bindLen(panel.querySelector('#vX'), x => { const b = snapshot(); v.x = x; commit(b); }, { min: -1e9 });
  bindLen(panel.querySelector('#vY'), y => { const b = snapshot(); v.y = y; commit(b); }, { min: -1e9 });
  panel.querySelector('#vDel').onclick = deleteSelection;
}

const DIRS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
function panelRoom(r) {
  const pts = M.roomPoints(doc, r);
  const area = Math.abs(polygonArea(pts));
  let perim = 0;
  const rows = r.verts.map((vid, i) => {
    const nid = r.verts[(i + 1) % r.verts.length];
    const A = doc.vertices[vid], B = doc.vertices[nid];
    const w = M.findWall(doc, vid, nid);
    const len = dist(A, B);
    perim += len;
    const dir = DIRS[Math.round(visualAngle(A, B) / 45) % 8];
    return `<div class="wall-row" data-wid="${w ? w.id : ''}" data-i="${i}">
      <span class="num">${i + 1}</span><span class="dir">${dir} wall</span>
      <input type="text" value="${esc(LI(len))}" aria-label="Wall ${i + 1} length"></div>`;
  }).join('');
  const thick = M.roomWallIds(doc, r).map(id => doc.walls[id].thickness);
  const sameThick = thick.every(t => Math.abs(t - thick[0]) < 1e-6);
  panel.innerHTML = `
    <h2>Room</h2>
    <p class="sub">Drag inside the room to move it.</p>
    <div class="field"><label for="rName">Name</label><input id="rName" type="text" value="${esc(r.name)}"></div>
    <div class="field"><label>Floor area</label><span class="readout">${formatArea(area, prefs.units)}</span></div>
    <div class="field"><label>Perimeter</label><span class="readout">${L(perim)}</span></div>
    <div class="field"><label for="rThick">Wall thickness</label><input id="rThick" type="text" value="${sameThick ? esc(LI(thick[0])) : ''}" placeholder="mixed"></div>
    <h3>Walls</h3>
    ${rows}
    <p class="note">Going around the room in order: changing a length keeps the wall's first corner in place and moves the next one.</p>
    <div class="btn-row"><button class="btn danger" id="rDel">Delete room</button></div>`;
  const name = panel.querySelector('#rName');
  const applyName = () => { if (name.value.trim() && name.value !== r.name) { const b = snapshot(); r.name = name.value.trim(); commit(b); } };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { applyName(); name.blur(); } });
  name.addEventListener('change', applyName);
  bindLen(panel.querySelector('#rThick'), v => { const b = snapshot(); M.roomWallIds(doc, r).forEach(id => (doc.walls[id].thickness = v)); commit(b); });
  panel.querySelectorAll('.wall-row').forEach(row => {
    const wid = row.dataset.wid, i = +row.dataset.i;
    row.onmouseenter = () => { ui.hoverWall = wid; render(); };
    row.onmouseleave = () => { ui.hoverWall = null; render(); };
    bindLen(row.querySelector('input'), v => {
      const w = doc.walls[wid];
      if (!w) return;
      const b = snapshot();
      setWallLength(w, v, 'start', r.verts[i]);
      commit(b);
    });
  });
  panel.querySelector('#rDel').onclick = deleteSelection;
}

// ---------------------------------------------------------------- start
canvas.tabIndex = 0;
setTool('select');
buildPanel();
updateChrome();
resize();
