import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import occt from 'occt-import-js';
import { partsFromOcct } from '../standalone/src/geom/from-occt.js';
import { extractCylinders, eigenSym3, fitCircle2D } from '../standalone/src/geom/holes.js';
import { buildNetworks, closestSegments } from '../standalone/src/geom/circuits.js';
import { meshStats, buildBom } from '../standalone/src/geom/bom.js';
import { creerMiseEnPlan } from '../standalone/src/geom/mise-en-plan.js';

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

// ——— Mise en plan 2D : trois vues à l'échelle 1:1 et coupes (MEP-01 à MEP-05) ———
const plaque = byName('PLAQUE_PORTE_EMPREINTE');
const proche = (a, b, t = 0.01) => Math.abs(a - b) <= t;

test('mise en plan : trois vues 1:1 en projection européenne (MEP-01)', () => {
  const mp = creerMiseEnPlan(plaque);
  const dim = id => { const e = mp.vues[id].emprise; return [e[2] - e[0], e[3] - e[1]]; };
  assert.ok(dim('face').every((v, i) => proche(v, [300, 40][i], 0.01)), 'face 300 × 40');
  assert.ok(dim('dessus').every((v, i) => proche(v, [300, 250][i], 0.01)), 'dessus 300 × 250');
  assert.ok(dim('gauche').every((v, i) => proche(v, [250, 40][i], 0.01)), 'gauche 250 × 40');
  const bx = id => { const v = mp.vues[id], e = v.emprise, o = v.off; return [e[0] + o[0], e[1] + o[1], e[2] + o[0], e[3] + o[1]]; };
  const F = bx('face'), D = bx('dessus'), G = bx('gauche');
  assert.ok(proche(D[0], F[0]) && proche(D[2], F[2]), 'dessus aligné sous la vue de face');
  assert.ok(D[3] < F[1], 'dessus placé SOUS la vue de face');
  assert.ok(proche(G[1], F[1]) && proche(G[3], F[3]), 'gauche alignée à droite de la vue de face');
  assert.ok(G[0] > F[2], 'gauche placée à DROITE de la vue de face');
  assert.equal(mp.axe, null, 'une plaque n’est pas une pièce de révolution : pas de coupe automatique');
  assert.equal(mp.vueDe(F[0] + 10, F[1] + 5).vue, 'face');
  assert.ok(mp.dansPiece(F[0] + 1, F[1] + 1) && !mp.dansPiece((F[2] + G[0]) / 2, F[1] + 5), 'la zone entre deux vues est « hors pièce »');
});

test('mise en plan : cercles reconnus et arêtes cachées en pointillé (MEP-02)', () => {
  const mp = creerMiseEnPlan(plaque), cercles = id => mp.vues[id].items.filter(o => o.kind === 'circle');
  const dessus = cercles('dessus');
  const gros = dessus.filter(o => !o.pointille && proche(o.r, 30, 0.05));
  assert.equal(gros.length, 1, 'logement Ø60 de la vue de dessus');
  assert.ok(proche(gros[0].c[0], -60, 0.05) && proche(gros[0].c[1], 60, 0.05), 'centre (−60 ; 60)');
  assert.equal(dessus.filter(o => !o.pointille && proche(o.r, 5, 0.05)).length, 4, '4 perçages Ø10 aux angles');
  assert.ok(dessus.some(o => o.pointille && proche(o.r, 4, 0.05)), 'forages Ø8 vus par la tranche : cercles cachés');
  assert.ok(mp.vues.face.items.some(o => o.pointille && o.kind === 'line'), 'forages cachés en pointillé dans la vue de face');
  assert.ok(dessus.every(o => o.snap.some(s => s.t === 'centre')), 'le centre de chaque cercle est une accroche');
  assert.ok(mp.vues.dessus.items.filter(o => o.kind === 'line' && !o.pointille).length >= 4, 'contour rectangulaire');
});

test('mise en plan : pièce de révolution, coupe A-A suivant l’axe, hachures, axe (MEP-03)', () => {
  const busette = byName('BUSETTE_D20')[0];
  const mp = creerMiseEnPlan([busette]);
  assert.equal(mp.axe.axe, 'Z'); assert.equal(mp.axe.plan, 'XZ');
  assert.equal(mp.sections.length, 1); const S = mp.sections[0];
  assert.ok(S.auto && S.nom === 'Coupe A-A');
  assert.ok(S.items.filter(o => o.hachure).length > 5, 'section hachurée');
  assert.ok(S.items.every(o => !o.pointille), 'pas d’arêtes cachées dans une coupe');
  const cx = (S.boite[0] + S.boite[2]) / 2;
  assert.ok(proche(S.axeLocal.pos, cx, 0.05) && S.axeLocal.dir === 'V', 'axe de révolution au milieu de la coupe');
  assert.deepEqual(mp.axeAt(cx, (S.boite[1] + S.boite[3]) / 2), S.axeLocal);
  assert.equal(mp.axeAt(S.boite[0] - 100, 0), null);
  const d = mp.dessin();
  assert.ok(d.items.some(o => o.layer === 'Axes') && d.items.some(o => o.layer === 'Plan de coupe'), 'axes et traits de coupe sur le dessin');
});

test('mise en plan : coupe choisie par un point cliqué, évidement non hachuré, doublon refusé (MEP-04)', () => {
  const mp = creerMiseEnPlan(plaque);
  const pt = mp.vueDe(mp.vues.dessus.off[0] - 60, mp.vues.dessus.off[1] + 60, 0.5);
  assert.equal(pt.vue, 'dessus'); assert.ok(proche(pt.Y, 60, 0.01));      // centre du logement Ø60
  const S = mp.ajouterCoupe('XZ', pt.Y);
  assert.equal(S.nom, 'Coupe A-A'); assert.ok(!S.auto && S.plan === 'XZ');
  const hach = S.items.filter(o => o.hachure);
  const couvre = (x, z) => hach.some(h => { const [a, c] = h.pts, t = (z - a[1]) / (c[1] - a[1]); return t >= 0 && t <= 1 && Math.abs(a[0] + t * (c[0] - a[0]) - x) < 3; });
  assert.ok(!couvre(-60, 62), 'le logement Ø60 (centre −60 ; Z 62, près de la face supérieure) n’est pas hachuré');
  assert.ok(couvre(-60, 33), 'sous le fond du logement, la matière est hachurée');
  assert.ok(couvre(100, 38) && couvre(-140, 38), 'la matière est hachurée');
  assert.ok(!couvre(100, 50), 'le forage Ø8 coupé suivant son axe (Z 46–54) n’est pas hachuré');
  assert.throws(() => mp.ajouterCoupe('XZ', 60), /existe déjà/);
  assert.throws(() => mp.ajouterCoupe('YZ', 1000), /ne rencontre pas/);
  const S2 = mp.ajouterCoupe('YZ', -60);                                      // plan YZ par le même centre (X = −60)
  assert.equal(S2.nom, 'Coupe B-B'); assert.ok(S2.boite[0] > S.boite[2], 'coupes alignées côte à côte, sans chevauchement');
  assert.equal(mp.retirerCoupe().nom, 'Coupe B-B'); assert.equal(mp.sections.length, 1);
});

test('mise en plan : le STEP n’est jamais modifié et une sélection vide est refusée (MEP-05)', () => {
  const avant = plaque[0].positions.slice(); creerMiseEnPlan(plaque);
  assert.deepEqual(Array.from(plaque[0].positions), Array.from(avant), 'maillage d’origine intact');
  assert.throws(() => creerMiseEnPlan([]), /Aucune géométrie/);
});

// ——— Mise en plan : vues auxiliaires et coupes décalées (MEP-06, MEP-07) ———
// Cylindre Ø24 × 50 dont l'axe est incliné de 30° dans le plan XZ (maillage synthétique, 48 facettes).
function cylindreIncline(R, L, deg, n = 48) {
  const th = deg * Math.PI / 180, a = [Math.sin(th), 0, Math.cos(th)], t = [Math.cos(th), 0, -Math.sin(th)], y = [0, 1, 0];
  const pt = (h, phi) => [0, 1, 2].map(k => h * a[k] + R * (Math.cos(phi) * t[k] + Math.sin(phi) * y[k]));
  const pos = [], idx = [], add = p => { pos.push(...p); return pos.length / 3 - 1; }, b = [], h = [];
  for (let i = 0; i < n; i++) { b.push(add(pt(0, 2 * Math.PI * i / n))); h.push(add(pt(L, 2 * Math.PI * i / n))); }
  const cb = add([0, 0, 0]), ct = add(a.map(q => q * L));
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(b[i], b[j], h[i], b[j], h[j], h[i]); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(cb, b[j], b[i]); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(ct, h[i], h[j]); }
  return { name: 'CYL_INCLINE', positions: Float32Array.from(pos), index: Uint32Array.from(idx), faces: [{ first: 0, last: 2 * n - 1 }, { first: 2 * n, last: 3 * n - 1 }, { first: 3 * n, last: 4 * n - 1 }] };
}
const R_CYL = 12, L_CYL = 50, ANG_CYL = 30;
const droiteCapCyl = () => {   // arête du plan de base supérieur vue par la tranche dans la vue de face : (u, v) = (X, Z)
  const th = ANG_CYL * Math.PI / 180, C = [L_CYL * Math.sin(th), L_CYL * Math.cos(th)], t = [Math.cos(th), -Math.sin(th)];
  return [[C[0] - R_CYL * t[0], C[1] - R_CYL * t[1]], [C[0] + R_CYL * t[0], C[1] + R_CYL * t[1]]];
};

test('mise en plan : vue auxiliaire — le cercle d’une face inclinée apparaît en vraie grandeur (MEP-06)', () => {
  const mp = creerMiseEnPlan([cylindreIncline(R_CYL, L_CYL, ANG_CYL)]);
  assert.equal(mp.axe, null);
  const fv = mp.vues.face.items.filter(o => o.kind === 'circle');
  assert.equal(fv.length, 0, 'dans la vue de face le cylindre incliné n’a aucun cercle');
  const [a, b] = droiteCapCyl(), S = mp.ajouterAuxiliaire('face', a, b);
  assert.equal(S.nom, 'Vue auxiliaire A'); assert.equal(S.type, 'auxiliaire');
  const cercles = S.items.filter(o => o.kind === 'circle' && !o.pointille);
  assert.equal(cercles.length, 1, 'un seul cercle (celui du fond, caché, est superposé donc supprimé)');
  assert.ok(proche(cercles[0].r, R_CYL, 0.05), 'Ø24 en vraie grandeur');
  assert.ok(S.items.every(o => !(o.kind === 'circle' && o.pointille)), 'pas de doublon pointillé');
  const e = S.emprise; assert.ok(proche(e[2] - e[0], 2 * R_CYL, 0.05) && proche(e[3] - e[1], 2 * R_CYL, 0.05), 'vue 24 × 24');
  // regard : du dehors du cylindre vers son centre, soit −axe (0,5 ; 0,866) ; proposé à partir de la droite choisie
  assert.ok(proche(S.regard[0], -Math.sin(ANG_CYL * Math.PI / 180), 1e-6) && proche(S.regard[1], -Math.cos(ANG_CYL * Math.PI / 180), 1e-6));
  // mise en page : à droite de tout le reste, flèche + lettre dans la vue source
  const bg = mp.vues.gauche, xg = bg.emprise[2] + bg.off[0];
  assert.ok(S.boite[0] > xg, 'vue auxiliaire placée à droite');
  const d = mp.dessin();
  assert.ok(d.items.some(o => o.kind === 'text' && o.texte === 'A' && o.layer === 'Plan de coupe'), 'lettre A');
  assert.ok(d.items.some(o => o.kind === 'poly' && o.plein && o.layer === 'Plan de coupe'), 'flèche pleine de visée');
  assert.ok(d.items.some(o => o.kind === 'text' && /Vue auxiliaire A/.test(o.texte)) && d.items.some(o => o.kind === 'text' && /sens proposé/.test(o.texte)));
  // refus : doublon, droite trop courte, vue inconnue
  assert.throws(() => mp.ajouterAuxiliaire('face', a, b), /existe déjà/);
  assert.throws(() => mp.ajouterAuxiliaire('face', [0, 0], [0.1, 0]), /trop courte/);
  assert.throws(() => mp.ajouterAuxiliaire('dessous', a, b), /inconnue/);
  // sens inversé : on regarde l'autre extrémité, le cercle reste un vrai cercle
  const S2 = mp.ajouterAuxiliaire('face', a, b, { inverse: true });
  assert.equal(S2.nom, 'Vue auxiliaire B'); assert.ok(S2.regard[0] > 0 && S2.regard[1] > 0);
  assert.ok(S2.items.some(o => o.kind === 'circle' && proche(o.r, R_CYL, 0.05)));
  assert.ok(S2.boite[0] > S.boite[2], 'sans chevauchement');
  assert.equal(mp.retirerAuxiliaire().nom, 'Vue auxiliaire B'); assert.equal(mp.auxiliaires.length, 1);
  assert.equal(mp.ajouterAuxiliaire('face', a, b, { inverse: true }).nom, 'Vue auxiliaire B', 'la lettre libérée est réutilisée');
});

test('mise en plan : vue auxiliaire d’une plaque — droite horizontale du dessus, vue 300 × 40 (MEP-06)', () => {
  const mp = creerMiseEnPlan(plaque);
  const S = mp.ajouterAuxiliaire('dessus', [-150, -125], [150, -125]);      // bord avant de la plaque
  const e = S.emprise;
  assert.ok(proche(e[2] - e[0], 300, 0.02) && proche(e[3] - e[1], 40, 0.02), 'on regarde la plaque par la tranche : 300 × 40');
  assert.ok(Math.abs(S.regard[0]) < 1e-9 && proche(S.regard[1], 1, 1e-9), 'regard vers +Y, depuis le bord avant');
  assert.equal(mp.dessin().items.filter(o => o.kind === 'text' && o.texte === 'A').length, 1);
});

test('mise en plan : coupe décalée XZ — deux plans parallèles, hachures continues, décrochement non tracé (MEP-07)', () => {
  const mp = creerMiseEnPlan(plaque);
  const S = mp.ajouterCoupeDecalee('XZ', [60, -60], [20]);
  assert.equal(S.nom, 'Coupe A-A'); assert.ok(S.decalee && S.plan === 'XZ' && S.valeurs.length === 2);
  const hach = S.items.filter(o => o.hachure);
  const couvre = (x, z) => hach.some(h => { const [a, c] = h.pts, t = (z - a[1]) / (c[1] - a[1]); return t >= 0 && t <= 1 && Math.abs(a[0] + t * (c[0] - a[0]) - x) < 3; });
  assert.ok(!couvre(-60, 62), 'plan Y = 60 : le logement Ø60 n’est pas hachuré');
  assert.ok(couvre(-60, 33), 'sous le fond du logement : hachuré');
  assert.ok(couvre(100, 38) && couvre(-140, 38) && couvre(100, 62), 'matière hachurée des deux côtés du décrochement');
  assert.ok(!couvre(100, 50), 'plan Y = −60 : le forage Ø8 (Z 46–54) n’est pas hachuré');
  assert.ok(couvre(20, 38) && couvre(19.5, 33) && couvre(20.5, 62), 'hachures continues à la hauteur du décrochement');
  const vert = S.items.filter(o => o.kind === 'line' && !o.hachure && Math.abs(o.pts[0][0] - 20) < 0.1 && Math.abs(o.pts[1][0] - 20) < 0.1 && Math.abs(o.pts[1][1] - o.pts[0][1]) > 1);
  assert.equal(vert.length, 0, 'aucun trait vertical au décrochement X = 20');
  assert.ok(S.items.every(o => !o.pointille), 'pas d’arêtes cachées en coupe');
  const d = mp.dessin();
  const chemin = d.items.find(o => o.kind === 'poly' && o.layer === 'Plan de coupe' && o.pointille);
  assert.equal(chemin.pts.length, 4, 'tracé : départ, deux sommets du décrochement, arrivée');
  const dv = mp.vues.dessus; assert.ok(proche(chemin.pts[1][0], 20 + dv.off[0]) && proche(chemin.pts[1][1], 60 + dv.off[1]) && proche(chemin.pts[2][1], -60 + dv.off[1]), 'décrochement à X = 20 entre Y = 60 et Y = −60');
  assert.ok(d.items.filter(o => o.epais).length >= 6, 'repères épais aux extrémités et au décrochement');
  assert.equal(d.items.filter(o => o.kind === 'text' && o.texte === 'A' && o.layer === 'Plan de coupe').length, 2, 'lettre A aux deux extrémités');
  assert.ok(d.items.some(o => o.kind === 'text' && /plans XZ décalés · Y = 60,00 \| -60,00/.test(o.texte)));
  // validations
  assert.throws(() => mp.ajouterCoupeDecalee('XZ', [60, -60], [20]), /existe déjà/);
  assert.throws(() => mp.ajouterCoupeDecalee('XZ', [60], []), /2 à 5 plans/);
  assert.throws(() => mp.ajouterCoupeDecalee('XZ', [10, 10], [0]), /identiques/);
  assert.throws(() => mp.ajouterCoupeDecalee('XZ', [10, 20, 30], [5, 5]), /un seul sens/);
  assert.throws(() => mp.ajouterCoupeDecalee('XY', [10, 20], [5]), /inconnu/);
  assert.throws(() => mp.ajouterCoupeDecalee('XZ', [1000, 2000], [0]), /ne rencontre pas/);
  // sens de saisie quelconque : bords rangés dans l'ordre croissant
  const S2 = mp.ajouterCoupeDecalee('XZ', [60, 0, -60], [40, -100]);
  assert.deepEqual(S2.bords, [-100, 40]); assert.deepEqual(S2.valeurs, [-60, 0, 60]); assert.equal(S2.nom, 'Coupe B-B');
  assert.ok(S2.boite[0] > S.boite[2]);
  assert.equal(mp.retirerCoupe().nom, 'Coupe B-B');
});

test('mise en plan : coupe décalée YZ et mélange avec vue auxiliaire (MEP-07)', () => {
  const mp = creerMiseEnPlan(plaque);
  const S = mp.ajouterCoupeDecalee('YZ', [-60, 100], [0]);
  assert.ok(S.decalee && S.plan === 'YZ' && S.vueId === 'gauche');
  assert.ok(S.items.filter(o => o.hachure).length > 10);
  const A = mp.ajouterAuxiliaire('dessus', [-150, -125], [150, -125]);
  assert.equal(A.nom, 'Vue auxiliaire B', 'la lettre A est prise par la coupe');
  assert.ok(A.boite[0] > S.boite[2], 'vue auxiliaire placée à droite de la coupe, sans chevauchement');
  assert.ok(mp.dansPiece((A.boite[0] + A.boite[2]) / 2, (A.boite[1] + A.boite[3]) / 2), 'la vue auxiliaire compte comme « pièce » pour le placement des cotes');
  const chemin = mp.dessin().items.find(o => o.kind === 'poly' && o.pointille && o.layer === 'Plan de coupe');
  const dv = mp.vues.dessus; assert.ok(proche(chemin.pts[1][0], -60 + dv.off[0]) && proche(chemin.pts[1][1], 0 + dv.off[1]) && proche(chemin.pts[2][0], 100 + dv.off[0]), 'YZ : décrochement à Y = 0 entre X = −60 et X = 100');
  assert.equal(mp.retirerAuxiliaire().nom, 'Vue auxiliaire B'); assert.equal(mp.retirerCoupe().nom, 'Coupe A-A'); assert.equal(mp.ordre.length, 0);
});

// ——— Export DXF / PDF de la mise en plan (MEP-08, MEP-09) ———
import { exporterDxf, exporterPdf, composerPlan, itemsCotes, texteCote, choisirPage, largeurTexte, versAnsi } from '../standalone/src/geom/export-plan.js';
import { spawnSync } from 'node:child_process';
function planCote() {
  const mp = creerMiseEnPlan(plaque), dv = mp.vues.dessus, ox = dv.off[0], oy = dv.off[1];
  const cotes = [
    { t: 'ph', a: { x: -150 + ox, y: -125 + oy }, b: { x: 150 + ox, y: -125 + oy }, p: { x: ox, y: -150 + oy }, ech: 1 },                 // 300,00 sous la vue
    { t: 'pv', a: { x: -150 + ox, y: -125 + oy }, b: { x: -150 + ox, y: 125 + oy }, p: { x: -175 + ox, y: oy }, ech: 1 },                 // 250,00 à gauche
    { t: 'pdia', c: { x: -60 + ox, y: 60 + oy }, r: 30, p: { x: -20 + ox + 150, y: 100 + oy + 40 }, ech: 1 },                           // Ø 60,00
    { t: 'prad', c: { x: 100 + ox, y: -90 + oy }, r: 5, p: { x: 130 + ox, y: -100 + oy }, ech: 1 },                                       // R 5,00
    { t: 'pa', a: { x: -150 + ox, y: -125 + oy }, b: { x: 150 + ox, y: 125 + oy }, p: { x: ox + 170, y: oy - 170 }, ech: 1, off: { m: [10, 5] } },
  ];
  return { mp, cotes, dessin: mp.dessin() };
}
const cleLigne = (a, b) => [a, b].map(p => p.map(v => Math.round(v * 100) / 100).join(',')).sort().join('|');

test('export : cotes en géométrie — valeurs, Ø/R, flèches pleines, traits fins (MEP-08)', () => {
  const { cotes } = planCote(), it = itemsCotes(cotes, 3.5);
  const textes = it.filter(o => o.kind === 'text').map(o => o.texte);
  assert.deepEqual(textes, ['300,00', '250,00', 'Ø 60,00', 'R 5,00', '390,51']);   // cote alignée : hypoténuse de 300 × 250
  assert.ok(it.filter(o => o.plein).length >= 8, 'flèches pleines');
  assert.ok(it.every(o => o.layer === 'Cotes') && it.some(o => o.kind === 'line'));
  assert.equal(texteCote({ t: 'ph', dia: true, a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }), 'Ø 20,00');
  // cote déplacée par l'opérateur : trait d'attache vers le texte déplacé
  const sans = itemsCotes([{ ...cotes[4], off: undefined }], 3.5);
  assert.equal(itemsCotes([cotes[4]], 3.5).length, sans.length + 1);
});

test('export : DXF R12 relu par le lecteur de l’application — géométrie, calques, textes, pointillés (MEP-08)', () => {
  const { cotes, dessin } = planCote();
  const octets = exporterDxf(dessin, cotes, { nom: 'plaque', date: '2026-10-12' });
  assert.ok(estDxf(octets));
  const txt = new TextDecoder('latin1').decode(octets);
  assert.match(txt, /\$ACADVER\r\n1\r\nAC1009/); assert.match(txt, /ANSI_1252/); assert.ok(txt.trimEnd().endsWith('EOF'));
  const d = lireDxf(octets);
  const nom = n => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9_$-]/g, '_');
  assert.deepEqual(d.calques.map(c => c.nom).sort(), [...new Set(['0', ...dessin.calques.map(c => nom(c.nom)), 'COTES', 'CARTOUCHE'])].sort());
  const mm = (L, k) => L.filter(o => o.kind === k);
  const orig = dessin.items;
  // cercles : mêmes rayons et centres
  const cir = L => mm(L, 'circle').map(o => `${o.c.map(v => v.toFixed(2)).join(',')}:${o.r.toFixed(2)}:${o.pointille ? 'h' : 'v'}`).sort();
  assert.deepEqual(cir(d.items), cir(orig)); assert.ok(cir(orig).length >= 5);
  // droites : mêmes extrémités (hors cotes et cartouche), pointillés conservés
  const lg = (L, f) => mm(L.filter(f), 'line').map(o => cleLigne(o.pts[0], o.pts.at(-1)) + (o.pointille ? 'h' : 'v')).sort();
  assert.deepEqual(lg(d.items, o => o.layer !== 'COTES' && o.layer !== 'CARTOUCHE'), lg(orig, () => true));
  // textes : titres, valeurs de cotes (Ø en ANSI 1252), cartouche avec la mention d'indicatif
  const T = d.items.filter(o => o.kind === 'text').map(o => o.texte);
  for (const t of ['Vue de face', 'Vue de dessus', '300,00', '250,00', 'Ø 60,00', 'R 5,00']) assert.ok(T.includes(t), t);
  assert.ok(T.some(t => /INDICATIVES/.test(t) && /2026-10-12/.test(t)), 'cartouche : valeurs indicatives, date');
  const h = d.items.find(o => o.kind === 'text' && o.texte === 'Vue de face'); assert.ok(h.h > 3, 'hauteur de texte conservée');
  // flèches pleines → SOLID (ignorées par le lecteur d'affichage mais présentes dans le fichier)
  assert.ok(d.ignores.SOLID >= 8 && d.ignores.SOLID === dessin.items.filter(o => o.plein).length + itemsCotes(cotes, 3.5).filter(o => o.plein).length);
  assert.ok(d.items.every(o => o.layer !== 'TITRES' || o.kind === 'text'));
  // dessin 1:1 : l'emprise du plateau reste 300 × 250 (rectangle du dessus)
  const dv = planCote().mp.vues.dessus, bx = dv.emprise[2] - dv.emprise[0];
  assert.ok(proche(bx, 300, 0.02));
  assert.ok(d.cadre.x1 - d.cadre.x0 > 600, 'plan complet exporté');
});

test('export : DXF d’une pièce de révolution — arcs, coupe hachurée et chemin de coupe (MEP-08)', () => {
  const mp = creerMiseEnPlan([byName('BUSETTE_D20')[0]]), dessin = mp.dessin();
  const d = lireDxf(exporterDxf(dessin, [], { nom: 'busette', date: '2026-10-12' }));
  const n = k => d.items.filter(o => o.kind === k).length, no = k => dessin.items.filter(o => o.kind === k).length;
  assert.equal(n('circle'), no('circle')); assert.equal(n('arc'), no('arc'));
  assert.equal(d.items.filter(o => o.layer === 'HACHURES').length, dessin.items.filter(o => o.layer === 'Hachures').length);
  for (const a of dessin.items.filter(o => o.kind === 'arc')) {
    const b = d.items.find(o => o.kind === 'arc' && Math.abs(o.r - a.r) < 1e-3 && Math.hypot(o.c[0] - a.c[0], o.c[1] - a.c[1]) < 1e-3 && Math.hypot(o.pts[0][0] - a.pts[0][0], o.pts[0][1] - a.pts[0][1]) < 1e-2 && Math.hypot(o.pts.at(-1)[0] - a.pts.at(-1)[0], o.pts.at(-1)[1] - a.pts.at(-1)[1]) < 1e-2);
    assert.ok(b, `arc R${a.r.toFixed(2)} relu avec le même sens et les mêmes extrémités`);
  }
  assert.ok(d.items.some(o => o.kind === 'poly' && o.layer === 'PLAN_DE_COUPE') || d.items.some(o => o.layer === 'PLAN_DE_COUPE'), 'traits de coupe');
  assert.ok(d.items.filter(o => o.layer === 'AXES').every(o => o.pointille), 'axes en trait mixte');
});

test('export : coupe décalée et vue auxiliaire passent dans le DXF (MEP-07, MEP-08)', () => {
  const mp = creerMiseEnPlan(plaque); mp.ajouterCoupeDecalee('XZ', [60, -60], [20]); mp.ajouterAuxiliaire('dessus', [-150, -125], [150, -125]);
  const dessin = mp.dessin(), d = lireDxf(exporterDxf(dessin, [], { nom: 'x', date: 'd' }));
  const T = d.items.filter(o => o.kind === 'text').map(o => o.texte);
  assert.ok(T.includes('Coupe A-A') && T.includes('Vue auxiliaire B') && T.some(t => /plans XZ décalés/.test(t)));
  assert.equal(d.items.filter(o => o.layer === 'HACHURES').length, dessin.items.filter(o => o.layer === 'Hachures').length);
  assert.ok(d.items.some(o => o.kind === 'poly' && o.layer === 'PLAN_DE_COUPE' && o.pts.length === 4), 'chemin de coupe décalée');
});

test('export : texte ANSI 1252 et largeur Helvetica (MEP-08)', () => {
  assert.deepEqual(Array.from(versAnsi('Ø 6° ±0,05 · é')), [0xD8, 32, 54, 0xB0, 32, 0xB1, 48, 44, 48, 53, 32, 0xB7, 32, 0xE9]);
  assert.deepEqual(Array.from(versAnsi('≈ → ’')), [126, 32, 45, 62, 32, 0x92], 'caractères hors page remplacés, jamais d’erreur');
  assert.ok(proche(largeurTexte('0', 10), 5.56, 1e-9) && proche(largeurTexte('Ø', 10), 7.78, 1e-9));
  assert.deepEqual([choisirPage(250, 150).nom, choisirPage(380, 250).nom, choisirPage(700, 500).nom, choisirPage(2000, 900).nom], ['A4', 'A3', 'A1', 'sur mesure']);
});

test('export : PDF vectoriel 1:1 relu par pdf.js, structure valide (MEP-09)', async () => {
  const { cotes, dessin } = planCote();
  const r = exporterPdf(dessin, cotes, { nom: 'plaque', date: '2026-10-12' });
  assert.equal(r.format, 'A1'); assert.ok(r.normalise);
  const brut = Buffer.from(r.octets), t = brut.toString('latin1');
  assert.ok(t.startsWith('%PDF-1.4') && t.trimEnd().endsWith('%%EOF'));
  const x0 = +/startxref\n(\d+)/.exec(t)[1]; assert.equal(t.slice(x0, x0 + 4), 'xref', 'startxref pointe sur la table');
  const noms = [...t.matchAll(/(\d{10}) 00000 n/g)].map(q => +q[1]);
  noms.forEach((p, i) => assert.equal(t.slice(p, p + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `décalage de l’objet ${i + 1}`));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const d = await lirePdf(pdfjs, r.octets);
  assert.ok(proche(d.cadre.x1, 841, 0.3) && proche(d.cadre.y1, 594, 0.3), 'page A1 paysage en mm');
  const gros = d.items.filter(o => o.kind === 'circle' && proche(2 * o.r, 60, 0.05));
  assert.ok(gros.length >= 1, 'logement Ø60 en vraie grandeur (1:1)');
  assert.ok(d.items.filter(o => o.kind === 'circle' && proche(2 * o.r, 10, 0.05)).length >= 4, '4 perçages Ø10');
  const T = d.items.filter(o => o.kind === 'text').map(o => o.texte.trim());
  for (const s of ['Vue de face', 'Vue de dessus', '300,00', '250,00']) assert.ok(T.some(x => x.includes(s)), s);
  assert.ok(T.some(x => x.includes('Ø 60,00')) && T.some(x => /INDICATIVES/.test(x)), 'valeur Ø et mention d’indicatif lisibles');
  assert.ok(d.items.some(o => o.pointille), 'pointillés');
  // distance entre les deux bords verticaux du rectangle du dessus : 300 mm
  const L = d.items.filter(o => o.kind === 'poly' || o.kind === 'line').flatMap(o => o.pts.slice(1).map((p, i) => [o.pts[i], p]));
  const verts = L.filter(([a, b]) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) > 249 && Math.abs(a[1] - b[1]) < 251).map(([a]) => a[0]).sort((a, b) => a - b);
  assert.ok(verts.some(a => verts.some(b => proche(b - a, 300, 0.1))), 'rectangle 300 × 250 mm sur la page');
  // qpdf, s'il est installé, valide aussi la structure
  const q = spawnSync('qpdf', ['--version']);
  if (!q.error) { fs.mkdirSync('/tmp/sdc-test', { recursive: true }); fs.writeFileSync('/tmp/sdc-test/plan.pdf', brut); const c = spawnSync('qpdf', ['--check', '/tmp/sdc-test/plan.pdf']); assert.equal(c.status, 0, String(c.stdout) + String(c.stderr)); }
});
