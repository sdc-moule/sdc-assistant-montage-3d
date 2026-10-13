// Écriture manuscrite (ANN-07) : reconnaissance hors ligne de chiffres, symboles et lettres, sur des écritures SYNTHÉTIQUES bruitées
// (rotation, inclinaison, échelle, tremblement, points manquants). Aucune écriture réelle n'a été évaluée : le résultat reste « proposé, à vérifier ».
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../standalone/src/geom/manuscrit.js';

function prng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const densifier = (s, n) => { const out = []; for (let i = 1; i < s.length; i++) { const a = s[i - 1], b = s[i], k = Math.max(1, Math.ceil(n / (s.length - 1))); for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); } out.push(s.at(-1)); return out; };
// chaîne → tracés en coordonnées écran (axe Y vers le bas) de hauteur H
function ecrire(txt, rnd, H = 100) {
  const traits = []; let x = 0;
  for (const ch of txt) {
    if (ch === ' ') { x += 0.9 * H; continue; }
    let gl, w = 0.6 * H;
    if (ch === '.') { gl = [[[0.03, 0], [0, 0.03], [0.04, 0.05]]]; w = 0.06 * H; }
    else if (ch === ',') { gl = [[[.05, -.07], [.04, 0], [-.02, .12]]]; w = 0.08 * H; }
    else if (ch === '-') { gl = [[[0, -.5], [.45, -.5]]]; w = 0.45 * H; }
    else if (ch === '°') { gl = [Array.from({ length: 12 }, (_, i) => [.12 + .12 * Math.cos(i / 11 * 6.4), -.9 + .12 * Math.sin(i / 11 * 6.4)])]; w = 0.25 * H; }
    else { gl = M.modeleTraces(ch, Math.floor(rnd() * 5)); w = Math.max(...gl.flat().map(p => p[0])) * H; }
    const sx = .88 + rnd() * .3, sy = .92 + rnd() * .16, th = (rnd() - .5) * .24, sh = (rnd() - .5) * .24;
    for (const s of gl) traits.push(densifier(s, 24 + Math.floor(rnd() * 14)).filter((_, i) => rnd() < .75 || i === 0).map(([a, b]) => {
      const X = a * sx - sh * b * sy, Y = b * sy, c = Math.cos(th), s2 = Math.sin(th);
      return [x + (X * c - Y * s2) * H + (rnd() - .5) * .025 * H, (X * s2 + Y * c) * H + (rnd() - .5) * .025 * H];
    }));
    x += w * sx + (0.22 + rnd() * .2) * H;
  }
  return traits;
}

test('ANN-07 : chaque chiffre est reconnu isolément (≥ 90 % par chiffre, ≥ 95 % au total)', () => {
  const rnd = prng(2026); let ok = 0, tot = 0;
  for (const ch of '0123456789') {
    let g = 0; for (let i = 0; i < 30; i++) if (M.reconnaitreTexte(ecrire(ch, rnd)).texte === ch) g++;
    assert.ok(g >= 27, `chiffre ${ch} : ${g}/30`); ok += g; tot += 30;
  }
  assert.ok(ok / tot >= 0.95, `${ok}/${tot}`);
});
test('ANN-07 : symboles de cotation Ø × ± ° , . - reconnus dans une chaîne', () => {
  const rnd = prng(99);
  for (const [t, min] of [['Ø8', 17], ['45°', 17], ['1,5', 17], ['-3', 17], ['H7', 17], ['12×30', 14], ['±0,05', 16], ['M10', 15], ['2×45°', 14]]) {
    let g = 0; for (let i = 0; i < 20; i++) if (M.reconnaitreTexte(ecrire(t, rnd)).texte === t) g++;
    assert.ok(g >= min, `« ${t} » : ${g}/20 (minimum ${min})`);
  }
});
test('ANN-07 : le résultat donne taille, ancre et doute caractère par caractère', () => {
  const rnd = prng(5), r = M.reconnaitreTexte(ecrire('Ø20', rnd, 80).map(s => s.map(([x, y]) => [x + 300, y + 500])));
  assert.equal(r.texte, 'Ø20'); assert.equal(r.car.length, 3);
  assert.ok(r.ancre[0] >= 290 && r.ancre[0] <= 330, `x ${r.ancre[0]}`); assert.ok(Math.abs(r.ancre[1] - 500) < 25, `y ${r.ancre[1]}`);
  assert.ok(r.taille > 70 && r.taille < 140, `taille ${r.taille}`);
  assert.ok(r.car.every(c => typeof c.doute === 'boolean' && Array.isArray(c.alt)));
});
test('ANN-07 : espace entre mots, contexte chiffres / lettres (M8, R5), entrée vide', () => {
  const rnd = prng(31);
  let g = 0; for (let i = 0; i < 20; i++) if (M.reconnaitreTexte(ecrire('Ø20 H7', rnd)).texte === 'Ø20 H7') g++;
  assert.ok(g >= 15, `Ø20 H7 : ${g}/20`);
  g = 0; for (let i = 0; i < 20; i++) if (M.reconnaitreTexte(ecrire('M8', rnd)).texte === 'M8') g++;
  assert.ok(g >= 15, `M8 : ${g}/20`);
  assert.equal(M.reconnaitreTexte([]).texte, '');
  assert.equal(M.CARACTERES.includes('Ø') && M.CARACTERES.includes('×') && M.CARACTERES.includes('R'), true);
});
