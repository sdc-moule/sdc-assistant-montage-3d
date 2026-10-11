// Guide contextuel : messages d'aide « Que faire maintenant ? » selon la sélection, l'avancement et l'onglet.
// Module pur (sans DOM ni Three.js) : testable sous Node. Aucune valeur n'est calculée ici, seulement des conseils.
// Chaque action porte un id que l'interface relie à une fonction existante (cadrer, isoler, masquer…).

const A = (id, label, opts = {}) => ({ id, label, ...opts });

const MODES = {
  explorer: { titre: 'Voir l\'assemblage', texte: 'Touchez une pièce pour la sélectionner. Touchez le vide pour désélectionner. Plusieurs pièces : bouton « Multi » ou tracer une fenêtre.', actions: [A('tout_afficher', 'Tout afficher')] },
  groupes: { titre: 'Trouver des pièces', texte: 'Choisissez un type d\'usinage ou une dimension : les pièces correspondantes sont comptées. Puis « Sélectionner » ou « Isoler ». Un groupe garde la liste sous un nom.', actions: [] },
  eclate: { titre: 'Démonter', texte: 'Faites glisser « Écartement » pour éloigner les pièces ; remettre à zéro = position exacte du fichier. « Ouverture paramétrée » simule une ouverture de moule.', actions: [A('eclate_zero', 'Remettre fermé')] },
  coupe: { titre: 'Couper', texte: 'Faites glisser un plan de coupe pour voir l\'intérieur. La coupe est visuelle ; elle ne modifie rien.', actions: [A('coupes_retirer', 'Retirer les coupes')] },
  percages: { titre: 'Perçages et circuits', texte: 'Touchez un circuit dans la liste pour le mettre en évidence. « Circuits seuls » isole le réseau de fluide. Classements proposés : à confirmer.', actions: [A('circuits_seuls', 'Circuits seuls')] },
  notes: { titre: 'Notes et vues', texte: 'Sélectionnez une pièce puis écrivez un commentaire. « Mémoriser » garde la vue (caméra, coupes, masquages) pour la retrouver.', actions: [] },
  commande: { titre: 'Assistant IA', texte: 'Fonction avancée : colle ici un bloc de commandes fourni par l\'assistant. Inutile pour l\'usage courant en atelier.', actions: [] },
};

export function guide(c = {}) {
  if (!c.charge) return { cle: 'vide', titre: 'Pour commencer', texte: 'Ouvrez le fichier STEP de l\'assemblage (bouton « Ouvrir un STEP » ou glisser-déposer).', actions: [] };
  if (c.cotation) return { cle: 'cotation', titre: 'Cotation en cours', texte: 'Touchez un cylindre pour son Ø, ou deux éléments (faces, axes, points) pour une distance. Pour déplacer le texte d\'une cote : le faire glisser. Double clic sur le texte : le remettre en place.', actions: [A('cotation_stop', 'Terminer la cotation')] };
  if (c.faces) return { cle: 'faces', titre: 'Retirer une face', texte: 'Touchez une face pour la retirer et voir l\'intérieur. « Remettre les faces » annule.', actions: [A('faces_stop', 'Terminer')] };
  if (c.nbSel === 1 && c.row) {
    const r = c.row, nom = r.nom ?? `repère ${r.repere}`, rest = c.restants ?? 0;
    if (r.etat === 'achete') return { cle: 'achete', titre: `${nom} — pièce achetée`, texte: `Rien à usiner${r.achat === 'proposé' ? ' (proposé d\'après le nom : à vérifier)' : ''}. Vous pouvez la masquer pour voir derrière, ou l\'isoler pour la repérer.`, actions: [A('masquer', 'Masquer'), A('isoler', 'Isoler'), A('cadrer', 'Cadrer'), A('a_usiner', 'Elle est à usiner')] };
    if (r.etat === 'fini') return { cle: 'fini', titre: `${nom} — fini ✔`, texte: rest ? `Pièce faite. Il reste ${rest} pièce${rest > 1 ? 's' : ''} à usiner.` : 'Pièce faite. Toutes les pièces à usiner sont terminées.', actions: [rest ? A('suivante', 'Pièce suivante à faire', { primaire: true }) : null, A('isoler', 'Isoler'), A('remettre_afaire', 'Remettre à faire')].filter(Boolean) };
    const typ = r.typologie ? ` Usinage proposé : ${r.typologie}.` : '';
    return { cle: 'afaire', titre: `${nom} — à usiner`, texte: `Repérez la pièce, vérifiez ses cotes${r.percages ? ' et ses perçages' : ''}.${typ} Quand elle est usinée, cochez « Fini » : elle passe en vert.`, actions: [A('fini', '✔ Marquer fini', { primaire: true }), A('cadrer', 'Cadrer'), A('isoler', 'Isoler'), A('masquer', 'Masquer'), A('coter', 'Mesurer'), r.percages ? A('percages_piece', 'Voir les perçages') : null].filter(Boolean) };
  }
  if (c.nbSel > 1) return { cle: 'multi', titre: `${c.nbSel} pièces sélectionnées`, texte: 'Vous pouvez les isoler, les masquer, les mettre en groupe ou les marquer finies d\'un coup.', actions: [A('isoler', 'Isoler', { primaire: true }), A('masquer', 'Masquer'), A('groupe', 'Créer un groupe'), A('fini', '✔ Marquer finies'), A('cadrer', 'Cadrer')] };
  if (c.mode === 'reste') {
    const rest = c.restants ?? 0;
    return { cle: 'reste', titre: 'Suivi de fabrication', texte: rest ? `${rest} pièce${rest > 1 ? 's' : ''} à usiner. Cochez « Fini » au fur et à mesure : les pièces faites passent en vert.` : 'Toutes les pièces à usiner sont faites.', actions: rest ? [A('suivante', 'Prochaine pièce à faire', { primaire: true })] : [] };
  }
  if (c.nbMasquees > 0 && (!c.mode || c.mode === 'explorer')) return { cle: 'masquees', titre: 'Des pièces sont masquées', texte: `${c.nbMasquees} pièce${c.nbMasquees > 1 ? 's' : ''} masquée${c.nbMasquees > 1 ? 's' : ''} ou isolée${c.nbMasquees > 1 ? 's' : ''}. « Tout afficher » rétablit la vue complète.`, actions: [A('tout_afficher', 'Tout afficher', { primaire: true })] };
  const m = MODES[c.mode] ?? MODES.explorer;
  return { cle: 'mode_' + (MODES[c.mode] ? c.mode : 'explorer'), ...m };
}

export const ACTIONS_GUIDE = ['tout_afficher', 'eclate_zero', 'coupes_retirer', 'circuits_seuls', 'cotation_stop', 'faces_stop', 'masquer', 'isoler', 'cadrer', 'a_usiner', 'suivante', 'remettre_afaire', 'fini', 'coter', 'percages_piece', 'groupe'];
