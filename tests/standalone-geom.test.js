import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import occt from 'occt-import-js';
import { partsFromOcct } from '../standalone/src/geom/from-occt.js';
import { extractCylinders, eigenSym3, fitCircle2D } from '../standalone/src/geom/holes.js';
import { buildNetworks, closestSegments } from '../standalone/src/geom/circuits.js';
import { meshStats, buildBom } from '../standalone/src/geom/bom.js';

const occ = await occt();
const res = occ.ReadStepFile(new Uint8Array(fs.readFileSync(new URL('./fixtures/bcr_synthetique.step', import.meta.url))),
  { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.1, angularDeflection: 0.3 });
const { parts } = partsFromOcct(res);
const byName = n => parts.filter(p => p.name === n);
const cyl = new Map(parts.map(p => [p.id, extractCylinders(p)]));
const net = buildNetworks(parts, cyl);

test('outils numériques', () => {
  const e = eigenSym3([[2, 0, 0], [0, 1, 0], [0, 0, 3]]);
  assert.deepEqual(e.map(x => Math.round(x.value)), [1, 2, 3]);
  const pts = Array.from({ length: 20 }, (_, i) => [5 + 4 * Math.cos(i), -2 + 4 * Math.sin(i)]);
  const c = fitCircle2D(pts);
  assert.ok(Math.abs(c.r - 4) < 1e-9 && Math.abs(c.cx - 5) < 1e-9);
  assert.ok(closestSegments([0, 0, 0], [10, 0, 0], [5, -5, 1], [5, 5, 1]).distance - 1 < 1e-9);
});

test('lecture STEP : 15 occurrences nommées dans un sous-ensemble', () => {
  assert.equal(parts.length, 15);
  assert.equal(byName('VIS_CHC_M10x40').length, 4);
  assert.ok(parts.every(p => p.path[0] === 'BCR_SYNTHETIQUE_ESSAI'));
});

test('perçages de la plaque porte-empreinte', () => {
  const pe = byName('PLAQUE_PORTE_EMPREINTE')[0];
  const holes = cyl.get(pe.id).holes;
  const feats = net.features.filter(f => f.partId === pe.id);
  const d8 = feats.filter(f => Math.abs(f.diameter - 8) < 0.05);
  assert.equal(d8.length, 5); // le canal coupé par le logement Ø60 reste un seul forage
  assert.ok(d8.filter(f => Math.abs(f.length - 280) < 0.5).length === 2);
  assert.ok(d8.some(f => f.interrupted));
  assert.equal(holes.filter(h => Math.abs(h.diameter - 24) < 0.05).length, 1);
});

test('circuit de refroidissement : 5 perçages Ø8, 3 obturés, 2 ouvertures libres', () => {
  const r = net.networks.find(n => n.kind === 'circuit' && n.diameters.join() === '8');
  assert.ok(r);
  assert.equal(r.features.length, 5);
  assert.equal(r.ports.filter(p => p.state === 'logé').length, 3);
  assert.equal(r.ports.filter(p => p.state === 'libre').length, 2);
});

test('distribution matière : buse + collecteur + busettes reliés, proposé « distribution matière »', () => {
  const r = net.networks.find(n => n.suggestion === 'distribution matière');
  assert.ok(r);
  assert.equal(r.features.length, 7);
  const names = new Set(r.partIds.map(id => parts.find(p => p.id === id).name));
  for (const n of ['COLLECTEUR_BCR', 'BUSETTE_D20', 'BUSE_INJECTION']) assert.ok(names.has(n));
  assert.equal(r.ports.filter(p => p.state === 'libre').length, 3); // 1 entrée + 2 sorties
});

test('logement Ø60 classé alésage, hors des circuits', () => {
  const bores = net.networks.filter(n => n.kind === 'alésage');
  assert.equal(bores.length, 1);
  assert.ok(Math.abs(net.features.find(f => f.id === bores[0].features[0]).diameter - 60) < 0.1);
  assert.ok(net.networks.filter(n => n.kind === 'circuit').every(n => n.diameters.every(d => d < 32)));
});

test('lamages et passages de vis : jamais classés en circuit', () => {
  const fix = net.networks.filter(n => n.suggestion === 'fixation');
  assert.equal(fix.length, 4);
  assert.ok(fix.every(n => n.kind === 'alignement'));
  assert.equal(net.features.filter(f => f.kind === 'étagé').length, 4);
});

test('nomenclature : regroupement nom + géométrie, jumeaux de noms différents non fusionnés', () => {
  const stats = new Map(parts.map(p => [p.id, meshStats(p.positions, p.index)]));
  const bom = buildBom(parts, stats);
  assert.equal(bom.length, 9);
  assert.equal(bom.find(r => r.designation === 'VIS_CHC_M10x40').quantite, 4);
  const y = bom.find(r => r.designation === 'OBTURATEUR_D8_Y');
  assert.equal(y.quantite, 1);
  assert.match(y.notes.join(), /non fusionné/);
  const plate = bom.find(r => r.designation === 'PLAQUE_FIXATION_INFERIEURE');
  assert.deepEqual(plate.dims.map(Math.round), [300, 250, 30]);
});

test('CSV : nombres négatifs conservés, formules neutralisées', async () => {
  const { toCsv } = await import('../standalone/src/geom/bom.js');
  const out = toCsv(['a'], [['-12,5'], ['=SOMME(A1)'], ['-x']]);
  assert.match(out, /"-12,5"/);
  assert.match(out, /"'=SOMME\(A1\)"/);
  assert.match(out, /"'-x"/);
});
