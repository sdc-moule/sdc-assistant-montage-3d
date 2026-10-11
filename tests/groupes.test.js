// Groupes de sélection nommés (standalone/src/geom/groupes.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { creerGroupe, trouverGroupe, ajouterAuGroupe, retirerDuGroupe, renommerGroupe, supprimerGroupe, groupesDe, reprendreGroupes, ErreurGroupe, MAX_NOM } from '../standalone/src/geom/groupes.js';

test('création : nom nettoyé, doublons d\'identifiants écartés, couleur et identifiant attribués', () => {
  const L = [];
  const g = creerGroupe(L, '  Partie   injection ', ['O001', 'O002', 'O001'], { origine: 'Filtre : tournage' });
  assert.equal(g.nom, 'Partie injection'); assert.deepEqual(g.ids, ['O001', 'O002']); assert.equal(g.id, 'G1'); assert.match(g.couleur, /^#[0-9a-f]{6}$/i); assert.equal(g.origine, 'Filtre : tournage');
  assert.equal(L.length, 1);
  assert.equal(creerGroupe(L, 'Éjection', ['O003']).id, 'G2');
});

test('refus : nom vide, trop long, déjà pris (sans tenir compte des accents ni de la casse), groupe vide', () => {
  const L = []; creerGroupe(L, 'Éjection', ['O001']);
  assert.throws(() => creerGroupe(L, '   ', ['O001']), ErreurGroupe);
  assert.throws(() => creerGroupe(L, 'x'.repeat(MAX_NOM + 1), ['O001']), /trop long/);
  assert.throws(() => creerGroupe(L, 'ejection', ['O002']), /existe déjà/);
  assert.throws(() => creerGroupe(L, 'Autre', []), /aucune pièce/);
  assert.equal(L.length, 1, 'rien n\'est créé en cas de refus');
});

test('recherche par identifiant ou par nom ; ajout / retrait comptent les pièces réellement touchées', () => {
  const L = []; const g = creerGroupe(L, 'Partie injection', ['O001', 'O002']);
  assert.equal(trouverGroupe(L, 'G1'), g); assert.equal(trouverGroupe(L, 'PARTIE INJECTION'), g); assert.equal(trouverGroupe(L, 'inconnu'), null); assert.equal(trouverGroupe(L, ''), null);
  assert.equal(ajouterAuGroupe(g, ['O002', 'O003', 'O004']), 2); assert.deepEqual(g.ids, ['O001', 'O002', 'O003', 'O004']);
  assert.equal(retirerDuGroupe(g, ['O001', 'O999']), 1); assert.deepEqual(g.ids, ['O002', 'O003', 'O004']);
  assert.deepEqual(groupesDe(L, 'O003').map(x => x.nom), ['Partie injection']); assert.deepEqual(groupesDe(L, 'O001'), []);
});

test('renommer : refusé si le nom est pris par un autre groupe ; supprimer ; identifiants jamais réutilisés', () => {
  const L = []; const a = creerGroupe(L, 'A', ['O001']), b = creerGroupe(L, 'B', ['O002']);
  assert.throws(() => renommerGroupe(L, a, 'b'), /existe déjà/);
  renommerGroupe(L, a, 'A bis'); assert.equal(a.nom, 'A bis'); renommerGroupe(L, a, 'a BIS'); assert.equal(a.nom, 'a BIS');
  assert.equal(supprimerGroupe(L, b), true); assert.equal(supprimerGroupe(L, b), false);
  assert.equal(creerGroupe(L, 'C', ['O003']).id, 'G2', 'G2 libre mais l\'identifiant suit le plus grand existant');
  const d = creerGroupe(L, 'D', ['O004']); assert.equal(d.id, 'G3');
});

test('reprise d\'un projet : correspondance des pièces, pièces absentes écartées, groupes vides abandonnés, données invalides ignorées', () => {
  const sauve = [
    { id: 'G1', nom: 'Injection', ids: ['O001', 'O002', 'O009'], couleur: '#1f77d0', origine: 'Filtre : tournage' },
    { id: 'G2', nom: 'Fantôme', ids: ['O777'] },
    { id: 'G3', nom: 'injection', ids: ['O003'], couleur: 'rouge' },
    { nom: 12 }, null, { nom: 'Sans ids' },
  ];
  const { groupes, perdues } = reprendreGroupes(sauve, id => ({ O001: 'P1', O002: 'P2', O003: 'P3' })[id], new Set(['P1', 'P2', 'P3']));
  assert.equal(groupes.length, 2); assert.equal(perdues, 2); // O009 et O777
  assert.deepEqual(groupes[0].ids, ['P1', 'P2']); assert.equal(groupes[0].couleur, '#1f77d0'); assert.equal(groupes[0].origine, 'Filtre : tournage');
  assert.equal(groupes[1].nom, 'injection (2)', 'nom en double renommé, jamais fusionné'); assert.match(groupes[1].couleur, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(reprendreGroupes(undefined, x => x, new Set()).groupes, []);
});
