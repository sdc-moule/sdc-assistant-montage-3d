// Nom de repère saisi par l'atelier (double clic dans la nomenclature). Module pur. Le STEP n'est jamais modifié :
// le nom est enregistré dans le projet (rowNotes[repere].nom) ; le nom d'origine reste visible et restituable.

export const MAX_NOM_REPERE = 80;
export class ErreurNom extends Error {}

/** Nom nettoyé (espaces simplifiés) ; chaîne vide = retour au nom d'origine (renvoie null). */
export function nomRepere(saisie, { origine } = {}) {
  const n = String(saisie ?? '').replace(/\s+/g, ' ').trim();
  if (!n || n === origine) return null;
  if (n.length > MAX_NOM_REPERE) throw new ErreurNom(`nom trop long (${MAX_NOM_REPERE} caractères maximum).`);
  return n;
}
/** Nom à afficher : le nom saisi s'il existe, sinon la désignation d'origine du STEP. */
export const nomAffiche = (note, origine) => (note?.nom ? note.nom : origine);
