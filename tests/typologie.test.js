// Typologie tournage / fraisage, dimensions de brut et filtre (standalone/src/geom/typologie.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import occt from 'occt-import-js';
import { partsFromOcct } from '../standalone/src/geom/from-occt.js';
import { extractCylinders } from '../standalone/src/geom/holes.js';
import { analyserTypologie, correspond, validerCriteres, normaliserType, resumeCriteres } from '../standalone/src/geom/typologie.js';

// ---------------------------------------------------------------- STEP synthétique : valeurs attendues chiffrées
const occ = await occt();
const res = occ.ReadStepFile(new Uint8Array(fs.readFileSync(new URL('./fixtures/bcr_synthetique.step', import.meta.url))),
  { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.1, angularDeflection: 0.3 });
const { parts } = partsFromOcct(res);
const typo = new Map(parts.map(p => [p.name + '#' + p.id, analyserTypologie(p, extractCylinders(p))]));
const de = nom => parts.filter(p => p.name === nom).map(p => typo.get(p.name + '#' + p.id));
const proche = (x, y, tol = 0.06) => assert.ok(Math.abs(x - y) <= tol, `${x} ≠ ${y}`);

test('STEP synthétique : 12 pièces rondes (tournage), 3 pièces prismatiques (fraisage)', () => {
  const t = [...typo.values()];
  assert.equal(t.filter(x => x.type === 'tournage').length, 12);
  assert.equal(t.filter(x => x.type === 'fraisage').length, 3);
  assert.equal(t.filter(x => x.type === 'mixte').length, 0);
});

test('pièces rondes : axe, Ø et longueur', () => {
  for (const [nom, d, l, axe] of [['OBTURATEUR_D8', 8, 12, [1, 0, 0]], ['OBTURATEUR_D8_Y', 8, 12, [0, 1, 0]], ['OBTURATEUR_COLLECTEUR_D10', 10, 15, [1, 0, 0]], ['BUSETTE_D20', 20, 50, [0, 0, 1]], ['BUSE_INJECTION', 30, 30, [0, 0, 1]], ['VIS_CHC_M10x40', 16, 50, [0, 0, 1]]]) {
    const r = de(nom); assert.ok(r.length, nom);
    for (const x of r) {
      assert.equal(x.type, 'tournage', nom); assert.ok(x.revolution_pct >= 99, `${nom} ${x.revolution_pct} %`);
      proche(x.diametre_mm, d); proche(x.longueur_mm, l);
      assert.ok(Math.abs(Math.abs(x.axe[0] * axe[0] + x.axe[1] * axe[1] + x.axe[2] * axe[2]) - 1) < 1e-3, `${nom} axe ${x.axe}`);
      [Math.max(d, l), Math.min(d, l), Math.min(d, l)].forEach((v, i) => proche(x.brut_mm[i], v));
    }
  }
  assert.deepEqual(de('BUSETTE_D20')[0].brut_mm, [50, 20, 20]); // barre Ø20 × 50
});

test('pièces prismatiques : brut L × l × e', () => {
  for (const [nom, brut] of [['PLAQUE_FIXATION_INFERIEURE', [300, 250, 30]], ['PLAQUE_PORTE_EMPREINTE', [300, 250, 40]], ['COLLECTEUR_BCR', [220, 60, 40]]]) {
    const x = de(nom)[0];
    assert.equal(x.type, 'fraisage', nom); assert.ok(x.revolution_pct < 40, `${nom} ${x.revolution_pct} %`);
    x.brut_mm.forEach((v, i) => proche(v, brut[i])); assert.equal(x.diametre_mm, null); assert.equal(x.axe, null);
    proche(x.dim_max_mm, brut[0]); proche(x.dim_min_mm, brut[2]);
  }
});

// ---------------------------------------------------------------- maillages construits à la main : cas limites
function pieceDe(tris, groupes) {
  const positions = new Float32Array(tris.flat(2)), index = Uint32Array.from({ length: tris.length * 3 }, (_, i) => i);
  const faces = []; let k = 0; for (const n of groupes) { faces.push({ first: k, last: k + n - 1 }); k += n; }
  return { id: 'T', name: 'essai', positions, index, faces, path: [] };
}
function boiteTris(dx, dy, dz) {
  const p = [[0, 0, 0], [dx, 0, 0], [dx, dy, 0], [0, dy, 0], [0, 0, dz], [dx, 0, dz], [dx, dy, dz], [0, dy, dz]];
  const q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]];
  return q.flatMap(([a, b, c, d]) => [[p[a], p[b], p[c]], [p[a], p[c], p[d]]]);
}
function cylTris(R, H, seg = 72) {
  const pt = (i, z) => [R * Math.cos(2 * Math.PI * i / seg), R * Math.sin(2 * Math.PI * i / seg), z], side = [], haut = [], bas = [];
  for (let i = 0; i < seg; i++) { side.push([pt(i, 0), pt(i + 1, 0), pt(i + 1, H)], [pt(i, 0), pt(i + 1, H), pt(i, H)]); haut.push([[0, 0, H], pt(i, H), pt(i + 1, H)]); bas.push([[0, 0, 0], pt(i + 1, 0), pt(i, 0)]); }
  return { tris: [...side, ...haut, ...bas], faces: [side.length, haut.length, bas.length] };
}
function hexTris(a, H) { // prisme hexagonal : 6 faces latérales + 2 faces d'extrémité
  const pt = (i, z) => [a * Math.cos(Math.PI * i / 3), a * Math.sin(Math.PI * i / 3), z], side = [], haut = [], bas = [];
  for (let i = 0; i < 6; i++) { side.push([pt(i, 0), pt(i + 1, 0), pt(i + 1, H)], [pt(i, 0), pt(i + 1, H), pt(i, H)]); haut.push([[0, 0, H], pt(i, H), pt(i + 1, H)]); bas.push([[0, 0, 0], pt(i + 1, 0), pt(i, 0)]); }
  return { tris: [...side, ...haut, ...bas], faces: [...Array(6).fill(2), 6, 6] };
}
const tourner = (tris, f) => tris.map(t => t.map(f));
const rotZ = a => ([x, y, z]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
const rotX = a => ([x, y, z]) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const decale = (dx, dy, dz) => ([x, y, z]) => [x + dx, y + dy, z + dz];
const pieceCyl = (R, H, f = p => p) => { const c = cylTris(R, H); return pieceDe(tourner(c.tris, f), c.faces); };

test('disque mince (Ø100 × 1) = tournage ; tôle carrée (100 × 100 × 1) = fraisage', () => {
  const d = analyserTypologie(pieceCyl(50, 1)); assert.equal(d.type, 'tournage'); proche(d.diametre_mm, 100); proche(d.longueur_mm, 1);
  const t = analyserTypologie(pieceDe(boiteTris(100, 100, 1), [2, 2, 2, 2, 2, 2])); assert.equal(t.type, 'fraisage'); assert.deepEqual(t.brut_mm, [100, 100, 1]);
});

test('cylindre incliné de 25° et décalé : axe retrouvé, Ø et longueur exacts', () => {
  const x = analyserTypologie(pieceCyl(15, 80, p => decale(300, -120, 40)(rotX(0.436)(p))));
  assert.equal(x.type, 'tournage'); proche(x.diametre_mm, 30); proche(x.longueur_mm, 80);
  proche(Math.abs(x.axe[2]), Math.cos(0.436), 1e-3); proche(Math.abs(x.axe[1]), Math.sin(0.436), 1e-3);
});

test('plaque tournée de 30° dans l\'assemblage : le brut reste 200 × 100 × 20 (pas la boîte axée sur le repère)', () => {
  const x = analyserTypologie(pieceDe(tourner(boiteTris(200, 100, 20), rotZ(Math.PI / 6)), [2, 2, 2, 2, 2, 2]));
  assert.equal(x.type, 'fraisage'); x.brut_mm.forEach((v, i) => proche(v, [200, 100, 20][i], 0.02));
});

test('prisme hexagonal : fraisage (les pans plats ne sont pas des surfaces de révolution)', () => {
  const h = hexTris(20, 60), x = analyserTypologie(pieceDe(h.tris, h.faces));
  assert.equal(x.type, 'fraisage'); assert.ok(x.revolution_pct < 20, `${x.revolution_pct} %`);
});

test('arbre + bloc prismatique dans une même pièce : « mixte » (ni l\'un ni l\'autre à coup sûr)', () => {
  const c = cylTris(20, 100), b = boiteTris(20, 20, 100).map(t => t.map(decale(40, 0, 0)));
  const piece = pieceDe([...c.tris, ...b], [...c.faces, 2, 2, 2, 2, 2, 2]), x = analyserTypologie(piece, extractCylinders(piece));
  assert.equal(x.type, 'mixte'); assert.ok(x.revolution_pct >= 50 && x.revolution_pct < 90, `${x.revolution_pct} %`);
  assert.equal(x.brut_mm.length, 3);
});

// ---------------------------------------------------------------- filtre
const P = (o = {}) => ({ nom: 'PLAQUE', famille: 'plaque', famille_label: 'Plaques', type_usinage: 'fraisage', diametre_mm: null, longueur_mm: null, dim_max_mm: 300, dim_min_mm: 30, ...o });
const T = (o = {}) => P({ nom: 'BUSETTE', famille: 'busette', famille_label: 'Busettes / buses', type_usinage: 'tournage', diametre_mm: 20, longueur_mm: 50, dim_max_mm: 50, dim_min_mm: 20, ...o });

test('filtre : type (alias, liste), plages avec tolérance maillage, Ø réservé aux pièces rondes', () => {
  assert.equal(correspond(T(), { type: 'tournage' }), true);
  assert.equal(correspond(T(), { type: 'prismatique' }), false);
  assert.equal(correspond(P(), { type: 'prismatique' }), true);
  assert.equal(correspond(P(), { type: ['tournage', 'mixte'] }), false);
  assert.equal(correspond(T(), { diametre_mm: { max: 20 } }), true);
  assert.equal(correspond(T({ diametre_mm: 20.04 }), { diametre_mm: { max: 20 } }), true, 'tolérance 0,05 mm du maillage');
  assert.equal(correspond(T({ diametre_mm: 20.2 }), { diametre_mm: { max: 20 } }), false);
  assert.equal(correspond(T(), { diametre_mm: { min: 25 } }), false);
  assert.equal(correspond(P(), { diametre_mm: { max: 1000 } }), false, 'une pièce prismatique n\'a pas de Ø');
  assert.equal(correspond(P(), { plus_grande_dim_mm: { max: 300 }, plus_petite_dim_mm: { max: 30 } }), true);
  assert.equal(correspond(P(), { plus_grande_dim_mm: { max: 250 } }), false);
});

test('filtre : nom, famille, sauf_famille', () => {
  assert.equal(correspond(T(), { nom: 'busette' }), true);
  assert.equal(correspond(T(), { famille: 'Busettes' }), true);
  assert.equal(correspond(T(), { famille: 'plaques' }), false);
  const vis = T({ nom: 'VIS_CHC', famille: 'visserie', famille_label: 'Visserie / goupilles' });
  assert.equal(correspond(vis, { sauf_famille: 'visserie' }), false);
  assert.equal(correspond(T(), { sauf_famille: 'visserie' }), true);
});

test('validation des critères : messages clairs', () => {
  assert.equal(validerCriteres({}), null);
  assert.equal(validerCriteres({ type: ['tournage', 'fraisage'], diametre_mm: { min: 5, max: 40 } }), null);
  assert.match(validerCriteres({ type: 'turbo' }), /inconnu/);
  assert.match(validerCriteres({ type: [] }), /au moins une valeur/);
  assert.match(validerCriteres({ diametre_mm: 40 }), /plage/);
  assert.match(validerCriteres({ diametre_mm: {} }), /au moins une/);
  assert.match(validerCriteres({ diametre_mm: { max: 'x' } }), /nombre positif/);
  assert.match(validerCriteres({ diametre_mm: { min: 50, max: 10 } }), /supérieur au maxi/);
  assert.match(validerCriteres({ diametre_mm: { maxi: 10 } }), /min et max/);
  assert.match(validerCriteres({ nom: '  ' }), /texte non vide/);
  assert.equal(normaliserType('Prismatique'), 'fraisage'); assert.equal(normaliserType('Tourné'), 'tournage'); assert.equal(normaliserType('x'), null);
});

test('résumé des critères', () => {
  assert.equal(resumeCriteres({}), 'Toutes les pièces');
  assert.equal(resumeCriteres({ type: ['tournage'], diametre_mm: { max: 40 }, sauf_famille: 'visserie' }), 'Filtre : tournage · Ø ≤ 40 mm · sans visserie');
});
