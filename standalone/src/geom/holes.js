// Détection des perçages (faces cylindriques concaves) à partir des maillages par face B-Rep.
// Module pur, sans Three.js : testable sous Node. Toutes les valeurs sont en mm, repère assemblage.
// Les résultats sont des ESTIMATIONS issues du maillage d'affichage, jamais des cotes validées.

const EPS = 1e-12;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a); return l > EPS ? mul(a, 1 / l) : [0, 0, 0]; };
export const vec = { dot, sub, add, mul, cross, len, norm };

/** Valeurs/vecteurs propres d'une matrice symétrique 3x3 (Jacobi). Tri croissant. */
export function eigenSym3(m) {
  const a = [[m[0][0], m[0][1], m[0][2]], [m[1][0], m[1][1], m[1][2]], [m[2][0], m[2][1], m[2][2]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  return [0, 1, 2].map(i => ({ value: a[i][i], vector: [v[0][i], v[1][i], v[2][i]] })).sort((x, y) => x.value - y.value);
}

function basis(axis) {
  const ref = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(axis, ref));
  return [u, cross(axis, u)];
}

/** Ajustement de cercle (Kasa) dans le plan (u,v) ; renvoie centre 2D, rayon, rms relatif. */
export function fitCircle2D(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const [x, y] of pts) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  // [sxx sxy sx; sxy syy sy; sx sy n] [D E F]ᵀ = -[sxz syz sz]ᵀ
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [-sxz, -syz, -sz];
  const det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A);
  if (Math.abs(d) < EPS) return null;
  const sol = [0, 1, 2].map(i => det(A.map((row, r) => row.map((x, c) => (c === i ? b[r] : x)))) / d);
  const cx = -sol[0] / 2, cy = -sol[1] / 2, r2 = cx * cx + cy * cy - sol[2];
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let err = 0;
  for (const [x, y] of pts) err += (Math.hypot(x - cx, y - cy) - r) ** 2;
  return { cx, cy, r, rms: Math.sqrt(err / n) / r };
}

function angularCoverage(pts, cx, cy) {
  const ang = pts.map(([x, y]) => Math.atan2(y - cy, x - cx)).sort((a, b) => a - b);
  let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
  for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
  return 2 * Math.PI - gap;
}

/**
 * Analyse une face (plage de triangles) et renvoie un candidat cylindre ou null.
 * mesh : { positions: Float32Array|number[], index: Uint32Array|number[] }
 */
export function analyseFace(mesh, first, last) {
  const P = mesh.positions, I = mesh.index;
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let area = 0;
  const tris = [];
  const vset = new Set();
  for (let t = first; t <= last; t++) {
    const ia = I[3 * t], ib = I[3 * t + 1], ic = I[3 * t + 2];
    const a = [P[3 * ia], P[3 * ia + 1], P[3 * ia + 2]], b = [P[3 * ib], P[3 * ib + 1], P[3 * ib + 2]], c = [P[3 * ic], P[3 * ic + 1], P[3 * ic + 2]];
    const nn = cross(sub(b, a), sub(c, a)), l = len(nn);
    if (l < EPS) continue;
    const w = l / 2, n = mul(nn, 1 / l);
    area += w;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += w * n[i] * n[j];
    tris.push({ n, c: mul(add(add(a, b), c), 1 / 3), w });
    vset.add(ia); vset.add(ib); vset.add(ic);
  }
  if (tris.length < 4 || area < EPS) return null;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] /= area;
  const eig = eigenSym3(M);
  // Cylindre : normales coplanaires (λ0≈0) et dispersées (λ1 non nul). Plan : λ0≈λ1≈0.
  if (eig[0].value > 0.01 || eig[1].value < 0.03) return null;
  const axis = norm(eig[0].vector);
  const [u, v] = basis(axis);
  const verts = [...vset].map(i => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
  const pts = verts.map(p => [dot(p, u), dot(p, v)]);
  const fit = fitCircle2D(pts);
  if (!fit || fit.rms > 0.03) return null;
  const centre = add(mul(u, fit.cx), mul(v, fit.cy)); // point de l'axe (composante axiale nulle)
  let concave = 0;
  for (const tr of tris) {
    const radial = sub(tr.c, add(centre, mul(axis, dot(tr.c, axis))));
    concave += (dot(radial, tr.n) < 0 ? 1 : -1) * tr.w;
  }
  const ts = verts.map(p => dot(p, axis));
  return {
    axis, origin: centre, radius: fit.r, rms: fit.rms,
    tmin: Math.min(...ts), tmax: Math.max(...ts),
    coverage: angularCoverage(pts, fit.cx, fit.cy),
    concave: concave > 0, area, verts,
  };
}

function lineDistance(a, b) {
  // distance du point d'origine de b à la droite de a (axes supposés parallèles)
  const d = sub(b.origin, a.origin);
  return len(sub(d, mul(a.axis, dot(d, a.axis))));
}

/** Étendue axiale de b exprimée selon l'axe de a (t = projection absolue sur l'axe). */
function rangeIn(a, b) {
  return dot(a.axis, b.axis) >= 0 ? [b.tmin, b.tmax] : [-b.tmax, -b.tmin];
}

/** Réajuste un ensemble de candidats coaxiaux de même rayon (faces scindées). */
function refit(group) {
  const ref = group[0];
  const axis = ref.axis;
  const [u, v] = basis(axis);
  const verts = group.flatMap(g => g.verts);
  const pts = verts.map(p => [dot(p, u), dot(p, v)]);
  const fit = fitCircle2D(pts) ?? { cx: dot(ref.origin, u), cy: dot(ref.origin, v), r: ref.radius, rms: ref.rms };
  const ts = verts.map(p => dot(p, axis));
  return {
    axis, origin: add(mul(u, fit.cx), mul(v, fit.cy)), radius: fit.r, rms: fit.rms,
    tmin: Math.min(...ts), tmax: Math.max(...ts), coverage: angularCoverage(pts, fit.cx, fit.cy),
    concave: ref.concave, area: group.reduce((s, g) => s + g.area, 0), faces: group.length,
  };
}

/**
 * Extrait les cylindres d'une pièce.
 * part : { id, positions, index, faces:[{first,last}] }
 * Retour : { holes:[...], bosses:[...] } ; un perçage = cylindre concave couvrant ≥ 200°.
 */
export function extractCylinders(part, options = {}) {
  const minCoverage = options.minCoverage ?? (200 * Math.PI) / 180;
  const cands = [];
  for (const f of part.faces) {
    const c = analyseFace(part, f.first, f.last);
    if (c) cands.push(c);
  }
  // Fusion des faces coaxiales de même rayon qui se recouvrent ou se touchent.
  const used = new Array(cands.length).fill(false);
  const merged = [];
  for (let i = 0; i < cands.length; i++) {
    if (used[i]) continue;
    const group = [cands[i]]; used[i] = true;
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < cands.length; j++) {
        if (used[j]) continue;
        const a = group[0], b = cands[j];
        if (a.concave !== b.concave || Math.abs(Math.abs(dot(a.axis, b.axis)) - 1) > 1e-3) continue;
        const tol = Math.max(0.02, a.radius * 0.02);
        if (Math.abs(a.radius - b.radius) > tol || lineDistance(a, b) > tol) continue;
        const [bmin, bmax] = rangeIn(a, b);
        const ok = group.some(g => { const [gmin, gmax] = [g.tmin, g.tmax]; return bmin <= gmax + 0.05 && bmax >= gmin - 0.05; });
        if (!ok) continue;
        // ramener b dans le sens de a
        if (dot(a.axis, b.axis) < 0) cands[j] = { ...b, axis: a.axis, tmin: -b.tmax, tmax: -b.tmin };
        group.push(cands[j]); used[j] = true; grew = true;
      }
    }
    merged.push(refit(group));
  }
  const holes = [], bosses = [];
  for (const c of merged) {
    const item = finalise(c, part.id);
    if (c.concave && c.coverage >= minCoverage) holes.push(item);
    else if (!c.concave && c.coverage >= minCoverage) bosses.push(item);
  }
  return { holes, bosses };
}

function finalise(c, partId) {
  // Axe orienté de façon canonique (composante dominante positive) pour des sorties stables.
  let axis = c.axis, tmin = c.tmin, tmax = c.tmax;
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(axis[i]) > Math.abs(axis[m]) ? i : m), 0);
  if (axis[k] < 0) { axis = mul(axis, -1); [tmin, tmax] = [-tmax, -tmin]; }
  const start = add(c.origin, mul(axis, tmin)), end = add(c.origin, mul(axis, tmax));
  return {
    partId, axis, start, end, radius: c.radius, diameter: 2 * c.radius, length: tmax - tmin,
    coverage: c.coverage, rms: c.rms, faces: c.faces ?? 1,
  };
}

const AXIS_NAMES = ['X', 'Y', 'Z'];
/** Nom lisible de la direction d'un axe : « X », « Z », ou « oblique ». */
export function axisLabel(axis) {
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(axis[i]) > Math.abs(axis[m]) ? i : m), 0);
  return Math.abs(axis[k]) > 0.9995 ? AXIS_NAMES[k] : 'oblique';
}

/** Débouchage estimé d'un perçage aux extrémités, d'après l'étendue de la pièce selon l'axe. */
export function openEnds(hole, partPositions, tol = 0.3) {
  const P = partPositions;
  let pmin = Infinity, pmax = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const t = P[i] * hole.axis[0] + P[i + 1] * hole.axis[1] + P[i + 2] * hole.axis[2];
    if (t < pmin) pmin = t; if (t > pmax) pmax = t;
  }
  const ts = dot(hole.start, hole.axis), te = dot(hole.end, hole.axis);
  return { start: ts - pmin < tol, end: pmax - te < tol };
}
