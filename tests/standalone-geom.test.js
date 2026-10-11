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

test('ZIP : extraction du STEP (deflate), identique à l\'original', async () => {
  const { extractCadFromZip } = await import('../standalone/src/geom/unzip.js');
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os'); const path = await import('node:path');
  const src = new URL('./fixtures/bcr_synthetique.step', import.meta.url).pathname;
  const zipPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sdc-')), 'essai.zip');
  execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED); z.write(sys.argv[2],"dossier/BCR essai.step"); z.writestr("lisezmoi.txt","x"); z.close()', zipPath, src]);
  const buf = fs.readFileSync(zipPath);
  const z = await extractCadFromZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  assert.equal(z.name, 'BCR essai.step');
  assert.ok(Buffer.from(z.bytes).equals(fs.readFileSync(src)));
});

test('PNG : la scène intégrée (iTXt UTF-8) est relue à l\'identique', async () => {
  const { pngWithText, pngText } = await import('../standalone/src/geom/png-meta.js');
  const zlib = await import('node:zlib');
  // PNG minimal 1×1 valide
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(Buffer.concat([Buffer.from(t), d])), 8 + d.length); return b; };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
  const txt = JSON.stringify({ name: 'Coupe collecteur éclaté', cuts: { y: 12.5 } });
  const out = pngWithText(png, 'sdc-montage3d-scene', txt);
  assert.equal(pngText(out, 'sdc-montage3d-scene'), txt);
  assert.equal(pngText(png, 'sdc-montage3d-scene'), null);
  assert.deepEqual([...out.subarray(-12, -8)], [0, 0, 0, 0]); // IEND reste le dernier chunk
});

test('STEP : accents ISO-8859-1 bruts réécrits en \\X\\HH, UTF-8 valide conservé', async () => {
  const { fixStepLatin1 } = await import('../standalone/src/geom/step-text.js');
  const base = fs.readFileSync(new URL('./fixtures/bcr_synthetique.step', import.meta.url), 'latin1');
  const raw = Buffer.from(base.replaceAll('PLAQUE_FIXATION_INFERIEURE', 'Semelle Inf\xe9rieure Glissi\xe8re'), 'latin1');
  const { bytes, fixed } = fixStepLatin1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  assert.ok(fixed >= 2);
  const r = occ.ReadStepFile(new Uint8Array(bytes), { linearUnit: 'millimeter' });
  assert.equal(r.meshes[0].name, 'Semelle Inférieure Glissière');
  const utf = Buffer.from('é Ω ✓', 'utf8');
  assert.equal(fixStepLatin1(utf.buffer.slice(utf.byteOffset, utf.byteOffset + utf.length)).fixed, 0);
});

test('cotation : faces parallèles, Ø, entraxe, axe-face, angle', async () => {
  const { classifyFace, coteCylindre, coteEntre } = await import('../standalone/src/geom/cotation.js');
  const ents = p => p.faces.map((_, i) => classifyFace(p, i)).filter(Boolean);
  const plate = byName('PLAQUE_FIXATION_INFERIEURE')[0], col = byName('COLLECTEUR_BCR')[0];
  const pl = ents(plate).filter(e => e.kind === 'plan' && Math.abs(Math.abs(e.n[2]) - 1) < 1e-6);
  const top = pl.find(e => Math.abs(e.p[2] - 30) < 1e-3), bot = pl.find(e => Math.abs(e.p[2]) < 1e-3);
  const d = coteEntre({ ...top, hit: top.p }, { ...bot, hit: bot.p });
  assert.equal(d.kind, 'distance'); assert.ok(Math.abs(d.value - 30) < 1e-3);
  const ce = ents(col), axes = ce.filter(e => e.kind === 'axe');
  const main = axes.find(e => Math.abs(Math.abs(e.d[0]) - 1) < 1e-3);
  const hit = [0, 0, 105];
  const dia = coteCylindre(main, hit);
  assert.equal(dia.kind, 'diametre'); assert.ok(Math.abs(dia.value - 10) < 0.02, `Ø ${dia.value}`);
  const outs = axes.filter(e => Math.abs(Math.abs(e.d[2]) - 1) < 1e-3 && Math.abs(e.r - 5) < 0.05);
  const left = outs.find(e => e.o[0] < -60), right = outs.find(e => e.o[0] > 60);
  const ent = coteEntre({ ...left, hit: [-70, 5, 85] }, { ...right, hit: [70, 5, 85] });
  assert.ok(Math.abs(ent.value - 140) < 0.05, `entraxe ${ent.value}`);
  const bottom = ce.find(e => e.kind === 'plan' && Math.abs(e.p[2] - 80) < 1e-3);
  const af = coteEntre({ ...main, hit: [0, 5, 100] }, { ...bottom, hit: bottom.p });
  assert.ok(Math.abs(af.value - 20) < 0.05, `axe-face ${af.value}`);
  const side = ce.find(e => e.kind === 'plan' && Math.abs(Math.abs(e.n[0]) - 1) < 1e-6);
  const ang = coteEntre({ ...side, hit: side.p }, { ...bottom, hit: bottom.p });
  assert.equal(ang.kind, 'angle'); assert.ok(Math.abs(ang.value - 90) < 0.01);
});
