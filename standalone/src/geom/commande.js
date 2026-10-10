// Commandes JSON pour piloter l'application (collées depuis un chat IA, ou appelées par window.SDC).
// Module PUR : ni DOM ni Three.js, testable sous Node. L'application fournit un « ctx » (voir app.js, apiCtx()).
// Principes : liste blanche de commandes, validation complète AVANT toute exécution, aucune évaluation de code,
// écritures (commentaire, validation, classement) soumises à confirmation de l'opérateur, retour « avant commande ».

export const VERSION_COMMANDES = 1;
const MAX_COMMANDES = 200;
const PLANS = { XZ: 'y', YZ: 'x', XY: 'z' };
const VUES = ['iso', 'dessus', 'face', 'droite', 'tout'];
const MODES = ['explorer', 'eclate', 'coupe', 'percages', 'notes', 'commande'];
const TYPES_RESEAU = ['circuit', 'alignement', 'isolé', 'alésage'];
export const CLASSEMENTS = ['non classé', 'refroidissement', 'distribution matière', 'fixation', 'hydraulique / air', 'éjection', 'autre'];
const TYPES_COMMENTAIRE = ['observation', 'montage', 'contrôle', 'anomalie'];
const HORS_PERIMETRE = /collision|interf[eé]rence|\bjeu|jeux|toler|serrage|simul|resistance_mat|contrainte/;

export class ErreurCommande extends Error {}
const erreur = m => new ErreurCommande(m);
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const f1 = x => (Math.round(x * 10) / 10).toLocaleString('fr-FR');
const nb = (n, mot, fem = false) => `${n} ${mot}${n > 1 ? 's' : ''}`;

// ------------------------------------------------------------------ cibles (quelles pièces ?)
const CLES_CIBLE = ['reperes', 'ids', 'nom', 'recherche', 'famille', 'sous_ensemble', 'selection', 'tout', 'visibles', 'masquees'];
export function validerCible(c) {
  if (c === 'selection' || c === 'tout' || Number.isInteger(c)) return;
  if (Array.isArray(c)) { if (!c.length || !c.every(Number.isInteger)) throw erreur('« cible » : liste de numéros de repère attendue, par exemple [3, 4].'); return; }
  if (!c || typeof c !== 'object') throw erreur('« cible » : attendu "selection", "tout", un repère, une liste de repères ou un objet {"reperes":[…]} (clés : ' + CLES_CIBLE.join(', ') + ').');
  const ks = Object.keys(c);
  if (!ks.length) throw erreur('« cible » vide : préciser au moins un critère.');
  for (const k of ks) {
    if (!CLES_CIBLE.includes(k)) throw erreur(`« cible.${k} » inconnu. Clés admises : ${CLES_CIBLE.join(', ')}.`);
    const v = c[k];
    if ((k === 'reperes') && !(Array.isArray(v) && v.length && v.every(Number.isInteger))) throw erreur('« cible.reperes » : liste d\'entiers non vide attendue.');
    if ((k === 'ids') && !(Array.isArray(v) && v.length && v.every(x => typeof x === 'string'))) throw erreur('« cible.ids » : liste d\'identifiants (texte) attendue.');
    if (['nom', 'recherche', 'famille', 'sous_ensemble'].includes(k) && !(typeof v === 'string' && v.trim())) throw erreur(`« cible.${k} » : texte non vide attendu.`);
    if (['selection', 'tout', 'visibles', 'masquees'].includes(k) && typeof v !== 'boolean') throw erreur(`« cible.${k} » : true ou false attendu.`);
  }
}
// Tous les critères donnés doivent être vrais (ET). Un repère ou un nom inexistant est une erreur : jamais de cible approximative.
export function resoudreCible(ctx, c, defaut) {
  if (c === undefined) { if (!defaut) throw erreur('« cible » manquante.'); c = defaut; }
  const pieces = ctx.pieces();
  if (c === 'tout') return pieces.map(p => p.id);
  if (c === 'selection') { const s = pieces.filter(p => p.selectionnee); if (!s.length) throw erreur('aucune pièce n\'est sélectionnée.'); return s.map(p => p.id); }
  if (Number.isInteger(c)) c = { reperes: [c] };
  else if (Array.isArray(c)) c = { reperes: c };
  let liste = pieces;
  if (c.reperes) {
    const connus = new Set(pieces.map(p => p.repere)), absents = c.reperes.filter(r => !connus.has(r));
    if (absents.length) throw erreur(`repère(s) inexistant(s) : ${absents.join(', ')}. Utiliser « nomenclature » ou « chercher » pour retrouver les numéros.`);
    liste = liste.filter(p => c.reperes.includes(p.repere));
  }
  if (c.ids) liste = liste.filter(p => c.ids.includes(p.id));
  if (c.nom) { const t = norm(c.nom); liste = liste.filter(p => norm(p.nom).includes(t)); }
  if (c.recherche) liste = liste.filter(p => ctx.recherche(p.id, c.recherche));
  if (c.famille) { const t = norm(c.famille); liste = liste.filter(p => norm(p.famille) === t || norm(p.famille_label).startsWith(t) || norm(p.famille_label).includes(t)); }
  if (c.sous_ensemble) { const t = norm(c.sous_ensemble); liste = liste.filter(p => norm(p.sous_ensemble).includes(t)); }
  if (c.selection) liste = liste.filter(p => p.selectionnee);
  if (c.visibles) liste = liste.filter(p => p.visible);
  if (c.masquees) liste = liste.filter(p => !p.visible);
  if (!liste.length) throw erreur(`aucune pièce ne correspond à la cible ${JSON.stringify(c)}.`);
  return liste.map(p => p.id);
}

// ------------------------------------------------------------------ types de paramètres
const p = (t, o = {}) => ({ t, ...o });
const CIBLE = o => p('cible', o);
function convertir(nom, spec, v) {
  const dans = (x, lo, hi) => { if (spec.min !== undefined && x < spec.min || spec.max !== undefined && x > spec.max) throw erreur(`« ${nom} » : valeur entre ${spec.min} et ${spec.max} attendue (reçu ${x}).`); return x; };
  switch (spec.t) {
    case 'texte': if (typeof v !== 'string' || !v.trim()) throw erreur(`« ${nom} » : texte non vide attendu.`); return v.trim();
    case 'nombre': if (typeof v !== 'number' || !Number.isFinite(v)) throw erreur(`« ${nom} » : nombre attendu (reçu ${JSON.stringify(v)}).`); return dans(v);
    case 'entier': if (!Number.isInteger(v)) throw erreur(`« ${nom} » : entier attendu (reçu ${JSON.stringify(v)}).`); return dans(v);
    case 'booleen': if (typeof v !== 'boolean') throw erreur(`« ${nom} » : true ou false attendu.`); return v;
    case 'choix': { const hit = spec.valeurs.find(x => norm(x) === norm(v)); if (hit === undefined) throw erreur(`« ${nom} » : valeur « ${v} » inconnue. Admis : ${spec.valeurs.join(', ')}.`); return hit; }
    case 'sens': { const s = { 1: 1, '+': 1, '+1': 1, positif: 1, '-1': -1, '-': -1, '−': -1, negatif: -1 }[typeof v === 'string' ? norm(v) : v]; if (s === undefined) throw erreur(`« ${nom} » : 1 ou -1 attendu (ou "+" / "-").`); return s; }
    case 'cible': validerCible(v); return v;
    case 'vec3': if (!(Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) throw erreur(`« ${nom} » : trois nombres [x, y, z] attendus.`); return v;
    case 'objet': if (!v || typeof v !== 'object' || Array.isArray(v)) throw erreur(`« ${nom} » : objet attendu.`); return v;
    case 'liste_choix': { if (!Array.isArray(v) || !v.length) throw erreur(`« ${nom} » : liste non vide attendue.`); return v.map(x => { const hit = spec.valeurs.find(y => norm(y) === norm(x)); if (hit === undefined) throw erreur(`« ${nom} » : « ${x} » inconnu. Admis : ${spec.valeurs.join(', ')}.`); return hit; }); }
    default: throw new Error('type interne inconnu ' + spec.t);
  }
}
const resoudre = (ctx, c, defaut) => resoudreCible(ctx, c, defaut);
const res = (message, donnees, avertissements) => ({ message, ...(donnees !== undefined ? { donnees } : {}), ...(avertissements?.length ? { avertissements } : {}) });
const LIMITE_LISTE = 400;
const coupeListe = (arr, n = LIMITE_LISTE) => ({ total: arr.length, liste: arr.slice(0, n), tronque: arr.length > n });

// ------------------------------------------------------------------ catalogue des commandes
// lecture : ne modifie rien · confirme : écriture demandant l'accord de l'opérateur · besoinFichier : faux pour « aide »
export const COMMANDES = {
  // ---- lecture
  aide: { lecture: true, besoinFichier: false, doc: 'Liste des commandes et de leurs paramètres.', params: {}, run: () => res('Commandes disponibles.', Object.entries(COMMANDES).map(([nom, d]) => ({ cmd: nom, doc: d.doc, ecriture: !!d.confirme, parametres: Object.fromEntries(Object.entries(d.params).map(([k, s]) => [k, decrireParam(s)])) }))) },
  etat: { lecture: true, doc: 'État courant : fichier, mode, sélection, coupes, éclaté, ouverture, circuits, scènes.', params: {}, run: ctx => res('État courant.', ctx.etat()) },
  lister_pieces: { lecture: true, doc: 'Occurrences (id, repère, nom, famille, visibilité, opacité, dimensions d\'encombrement). Cible facultative (défaut : tout).', params: { cible: CIBLE() },
    run(ctx, q) { const ids = new Set(resoudre(ctx, q.cible, 'tout')); const l = ctx.pieces().filter(x => ids.has(x.id)); return res(`${nb(l.length, 'pièce')}.`, coupeListe(l)); } },
  nomenclature: { lecture: true, doc: 'Nomenclature repérée (repère, désignation, quantité, famille, sous-ensemble, X×Y×Z mm, statut).', params: {}, run: ctx => { const l = ctx.nomenclature(); return res(`${nb(l.length, 'repère')}. Dimensions : boîte d'encombrement du maillage, indicatives.`, coupeListe(l)); } },
  chercher: { lecture: true, doc: 'Cherche des pièces comme la barre de recherche (repère, nom, référence, dimension, Ø de perçage). Ne change pas la sélection.', params: { texte: p('texte', { req: true }) },
    run(ctx, q) { const l = ctx.pieces().filter(x => ctx.recherche(x.id, q.texte)); return res(`${nb(l.length, 'pièce')} pour « ${q.texte} ».`, coupeListe(l)); } },
  lister_reseaux: { lecture: true, doc: 'Réseaux de perçages / circuits détectés (type, classement proposé ou validé, Ø, longueur).', params: { type: p('choix', { valeurs: TYPES_RESEAU }) },
    run(ctx, q) { const l = ctx.reseaux().filter(n => !q.type || n.type === q.type); return res(`${nb(l.length, 'réseau')}. Classements « proposés » tant que l'opérateur ne les a pas validés.`, coupeListe(l)); } },
  fiche_percages: { lecture: true, doc: 'Fiche des perçages : Ø, longueur, axe, extrémités en mm depuis le coin mini de la pièce (valeurs du maillage). Filtrer par reseau ou par cible.', params: { reseau: p('texte'), cible: CIBLE() },
    run(ctx, q) { const ids = q.cible === undefined ? null : new Set(resoudre(ctx, q.cible)); const l = ctx.percages(q.reseau ?? null, ids); return res(`${nb(l.length, 'perçage')}. Valeurs indicatives (maillage) ; taraudages non détectables.`, coupeListe(l)); } },
  lister_scenes: { lecture: true, doc: 'Scènes mémorisées.', params: {}, run: ctx => { const l = ctx.scenes(); return res(`${nb(l.length, 'scène')}.`, l); } },
  lister_cotes: { lecture: true, doc: 'Cotes posées à l\'écran.', params: {}, run: ctx => { const l = ctx.cotes(); return res(`${nb(l.length, 'cote')}.`, l); } },

  // ---- sélection, visibilité, vues
  selectionner: { doc: 'Sélectionne des pièces (remplace la sélection, sauf ajouter:true).', params: { cible: CIBLE({ req: true }), ajouter: p('booleen'), cadrer: p('booleen') },
    run(ctx, q) { const ids = resoudre(ctx, q.cible); ctx.selectionner(ids, !!q.ajouter); if (q.cadrer) ctx.cadrer(ids); return res(`${nb(ids.length, 'pièce')} sélectionnée(s).`, { reperes: ctx.reperesDe(ids) }); } },
  deselectionner: { doc: 'Vide la sélection.', params: {}, run: ctx => { ctx.deselectionner(); return res('Sélection vidée.'); } },
  masquer: { doc: 'Masque des pièces (défaut : la sélection). Annulable.', params: { cible: CIBLE() },
    run(ctx, q) { const ids = resoudre(ctx, q.cible, 'selection'); ctx.masquer(ids); return res(`${nb(ids.length, 'pièce')} masquée(s).`); } },
  afficher: { doc: 'Réaffiche des pièces masquées.', params: { cible: CIBLE({ req: true }) },
    run(ctx, q) { const ids = resoudre(ctx, q.cible); ctx.afficher(ids); return res(`${nb(ids.length, 'pièce')} affichée(s).`); } },
  isoler: { doc: 'N\'affiche que les pièces ciblées (défaut : la sélection) et cadre dessus.', params: { cible: CIBLE(), cadrer: p('booleen', { def: true }) },
    run(ctx, q) { const ids = resoudre(ctx, q.cible, 'selection'); ctx.isoler(ids, q.cadrer !== false); return res(`${nb(ids.length, 'pièce')} isolée(s).`, { reperes: ctx.reperesDe(ids) }); } },
  tout_afficher: { doc: 'Réaffiche tout, opacité 100 %, familles visibles.', params: {}, run: ctx => { ctx.toutAfficher(); return res('Tout est affiché.'); } },
  opacite: { doc: 'Opacité des pièces : 100 = opaque, 0 = invisible (défaut : la sélection).', params: { cible: CIBLE(), opacite_pct: p('nombre', { req: true, min: 0, max: 100 }) },
    run(ctx, q) { const ids = resoudre(ctx, q.cible, 'selection'); ctx.opacite(ids, q.opacite_pct); return res(`Opacité ${q.opacite_pct} % sur ${nb(ids.length, 'pièce')}.`); } },
  fantome: { doc: 'Mode fantôme : pièces non sélectionnées presque transparentes.', params: { actif: p('booleen', { req: true }) }, run: (ctx, q) => { ctx.fantome(q.actif); return res(`Fantôme ${q.actif ? 'activé' : 'désactivé'}.`); } },
  cadrer: { doc: 'Cadre la caméra sur des pièces (défaut : la sélection, sinon tout).', params: { cible: CIBLE() },
    run(ctx, q) { const ids = q.cible === undefined && !ctx.pieces().some(x => x.selectionnee) ? null : resoudre(ctx, q.cible, 'selection'); ctx.cadrer(ids); return res('Vue cadrée.'); } },
  vue: { doc: 'Vue standard.', params: { nom: p('choix', { req: true, valeurs: VUES }) }, run: (ctx, q) => { ctx.vue(q.nom); return res(`Vue « ${q.nom} ».`); } },
  famille: { doc: 'Affiche ou masque une famille de pièces (plaques, collecteurs, busettes…).', params: { nom: p('texte', { req: true }), afficher: p('booleen', { req: true }) },
    run(ctx, q) { const id = ctx.familleId(q.nom); if (!id) throw erreur(`famille « ${q.nom} » inconnue. Familles : ${ctx.familles().map(x => x.label).join(', ')}.`); ctx.famille(id, q.afficher); return res(`Famille « ${id} » ${q.afficher ? 'affichée' : 'masquée'}.`); } },
  classer_famille: { confirme: true, doc: 'ÉCRITURE : classe des pièces dans une famille (remplace la proposition faite d\'après les noms).', params: { cible: CIBLE({ req: true }), famille: p('texte', { req: true }) },
    run(ctx, q) { const ids = resoudre(ctx, q.cible), id = ctx.familleId(q.famille); if (!id) throw erreur(`famille « ${q.famille} » inconnue. Familles : ${ctx.familles().map(x => x.label).join(', ')}.`); ctx.classerFamille(ids, id); return res(`${nb(ids.length, 'pièce')} classée(s) « ${id} ».`); } },
  bulles: { doc: 'Bulles de repères.', params: { actif: p('booleen', { req: true }), portee: p('choix', { valeurs: ['tous', 'selection'] }) },
    run(ctx, q) { ctx.bulles(q.actif, q.portee ?? null); return res(`Bulles ${q.actif ? 'affichées' : 'masquées'}.`); } },
  couleurs: { doc: 'Mode de couleur.', params: { mode: p('choix', { req: true, valeurs: ['step', 'repere', 'famille'] }) }, run: (ctx, q) => { ctx.couleurs(q.mode === 'famille' ? 'categorie' : q.mode); return res(`Couleurs : ${q.mode}.`); } },
  mode: { doc: 'Change d\'onglet de l\'application.', params: { nom: p('choix', { req: true, valeurs: MODES }) }, run: (ctx, q) => { ctx.mode(q.nom); return res(`Onglet « ${q.nom} ».`); } },

  // ---- coupes
  coupe: { doc: 'Plan de coupe visuel (pas une section B-Rep exacte). XZ = normale Y, YZ = normale X, XY = normale Z. Position en mm (repère assemblage) ou position_pct de l\'encombrement.', params: { plan: p('choix', { req: true, valeurs: Object.keys(PLANS) }), position_mm: p('nombre'), position_pct: p('nombre', { min: 0, max: 100 }), actif: p('booleen', { def: true }), inverser: p('booleen') },
    run(ctx, q) {
      const k = PLANS[q.plan], b = ctx.bornes()[k];
      if (q.position_mm !== undefined && q.position_pct !== undefined) throw erreur('donner position_mm OU position_pct, pas les deux.');
      const pos = q.position_pct !== undefined ? b[0] + (b[1] - b[0]) * q.position_pct / 100 : q.position_mm;
      if (pos !== undefined && (pos < b[0] - 1 || pos > b[1] + 1)) throw erreur(`position ${f1(pos)} mm hors de l'encombrement : plan ${q.plan} entre ${f1(b[0])} et ${f1(b[1])} mm (selon ${k.toUpperCase()}).`);
      const s = ctx.coupe(k, { on: q.actif !== false, pos, flip: q.inverser });
      return res(`Coupe ${q.plan} ${s.on ? 'active' : 'désactivée'} à ${f1(s.pos)} mm${s.flip ? ' (côté inversé)' : ''}.`, { plan: q.plan, actif: s.on, position_mm: +s.pos.toFixed(2), inverse: s.flip, plage_mm: [+b[0].toFixed(1), +b[1].toFixed(1)] });
    } },
  coupes_retirer: { doc: 'Désactive les coupes (un plan, ou toutes).', params: { plan: p('choix', { valeurs: Object.keys(PLANS) }) },
    run(ctx, q) { ctx.coupesRetirer(q.plan ? [PLANS[q.plan]] : ['x', 'y', 'z']); return res(q.plan ? `Coupe ${q.plan} retirée.` : 'Toutes les coupes retirées.'); } },
  coupe_options: { doc: 'Options de coupe : remplissage de la matière, contour du plan.', params: { remplir: p('booleen'), contour_plan: p('booleen') },
    run(ctx, q) { ctx.coupeOptions({ remplir: q.remplir, contour: q.contour_plan }); return res('Options de coupe appliquées.'); } },

  // ---- éclaté, ouverture
  eclater: { doc: 'Éclaté : pct 0 = position du STEP (retour exact), 100 = écartement maxi. direction z|x|y|radial ; portee tout|selection (avec cible).', params: { pct: p('nombre', { req: true, min: 0, max: 100 }), direction: p('choix', { valeurs: ['z', 'x', 'y', 'radial'] }), portee: p('choix', { valeurs: ['tout', 'selection'] }), cible: CIBLE() },
    run(ctx, q) {
      const portee = q.portee ?? (q.cible !== undefined ? 'selection' : null);
      const ids = portee === 'selection' ? resoudre(ctx, q.cible, 'selection') : null;
      ctx.eclater({ pct: q.pct, dir: q.direction, scope: portee === 'tout' ? 'all' : portee, ids });
      return res(`Éclaté ${q.pct} %${q.pct === 0 ? ' (position d\'origine)' : ''}.`);
    } },
  ouverture: { doc: 'Position ouverte : pct 0 = fermé (position du STEP), 100 = ouvert (course / angle des groupes mobiles).', params: { pct: p('nombre', { req: true, min: 0, max: 100 }) },
    run(ctx, q) { const n = ctx.nbGroupes(); ctx.ouverture(q.pct); return res(`Ouverture ${q.pct} %.`, undefined, n ? [] : ['Aucun groupe mobile défini : créer d\'abord « groupe_mobile ».']); } },
  groupe_mobile: { doc: 'Crée un groupe mobile. translation : axe x|y|z, sens, course_mm. rotation : angle_deg, sens, et l\'axe par axe_cylindre {repere, diametre_mm} (axe d\'un perçage / goupille) ou axe_libre {origine:[x,y,z], direction:[x,y,z]} en mm. Le mouvement n\'est PAS validé mécaniquement.', params: { type: p('choix', { req: true, valeurs: ['translation', 'rotation'] }), cible: CIBLE({ req: true }), axe: p('choix', { valeurs: ['x', 'y', 'z'] }), sens: p('sens', { def: 1 }), course_mm: p('nombre', { min: 0 }), angle_deg: p('nombre', { min: 0, max: 360 }), axe_cylindre: p('objet'), axe_libre: p('objet') },
    run(ctx, q) {
      const ids = resoudre(ctx, q.cible), sens = q.sens ?? 1, av = [];
      if (q.type === 'translation') {
        if (!q.axe || q.course_mm === undefined) throw erreur('translation : « axe » et « course_mm » requis.');
        ctx.groupeMobile({ type: 'translation', ids, axis: q.axe, sign: sens, course: q.course_mm });
        return res(`Groupe mobile : ${nb(ids.length, 'pièce')} en translation ${sens > 0 ? '+' : '−'}${q.axe.toUpperCase()} de ${q.course_mm} mm. Régler « ouverture ».`, undefined, ['Mouvement paramétré, non validé mécaniquement.']);
      }
      if (q.angle_deg === undefined) throw erreur('rotation : « angle_deg » requis.');
      let origin, dir, label;
      if (q.axe_cylindre && q.axe_libre) throw erreur('rotation : axe_cylindre OU axe_libre, pas les deux.');
      if (q.axe_cylindre) {
        const { repere, diametre_mm } = q.axe_cylindre;
        if (!Number.isInteger(repere)) throw erreur('axe_cylindre.repere : entier attendu.');
        const idsRep = resoudre(ctx, [repere]);
        const tous = idsRep.flatMap(id => ctx.cylindres(id).map(c => ({ ...c, id })));
        const ok = diametre_mm === undefined ? tous : tous.filter(c => Math.abs(c.diametre - diametre_mm) < 0.11);
        if (!ok.length) throw erreur(`aucun cylindre${diametre_mm !== undefined ? ' de Ø' + diametre_mm : ''} sur le repère ${repere}. Ø disponibles : ${[...new Set(tous.map(c => +c.diametre.toFixed(1)))].sort((a, b) => a - b).join(', ') || 'aucun'}.`);
        if (ok.length > 1) av.push(`${ok.length} cylindres correspondent sur le repère ${repere} : le premier est utilisé, à vérifier à l'écran (trait pointillé violet en mode Démonter).`);
        origin = ok[0].origine; dir = ok[0].direction; label = `axe du cylindre Ø${f1(ok[0].diametre)} (repère ${repere})`;
      } else if (q.axe_libre) {
        const { origine, direction } = q.axe_libre;
        if (!(Array.isArray(origine) && origine.length === 3 && origine.every(Number.isFinite)) || !(Array.isArray(direction) && direction.length === 3 && direction.every(Number.isFinite))) throw erreur('axe_libre : {origine:[x,y,z], direction:[x,y,z]} en nombres.');
        const L = Math.hypot(...direction); if (L < 1e-9) throw erreur('axe_libre.direction : vecteur nul.');
        origin = origine; dir = direction.map(x => x / L); label = 'axe libre saisi';
      } else throw erreur('rotation : fournir axe_cylindre {repere, diametre_mm} ou axe_libre {origine, direction}.');
      ctx.groupeMobile({ type: 'rotation', ids, origin, dir, axisLabel: label, angle: q.angle_deg, sign: sens });
      return res(`Groupe mobile : ${nb(ids.length, 'pièce')} pivotent de ${q.angle_deg}° autour de l'${label}. Régler « ouverture ».`, undefined, [...av, 'Mouvement paramétré, non validé mécaniquement ; vérifier l\'axe à l\'écran.']);
    } },
  groupes_mobiles_supprimer: { doc: 'Supprime tous les groupes mobiles (retour fermé).', params: {}, run: ctx => { ctx.groupesSupprimer(); return res('Groupes mobiles supprimés.'); } },

  // ---- perçages et circuits
  circuits: { doc: 'Affichage des circuits : afficher, seuls (circuits isolés des pièces), reseau (focus sur un réseau, ex. "R3", ou "aucun"), percage (ex. "P12"), etiquettes, pleins {actif, d_min, d_max}, types [circuit, alignement, isolé, alésage], d_min, d_max, cadrer.', params: { afficher: p('booleen'), seuls: p('booleen'), reseau: p('texte'), percage: p('texte'), etiquettes: p('booleen'), pleins: p('objet'), types: p('liste_choix', { valeurs: TYPES_RESEAU }), d_min: p('nombre', { min: 0 }), d_max: p('nombre', { min: 0 }), cadrer: p('booleen') },
    run(ctx, q) {
      if (q.pleins) for (const [k, v] of Object.entries(q.pleins)) { if (!['actif', 'd_min', 'd_max'].includes(k)) throw erreur(`pleins.${k} inconnu (actif, d_min, d_max).`); if (k === 'actif' ? typeof v !== 'boolean' : !Number.isFinite(v)) throw erreur(`pleins.${k} : valeur invalide.`); }
      const r = ctx.circuits(q); return res(r.message, r.donnees, r.avertissements);
    } },
  classer_circuit: { confirme: true, doc: 'ÉCRITURE : valide le classement d\'un réseau (classement parmi ' + CLASSEMENTS.join(' / ') + ') ou "proposé" pour revenir à la proposition.', params: { reseau: p('texte', { req: true }), classement: p('texte', { req: true }) },
    run(ctx, q) { const c = q.classement === 'proposé' || norm(q.classement) === 'propose' ? null : CLASSEMENTS.find(x => norm(x) === norm(q.classement)); if (c === undefined) throw erreur(`classement « ${q.classement} » inconnu. Admis : ${CLASSEMENTS.join(', ')}, ou "proposé".`); ctx.classerCircuit(q.reseau, c); return res(c ? `Réseau ${q.reseau} validé « ${c} ».` : `Réseau ${q.reseau} remis à « proposé ».`); } },
  diametre_maxi_forage: { confirme: true, doc: 'ÉCRITURE : Ø maxi d\'un forage (défaut 32). Recalcule les réseaux ; les classements validés repassent à « proposé ».', params: { mm: p('nombre', { req: true, min: 1, max: 500 }) },
    run(ctx, q) { ctx.diametreMaxi(q.mm); return res(`Ø maxi de forage : ${q.mm} mm ; réseaux recalculés, classements remis à « proposé ».`); } },

  // ---- annotations (écritures soumises à confirmation)
  commentaire_ajouter: { confirme: true, doc: 'ÉCRITURE : commentaire en français sur des pièces (défaut : la sélection).', params: { cible: CIBLE(), texte: p('texte', { req: true }), type: p('choix', { valeurs: TYPES_COMMENTAIRE, def: 'observation' }), statut: p('choix', { valeurs: ['ouvert', 'traité'] }), auteur: p('texte') },
    run(ctx, q) { const ids = resoudre(ctx, q.cible, 'selection'); ctx.commentaire({ ids, texte: q.texte, type: q.type ?? 'observation', statut: q.statut ?? 'ouvert', auteur: q.auteur }); return res(`Commentaire ajouté sur ${nb(ids.length, 'pièce')}.`); } },
  repere_valider: { confirme: true, doc: 'ÉCRITURE : valide (ou dévalide) un repère de nomenclature.', params: { repere: p('entier', { req: true, min: 1 }), valide: p('booleen', { def: true }) },
    run(ctx, q) { resoudre(ctx, [q.repere]); ctx.repereValider(q.repere, q.valide !== false); return res(`Repère ${q.repere} ${q.valide !== false ? 'validé' : 'dévalidé'}.`); } },
  repere_reference: { confirme: true, doc: 'ÉCRITURE : saisit la référence d\'un repère.', params: { repere: p('entier', { req: true, min: 1 }), reference: p('texte', { req: true }) },
    run(ctx, q) { resoudre(ctx, [q.repere]); ctx.repereReference(q.repere, q.reference); return res(`Référence du repère ${q.repere} : ${q.reference}.`); } },
  scene_sauver: { doc: 'Mémorise la vue actuelle comme scène.', params: { nom: p('texte') }, run: (ctx, q) => res(`Scène « ${ctx.sceneSauver(q.nom)} » mémorisée.`) },
  scene_charger: { doc: 'Restaure une scène mémorisée (par son nom).', params: { nom: p('texte', { req: true }) }, run: (ctx, q) => { if (!ctx.sceneCharger(q.nom)) throw erreur(`scène « ${q.nom} » introuvable. Scènes : ${ctx.scenes().map(s => s.nom).join(', ') || 'aucune'}.`); return res(`Scène « ${q.nom} » restaurée.`); } },
  exporter: { doc: 'Lance un export (ouvre « Enregistrer sous » ou télécharge) : nomenclature, percages, capture, rapport.', params: { quoi: p('choix', { req: true, valeurs: ['nomenclature', 'percages', 'capture', 'rapport'] }) }, run: (ctx, q) => { ctx.exporter(q.quoi); return res(`Export « ${q.quoi} » lancé.`); } },

  // ---- historique
  annuler: { sansSauvegarde: true, doc: 'Annule le dernier masquage / transparence / famille / face retirée.', params: {}, run: ctx => (ctx.annuler() ? res('Annulé.') : res('Rien à annuler.')) },
  retablir: { sansSauvegarde: true, doc: 'Rétablit l\'action annulée.', params: {}, run: ctx => (ctx.retablir() ? res('Rétabli.') : res('Rien à rétablir.')) },
  retour_avant_commande: { sansSauvegarde: true, doc: 'Restaure l\'affichage tel qu\'il était avant la dernière série de commandes (caméra, visibilité, coupes, éclaté, ouverture, circuits).', params: {}, run: ctx => { if (!ctx.retourAvant()) throw erreur('aucun état « avant commande » mémorisé.'); return res('Affichage restauré à l\'état d\'avant la dernière série de commandes.'); } },
};
const ALIAS = { selection: 'selectionner', select: 'selectionner', hide: 'masquer', isolate: 'isoler', show: 'afficher', transparence: 'opacite', coupes: 'coupe', eclate: 'eclater', ouvrir: 'ouverture', retour: 'retour_avant_commande', perçages: 'fiche_percages', percages: 'fiche_percages', circuit: 'circuits', reseaux: 'lister_reseaux', undo: 'annuler', redo: 'retablir' };

function decrireParam(s) {
  const base = { texte: 'texte', nombre: 'nombre', entier: 'entier', booleen: 'true|false', sens: '1|-1', cible: 'cible (voir format)', vec3: '[x,y,z]', objet: 'objet' }[s.t];
  return `${s.t === 'choix' ? s.valeurs.join('|') : s.t === 'liste_choix' ? '[' + s.valeurs.join('|') + ',…]' : base}${s.min !== undefined || s.max !== undefined ? ` (${s.min ?? ''}…${s.max ?? ''})` : ''}${s.req ? ' · requis' : ''}${s.def !== undefined ? ` · défaut ${s.def}` : ''}`;
}

// ------------------------------------------------------------------ analyse et validation
export function extraireJson(texte) {
  let t = String(texte).trim().replace(/^```(?:json|JSON)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const essayer = s => { try { return { v: JSON.parse(s) }; } catch (e) { return { e }; } };
  let r = essayer(t);
  if (r.e) { const lisse = t.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'"); r = essayer(lisse); if (!r.e) return r.v; }
  if (r.e) { const a = t.search(/[[{]/), z = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']')); if (a >= 0 && z > a) { const r2 = essayer(t.slice(a, z + 1).replace(/[“”]/g, '"')); if (!r2.e) return r2.v; } }
  if (r.e) throw erreur('JSON illisible : ' + r.e.message + '. Coller uniquement le bloc JSON fourni par l\'assistant.');
  return r.v;
}
function analyser(entree) {
  const v = typeof entree === 'string' ? extraireJson(entree) : entree, av = [];
  let cmds;
  if (Array.isArray(v)) cmds = v;
  else if (v && typeof v === 'object' && Array.isArray(v.commandes)) { cmds = v.commandes; if (v.sdc !== undefined && v.sdc !== VERSION_COMMANDES) av.push(`format sdc ${v.sdc} différent du format géré (${VERSION_COMMANDES}) : vérifier les résultats.`); }
  else if (v && typeof v === 'object' && (v.cmd || v.commande)) cmds = [v];
  else throw erreur('Format non reconnu : attendu {"sdc":1,"commandes":[{"cmd":"isoler","cible":{"reperes":[3]}}]}.');
  if (!cmds.length) throw erreur('Aucune commande dans la liste.');
  if (cmds.length > MAX_COMMANDES) throw erreur(`Trop de commandes (${cmds.length} > ${MAX_COMMANDES}).`);
  return { commandes: cmds, avertissements: av };
}
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
export function preparer(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw erreur('commande : objet {"cmd":"…", …} attendu.');
  const brut = norm(c.cmd ?? c.commande ?? '').replace(/[\s-]+/g, '_');
  if (!brut) throw erreur('« cmd » manquant.');
  if (HORS_PERIMETRE.test(brut)) throw erreur(`« ${brut} » : hors périmètre. L'application ne calcule ni collision, ni jeu, ni tolérance, ni serrage, et ne simule rien.`);
  const nom = COMMANDES[brut] ? brut : ALIAS[brut];
  const def = COMMANDES[nom];
  if (!def) { const best = Object.keys(COMMANDES).map(k => [lev(brut, k), k]).sort((x, y) => x[0] - y[0])[0]; throw erreur(`commande inconnue « ${brut} »${best[0] <= 3 ? ` — vouliez-vous dire « ${best[1]} » ?` : ' — voir la commande « aide »'}.`); }
  const { cmd, commande, ...reste } = c;
  const params = {};
  for (const k of Object.keys(reste)) if (!def.params[k]) throw erreur(`« ${nom} » : paramètre « ${k} » inconnu (admis : ${Object.keys(def.params).join(', ') || 'aucun'}).`);
  for (const [k, spec] of Object.entries(def.params)) {
    if (reste[k] === undefined || reste[k] === null) { if (spec.req) throw erreur(`« ${nom} » : paramètre « ${k} » requis.`); continue; }
    params[k] = convertir(k, spec, reste[k]);
  }
  return { nom, def, params };
}

// Phrase lue par l'opérateur avant d'accepter une écriture.
function descrire(ctx, { nom, params: q }) {
  const piece = id => ctx.pieces().find(x => x.id === id);
  const cible = () => { try { const ids = resoudreCible(ctx, q.cible, 'selection'); return nb(ids.length, 'pièce') + ' (repères ' + [...new Set(ids.map(i => piece(i).repere))].sort((a, b) => a - b).join(', ') + ')'; } catch (e) { return 'cible invalide : ' + e.message; } };
  switch (nom) {
    case 'commentaire_ajouter': return `Ajouter un commentaire « ${q.type ?? 'observation'} » sur ${cible()} : « ${q.texte} »`;
    case 'repere_valider': return `${q.valide !== false ? 'Valider' : 'Dévalider'} le repère ${q.repere}`;
    case 'repere_reference': return `Enregistrer la référence « ${q.reference} » pour le repère ${q.repere}`;
    case 'classer_circuit': return `Valider le réseau ${q.reseau} comme « ${q.classement} »`;
    case 'classer_famille': return `Classer ${cible()} dans la famille « ${q.famille} »`;
    case 'diametre_maxi_forage': return `Fixer le Ø maxi de forage à ${q.mm} mm (les classements validés repassent à « proposé »)`;
    default: return nom;
  }
}

// ------------------------------------------------------------------ exécution
// entree : texte JSON ou objet. opts.confirmer(liste_de_phrases) → Promise<boolean> ; sans lui, toute écriture est refusée.
export async function executer(ctx, entree, opts = {}) {
  let analyse;
  try { analyse = analyser(entree); } catch (e) { return { ok: false, executees: 0, total: 0, erreur: e.message, resultats: [] }; }
  const prep = [], erreurs = [];
  analyse.commandes.forEach((c, i) => { try { prep.push(preparer(c)); } catch (e) { if (!(e instanceof ErreurCommande)) throw e; erreurs.push({ index: i + 1, cmd: c?.cmd ?? c?.commande, erreur: e.message }); } });
  const base = { total: analyse.commandes.length, avertissements: analyse.avertissements };
  if (erreurs.length) return { ok: false, executees: 0, ...base, erreur: `${nb(erreurs.length, 'commande')} invalide(s) : rien n'a été exécuté.`, erreurs, resultats: [] };
  if (!ctx.charge() && prep.some(x => x.def.besoinFichier !== false)) return { ok: false, executees: 0, ...base, erreur: 'Aucun assemblage ouvert : ouvrir d\'abord un STEP.', resultats: [] };
  const sensibles = prep.filter(x => x.def.confirme);
  let accord = true;
  if (sensibles.length) accord = opts.confirmer ? !!(await opts.confirmer(sensibles.map(x => descrire(ctx, x)))) : false;
  if (prep.some(x => !x.def.lecture && !x.def.sansSauvegarde)) ctx.sauverAvant();
  const resultats = [];
  for (const [i, x] of prep.entries()) {
    const index = i + 1;
    if (x.def.confirme && !accord) { resultats.push({ index, cmd: x.nom, ok: false, ignoree: true, erreur: opts.confirmer ? 'écriture non confirmée par l\'opérateur : ignorée.' : 'écriture refusée : confirmation de l\'opérateur requise.' }); continue; }
    try { resultats.push({ index, cmd: x.nom, ok: true, ...(await x.def.run(ctx, x.params)) }); }
    catch (e) { if (!(e instanceof ErreurCommande)) console.error(e); resultats.push({ index, cmd: x.nom, ok: false, erreur: e instanceof ErreurCommande ? e.message : `erreur interne : ${e.message}` }); if (opts.arret !== false) break; }
  }
  const ok = resultats.length === prep.length && resultats.every(r => r.ok);
  return { ok, executees: resultats.filter(r => r.ok).length, ...base, resultats };
}

// ------------------------------------------------------------------ mode d'emploi pour l'IA (copié depuis l'application)
export function modeEmploiIA() {
  const lignes = Object.entries(COMMANDES).map(([nom, d]) => `- ${nom}${d.confirme ? ' [ÉCRITURE : confirmation opérateur]' : d.lecture ? ' [lecture]' : ''} — ${d.doc}${Object.keys(d.params).length ? '\n    paramètres : ' + Object.entries(d.params).map(([k, s]) => `${k} (${decrireParam(s)})`).join(' ; ') : ''}`);
  return `# Pilotage de SDC Montage 3D par commandes JSON (format sdc ${VERSION_COMMANDES})
Tu assistes un opérateur d'atelier (monteur, ajusteur) qui consulte un assemblage de moule ou de BCR. Réponds en français.
Pour agir sur l'application, produis UN SEUL bloc JSON que l'opérateur colle dans l'onglet « Commande » :
{"sdc":1,"commandes":[{"cmd":"isoler","cible":{"reperes":[3,4]}},{"cmd":"coupe","plan":"XZ","position_mm":120}]}
Les commandes s'exécutent dans l'ordre ; l'exécution s'arrête à la première erreur. Tout est validé avant exécution.

## Cible (quelles pièces)
"selection" | "tout" | 3 | [3,4] | {"reperes":[3,4], "nom":"vis", "famille":"busettes", "sous_ensemble":"…", "recherche":"Ø8", "visibles":true}. Les critères se cumulent (ET). Un repère inexistant est une erreur.

## Règles impératives
- N'invente jamais un repère, une dimension, un Ø : lis d'abord (« nomenclature », « chercher », « lister_reseaux », « fiche_percages ») ou demande à l'opérateur de coller le résultat.
- Les valeurs viennent du maillage d'affichage (≈ 0,05 mm) : indicatives, jamais des cotes de fabrication validées.
- Classements de circuits et familles : « proposés ». Ne les présente jamais comme certains ; les valider = commande d'ÉCRITURE soumise à l'accord de l'opérateur.
- Ne déduis ni ordre de montage, ni faisabilité mécanique, ni collision, jeu, tolérance, serrage : hors périmètre. Une ouverture ou un éclaté n'est qu'un déplacement paramétré.
- Les coupes sont visuelles (pas des sections B-Rep exactes). Éclaté 0 % et ouverture 0 % = position exacte du STEP.
- Plans de coupe : XZ (normale Y), YZ (normale X), XY (normale Z), position en mm dans le repère assemblage.

## Commandes
${lignes.join('\n')}
`;
}
export function contexteIA(ctx) {
  const noms = ctx.charge() ? ctx.nomenclature() : [];
  const tab = noms.slice(0, LIMITE_LISTE).map(r => `${r.repere} | ${r.designation} | ${r.quantite} | ${r.famille} | ${r.sous_ensemble || '—'} | ${r.dims_mm.map(x => f1(x)).join('×')} | ${r.statut}`);
  return `${modeEmploiIA()}
## Assemblage ouvert
${ctx.charge() ? JSON.stringify(ctx.etat()) : 'Aucun assemblage ouvert.'}

## Nomenclature (repère | désignation | qté | famille proposée | sous-ensemble | X×Y×Z mm indicatif | statut)${noms.length > LIMITE_LISTE ? `\n(${noms.length} repères, ${LIMITE_LISTE} premiers)` : ''}
${tab.join('\n') || '—'}
`;
}
