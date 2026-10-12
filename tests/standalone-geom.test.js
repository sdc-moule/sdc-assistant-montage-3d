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

// ——— DXF 2D (DXF-01…) ———
import { lireDxf, estDxf, distance, angleEntre, accroche, entiteProche } from '../standalone/src/geom/dxf.js';
const dxfSynth = () => lireDxf(fs.readFileSync(new URL('./fixtures/plan_synthetique.dxf', import.meta.url)));

test('DXF : lecture du plan synthétique (entités, calques, unité)', () => {
  const buf = fs.readFileSync(new URL('./fixtures/plan_synthetique.dxf', import.meta.url));
  assert.ok(estDxf(buf));
  const d = dxfSynth();
  assert.equal(d.unite, 'mm');
  assert.equal(d.items.filter(o => o.kind === 'line').length, 5);
  assert.equal(d.items.filter(o => o.kind === 'circle').length, 3); // cercle, trou inséré, ellipse ronde
  assert.deepEqual(d.calques.map(c => c.nom).sort(), ['0', 'Cache']);
  assert.ok(d.items.find(o => o.layer === 'Cache').pointille, 'calque HIDDEN → pointillé');
  assert.deepEqual([d.cadre.x0, d.cadre.y0, d.cadre.x1, d.cadre.y1].map(v => Math.round(v)), [0, 0, 100, 80]);
});

test('DXF : cotes chiffrées (distance, Ø, R, angle)', () => {
  const d = dxfSynth();
  assert.ok(Math.abs(distance({ x: 0, y: 0 }, { x: 100, y: 60 }) - 116.619) < 1e-3);
  const c = d.items.find(o => o.kind === 'circle' && o.c[0] === 50);
  assert.ok(Math.abs(2 * c.r - 20) < 1e-9, 'Ø 20');
  const a = d.items.find(o => o.kind === 'arc');
  assert.ok(Math.abs(a.r - 15) < 1e-9, 'R 15');
  assert.ok(Math.abs(angleEntre({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }) - 90) < 1e-9);
  const rond = d.items.find(o => o.kind === 'circle' && Math.abs(o.c[0] - 70) < 1e-9);
  assert.ok(Math.abs(rond.r - 5) < 1e-9, 'ellipse de rapport 1 = cercle R5');
});

test('DXF : normale -Z (miroir X) et bloc INSERT', () => {
  const d = dxfSynth();
  const el = d.items.find(o => o.kind === 'ellipse');
  assert.ok(Math.abs(el.c[0] - 40) < 1e-9 && Math.abs(el.c[1] - 20) < 1e-9, 'centre monde (40,20), normale −Z');
  const trou = d.items.find(o => o.kind === 'circle' && Math.abs(o.c[0] - 20) < 1e-9);
  assert.ok(trou && Math.abs(trou.c[1] - 20) < 1e-9 && Math.abs(2 * trou.r - 6) < 1e-9, 'bloc TROU inséré en (20,20), Ø6');
});

test('DXF : accroche (extrémité, centre, intersection) et entité proche', () => {
  const d = dxfSynth();
  const s1 = accroche(d, 99.5, 0.4, 2); assert.equal(s1.t, 'extrémité'); assert.ok(Math.abs(s1.x - 100) < 1e-9 && Math.abs(s1.y) < 1e-9);
  const s2 = accroche(d, 50.3, 30.2, 2); assert.equal(s2.t, 'centre');
  const s3 = accroche(d, 10.2, 49.9, 2); assert.ok(s3 && s3.x === 10 && s3.y === 50, 'extrémité de la ligne du calque Cache');
  assert.equal(entiteProche(d, 50, 40, 1.5).kind, 'circle'); // sommet du cercle Ø20 centré (50,30)
});

test('DXF : plan d\'exemple réel (si présent) — tout est lisible', { skip: !fs.existsSync('/root/.claude/uploads/670a3e29-2440-50bb-803d-1d87f8fac8e4/e79263bc-empreinte_axone_design_.dxf') }, () => {
  const d = lireDxf(fs.readFileSync('/root/.claude/uploads/670a3e29-2440-50bb-803d-1d87f8fac8e4/e79263bc-empreinte_axone_design_.dxf'));
  assert.equal(d.items.length, 97); assert.equal(d.unite, 'mm');
  assert.ok(d.cadre.x1 > 93 && d.cadre.y0 < -75);
});

// ——— PDF vectoriel → dessin 2D (DXF-05 ; lecteur dans l'application) ———
import { lirePdf } from '../standalone/src/geom/pdf.js';
test('PDF : plan synthétique (rectangle, cercle Ø20 papier, axe pointillé, texte d\'échelle)', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const d = await lirePdf(pdfjs, new Uint8Array(fs.readFileSync(new URL('./fixtures/plan_synthetique.pdf', import.meta.url))));
  assert.equal(d.source, 'pdf'); assert.equal(d.unite, 'mm');
  assert.ok(Math.abs(d.cadre.x1 - 210) < 0.1 && Math.abs(d.cadre.y1 - 297) < 0.1, 'cadre A4 en mm papier');
  const c = d.items.find(o => o.kind === 'circle');
  assert.ok(c && Math.abs(2 * c.r - 20) < 0.02, 'cercle Ø 20,00 mm reconnu (Ø/R mesurable)');
  assert.ok(Math.abs(c.c[0] - 70) < 0.02 && Math.abs(c.c[1] - (297 - 50)) < 0.02, 'centre (70 ; 247) — repère PDF, axe Y vers le haut');
  assert.ok(d.items.some(o => o.pointille), 'trait mixte/tirets reconnu');
  assert.ok(d.items.some(o => o.kind === 'text' && /2:1/.test(o.texte)), 'texte « 2:1 » conservé');
  assert.ok(d.calques.some(k => /bleu/i.test(k.nom)) && d.calques.some(k => /rouge/i.test(k.nom)), 'calques par couleur');
});

// ——— Cotation automatique proposée (niveau 1) ———
import { proposerCotes, traitsForts } from '../standalone/src/geom/cotation-auto.js';
test('Cotation auto : ordonnées depuis une référence, Ø groupés, traits cachés exclus', () => {
  const d = dxfSynth();
  const r = proposerCotes(d, { origine: { x: 0, y: 0 }, zone: d.cadre });
  const ax = r.xs.map(e => +e.x.toFixed(2)), ay = r.ys.map(e => +e.y.toFixed(2));
  for (const v of [0, 20, 50, 70, 100]) assert.ok(ax.includes(v), `ordonnée X ${v}`);
  for (const v of [0, 20, 30, 45, 60]) assert.ok(ay.includes(v), `ordonnée Y ${v}`);
  assert.ok(!ay.includes(50) && !ax.includes(90), 'extrémités du calque Cache (pointillé) non cotées');
  assert.equal(new Set(ax).size, ax.length, 'une seule cote par valeur');
  const d20 = r.dias.find(g => g.kind === 'circle' && Math.abs(2 * g.r - 20) < 1e-6); assert.ok(d20 && d20.n === 1);
  assert.ok(r.dias.find(g => g.kind === 'arc' && Math.abs(g.r - 15) < 1e-6), 'arc R15');
  assert.ok(traitsForts(d).every(o => !o.pointille && o.kind !== 'text'));
});
test('Cotation auto : origine décalée, zone restreinte et catégories', () => {
  const d = dxfSynth();
  const r = proposerCotes(d, { origine: { x: 50, y: 30 }, zone: { x0: 40, y0: 20, x1: 60, y1: 40 }, categories: { centres: true, coins: false, inter: false } });
  assert.equal(r.dias.length, 1); assert.ok(Math.abs(2 * r.dias[0].r - 20) < 1e-6);
  assert.deepEqual(r.xs.map(e => +(e.x - 50).toFixed(2)), [0]); assert.deepEqual(r.ys.map(e => +(e.y - 30).toFixed(2)), [0]);
});
test('Cotation auto : plans PDF réels — traits forts = contours épais, plafonné', { skip: !fs.existsSync('/root/.claude/uploads/670a3e29-2440-50bb-803d-1d87f8fac8e4/e4883814-11193_01_Plaque_semelle_SUP_2D.pdf') }, async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const d = await lirePdf(pdfjs, new Uint8Array(fs.readFileSync('/root/.claude/uploads/670a3e29-2440-50bb-803d-1d87f8fac8e4/e4883814-11193_01_Plaque_semelle_SUP_2D.pdf')));
  const t0 = Date.now(), r = proposerCotes(d, { origine: { x: 0, y: 0 }, zone: d.cadre });
  assert.ok(Date.now() - t0 < 20000 && r.xs.length <= 60 && r.ys.length <= 60 && r.dias.length > 0);
});
