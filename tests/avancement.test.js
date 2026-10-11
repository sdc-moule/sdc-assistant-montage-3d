// Avancement « reste à faire » (standalone/src/geom/avancement.js) et critère de cible « avancement ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { achatProbable, etatRepere, normaliserEtat, validerAvancement, noteAvec, compter } from '../standalone/src/geom/avancement.js';
import { correspond, validerCriteres } from '../standalone/src/geom/typologie.js';

test('détection des pièces achetées : vis, écrou, rondelle, joint, bague, colonne (accents, pluriels, séparateurs _ - espace)', () => {
  for (const n of ['VIS_CHC_M10×40', 'Vis M8', 'Écrou H M12', 'ECROU_M12', 'Rondelle plate', 'Joint torique', 'JOINTS', 'Bague de guidage', 'BAGUE_CENTRAGE', 'Colonne de guidage', 'colonnes', 'screw M6', 'O-ring 20x2', 'Bushing'])
    assert.equal(achatProbable(n), true, n);
  for (const n of ['OBTURATEUR_D8', 'BUSETTE_D20', 'PLAQUE_FIXATION_INF', 'COLLECTEUR_BCR', 'Visseuse', 'Adjoint', 'Révision', 'Divis', '', undefined])
    assert.equal(achatProbable(n), false, String(n));
});

test('état d\'un repère : acheté prioritaire, fini saisi, correction manuelle de la détection', () => {
  assert.deepEqual(etatRepere({}, 'PLAQUE'), { etat: 'a_faire', achat: null, fini: false });
  assert.deepEqual(etatRepere({ fini: true }, 'PLAQUE'), { etat: 'fini', achat: null, fini: true });
  assert.deepEqual(etatRepere(undefined, 'VIS_CHC'), { etat: 'achete', achat: 'proposé', fini: false });
  assert.equal(etatRepere({ fini: true }, 'VIS_CHC').etat, 'achete', 'acheté l\'emporte : pas à usiner');
  assert.deepEqual(etatRepere({ achete: false }, 'VIS_SPECIALE_USINEE'), { etat: 'a_faire', achat: null, fini: false }, 'vis spéciale usinée en interne');
  assert.deepEqual(etatRepere({ achete: true }, 'RESSORT'), { etat: 'achete', achat: 'manuel', fini: false });
});

test('mise à jour des notes sans effet de bord, valeurs par défaut supprimées', () => {
  const n0 = { reference: 'R1' };
  const n1 = noteAvec(n0, { fini: true }); assert.deepEqual(n1, { reference: 'R1', fini: true }); assert.deepEqual(n0, { reference: 'R1' });
  assert.deepEqual(noteAvec(n1, { fini: false }), { reference: 'R1' });
  assert.deepEqual(noteAvec(n1, { achete: false }), { reference: 'R1', fini: true, achete: false });
  assert.deepEqual(noteAvec({ achete: false }, { achete: null }), {}, 'retour à la détection automatique');
});

test('critère « avancement » : alias, validation, correspondance', () => {
  assert.equal(normaliserEtat('À faire'), 'a_faire'); assert.equal(normaliserEtat('faites'), 'fini'); assert.equal(normaliserEtat('Achetées'), 'achete'); assert.equal(normaliserEtat('xx'), null);
  assert.equal(validerAvancement(['fini', 'achetee']), null); assert.match(validerAvancement('bientôt'), /inconnu/); assert.match(validerAvancement([]), /au moins/);
  assert.match(validerCriteres({ avancement: 3 }), /inconnu/);
  assert.equal(validerCriteres({ avancement: 'a_faire' }), null);
  const p = { nom: 'x', avancement: 'a_faire' };
  assert.equal(correspond(p, { avancement: 'à faire' }), true); assert.equal(correspond(p, { avancement: ['fini', 'achete'] }), false);
  assert.equal(correspond(p, { avancement: 'a_faire', nom: 'y' }), false, 'critères cumulés');
});

test('totaux : repères et pièces, pièces achetées exclues du pourcentage', () => {
  const t = compter([{ etat: 'fini', quantite: 2 }, { etat: 'a_faire', quantite: 2 }, { etat: 'a_faire', quantite: 1 }, { etat: 'achete', quantite: 4 }]);
  assert.deepEqual(t.reperes, { a_faire: 2, fini: 1, achete: 1 }); assert.deepEqual(t.pieces, { a_faire: 3, fini: 2, achete: 4 });
  assert.deepEqual(t.usiner, { reperes: 3, pieces: 5 }); assert.equal(t.pct_fini, 40);
  assert.equal(compter([{ etat: 'achete', quantite: 4 }]).pct_fini, null);
});
