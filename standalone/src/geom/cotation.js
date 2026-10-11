// Cotation : reconnaissance de l'élément touché (plan, axe de cylindre, point) et calcul de la cote.
// Module pur (sans Three.js). Coordonnées en mm dans le repère STEP. Valeurs issues du maillage : INDICATIVES.
import { analyseFace, vec } from './holes.js';
const { dot, sub, add, mul, cross, len, norm } = vec;

/** Élément d'une face B-Rep : { kind:'plan', n, p } | { kind:'axe', d, o, r, coverage } | null. */
export function classifyFace(part, faceIdx) {
  const f = part.faces[faceIdx];
  if (!f) return null;
  const P = part.positions, I = part.index;
  let nx = 0, ny = 0, nz = 0, area = 0, cx = 0, cy = 0, cz = 0, planar = true, ref = null;
  for (let t = f.first; t <= f.last; t++) {
    const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = cross(u, v), l = len(n);
    if (l < 1e-12) continue;
    const nn = mul(n, 1 / l);
    if (!ref) ref = nn; else if (dot(ref, nn) < 0.99995) planar = false;
    nx += n[0]; ny += n[1]; nz += n[2]; area += l;
    cx += (P[a] + P[b] + P[c]) * l / 3; cy += (P[a + 1] + P[b + 1] + P[c + 1]) * l / 3; cz += (P[a + 2] + P[b + 2] + P[c + 2]) * l / 3;
  }
  if (!area) return null;
  if (planar) return { kind: 'plan', n: norm([nx, ny, nz]), p: [cx / area, cy / area, cz / area] };
  const c = analyseFace(part, f.first, f.last);
  if (c) return { kind: 'axe', d: c.axis, o: c.origin, r: c.radius, coverage: c.coverage };
  return null;
}

const fr = (x, d = 2) => x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const deg = r => (r * 180) / Math.PI;
const onAxis = (e, p) => add(e.o, mul(e.d, dot(sub(p, e.o), e.d))); // projeté de p sur l'axe
const PARALLEL = 0.9995;

/** Cote d'un seul élément : Ø (cylindre ≥ 300°) ou R (arc). hit = point touché. */
export function coteCylindre(e, hit) {
  const c = onAxis(e, hit), u = norm(sub(hit, c));
  if (e.coverage >= (300 * Math.PI) / 180) return { kind: 'diametre', value: 2 * e.r, text: `Ø${fr(2 * e.r)}`, p1: sub(c, mul(u, e.r)), p2: add(c, mul(u, e.r)) };
  return { kind: 'rayon', value: e.r, text: `R${fr(e.r)}`, p1: c, p2: add(c, mul(u, e.r)) };
}

/**
 * Cote entre deux éléments A et B (chacun { kind, …, hit }).
 * plan/plan, axe/axe, plan/axe, point/x : distance si parallèles, angle sinon.
 */
export function coteEntre(A, B) {
  const kinds = [A.kind, B.kind].sort().join('/');
  if (kinds === 'plan/plan') {
    const c = Math.abs(dot(A.n, B.n));
    if (c > PARALLEL) { const p1 = A.hit, dist = dot(sub(p1, B.p), B.n); return { kind: 'distance', value: Math.abs(dist), text: fr(Math.abs(dist)), p1, p2: sub(p1, mul(B.n, dist)) }; }
    const a = deg(Math.acos(Math.min(1, c)));
    return { kind: 'angle', value: a, text: `∠ ${fr(a, 1)}°`, p1: A.hit, p2: B.hit };
  }
  if (kinds === 'axe/axe') {
    const c = Math.abs(dot(A.d, B.d));
    const p1 = onAxis(A, A.hit), p2 = onAxis(B, p1), dist = len(sub(p2, p1));
    if (c > PARALLEL) return { kind: 'distance', value: dist, text: `${fr(dist)} (entraxe)`, p1, p2 };
    // axes non parallèles : distance mini entre droites + angle
    const n = norm(cross(A.d, B.d)), dmin = Math.abs(dot(sub(B.o, A.o), n)), a = deg(Math.acos(Math.min(1, c)));
    return { kind: 'angle', value: a, text: `∠ ${fr(a, 1)}° · écart ${fr(dmin)}`, p1: onAxis(A, A.hit), p2: onAxis(B, B.hit) };
  }
  if (kinds === 'axe/plan') {
    const ax = A.kind === 'axe' ? A : B, pl = A.kind === 'plan' ? A : B;
    const s = Math.abs(dot(ax.d, pl.n));
    if (s < 1 - PARALLEL + 1e-4) { const p1 = onAxis(ax, ax.hit), dist = dot(sub(p1, pl.p), pl.n); return { kind: 'distance', value: Math.abs(dist), text: `${fr(Math.abs(dist))} (axe – face)`, p1, p2: sub(p1, mul(pl.n, dist)) }; }
    const a = 90 - deg(Math.acos(Math.min(1, s)));
    return { kind: 'angle', value: a, text: `∠ ${fr(a, 1)}° (axe / face)`, p1: onAxis(ax, ax.hit), p2: pl.hit };
  }
  // au moins un point quelconque
  const pt = A.kind === 'point' ? A : B, o = A.kind === 'point' ? B : A;
  let p2;
  if (o.kind === 'plan') p2 = sub(pt.hit, mul(o.n, dot(sub(pt.hit, o.p), o.n)));
  else if (o.kind === 'axe') p2 = onAxis(o, pt.hit);
  else p2 = o.hit;
  const dist = len(sub(p2, pt.hit));
  return { kind: 'distance', value: dist, text: fr(dist), p1: pt.hit, p2 };
}
