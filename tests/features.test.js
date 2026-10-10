import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentMesh, roundOf } from '../frontend/src/features.js';
import { measurePair, measureRound, toWorldPlane, toWorldAxis, toWorldRound, defaultRoundMode, drawable } from '../frontend/src/dimensions.js';
import { planeSegments } from '../frontend/src/section.js';

// Maillage comme celui du convertisseur : chaque face a ses propres sommets.
function builder() {
  const pos = [], idx = [];
  return {
    pos, idx,
    quad(a, b, c, d) { const o = pos.length / 3; pos.push(...a, ...b, ...c, ...d); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); },
    // Une face BRep : deux polylignes homologues, sommets partagés au sein de la face.
    strip(A, B) {
      const o = pos.length / 3;
      A.forEach((a, i) => pos.push(...a, ...B[i]));
      for (let i = 0; i + 1 < A.length; i++) { const k = o + 2 * i; idx.push(k, k + 2, k + 3, k, k + 3, k + 1); }
    },
    done: () => ({ pos: Float32Array.from(pos), idx: Uint32Array.from(idx) })
  };
}
function box(b, [x0, y0, z0], [x1, y1, z1]) {
  b.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  b.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  b.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  b.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  b.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  b.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
}
// Rondelle : cylindre extérieur R, trou r, épaisseur h, axe Z ; paroi du trou en une ou deux faces.
function ring(b, [cx, cy], R, r, h, steps = 36, split = false) {
  const p = (rad, i, z) => [cx + rad * Math.cos(2 * Math.PI * i / steps), cy + rad * Math.sin(2 * Math.PI * i / steps), z];
  const loop = (rad, z, from = 0, to = steps) => Array.from({ length: to - from + 1 }, (_, k) => p(rad, from + k, z));
  b.strip(loop(R, 0), loop(R, h));
  b.strip(loop(R, 0), loop(r, 0));
  b.strip(loop(R, h), loop(r, h));
  if (split) { b.strip(loop(r, 0, 0, steps / 2), loop(r, h, 0, steps / 2)); b.strip(loop(r, 0, steps / 2, steps), loop(r, h, steps / 2, steps)); }
  else b.strip(loop(r, 0), loop(r, h));
}
const close = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('un parallélépipède donne six plans distincts et leur distance', () => {
  const b = builder(); box(b, [0, 0, 0], [40, 30, 12]);
  const { pos, idx } = b.done(), seg = segmentMesh(pos, idx);
  assert.equal(seg.faces.length, 6);
  assert.ok(seg.faces.every(f => f.kind === 'plane'));
  const bottom = seg.faces.find(f => f.kind === 'plane' && Math.abs(f.n[2]) > .99 && f.p[2] < 1);
  const top = seg.faces.find(f => f.kind === 'plane' && Math.abs(f.n[2]) > .99 && f.p[2] > 1);
  const result = measurePair(toWorldPlane(bottom, identity), toWorldPlane(top, identity));
  assert.equal(result.type, 'distance'); close(result.value, 12);
  const side = seg.faces.find(f => Math.abs(f.n[0]) > .99 && f.p[0] > 1);
  const angle = measurePair(toWorldPlane(bottom, identity), toWorldPlane(side, identity));
  assert.equal(angle.type, 'angle'); close(angle.value, 90);
});

test('maillage soudé : les arêtes vives séparent encore les faces', () => {
  // Boîte sans duplication de sommets (8 sommets partagés).
  const pos = Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5]);
  const idx = Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
  const seg = segmentMesh(pos, idx);
  assert.equal(seg.faces.length, 6);
  assert.ok(seg.faces.every(f => f.kind === 'plane'));
});

test('cylindre : rayon, axe et diamètre ; demi-faces fusionnées', () => {
  for (const split of [false, true]) {
    const b = builder(); ring(b, [100, 50], 30, 8, 10, 36, split);
    const { pos, idx } = b.done(), seg = segmentMesh(pos, idx);
    const hole = seg.faces.findIndex(f => f.kind === 'cylinder' && Math.abs(f.r - 8) < .01);
    assert.ok(hole >= 0, 'trou reconnu');
    const round = roundOf(pos, seg, hole);
    close(round.r, 8, 1e-3); close(round.c[0], 100); close(round.c[1], 50); close(round.c[2], 5, 1e-2);
    close(Math.abs(round.a[2]), 1, 1e-6);
    assert.ok(round.span > 2 * Math.PI - 1e-6, `arc complet (${round.span})`);
    assert.equal(defaultRoundMode(round), 'diameter');
    const dim = measureRound(toWorldRound(round, identity));
    assert.equal(dim.text, 'Ø 16.00 mm');
  }
});

test('arc de 90° : rayon', () => {
  const b = builder(), steps = 12, R = 6;
  const arc = z => Array.from({ length: steps + 1 }, (_, i) => [R * Math.cos(Math.PI / 2 * i / steps), R * Math.sin(Math.PI / 2 * i / steps), z]);
  b.strip(arc(0), arc(20));
  const { pos, idx } = b.done(), seg = segmentMesh(pos, idx);
  assert.equal(seg.faces.length, 1);
  const round = roundOf(pos, seg, 0);
  close(round.r, 6, 1e-3); close(round.span, Math.PI / 2, 1e-4);
  assert.equal(defaultRoundMode(round), 'radius');
  assert.equal(measureRound(round).text, 'R 6.00 mm');
  assert.equal(measureRound(round, 'diameter').text, 'Ø 12.00 mm');
});

test('entre axes parallèles, face et axe', () => {
  const b = builder(); ring(b, [0, 0], 30, 5, 10); ring(b, [40, 0], 30, 5, 10);
  const { pos, idx } = b.done(), seg = segmentMesh(pos, idx);
  const holes = seg.faces.map((f, i) => [f, i]).filter(([f]) => f.kind === 'cylinder' && Math.abs(f.r - 5) < .01);
  assert.equal(holes.length, 2);
  const axes = holes.map(([, i]) => toWorldAxis(roundOf(pos, seg, i), identity));
  close(measurePair(axes[0], axes[1]).value, 40);
  const top = seg.faces.find(f => f.kind === 'plane' && f.n[2] > .99 && f.p[2] > 9);
  const faceAxis = measurePair(toWorldPlane(top, identity), axes[0]);
  assert.equal(faceAxis.type, 'angle'); close(faceAxis.value, 90);
  const wall = { kind: 'plane', n: [1, 0, 0], p: [100, 0, 0] };
  const parallel = measurePair(wall, axes[1]);
  assert.equal(parallel.type, 'distance'); close(parallel.value, 60);
});

test('axes gauches : distance et angle', () => {
  const r = measurePair({ kind: 'axis', a: [0, 0, 1], c: [0, 0, 0], h: 5 }, { kind: 'axis', a: [1, 0, 0], c: [0, 3, 7], h: 5 });
  assert.equal(r.type, 'mixed'); close(r.value, 3); close(r.angle, 90);
  assert.ok(drawable(r, 1).length >= 2);
});

test('le maillage translaté (éclaté) conserve les mesures', () => {
  const b = builder(); ring(b, [0, 0], 20, 4, 8);
  const { pos, idx } = b.done(), seg = segmentMesh(pos, idx);
  const i = seg.faces.findIndex(f => f.kind === 'cylinder' && Math.abs(f.r - 4) < .01);
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, -5, 30, 1];
  const world = toWorldRound(roundOf(pos, seg, i), m);
  close(world.r, 4); close(world.c[2], 34, 1e-2); close(world.c[0], 10);
});

test('contour de coupe : carré de 10 × 10 pour un cube', () => {
  const b = builder(); box(b, [0, 0, 0], [10, 10, 10]);
  const { pos, idx } = b.done(), segs = planeSegments(pos, idx, [0, 0, 1], -5);
  let total = 0;
  for (let i = 0; i < segs.length; i += 6) total += Math.hypot(segs[i] - segs[i + 3], segs[i + 1] - segs[i + 4], segs[i + 2] - segs[i + 5]);
  close(total, 40, 1e-3);
  for (let i = 2; i < segs.length; i += 3) close(segs[i], 5, 1e-5);
  assert.equal(planeSegments(pos, idx, [0, 0, 1], -50).length, 0);
});

test('contour de coupe d’un cylindre : périmètre du polygone', () => {
  const b = builder(); ring(b, [0, 0], 20, 5, 10, 48);
  const { pos, idx } = b.done(), segs = planeSegments(pos, idx, [0, 0, 1], -5);
  let total = 0;
  for (let i = 0; i < segs.length; i += 6) total += Math.hypot(segs[i] - segs[i + 3], segs[i + 1] - segs[i + 4]);
  const polygon = r => 48 * 2 * r * Math.sin(Math.PI / 48);
  close(total, polygon(20) + polygon(5), 1e-2);
});

test('surface quelconque : non cotable', () => {
  const b = builder();
  // Surface gauche (selle) découpée finement : ni plan, ni cylindre, ni sphère.
  const n = 6, p = (i, j) => [i, j, .3 * (i - n / 2) * (j - n / 2)];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) b.quad(p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1));
  const { pos, idx } = b.done();
  // Les quads ne partagent pas de sommets : chaque quad est une face plane distincte ou 'other'.
  const seg = segmentMesh(pos, idx);
  assert.ok(seg.faces.length > 1);
  assert.equal(roundOf(pos, seg, seg.faces.findIndex(f => f.kind !== 'cylinder')), null);
});
