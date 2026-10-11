import test from 'node:test';
import assert from 'node:assert/strict';
import { guide, ACTIONS_GUIDE } from '../standalone/src/geom/guide.js';

test('guide : sans fichier, invite à ouvrir un STEP', () => {
  const g = guide({ charge: false });
  assert.equal(g.cle, 'vide'); assert.match(g.texte, /STEP/); assert.equal(g.actions.length, 0);
});

test('guide : pièce à usiner propose « fini » en action principale', () => {
  const g = guide({ charge: true, nbSel: 1, row: { repere: 3, etat: 'a_faire', percages: 2, typologie: 'tournage' } });
  assert.equal(g.cle, 'afaire');
  assert.equal(g.actions[0].id, 'fini'); assert.ok(g.actions[0].primaire);
  assert.ok(g.actions.some(a => a.id === 'percages_piece'));
  assert.match(g.texte, /tournage/); assert.match(g.texte, /vert/);
});

test('guide : pièce finie propose la suivante, sauf s\'il ne reste rien', () => {
  const r = { repere: 1, etat: 'fini' };
  assert.equal(guide({ charge: true, nbSel: 1, row: r, restants: 4 }).actions[0].id, 'suivante');
  const g0 = guide({ charge: true, nbSel: 1, row: r, restants: 0 });
  assert.ok(!g0.actions.some(a => a.id === 'suivante')); assert.match(g0.texte, /terminées/);
});

test('guide : pièce achetée proposée → marquée « à vérifier »', () => {
  const g = guide({ charge: true, nbSel: 1, row: { repere: 9, etat: 'achete', achat: 'proposé' } });
  assert.equal(g.cle, 'achete'); assert.match(g.texte, /vérifier/);
  assert.ok(g.actions.some(a => a.id === 'a_usiner'));
});

test('guide : le nom renommé est utilisé dans le titre', () => {
  assert.match(guide({ charge: true, nbSel: 1, row: { repere: 3, nom: 'Chambre A', etat: 'a_faire' } }).titre, /Chambre A/);
});

test('guide : sélection multiple, cotation et suivi', () => {
  assert.equal(guide({ charge: true, nbSel: 4 }).cle, 'multi');
  assert.equal(guide({ charge: true, cotation: true, nbSel: 1, row: { etat: 'a_faire' } }).cle, 'cotation');
  assert.match(guide({ charge: true, cotation: true }).texte, /glisser/);
  const g = guide({ charge: true, mode: 'reste', nbSel: 0, restants: 2 });
  assert.equal(g.cle, 'reste'); assert.equal(g.actions[0].id, 'suivante');
});

test('guide : pièces masquées en mode explorer, puis aide du mode', () => {
  assert.equal(guide({ charge: true, mode: 'explorer', nbSel: 0, nbMasquees: 3 }).cle, 'masquees');
  assert.equal(guide({ charge: true, mode: 'coupe', nbSel: 0, nbMasquees: 3 }).cle, 'mode_coupe');
  assert.equal(guide({ charge: true, mode: 'inconnu', nbSel: 0 }).cle, 'mode_explorer');
});

test('guide : toutes les actions proposées sont connues de l\'interface', () => {
  const ctxs = [
    { charge: true, nbSel: 1, row: { etat: 'a_faire', percages: 1 }, restants: 2 }, { charge: true, nbSel: 1, row: { etat: 'fini' }, restants: 2 },
    { charge: true, nbSel: 1, row: { etat: 'achete' } }, { charge: true, nbSel: 3 }, { charge: true, cotation: true }, { charge: true, faces: true },
    { charge: true, mode: 'reste', restants: 1 }, { charge: true, mode: 'eclate' }, { charge: true, mode: 'coupe' }, { charge: true, mode: 'percages' }, { charge: true, nbMasquees: 2 },
  ];
  for (const c of ctxs) for (const a of guide(c).actions) assert.ok(ACTIONS_GUIDE.includes(a.id), `action inconnue : ${a.id}`);
});
