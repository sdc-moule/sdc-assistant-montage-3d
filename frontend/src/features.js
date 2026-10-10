// Reconnaissance de surfaces (plan, cylindre, sphère) sur un maillage triangulé, repère local du maillage.
// Les sommets du convertisseur FreeCAD appartiennent à la surface exacte : l'ajustement donne donc
// un rayon ou une distance exacts au bruit flottant près. Ces valeurs restent indicatives (maillage, pas BRep).
import { add, sub, mul, dot, cross, len, unit, perpendicular } from './vec.js';

// Incrémenter si la segmentation change : les cotes d'un projet enregistré référencent des indices de faces.
export const FEATURE_VERSION = 1;
const COS_PLANE = Math.cos(Math.PI / 180);
const COS_SHARP = Math.cos(30 * Math.PI / 180);
const TWO_PI = 2 * Math.PI;

function eigenSym(matrix) {
  const a = matrix.map(row => row.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    if (a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2 < 1e-28) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { values: order.map(i => a[i][i]), vectors: order.map(i => [v[0][i], v[1][i], v[2][i]]) };
}

// Résolution de A·x = b par pivot partiel ; null si la matrice est singulière.
function solve(A, b) {
  const n = b.length, m = A.map((row, i) => [...row, b[i]]);
  let scale = 0;
  for (const row of A) for (const x of row) scale = Math.max(scale, Math.abs(x));
  for (let col = 0; col < n; col++) {
    let best = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[best][col])) best = r;
    if (Math.abs(m[best][col]) < 1e-12 * (scale || 1)) return null;
    [m[col], m[best]] = [m[best], m[col]];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      for (let k = col; k <= n; k++) m[r][k] -= f * m[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let k = i + 1; k < n; k++) s -= m[i][k] * x[k];
    x[i] = s / m[i][i];
  }
  return x.every(Number.isFinite) ? x : null;
}

function buildWeld(pos, q) {
  const map = new Map(), out = new Int32Array(pos.length / 3);
  for (let i = 0; i < out.length; i++) {
    const key = `${Math.round(pos[3 * i] / q)},${Math.round(pos[3 * i + 1] / q)},${Math.round(pos[3 * i + 2] / q)}`;
    const found = map.get(key);
    if (found === undefined) { map.set(key, i); out[i] = i; } else out[i] = found;
  }
  return out;
}

export function segmentMesh(pos, index) {
  const nv = pos.length / 3, indexed = Boolean(index);
  const nt = indexed ? Math.floor(index.length / 3) : Math.floor(nv / 3);
  const corner = (t, k) => indexed ? index[3 * t + k] : 3 * t + k;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[3 * i + k]); hi[k] = Math.max(hi[k], pos[3 * i + k]); }
  const diag = nv ? len(sub(hi, lo)) : 0;
  const tol = 2e-5 * diag + 2e-3;
  let weldCache;
  const weld = () => weldCache ??= buildWeld(pos, Math.max(diag * 1e-6, 1e-6));
  const point = i => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  const cr = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = point(corner(t, 0)), c = cross(sub(point(corner(t, 1)), a), sub(point(corner(t, 2)), a));
    cr[3 * t] = c[0]; cr[3 * t + 1] = c[1]; cr[3 * t + 2] = c[2];
  }
  const crossOf = t => [cr[3 * t], cr[3 * t + 1], cr[3 * t + 2]];
  const ctx = { corner, point, crossOf, tol };

  // Composantes connexes par indices de sommets : avec le convertisseur, une face BRep = une composante.
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const base = indexed ? v => v : v => weld()[v];
  for (let t = 0; t < nt; t++) {
    const r0 = find(base(corner(t, 0)));
    for (const k of [1, 2]) { const r = find(base(corner(t, k))); if (r !== r0) parent[r] = r0; }
  }
  const groups = new Map();
  for (let t = 0; t < nt; t++) {
    const r = find(base(corner(t, 0)));
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }

  function split(tris) {
    // Découpe d'un groupe non reconnu aux arêtes vives (> 30°), adjacence par positions soudées.
    const w = weld(), edges = new Map(), local = new Set(tris);
    const key = (a, b) => a < b ? a * nv + b : b * nv + a;
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const e = key(w[corner(t, k)], w[corner(t, (k + 1) % 3)]);
      if (!edges.has(e)) edges.set(e, []);
      edges.get(e).push(t);
    }
    const seen = new Set(), regions = [];
    for (const seed of tris) {
      if (seen.has(seed)) continue;
      const region = [seed], stack = [seed]; seen.add(seed);
      while (stack.length) {
        const t = stack.pop(), nt1 = crossOf(t), l1 = len(nt1);
        for (let k = 0; k < 3; k++) for (const other of edges.get(key(w[corner(t, k)], w[corner(t, (k + 1) % 3)]))) {
          if (seen.has(other) || !local.has(other)) continue;
          const n2 = crossOf(other), l2 = len(n2);
          if (l1 > 1e-12 && l2 > 1e-12 && dot(nt1, n2) < COS_SHARP * l1 * l2) continue;
          seen.add(other); region.push(other); stack.push(other);
        }
      }
      regions.push(region);
    }
    return regions;
  }

  const faces = [];
  for (const tris of groups.values()) {
    let face = classify(ctx, tris);
    if (face.kind === 'other' && tris.length > 1) {
      const parts = split(tris);
      if (parts.length > 1) { for (const part of parts) faces.push(classify(ctx, part)); continue; }
    }
    faces.push(face);
  }
  const triFace = new Int32Array(nt);
  faces.forEach((face, i) => { for (const t of face.tris) triFace[t] = i; });
  return { faces, triFace, tol, diag };
}

function classify(ctx, triList) {
  const tris = Int32Array.from(triList), vertSet = new Set();
  for (const t of tris) for (let k = 0; k < 3; k++) vertSet.add(ctx.corner(t, k));
  const verts = Int32Array.from(vertSet);
  const face = fitPlane(ctx, tris, verts) ?? fitCylinder(ctx, tris, verts) ?? fitSphere(ctx, tris, verts) ?? { kind: 'other' };
  return { ...face, tris, verts };
}

function fitPlane(ctx, tris, verts) {
  let normal = [0, 0, 0], centroid = [0, 0, 0], area = 0;
  for (const t of tris) {
    const c = ctx.crossOf(t), a = len(c) / 2;
    normal = add(normal, c); area += a;
    const p0 = ctx.point(ctx.corner(t, 0)), p1 = ctx.point(ctx.corner(t, 1)), p2 = ctx.point(ctx.corner(t, 2));
    centroid = add(centroid, mul(add(add(p0, p1), p2), a / 3));
  }
  if (len(normal) < 1e-12 || area <= 0) return null;
  const n = unit(normal), p = mul(centroid, 1 / area);
  for (const t of tris) { const c = ctx.crossOf(t), l = len(c); if (l > 1e-12 && dot(c, n) < COS_PLANE * l) return null; }
  for (const v of verts) if (Math.abs(dot(sub(ctx.point(v), p), n)) > ctx.tol) return null;
  return { kind: 'plane', n, p, area };
}

function meanPoint(ctx, verts) {
  let m = [0, 0, 0];
  for (const v of verts) m = add(m, ctx.point(v));
  return mul(m, 1 / verts.length);
}

function fitCylinder(ctx, tris, verts) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let W = 0;
  for (const t of tris) {
    const c = ctx.crossOf(t), l = len(c);
    if (l < 1e-12) continue;
    const n = mul(c, 1 / l);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += l * n[i] * n[j];
    W += l;
  }
  if (W === 0) return null;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] /= W;
  const { values, vectors } = eigenSym(C);
  if (values[1] < 2e-4 || values[0] > 0.05 * values[1]) return null;
  const a = unit(vectors[0]), e1 = perpendicular(a), e2 = cross(a, e1), m = meanPoint(ctx, verts);
  const xs = [], ys = [], zs = [];
  for (const v of verts) { const d = sub(ctx.point(v), m); xs.push(dot(d, e1)); ys.push(dot(d, e2)); zs.push(dot(d, a)); }
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i], q = x * x + y * y, row = [x, y, 1];
    for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) A[r][c] += row[r] * row[c]; b[r] -= row[r] * q; }
  }
  const sol = solve(A, b);
  if (!sol) return null;
  const cx = -sol[0] / 2, cy = -sol[1] / 2, r2 = cx * cx + cy * cy - sol[2];
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) sum += (Math.hypot(xs[i] - cx, ys[i] - cy) - r) ** 2;
  if (Math.sqrt(sum / xs.length) > 1e-3 * r + ctx.tol || r > 1e6) return null;
  return { kind: 'cylinder', a, c0: add(add(m, mul(e1, cx)), mul(e2, cy)), r, t0: zs.reduce((x, y) => Math.min(x, y), Infinity), t1: zs.reduce((x, y) => Math.max(x, y), -Infinity) };
}

function fitSphere(ctx, tris, verts) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let W = 0;
  for (const t of tris) {
    const c = ctx.crossOf(t), l = len(c);
    if (l < 1e-12) continue;
    const n = mul(c, 1 / l);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += l * n[i] * n[j];
    W += l;
  }
  if (W === 0) return null;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] /= W;
  if (verts.length < 10 || eigenSym(C).values[0] < 0.01) return null;
  const m = meanPoint(ctx, verts), A = Array.from({ length: 4 }, () => [0, 0, 0, 0]), b = [0, 0, 0, 0];
  for (const v of verts) {
    const d = sub(ctx.point(v), m), row = [2 * d[0], 2 * d[1], 2 * d[2], 1], q = dot(d, d);
    for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) A[r][c] += row[r] * row[c]; b[r] += row[r] * q; }
  }
  const sol = solve(A, b);
  if (!sol) return null;
  const c = [sol[0], sol[1], sol[2]], r2 = sol[3] + dot(c, c);
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let sum = 0;
  for (const v of verts) sum += (len(sub(sub(ctx.point(v), m), c)) - r) ** 2;
  if (Math.sqrt(sum / verts.length) > 1e-3 * r + ctx.tol) return null;
  // Les normales doivent être radiales (huit sommets d'un parallélépipède sont aussi cosphériques).
  const center = add(m, c);
  let radial = 0, total = 0;
  for (const t of tris) {
    const n = ctx.crossOf(t), l = len(n);
    if (l < 1e-12) continue;
    const centroid = mul(add(add(ctx.point(ctx.corner(t, 0)), ctx.point(ctx.corner(t, 1))), ctx.point(ctx.corner(t, 2))), 1 / 3);
    radial += Math.abs(dot(n, unit(sub(centroid, center)))); total += l;
  }
  if (radial < 0.9 * total) return null;
  return { kind: 'sphere', c: center, r };
}

// Cylindre « complet » : fusionne les faces coaxiales de même rayon (un trou est souvent coupé en deux demi-faces).
export function roundOf(pos, seg, faceIndex) {
  const f = seg.faces[faceIndex];
  if (!f) return null;
  if (f.kind === 'sphere') return { kind: 'sphere', c: f.c, r: f.r, a: null, u: null, span: TWO_PI };
  if (f.kind !== 'cylinder') return null;
  const point = i => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]], tol = seg.tol;
  const group = [faceIndex];
  for (let j = 0; j < seg.faces.length; j++) {
    const g = seg.faces[j];
    if (j === faceIndex || g.kind !== 'cylinder' || Math.abs(dot(g.a, f.a)) < .9999 || Math.abs(g.r - f.r) > 1e-3 * f.r + tol) continue;
    const w = sub(g.c0, f.c0), along = dot(w, f.a);
    if (len(sub(w, mul(f.a, along))) > 1e-3 * f.r + tol) continue;
    const sign = dot(g.a, f.a) > 0 ? 1 : -1;
    const lo = along + (sign > 0 ? g.t0 : -g.t1), hi = along + (sign > 0 ? g.t1 : -g.t0);
    if (hi < f.t0 - tol || lo > f.t1 + tol) continue;
    group.push(j);
  }
  const e1 = perpendicular(f.a), e2 = cross(f.a, e1);
  const angles = [];
  let tMin = Infinity, tMax = -Infinity;
  for (const j of group) for (const v of seg.faces[j].verts) {
    const d = sub(point(v), f.c0), t = dot(d, f.a);
    tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
    angles.push(Math.atan2(dot(d, e2), dot(d, e1)));
  }
  angles.sort((x, y) => x - y);
  const uniq = angles.filter((x, i) => i === 0 || x - angles[i - 1] > 1e-6);
  const gaps = uniq.map((x, i) => i + 1 < uniq.length ? uniq[i + 1] - x : uniq[0] + TWO_PI - x);
  const widest = gaps.reduce((best, g, i) => g > gaps[best] ? i : best, 0);
  const typical = [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)];
  let span = TWO_PI, mid = 0;
  if (uniq.length < 3) return null;
  if (gaps[widest] > 2.5 * typical + 1e-9) {
    span = TWO_PI - gaps[widest];
    mid = uniq[(widest + 1) % uniq.length] + span / 2;
  }
  return { kind: 'cylinder', c: add(f.c0, mul(f.a, (tMin + tMax) / 2)), a: f.a, h: (tMax - tMin) / 2, r: f.r, span,
    u: add(mul(e1, Math.cos(mid)), mul(e2, Math.sin(mid))), faces: group };
}
