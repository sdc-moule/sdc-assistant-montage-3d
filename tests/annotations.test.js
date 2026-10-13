// Annotations (ANN-01 à ANN-04) : redressement des tracés, poignées, sélection, nettoyage de projet, export PDF.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as A from '../standalone/src/geom/annotations.js';

const bruit = (pts, s = 1.2) => pts.map(([x, y], i) => [x + Math.sin(i * 7.1) * s, y + Math.cos(i * 5.3) * s]);
const seg = (a, b, n = 30) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
const arc = (c, r, a0 = 0.3, a1 = 2 * Math.PI + 0.2, n = 60) => Array.from({ length: n + 1 }, (_, i) => [c[0] + r * Math.cos(a0 + (a1 - a0) * i / n), c[1] + r * Math.sin(a0 + (a1 - a0) * i / n)]);
const proche = (a, b, t) => Math.abs(a - b) <= t;

test('ANN-01 : un tracé presque droit devient une droite aux deux extrémités', () => {
  const r = A.reconnaitre(bruit(seg([10, 10], [300, 80])));
  assert.equal(r.type, 'ligne'); assert.equal(r.pts.length, 2);
  assert.ok(proche(r.pts[0][0], 10, 2) && proche(r.pts[1][0], 300, 2));
});
test('ANN-01 : cercle, rectangle, quadrilatère penché, flèche, polyligne', () => {
  const c = A.reconnaitre(bruit(arc([200, 200], 80), 2));
  assert.equal(c.type, 'cercle'); assert.ok(proche(c.pts[0][0], 200, 2) && proche(c.pts[0][1], 200, 2));
  assert.ok(proche(A.distance({ type: 'cercle', pts: c.pts }, [200, 120]), 0, 2));
  const rect = [...seg([50, 50], [250, 50], 20), ...seg([250, 50], [250, 150], 14), ...seg([250, 150], [50, 150], 20), ...seg([50, 150], [50, 52], 14)];
  const r = A.reconnaitre(bruit(rect));
  assert.equal(r.type, 'rect'); assert.ok(proche(r.pts[1][0] - r.pts[0][0], 200, 4) && proche(r.pts[1][1] - r.pts[0][1], 100, 4));
  const penche = A.reconnaitre(bruit([...seg([100, 0], [200, 60]), ...seg([200, 60], [140, 160]), ...seg([140, 160], [40, 100]), ...seg([40, 100], [100, 2])]));
  assert.equal(penche.type, 'poly'); assert.equal(penche.pts.length, 4); assert.equal(penche.ferme, true);
  const f = A.reconnaitre(bruit([...seg([20, 100], [300, 100], 40), ...seg([300, 100], [270, 80], 6), ...seg([270, 80], [300, 100], 6), ...seg([300, 100], [270, 120], 6)], 0.8));
  assert.equal(f.type, 'fleche'); assert.ok(proche(f.pts[1][0], 300, 3));
  const z = A.reconnaitre(bruit([...seg([0, 0], [100, 80], 20), ...seg([100, 80], [200, 0], 20), ...seg([200, 0], [300, 90], 20)]));
  assert.equal(z.type, 'poly'); assert.equal(z.pts.length, 4);                 // poignée à chaque sommet, extrémités comprises
  assert.ok(proche(z.pts[0][0], 0, 2) && proche(z.pts[3][0], 300, 2));
});
test('ANN-01 : sans correction le tracé reste une polyligne ; un simple clic ne crée rien', () => {
  assert.equal(A.reconnaitre(bruit(seg([10, 10], [300, 80])), { corriger: false }).type, 'poly');
  assert.equal(A.reconnaitre([[5, 5], [5, 6]]), null);
  assert.equal(A.reconnaitre([[5, 5]]), null);
});
test('ANN-02 : poignées et déformation', () => {
  const r = A.creer('rect', [[10, 10], [110, 60]], { id: 'a1' });
  assert.deepEqual(A.poignees(r), [[10, 10], [110, 10], [110, 60], [10, 60]]);
  const r2 = A.deplacerPoignee(r, 2, [150, 90]);                               // coin opposé fixe
  assert.deepEqual(r2.pts, [[10, 10], [150, 90]]);
  const r3 = A.deplacerPoignee(r, 1, [130, 0]);
  assert.deepEqual(r3.pts, [[10, 0], [130, 60]]);
  assert.deepEqual(r.pts, [[10, 10], [110, 60]]);                              // l'original n'est pas modifié (annuler/rétablir)
  const c = A.creer('cercle', [[50, 50], [80, 50]]);
  assert.equal(A.deplacerPoignee(c, 1, [50, 90]).pts[1][1], 90);
  const dc = A.deplacerPoignee(c, 0, [60, 70]);
  assert.deepEqual(dc.pts, [[60, 70], [90, 70]]);
  const p = A.creer('poly', [[0, 0], [10, 10], [20, 0]]);
  assert.deepEqual(A.deplacerPoignee(p, 2, [30, 5]).pts[2], [30, 5]);
  assert.deepEqual(A.deplacer(p, 5, -5).pts[1], [15, 5]);
});
test('ANN-02 : sélection au pointeur', () => {
  const l = [A.creer('ligne', [[0, 0], [100, 0]], { id: 'a1' }), A.creer('cercle', [[50, 50], [80, 50]], { id: 'a2' }), A.creer('texte', [[200, 100]], { id: 'a3', texte: 'Ø 12', taille: 20 })];
  assert.equal(A.trouver(l, [40, 3], 6), 0);
  assert.equal(A.trouver(l, [80, 50], 6), 1);
  assert.equal(A.trouver(l, [205, 95], 2), 2);
  assert.equal(A.trouver(l, [500, 500], 6), -1);
  assert.equal(A.trouverPoignee(l[1], [81, 51], 5), 1);
  assert.equal(A.idSuivant(l), 'a4');
});
test('ANN-03 : tracer ramène chaque annotation à des primitives (flèche = hampe + tête pleine)', () => {
  const f = A.tracer(A.creer('fleche', [[0, 0], [100, 0]], { epais: 4 }));
  assert.equal(f.length, 2); assert.equal(f[1].t, 'tete'); assert.deepEqual(f[1].pts[0], [100, 0]);
  assert.ok(f[0].pts[1][0] < 100 && f[0].pts[1][0] > 70);                      // la hampe s'arrête dans la tête
  assert.deepEqual(A.tracer(A.creer('fleche', [[5, 5], [5, 5]])), []);
  const t = A.tracer(A.creer('texte', [[10, 20]], { texte: 'a\nb', taille: 10 }), { sens: -1 })[0];
  assert.equal(t.lignes.length, 2); assert.equal(t.pas, -12);
  assert.equal(A.tracer(A.creer('rect', [[0, 0], [4, 3]]))[0].pts.length, 4);
});
test('ANN-04 : un projet ou un stockage corrompu ne produit aucune annotation invalide', () => {
  const bon = A.creer('ligne', [[0, 0], [1, 1]], { id: 'a1' });
  const sale = [bon, null, { type: 'inconnu', pts: [] }, { type: 'ligne', pts: [[0, 0]] }, { type: 'cercle', pts: [[0, 0], [NaN, 2]] },
    { type: 'texte', pts: [[1, 2]], texte: 'ok', taille: -3, couleur: 'rouge', id: 'x' }, { type: 'poly', pts: [[0, 0], [1, 1], [2, 0]], ferme: true, couleur: '#00ff00', epais: 3 }];
  const n = A.nettoyer(sale);
  assert.equal(n.length, 3);
  assert.equal(n[1].taille, 24); assert.equal(n[1].couleur, A.PALETTE[0]); assert.equal(n[2].ferme, true);
  assert.deepEqual(A.nettoyer('x'), []);
});
test('ANN-05 : export PDF d’une capture annotée (JPEG + annotations vectorielles), structure valide', async () => {
  const jpeg = new Uint8Array(fs.readFileSync(new URL('./fixtures/fond_annot_64x48.jpg', import.meta.url)));
  const an = [A.creer('fleche', [[5, 5], [50, 30]], { couleur: '#e53935' }), A.creer('cercle', [[32, 24], [45, 24]], { couleur: '#1e88e5' }),
    A.creer('rect', [[8, 8], [30, 20]]), A.creer('poly', [[1, 40], [20, 44], [40, 38]], { couleur: '#43a047' }), A.creer('texte', [[10, 40]], { texte: 'Ø 12 ±0,05 (à vérifier)', taille: 6 })];
  const r = A.ecrirePdfImage(jpeg, 64, 48, an, { fichier: 'essai.step', date: '2026-10-13' });
  assert.equal(r.format, 'A4 paysage');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annot-')), f = path.join(dir, 'a.pdf');
  fs.writeFileSync(f, r.octets);
  const txt = Buffer.from(r.octets).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4') && txt.includes('/DCTDecode') && txt.includes('/Width 64 /Height 48') && txt.trimEnd().endsWith('%%EOF'));
  const q = spawnSync('qpdf', ['--check', f], { encoding: 'utf8' });
  if (q.error) return;                                                            // qpdf absent : contrôle facultatif
  assert.equal(q.status, 0, q.stdout + q.stderr);
  const t = spawnSync('pdftotext', [f, '-'], { encoding: 'utf8' });
  if (!t.error) assert.ok(t.stdout.includes('Ø 12') || t.stdout.includes('12 ±0,05'), t.stdout);
  execFileSync('python3', ['-c', 'import sys;d=open(sys.argv[1],"rb").read();assert d[:5]==b"%PDF-"', f]);
});

// ——— Annotations en mm sur la mise en plan : repère, DXF et PDF ———
import { exporterDxf, exporterPdf, composerPlan, ecrireDxf, aciProche } from '../standalone/src/geom/export-plan.js';
const dessin0 = () => ({
  items: [{ kind: 'poly', layer: 'Contours', pts: [[0, 0], [200, 0], [200, 100], [0, 100], [0, 0]], snap: [], pointille: false }],
  calques: [{ nom: 'Contours', rgb: '#15202b', couleur: 7, ltype: 'CONTINUOUS', gele: false, nb: 1 }], cadre: { x0: 0, y0: 0, x1: 200, y1: 100 }, unite: 'mm',
});
test('ANN-06 : changement de repère capture ↔ plan, aller-retour exact, tailles proportionnelles', () => {
  const f = { kx: 4, ky: -4, tx: 100, ty: 300 };                       // 4 px par mm, axe Y inversé
  const px = [A.creer('texte', [[140, 260]], { texte: 'X', taille: 24, epais: 8 }), A.creer('fleche', [[100, 300], [180, 220]], { epais: 8 }), A.creer('rect', [[100, 300], [140, 260]], { epais: 4 })];
  const mm = A.transformer(px, A.inverse(f));
  assert.deepEqual(mm[1].pts, [[0, 0], [20, 20]]);                    // 80 px à droite et 80 px vers le haut = 20 mm
  assert.equal(mm[0].taille, 6); assert.equal(mm[1].epais, 2);
  const retour = A.transformer(mm, f);
  for (let i = 0; i < px.length; i++) { assert.equal(retour[i].epais, px[i].epais); retour[i].pts.forEach((p, j) => { assert.ok(Math.abs(p[0] - px[i].pts[j][0]) < 1e-9 && Math.abs(p[1] - px[i].pts[j][1]) < 1e-9); }); }
  assert.deepEqual(px[1].pts, [[100, 300], [180, 220]]);               // l'entrée n'est pas modifiée
});
test('ANN-06 : DXF avec calque ANNOTATIONS, couleurs propres, texte multiligne, flèche pleine', () => {
  const an = [A.creer('fleche', [[10, 10], [60, 40]], { couleur: '#1e88e5', epais: 0.5 }), A.creer('cercle', [[100, 50], [120, 50]], { couleur: '#43a047', epais: 0.5 }),
    A.creer('rect', [[20, 60], [80, 90]], { couleur: '#fb8c00', epais: 0.5 }), A.creer('poly', [[0, 0], [10, 20], [30, 5]], { couleur: '#8e24aa', epais: 0.5 }),
    A.creer('texte', [[130, 80]], { texte: 'Ø 8 H7\nà vérifier', taille: 4, couleur: '#e53935' })];
  const it = A.itemsAnnotations(an);
  assert.ok(it.every(o => o.layer === 'Annotations' && o.rgb));
  assert.equal(it.filter(o => o.kind === 'text').length, 2);
  assert.ok(it.find(o => o.kind === 'text' && o.texte === 'à vérifier').pts[0][1] < 80);   // 2ᵉ ligne SOUS la 1ʳᵉ (axe Y vers le haut)
  assert.equal(it.filter(o => o.plein).length, 1);
  assert.equal(aciProche('#1e88e5'), 150); assert.equal(aciProche('#e53935'), 1); assert.equal(aciProche('zzz'), 7);
  const src = dessin0(), avant = JSON.stringify(src);
  const plan = composerPlan(src, [], { cartouche: true, annotations: it });
  assert.equal(JSON.stringify(src), avant, 'le dessin source n’est pas modifié');
  assert.ok(plan.calques.some(c => c.nom === 'Annotations'));
  const dxf = Buffer.from(ecrireDxf(plan, {})).toString('latin1');
  assert.ok(dxf.includes('ANNOTATIONS') && /\n 62\r\n150\r\n|\r\n62\r\n150\r\n/.test(dxf), 'couleur ACI par entité');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annot-dxf-')), f = path.join(dir, 'a.dxf');
  fs.writeFileSync(f, ecrireDxf(plan, {}));
  const r = spawnSync('python3', ['-c', 'import sys,ezdxf\nfrom ezdxf import recover\nd=ezdxf.readfile(sys.argv[1])\naud=d.audit()\nprint(len(aud.errors))\nms=d.modelspace()\nprint(len([e for e in ms if e.dxf.layer=="ANNOTATIONS"]))', f], { encoding: 'utf8' });
  if (r.status === 0) { const [err, nb] = r.stdout.trim().split('\n').map(Number); assert.equal(err, 0); assert.equal(nb, 7); }
});
test('ANN-06 : PDF 1:1 avec annotations colorées (qpdf)', () => {
  const an = [A.creer('cercle', [[100, 50], [120, 50]], { couleur: '#43a047', epais: 0.5 }), A.creer('texte', [[130, 80]], { texte: 'Contrôle 12', taille: 4, couleur: '#e53935' })];
  const r = exporterPdf(dessin0(), [], { nom: 'essai', date: '2026-10-13', annotations: A.itemsAnnotations(an) });
  const txt = Buffer.from(r.octets).toString('latin1');
  assert.ok(txt.includes('0.2627 0.6275 0.2784 RG') || txt.includes('0.2627 0.6275 0.2784 rg'), 'vert de l’annotation');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annot-pdf-')), f = path.join(dir, 'p.pdf'); fs.writeFileSync(f, r.octets);
  const q = spawnSync('qpdf', ['--check', f], { encoding: 'utf8' }); if (!q.error) assert.equal(q.status, 0, q.stdout);
  const t = spawnSync('pdftotext', [f, '-'], { encoding: 'utf8' }); if (!t.error) assert.ok(t.stdout.includes('Contrôle 12'));
});
