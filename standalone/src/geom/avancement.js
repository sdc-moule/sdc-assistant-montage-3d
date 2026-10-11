// Avancement de fabrication par repère : « à faire » / « fini » / « acheté ». Module pur, sans DOM ni Three.js.
// Les pièces ACHETÉES (vis, écrous, rondelles, joints, bagues, colonnes) ne sont pas à usiner : elles sont détectées d'office
// d'après la désignation, marquées « proposé », et l'opérateur peut toujours corriger (note.achete = true | false).
// La coche « fini » est saisie par l'opérateur ; rien n'est déduit de la géométrie. Ce n'est pas une validation de fabrication.

export const ETATS = ['a_faire', 'fini', 'achete'];
export const LIBELLES = { a_faire: 'à faire', fini: 'fini', achete: 'acheté' };
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// mots entiers (après suppression des accents) : « VIS_CHC_M10 », « Bague guide », « colonnes » ; pas « visseuse » ni « adjoint »
export const MOTS_ACHAT = ['vis', 'ecrou', 'rondelle', 'joint', 'bague', 'colonne', 'screw', 'nut', 'washer', 'o-ring', 'oring', 'bushing', 'pillar'];
const RE_ACHAT = new RegExp(`(^|[^a-z])(${MOTS_ACHAT.join('|')})s?($|[^a-z])`);

/** La désignation évoque-t-elle une pièce du commerce ? (proposition, jamais une certitude) */
export const achatProbable = designation => RE_ACHAT.test(norm(designation));

/**
 * État d'un repère : { etat, achat: 'proposé' | 'manuel' | null, fini }.
 * `note` = { fini?: true, achete?: true | false } ; achete absent = détection automatique d'après `designation`.
 */
export function etatRepere(note, designation) {
  const n = note ?? {};
  const manuel = typeof n.achete === 'boolean';
  const achete = manuel ? n.achete : achatProbable(designation);
  const fini = n.fini === true;
  return { etat: achete ? 'achete' : fini ? 'fini' : 'a_faire', achat: achete ? (manuel ? 'manuel' : 'proposé') : null, fini };
}

const ALIAS = { a_faire: 'a_faire', afaire: 'a_faire', 'a faire': 'a_faire', reste: 'a_faire', reste_a_faire: 'a_faire', fini: 'fini', finie: 'fini', finis: 'fini', finies: 'fini', fait: 'fini', faite: 'fini', faites: 'fini', faits: 'fini', achete: 'achete', achetee: 'achete', achetes: 'achete', achetees: 'achete', achat: 'achete', achats: 'achete' };
export const normaliserEtat = v => ALIAS[norm(v).trim().replace(/\s+/g, ' ')] ?? null;

/** Message d'erreur si la valeur du critère « avancement » est invalide (texte ou liste de textes), sinon null. */
export function validerAvancement(v) {
  const l = Array.isArray(v) ? v : [v];
  if (!l.length) return '« avancement » : au moins une valeur attendue (a_faire, fini, achete).';
  for (const x of l) if (typeof x !== 'string' || !normaliserEtat(x)) return `« avancement » : « ${x} » inconnu. Admis : a_faire, fini, achete.`;
  return null;
}
export const avancementCorrespond = (etat, v) => (Array.isArray(v) ? v : [v]).map(normaliserEtat).includes(etat);

/** Note mise à jour (nouvel objet) ; une valeur par défaut est supprimée plutôt que stockée. */
export function noteAvec(note, { fini, achete } = {}) {
  const n = { ...(note ?? {}) };
  if (fini !== undefined) { if (fini) n.fini = true; else delete n.fini; }
  if (achete !== undefined) { if (typeof achete === 'boolean') n.achete = achete; else delete n.achete; } // null / undefined = retour à la détection automatique
  return n;
}

/** Totaux par état : lignes = [{ etat, quantite }] → { a_faire, fini, achete } en repères et en pièces. */
export function compter(lignes) {
  const t = { reperes: { a_faire: 0, fini: 0, achete: 0 }, pieces: { a_faire: 0, fini: 0, achete: 0 } };
  for (const l of lignes) { t.reperes[l.etat]++; t.pieces[l.etat] += l.quantite ?? 1; }
  const aUsiner = t.reperes.a_faire + t.reperes.fini, piecesUsiner = t.pieces.a_faire + t.pieces.fini;
  return { ...t, usiner: { reperes: aUsiner, pieces: piecesUsiner }, pct_fini: piecesUsiner ? Math.round(100 * t.pieces.fini / piecesUsiner) : null };
}
