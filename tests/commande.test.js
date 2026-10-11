// Commandes JSON (standalone/src/geom/commande.js) : validation avant exécution, cibles, confirmations, garde-fous.
import test from 'node:test';
import assert from 'node:assert/strict';
import { executer, preparer, resoudreCible, extraireJson, modeEmploiIA, contexteIA, COMMANDES, ErreurCommande } from '../standalone/src/geom/commande.js';

// Faux « ctx » : trois repères, mémorise les appels pour vérifier ce qui est réellement demandé à l'application.
function fauxCtx() {
  const appels = [];
  const pieces = [
    { id: 'O001', repere: 1, nom: 'PLAQUE_PORTE_EMPREINTE', sous_ensemble: 'BCR', famille: 'plaque', famille_label: 'Plaques', visible: true, opacite_pct: 100, selectionnee: false, dims_mm: [300, 200, 40], volume_cm3: 1200, type_usinage: 'fraisage', revolution_pct: 12, diametre_mm: null, longueur_mm: null, dim_max_mm: 300, dim_min_mm: 40, brut_mm: [300, 200, 40] },
    { id: 'O002', repere: 2, nom: 'VIS_CHC_M10x40', sous_ensemble: 'BCR / visserie', famille: 'visserie', famille_label: 'Visserie / goupilles', visible: true, opacite_pct: 100, selectionnee: false, dims_mm: [10, 10, 40], volume_cm3: 3, type_usinage: 'tournage', revolution_pct: 100, diametre_mm: 10, longueur_mm: 40, dim_max_mm: 40, dim_min_mm: 10, brut_mm: [40, 10, 10] },
    { id: 'O003', repere: 2, nom: 'VIS_CHC_M10x40', sous_ensemble: 'BCR / visserie', famille: 'visserie', famille_label: 'Visserie / goupilles', visible: true, opacite_pct: 100, selectionnee: false, dims_mm: [10, 10, 40], volume_cm3: 3, type_usinage: 'tournage', revolution_pct: 100, diametre_mm: 10, longueur_mm: 40, dim_max_mm: 40, dim_min_mm: 10, brut_mm: [40, 10, 10] },
    { id: 'O004', repere: 3, nom: 'COLLECTEUR', sous_ensemble: 'BCR', famille: 'collecteur', famille_label: 'Collecteurs', visible: true, opacite_pct: 100, selectionnee: false, dims_mm: [120, 60, 50], volume_cm3: 200, type_usinage: 'fraisage', revolution_pct: 30, diametre_mm: null, longueur_mm: null, dim_max_mm: 120, dim_min_mm: 50, brut_mm: [120, 60, 50] },
  ];
  const rec = nom => (...a) => { appels.push([nom, ...a]); };
  const ctx = {
    appels, pieces: () => pieces, charge: () => true,
    recherche: (id, t) => pieces.find(p => p.id === id).nom.toLowerCase().includes(String(t).toLowerCase()),
    reperesDe: ids => [...new Set(ids.map(i => pieces.find(p => p.id === i).repere))].sort((a, b) => a - b),
    nomenclature: () => [{ repere: 1, designation: 'PLAQUE', quantite: 1, famille: 'Plaques', sous_ensemble: 'BCR', dims_mm: [300, 200, 40], statut: 'proposé' }],
    etat: () => ({ fichier: 'essai.step' }),
    bornes: () => ({ x: [0, 300], y: [0, 200], z: [0, 140] }),
    cylindres: id => (id === 'O001' ? [{ type: 'perçage', diametre: 24, origine: [10, 0, 0], direction: [0, 1, 0], longueur: 50 }, { type: 'perçage', diametre: 8, origine: [0, 0, 0], direction: [0, 0, 1], longueur: 30 }] : []),
    familles: () => [{ id: 'plaque', label: 'Plaques' }, { id: 'busette', label: 'Busettes / buses' }],
    familleId: n => ({ plaques: 'plaque', busettes: 'busette' }[String(n).toLowerCase()] ?? null),
    coupe: (k, s) => { appels.push(['coupe', k, s]); return { on: s.on, pos: s.pos ?? 100, flip: !!s.flip }; },
    nbGroupes: () => 0, scenes: () => [], cotes: () => [], reseaux: () => [], percages: () => [],
  };
  for (const n of ['selectionner', 'deselectionner', 'masquer', 'afficher', 'isoler', 'toutAfficher', 'opacite', 'fantome', 'cadrer', 'vue', 'famille', 'classerFamille', 'bulles', 'couleurs', 'mode', 'coupesRetirer', 'coupeOptions', 'eclater', 'ouverture', 'groupeMobile', 'groupesSupprimer', 'classerCircuit', 'diametreMaxi', 'commentaire', 'repereValider', 'repereReference', 'exporter']) ctx[n] = rec(n);
  const groupes = [];
  ctx.groupes = () => groupes.map(g => ({ nom: g.nom, nb_pieces: g.ids.length }));
  ctx.nomsGroupes = () => groupes.map(g => g.nom);
  ctx.idsGroupe = ref => groupes.find(g => g.nom.toLowerCase() === String(ref).toLowerCase())?.ids ?? null;
  ctx.groupeCreer = (nom, ids) => { if (groupes.some(g => g.nom === nom)) throw new ErreurCommande(`le groupe « ${nom} » existe déjà.`); groupes.push({ nom, ids: [...ids] }); appels.push(['groupeCreer', nom, ids]); return nom; };
  ctx.groupeAjouter = (nom, ids) => { const g = groupes.find(x => x.nom === nom); if (!g) throw new ErreurCommande(`groupe « ${nom} » inconnu.`); const n = ids.filter(i => !g.ids.includes(i)); g.ids.push(...n); appels.push(['groupeAjouter', nom, ids]); return n.length; };
  ctx.groupeRetirer = (nom, ids) => { const g = groupes.find(x => x.nom === nom); if (!g) throw new ErreurCommande(`groupe « ${nom} » inconnu.`); const av = g.ids.length; g.ids = g.ids.filter(i => !ids.includes(i)); appels.push(['groupeRetirer', nom, ids]); return av - g.ids.length; };
  ctx.groupeSupprimer = nom => { const i = groupes.findIndex(x => x.nom === nom); if (i < 0) throw new ErreurCommande(`groupe « ${nom} » inconnu.`); groupes.splice(i, 1); appels.push(['groupeSupprimer', nom]); };
  ctx.circuits = q => { appels.push(['circuits', q]); return { message: 'ok' }; };
  ctx.sauverAvant = () => appels.push(['sauverAvant']);
  ctx.sceneSauver = n => { appels.push(['sceneSauver', n]); return n ?? 'Scène 1'; };
  ctx.sceneCharger = () => false; ctx.annuler = () => true; ctx.retablir = () => false; ctx.retourAvant = () => true;
  return ctx;
}
const run = (ctx, j, o) => executer(ctx, j, o);

test('cibles : repères, nom, famille, ET entre critères ; repère inexistant = erreur', () => {
  const c = fauxCtx();
  assert.deepEqual(resoudreCible(c, [2]), ['O002', 'O003']);
  assert.deepEqual(resoudreCible(c, { nom: 'vis' }), ['O002', 'O003']);
  assert.deepEqual(resoudreCible(c, { famille: 'visserie', reperes: [2, 3] }), ['O002', 'O003']);
  assert.deepEqual(resoudreCible(c, { famille: 'Collecteurs' }), ['O004']);
  assert.deepEqual(resoudreCible(c, { recherche: 'plaque' }), ['O001']);
  assert.throws(() => resoudreCible(c, [99]), /inexistant/);
  assert.throws(() => resoudreCible(c, { nom: 'inexistant' }), /aucune pièce/);
  assert.throws(() => resoudreCible(c, 'selection'), /aucune pièce n'est sélectionnée/);
});

test('validation complète AVANT exécution : une commande invalide bloque tout le lot', async () => {
  const c = fauxCtx();
  const r = await run(c, { commandes: [{ cmd: 'masquer', cible: [1] }, { cmd: 'isolr' }] });
  assert.equal(r.ok, false); assert.equal(r.executees, 0);
  assert.match(r.erreurs[0].erreur, /vouliez-vous dire « isoler »/);
  assert.ok(!c.appels.some(a => a[0] === 'masquer'), 'rien ne doit avoir été exécuté');
});

test('paramètres inconnus, hors plage ou mal typés refusés', async () => {
  const c = fauxCtx();
  for (const cmd of [{ cmd: 'opacite', cible: [1], opacite_pct: 150 }, { cmd: 'opacite', cible: [1], pct: 50 }, { cmd: 'coupe', plan: 'AB', position_mm: 1 }, { cmd: 'eclater', pct: 'beaucoup' }, { cmd: 'isoler', cible: { reper: [1] } }, { cmd: 'vue', nom: 'dessous' }]) {
    const r = await run(c, { commandes: [cmd] });
    assert.equal(r.ok, false, JSON.stringify(cmd));
  }
  assert.equal(c.appels.length, 0);
});

test('hors périmètre : collision, jeu, tolérance, serrage, simulation refusés', async () => {
  for (const cmd of ['detecter_collisions', 'calcul_jeux', 'verifier_tolerances', 'serrage', 'simulation_mecanique']) {
    const r = await run(fauxCtx(), { cmd });
    assert.equal(r.ok, false, cmd); assert.match(r.erreurs[0].erreur, /hors périmètre/);
  }
});

test('isoler / masquer / opacité / coupe : appels exacts', async () => {
  const c = fauxCtx();
  const r = await run(c, { sdc: 1, commandes: [{ cmd: 'isoler', cible: { reperes: [3] } }, { cmd: 'opacite', cible: 'tout', opacite_pct: 30 }, { cmd: 'coupe', plan: 'XZ', position_mm: 120, inverser: true }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(c.appels.find(a => a[0] === 'isoler'), ['isoler', ['O004'], true]);
  assert.deepEqual(c.appels.find(a => a[0] === 'opacite'), ['opacite', ['O001', 'O002', 'O003', 'O004'], 30]);
  assert.deepEqual(c.appels.find(a => a[0] === 'coupe'), ['coupe', 'y', { on: true, pos: 120, flip: true }]); // XZ → normale Y
});

test('coupe hors encombrement refusée avec la plage ; position en pourcentage convertie en mm', async () => {
  const c = fauxCtx();
  const r1 = await run(c, { cmd: 'coupe', plan: 'YZ', position_mm: 999 });
  assert.equal(r1.ok, false); assert.match(r1.resultats[0].erreur, /entre 0 et 300 mm/);
  const r2 = await run(c, { cmd: 'coupe', plan: 'XY', position_pct: 50 });
  assert.equal(r2.ok, true); assert.deepEqual(c.appels.find(a => a[0] === 'coupe'), ['coupe', 'z', { on: true, pos: 70, flip: undefined }]);
  const r3 = await run(c, { cmd: 'coupe', plan: 'XY', position_mm: 1, position_pct: 1 });
  assert.equal(r3.ok, false);
});

test('écritures : refusées sans confirmation, appliquées avec, ignorées si l\'opérateur refuse ; lectures et affichage passent', async () => {
  const lot = { commandes: [{ cmd: 'isoler', cible: [1] }, { cmd: 'commentaire_ajouter', cible: [2], texte: 'Vis à remplacer', type: 'anomalie' }, { cmd: 'repere_valider', repere: 3 }] };
  let c = fauxCtx();
  let r = await run(c, lot);                       // pas de confirmer : refus par défaut (API programmatique)
  assert.equal(r.ok, false);
  assert.ok(r.resultats.filter(x => x.ignoree).length === 2 && !c.appels.some(a => ['commentaire', 'repereValider'].includes(a[0])));
  assert.ok(c.appels.some(a => a[0] === 'isoler'));
  c = fauxCtx(); let vu;
  r = await run(c, lot, { confirmer: async l => { vu = l; return true; } });
  assert.equal(r.ok, true);
  assert.equal(vu.length, 2); assert.match(vu[0], /commentaire « anomalie »/); assert.match(vu[0], /repères 2/);
  assert.deepEqual(c.appels.find(a => a[0] === 'commentaire')[1], { ids: ['O002', 'O003'], texte: 'Vis à remplacer', type: 'anomalie', statut: 'ouvert', auteur: undefined });
  c = fauxCtx();
  r = await run(c, lot, { confirmer: () => false });
  assert.equal(r.ok, false); assert.ok(!c.appels.some(a => a[0] === 'commentaire'));
});

test('erreur d\'exécution : arrêt à la première erreur (ou poursuite avec arret:false)', async () => {
  const lot = { commandes: [{ cmd: 'masquer', cible: [1] }, { cmd: 'masquer', cible: { nom: 'introuvable' } }, { cmd: 'afficher', cible: [1] }] };
  let r = await run(fauxCtx(), lot);
  assert.equal(r.resultats.length, 2); assert.equal(r.executees, 1); assert.equal(r.ok, false);
  r = await run(fauxCtx(), lot, { arret: false });
  assert.equal(r.resultats.length, 3); assert.equal(r.executees, 2);
});

test('état « avant commande » mémorisé pour les commandes d\'affichage, pas pour lecture / annuler / retour', async () => {
  let c = fauxCtx();
  await run(c, { cmd: 'nomenclature' }); assert.ok(!c.appels.some(a => a[0] === 'sauverAvant'));
  await run(c, { cmd: 'masquer', cible: [1] }); assert.equal(c.appels.filter(a => a[0] === 'sauverAvant').length, 1);
  c = fauxCtx();
  for (const cmd of ['annuler', 'retablir', 'retour_avant_commande']) await run(c, { cmd });
  assert.ok(!c.appels.some(a => a[0] === 'sauverAvant'), 'ne doit pas écraser l\'état à restaurer');
});

test('groupe mobile : translation, rotation sur cylindre (Ø), erreur si Ø absent', async () => {
  let c = fauxCtx();
  let r = await run(c, { cmd: 'groupe_mobile', type: 'translation', cible: [1], axe: 'z', sens: '-', course_mm: 150 });
  assert.equal(r.ok, true); assert.deepEqual(c.appels.find(a => a[0] === 'groupeMobile')[1], { type: 'translation', ids: ['O001'], axis: 'z', sign: -1, course: 150 });
  c = fauxCtx();
  r = await run(c, { cmd: 'groupe_mobile', type: 'rotation', cible: [3], axe_cylindre: { repere: 1, diametre_mm: 24 }, angle_deg: 90 });
  assert.equal(r.ok, true);
  const m = c.appels.find(a => a[0] === 'groupeMobile')[1];
  assert.deepEqual([m.type, m.origin, m.dir, m.angle, m.sign], ['rotation', [10, 0, 0], [0, 1, 0], 90, 1]);
  assert.ok(r.resultats[0].avertissements.some(a => /non validé mécaniquement/.test(a)));
  r = await run(fauxCtx(), { cmd: 'groupe_mobile', type: 'rotation', cible: [3], axe_cylindre: { repere: 1, diametre_mm: 12 }, angle_deg: 90 });
  assert.equal(r.ok, false); assert.match(r.resultats[0].erreur, /Ø disponibles : 8, 24/);
  r = await run(fauxCtx(), { cmd: 'groupe_mobile', type: 'rotation', cible: [3], axe_libre: { origine: [0, 0, 0], direction: [0, 0, 0] }, angle_deg: 90 });
  assert.equal(r.ok, false);
});

test('extraction JSON tolérante : bloc ```json, texte autour, guillemets typographiques', async () => {
  const a = extraireJson('Voici :\n```json\n{"commandes":[{"cmd":"etat"}]}\n```\nBonne journée');
  assert.equal(a.commandes[0].cmd, 'etat');
  const b = extraireJson('{“commandes”:[{“cmd”:“etat”}]}');
  assert.equal(b.commandes[0].cmd, 'etat');
  assert.throws(() => extraireJson('pas du json'), ErreurCommande);
  const r = await run(fauxCtx(), '```json\n[{"cmd":"vue","nom":"dessus"}]\n```');
  assert.equal(r.ok, true);
  assert.equal((await run(fauxCtx(), '{"foo":1}')).ok, false);
  assert.equal((await run(fauxCtx(), { commandes: [] })).ok, false);
});

test('alias et commande seule', async () => {
  const c = fauxCtx();
  assert.equal((await run(c, { cmd: 'transparence', cible: [1], opacite_pct: 20 })).ok, true);
  assert.equal(preparer({ commande: 'Tout-Afficher' }).nom, 'tout_afficher');
});

test('mode d\'emploi IA : toutes les commandes décrites, règles de prudence présentes ; contexte avec nomenclature', () => {
  const t = modeEmploiIA();
  for (const nom of Object.keys(COMMANDES)) assert.ok(t.includes(`- ${nom}`), nom);
  assert.match(t, /N'invente jamais/); assert.match(t, /indicatives/); assert.match(t, /ÉCRITURE/);
  const ctxt = contexteIA(fauxCtx());
  assert.match(ctxt, /1 \| PLAQUE \| 1 \| Plaques/);
});

test('aide et lectures ne modifient rien', async () => {
  const c = fauxCtx();
  const r = await run(c, { commandes: [{ cmd: 'aide' }, { cmd: 'etat' }, { cmd: 'lister_pieces', cible: { famille: 'visserie' } }, { cmd: 'chercher', texte: 'vis' }] });
  assert.equal(r.ok, true);
  assert.equal(r.resultats[2].donnees.total, 2); assert.equal(r.resultats[3].donnees.total, 2);
  assert.equal(c.appels.length, 0);
});

test('docs/pilotage-ia.md : chaque exemple JSON est valide (commandes, paramètres, plages)', async () => {
  const fs = await import('node:fs');
  const md = fs.readFileSync(new URL('../docs/pilotage-ia.md', import.meta.url), 'utf8');
  const blocs = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]);
  assert.ok(blocs.length >= 15, `${blocs.length} exemples seulement`);
  for (const b of blocs) {
    const v = extraireJson(b);
    for (const c of v.commandes ?? [v]) assert.doesNotThrow(() => preparer(c), `${b.slice(0, 90)}…`);
  }
  // le premier exemple (format) est exécutable de bout en bout sur le faux ctx
  assert.equal((await executer(fauxCtx(), blocs[0].replace('[3, 4]', '[1, 2]'))).ok, true);
});

test('cibles par type d\'usinage et dimensions (même règle que la fenêtre de filtre)', () => {
  const c = fauxCtx();
  assert.deepEqual(resoudreCible(c, { type: 'tournage' }), ['O002', 'O003']);
  assert.deepEqual(resoudreCible(c, { type: 'prismatique' }), ['O001', 'O004']);
  assert.deepEqual(resoudreCible(c, { type: ['tournage', 'fraisage'], plus_grande_dim_mm: { max: 120 } }), ['O002', 'O003', 'O004']);
  assert.deepEqual(resoudreCible(c, { type: 'tournage', diametre_mm: { max: 10 }, longueur_mm: { min: 30 } }), ['O002', 'O003']);
  assert.deepEqual(resoudreCible(c, { plus_petite_dim_mm: { max: 40 } }), ['O001', 'O002', 'O003']);
  assert.deepEqual(resoudreCible(c, { sauf_famille: 'visserie' }), ['O001', 'O004']);
  assert.throws(() => resoudreCible(c, { diametre_mm: { max: 5 } }), /aucune pièce/);
});

test('cible mal formée refusée avec un message précis (type, plage, groupe)', async () => {
  for (const [cible, motif] of [[{ type: 'turbo' }, /inconnu/], [{ diametre_mm: 40 }, /plage/], [{ diametre_mm: { min: 9, max: 3 } }, /supérieur au maxi/], [{ plus_grande_dim_mm: { max: -1 } }, /positif/], [{ groupe: '' }, /groupe/], [{ groupe: 'fantôme' }, /inconnu\. Groupes : aucun/]]) {
    const r = await run(fauxCtx(), { commandes: [{ cmd: 'isoler', cible }] });
    assert.equal(r.ok, false, JSON.stringify(cible));
    assert.match(JSON.stringify(r), motif, JSON.stringify(cible));
  }
});

test('groupes : créer, utiliser dans une cible, ajouter ; retirer et supprimer demandent confirmation', async () => {
  const c = fauxCtx();
  let r = await run(c, { commandes: [{ cmd: 'groupe_creer', nom: 'partie injection', cible: { type: 'tournage' } }, { cmd: 'isoler', cible: { groupe: 'Partie Injection' } }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(c.appels.find(a => a[0] === 'groupeCreer'), ['groupeCreer', 'partie injection', ['O002', 'O003']]);
  assert.deepEqual(c.appels.find(a => a[0] === 'isoler')[1], ['O002', 'O003'], 'nom de groupe insensible à la casse');
  r = await run(c, { cmd: 'groupe_ajouter', nom: 'partie injection', cible: [3] });
  assert.equal(r.ok, true); assert.equal(r.resultats[0].message.startsWith('1 pièce'), true);
  r = await run(c, { cmd: 'groupe_creer', nom: 'partie injection', cible: [1] });
  assert.equal(r.ok, false); assert.match(r.resultats[0].erreur, /existe déjà/);
  // retirer / supprimer : écritures confirmées
  const lot = { commandes: [{ cmd: 'groupe_retirer', nom: 'partie injection', cible: [3] }, { cmd: 'groupe_supprimer', nom: 'partie injection' }] };
  r = await run(c, lot); assert.equal(r.ok, false); assert.ok(!c.appels.some(a => ['groupeRetirer', 'groupeSupprimer'].includes(a[0])), 'refusé sans confirmation');
  let vu; r = await run(c, lot, { confirmer: l => { vu = l; return true; } });
  assert.equal(r.ok, true); assert.match(vu[0], /Retirer 1 pièce \(repères 3\) du groupe « partie injection »/); assert.match(vu[1], /Supprimer le groupe « partie injection »/);
  assert.equal(c.groupes().length, 0);
  r = await run(fauxCtx(), { cmd: 'groupe_ajouter', nom: 'inconnu', cible: [1] }); assert.equal(r.ok, false);
  r = await run(c, { cmd: 'lister_groupes' }); assert.equal(r.ok, true);
});

test('groupe utilisé comme source d\'un groupe mobile', async () => {
  const c = fauxCtx();
  await run(c, { cmd: 'groupe_creer', nom: 'Injection', cible: [3] });
  const r = await run(c, { cmd: 'groupe_mobile', type: 'translation', cible: { groupe: 'injection' }, axe: 'z', course_mm: 100 });
  assert.equal(r.ok, true); assert.deepEqual(c.appels.find(a => a[0] === 'groupeMobile')[1].ids, ['O004']);
});

test('le contexte IA mentionne les types d\'usinage et rappelle qu\'ils sont proposés', () => {
  const t = modeEmploiIA();
  assert.match(t, /"type":"tournage"/); assert.match(t, /groupe_creer/); assert.match(t, /DÉDUITS de la forme du maillage/);
  const c = fauxCtx(); c.nomenclature = () => [{ repere: 1, designation: 'VIS', quantite: 4, famille: 'Visserie', sous_ensemble: '', dims_mm: [10, 10, 40], type_usinage: 'tournage', diametre_mm: 10, longueur_mm: 40, brut_mm: [40, 10, 10], statut: 'à vérifier' }, { repere: 2, designation: 'PLAQUE', quantite: 1, famille: 'Plaques', sous_ensemble: '', dims_mm: [300, 200, 40], type_usinage: 'fraisage', diametre_mm: null, longueur_mm: null, brut_mm: [300, 200, 40], statut: 'à vérifier' }];
  const ctxt = contexteIA(c);
  assert.match(ctxt, /1 \| VIS \| 4 \| Visserie \| — \| 10×10×40 \| tournage \| Ø10×40 \| à vérifier/);
  assert.match(ctxt, /2 \| PLAQUE \| 1 \| Plaques \| — \| 300×200×40 \| fraisage \| 300×200×40 \| à vérifier/);
});
