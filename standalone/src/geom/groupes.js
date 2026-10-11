// Groupes de sélection nommés (ex. « partie injection ») : module pur, sans DOM. Un groupe garde des identifiants
// d'occurrences ; il est enregistré dans le projet (lié à l'empreinte du fichier), jamais dans le STEP.

export class ErreurGroupe extends Error {}
export const MAX_NOM = 60;
export const COULEURS_GROUPES = ['#d7301f', '#1f77d0', '#2e8b57', '#e8730c', '#7b3fbf', '#00a3c4', '#c2185b', '#8d6e63', '#b38600', '#16a085'];

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function nomPropre(nom) {
  const n = String(nom ?? '').replace(/\s+/g, ' ').trim();
  if (!n) throw new ErreurGroupe('donner un nom au groupe.');
  if (n.length > MAX_NOM) throw new ErreurGroupe(`nom trop long (${MAX_NOM} caractères maximum).`);
  return n;
}

/** Retrouve un groupe par identifiant (« G2 ») ou par nom (sans tenir compte des accents ni de la casse). */
export function trouverGroupe(groupes, ref) {
  if (ref === null || ref === undefined || ref === '') return null;
  const t = norm(ref);
  return groupes.find(g => g.id === ref) ?? groupes.find(g => norm(g.nom) === t) ?? null;
}

export function creerGroupe(groupes, nom, ids, { origine } = {}) {
  const n = nomPropre(nom);
  if (trouverGroupe(groupes, n)) throw new ErreurGroupe(`le groupe « ${n} » existe déjà : lui ajouter des pièces, le renommer ou le supprimer.`);
  const u = [...new Set(ids)];
  if (!u.length) throw new ErreurGroupe('aucune pièce à mettre dans le groupe.');
  const num = Math.max(0, ...groupes.map(g => parseInt(String(g.id).slice(1), 10) || 0)) + 1;
  const g = { id: `G${num}`, nom: n, ids: u, couleur: COULEURS_GROUPES[(num - 1) % COULEURS_GROUPES.length], date: new Date().toISOString(), ...(origine ? { origine } : {}) };
  groupes.push(g);
  return g;
}
/** Ajoute des pièces ; renvoie le nombre de pièces réellement ajoutées (les doublons sont ignorés). */
export function ajouterAuGroupe(g, ids) { const s = new Set(g.ids); let n = 0; for (const id of ids) if (!s.has(id)) { s.add(id); n++; } g.ids = [...s]; return n; }
/** Retire des pièces ; renvoie le nombre de pièces réellement retirées. */
export function retirerDuGroupe(g, ids) { const r = new Set(ids), avant = g.ids.length; g.ids = g.ids.filter(id => !r.has(id)); return avant - g.ids.length; }
export function renommerGroupe(groupes, g, nom) {
  const n = nomPropre(nom), autre = trouverGroupe(groupes, n);
  if (autre && autre !== g) throw new ErreurGroupe(`le groupe « ${n} » existe déjà.`);
  g.nom = n;
}
export function supprimerGroupe(groupes, g) { const i = groupes.indexOf(g); if (i < 0) return false; groupes.splice(i, 1); return true; }
export const groupesDe = (groupes, id) => groupes.filter(g => g.ids.includes(id));

/**
 * Reprend les groupes d'un projet enregistré : identifiants convertis par `mapId` (undefined = pièce sans correspondance),
 * pièces absentes du fichier ouvert écartées, groupes devenus vides abandonnés. Renvoie { groupes, perdues }.
 */
export function reprendreGroupes(liste, mapId, existants) {
  const groupes = []; let perdues = 0;
  for (const g of Array.isArray(liste) ? liste : []) {
    if (!g || typeof g.nom !== 'string' || !Array.isArray(g.ids)) continue;
    const ids = [...new Set(g.ids.map(mapId).filter(id => id !== undefined && id !== null && existants.has(id)))];
    perdues += g.ids.length - ids.length;
    if (!ids.length) continue;
    let nom = String(g.nom).replace(/\s+/g, ' ').trim().slice(0, MAX_NOM);
    if (!nom || groupes.some(x => norm(x.nom) === norm(nom))) nom = `${nom || 'Groupe'} (${groupes.length + 1})`;
    groupes.push({ id: /^G\d+$/.test(g.id) && !groupes.some(x => x.id === g.id) ? g.id : `G${groupes.length + 1}`, nom, ids, couleur: /^#[0-9a-f]{6}$/i.test(g.couleur) ? g.couleur : COULEURS_GROUPES[groupes.length % COULEURS_GROUPES.length], date: g.date ?? new Date().toISOString(), ...(g.origine ? { origine: String(g.origine) } : {}) });
  }
  return { groupes, perdues };
}
