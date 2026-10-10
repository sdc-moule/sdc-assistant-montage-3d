// Cotation indicative entre éléments reconnus sur maillage, en repère monde (mm).
import { add, sub, mul, dot, cross, len, unit, mid, perpendicular, applyPoint, applyDirection, scaleOf } from './vec.js';

const PARALLEL = Math.cos(.5 * Math.PI / 180);
const SIN_PARALLEL = Math.sin(.5 * Math.PI / 180);
const DEG = 180 / Math.PI;
const f2 = x => x.toFixed(2);

// Face locale -> élément monde. m : Matrix4.elements du maillage.
export function toWorldPlane(face, m) {
  return { kind: 'plane', n: unit(applyDirection(m, face.n)), p: applyPoint(m, face.p) };
}
export function toWorldAxis(round, m) {
  return { kind: 'axis', a: unit(applyDirection(m, round.a)), c: applyPoint(m, round.c), h: round.h * scaleOf(m) };
}
export function toWorldRound(round, m) {
  const k = scaleOf(m);
  return { kind: round.kind, c: applyPoint(m, round.c), a: round.a ? unit(applyDirection(m, round.a)) : null,
    u: round.u ? unit(applyDirection(m, round.u)) : null, r: round.r * k, span: round.span };
}

export function measurePair(first, second) {
  let e1 = first, e2 = second;
  if (e1.kind === 'axis' && e2.kind === 'plane') [e1, e2] = [e2, e1];
  if (e1.kind === 'plane' && e2.kind === 'plane') {
    const c = Math.abs(dot(e1.n, e2.n));
    if (c >= PARALLEL) {
      const s = dot(e1.n, sub(e2.p, e1.p)), q2 = add(e1.p, mul(e1.n, s));
      return { type: 'distance', value: Math.abs(s), text: `${f2(Math.abs(s))} mm`, segments: [[e1.p, q2]], arrows: true, label: mid(e1.p, q2) };
    }
    const angle = Math.acos(Math.min(1, c)) * DEG;
    return { type: 'angle', value: angle, text: `∠ ${f2(angle)}° (${f2(180 - angle)}°)`, segments: [[e1.p, e2.p]], arrows: false, label: mid(e1.p, e2.p) };
  }
  if (e1.kind === 'plane' && e2.kind === 'axis') {
    const s = dot(e2.a, e1.n), dd = dot(e1.n, sub(e2.c, e1.p)), foot = sub(e2.c, mul(e1.n, dd));
    if (Math.abs(s) <= SIN_PARALLEL) {
      return { type: 'distance', value: Math.abs(dd), text: `${f2(Math.abs(dd))} mm`, segments: [[e2.c, foot]], arrows: true, label: mid(e2.c, foot) };
    }
    const angle = Math.asin(Math.min(1, Math.abs(s))) * DEG;
    return { type: 'angle', value: angle, text: `∠ ${f2(angle)}°`, segments: [[e2.c, foot]], arrows: false, label: mid(e2.c, foot) };
  }
  if (e1.kind === 'axis' && e2.kind === 'axis') {
    const c = Math.abs(dot(e1.a, e2.a));
    if (c >= PARALLEL) {
      const w = sub(e2.c, e1.c), q1 = add(e1.c, mul(e1.a, dot(e1.a, w))), d = len(sub(e2.c, q1));
      return { type: 'distance', value: d, text: `${f2(d)} mm`, segments: [[q1, e2.c]], arrows: true, label: mid(q1, e2.c) };
    }
    const b = dot(e1.a, e2.a), w0 = sub(e1.c, e2.c), d1 = dot(e1.a, w0), e = dot(e2.a, w0), denom = 1 - b * b;
    const s = (b * e - d1) / denom, t = (e - b * d1) / denom;
    const p1 = add(e1.c, mul(e1.a, s)), p2 = add(e2.c, mul(e2.a, t)), dist = len(sub(p1, p2)), angle = Math.acos(Math.min(1, c)) * DEG;
    const text = dist < 1e-2 ? `∠ ${f2(angle)}°` : `${f2(dist)} mm · ∠ ${f2(angle)}°`;
    return { type: 'mixed', value: dist, angle, text, segments: [[p1, p2]], arrows: dist >= 1e-2, label: mid(p1, p2) };
  }
  throw new Error('Cotation impossible : choisir une face plane ou un cylindre (axe).');
}

// Ø si l'arc couvre au moins 200°, sinon rayon.
export const defaultRoundMode = round => round.kind === 'sphere' || round.span >= 200 / DEG ? 'diameter' : 'radius';

export function measureRound(round, mode = defaultRoundMode(round)) {
  const u = round.u ?? perpendicular(round.a ?? [0, 0, 1]);
  if (mode === 'diameter') {
    const p = add(round.c, mul(u, round.r)), q = sub(round.c, mul(u, round.r));
    return { type: 'diameter', value: 2 * round.r, text: `Ø ${f2(2 * round.r)} mm`, segments: [[q, p]], arrows: true, label: round.c };
  }
  const p = add(round.c, mul(u, round.r));
  return { type: 'radius', value: round.r, text: `R ${f2(round.r)} mm`, segments: [[round.c, p]], arrows: true, arrowStart: false, label: mid(round.c, p) };
}

// Segments à tracer (paires de points) : traits, pointes de flèche ou repères de bout.
export function drawable(result, size) {
  const out = [];
  for (const [p, q] of result.segments) {
    out.push(p, q);
    const d = len(sub(q, p));
    if (d < 1e-9) continue;
    const dir = mul(sub(q, p), 1 / d), side = perpendicular(dir), head = Math.min(size, d / 3);
    const ends = result.arrows ? [[p, dir, result.arrowStart !== false], [q, mul(dir, -1), true]] : [[p, dir, true], [q, dir, true]];
    for (const [tip, inward, show] of ends) {
      if (!show) continue;
      if (result.arrows) {
        for (const sgn of [-1, 1]) out.push(tip, add(tip, add(mul(inward, head), mul(side, sgn * head * .35))));
      } else {
        out.push(sub(tip, mul(side, size * .5)), add(tip, mul(side, size * .5)));
        out.push(sub(tip, mul(cross(dir, side), size * .5)), add(tip, mul(cross(dir, side), size * .5)));
      }
    }
  }
  return out;
}
