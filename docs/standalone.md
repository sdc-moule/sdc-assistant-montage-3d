# Application autonome — SDC Montage 3D 1.0

Un seul fichier `SDC_Montage_3D.html` (~5 Mo). Double-clic → Chrome ou Edge. Pas d'installation, pas de FreeCAD, pas
d'Internet. Le STEP est lu sur le poste par OpenCascade compilé en WebAssembly (même noyau que FreeCAD).

## Fonctions (état réel)
| Domaine | Disponible |
| --- | --- |
| Ouverture | STEP/STP AP203/214/242, IGES ; glisser-déposer ; 3 finesses d'affichage ; empreinte SHA-256 |
| Arborescence / nomenclature | Sous-ensembles du STEP, repères uniques, regroupement nom + signature géométrique **à valider**, jumeaux de noms différents signalés non fusionnés, référence et validation saisies par repère |
| Sélection | Clic 3D, arborescence, nomenclature, bulles ; Ctrl ou bouton « Multi » ; recherche (repère, nom, dimension, Ø de perçage) ; Entrée = sélectionner tous les résultats |
| Visibilité | Masquer, isoler, tout afficher, transparence 0–100 %, fantôme autour de la sélection, familles BCR (plaques, collecteurs, busettes, obturateurs, résistances, visserie, guidage, refroidissement) proposées par les noms et corrigeables, annuler/rétablir |
| Repérage | Bulles numérotées à flèche, anti-chevauchement, déplaçables à la souris, tous / sélection |
| Éclaté | Tout / sélection, empilage Z, X, Y ou radial, animation, retour exact à 0 |
| Ouverture | Groupes mobiles = sélection, axe, sens, course mm, curseur fermé → ouvert |
| Coupes | XZ, YZ, XY simultanées, curseur en mm sur toute l'étendue, inversion, remplissage de la matière coupée, plan visible, compatibles éclaté |
| Perçages & circuits | Voir ci-dessous |
| Mesure | Distance point à point + ΔX/ΔY/ΔZ, indicative |
| Notes et vues | Commentaires typés (observation, montage, contrôle, anomalie), auteur, statut ; vues mémorisées (caméra, visibilité, coupes, éclaté, ouverture, circuits) ; sauvegarde automatique par fichier + projet JSON ; réimport sur un STEP modifié par nom + signature avec avertissement |
| Exports | Nomenclature CSV (Excel FR), fiche des perçages CSV, capture PNG annotée, rapport imprimable / PDF |

## Module perçages & circuits
1. Chaque face B-Rep maillée est testée : normales coplanaires → cylindre ; ajustement de cercle (rayon, axe, étendue) ; concave = perçage, convexe = arbre (vis, obturateur, busette…).
2. Les faces coaxiales d'un même cylindre sont fusionnées ; les segments coaxiaux contigus d'une pièce forment un **perçage étagé** (lamage, chambrage).
3. Liaisons : forages **sécants** (axes à moins de la somme des rayons) et continuité **coaxiale** entre pièces (collecteur → busette → buse).
4. Réseaux : *circuit* (au moins un croisement), *passage aligné* (empilage coaxial), *perçage isolé*.
5. Extrémités : débouchante libre (flèche verte = entrée/sortie possible) ou occupée par une pièce coaxiale de même Ø (disque orange : obturateur, vis…).
6. Classement **proposé** d'après les noms (distribution matière, refroidissement, fixation) ; l'opérateur valide ou corrige.
7. Squelette : axe + volume de fluide translucide par segment, nœuds de croisement ; mode « Circuits seuls » ; filtres type et Ø ; fiche avec Ø, longueur, axe, extrémités en mm depuis le coin mini de la pièce.

Limites : taraudages non détectables (le STEP ne porte pas le filetage) ; perçages coniques, obliques complexes et
pointes de forêt non caractérisés ; débouchage estimé par l'étendue de la pièce selon l'axe ; valeurs issues du maillage.
Un croisement détecté entre un canal et un perçage de vis est un fait géométrique à vérifier, pas une analyse de collision.

## Réception
`tests/standalone-geom.test.js` vérifie les valeurs attendues sur l'assemblage synthétique ; `tests/e2e/standalone_e2e.py`
vérifie l'interface. À faire : réception sur un moule réel et un BCR réel (nombre de perçages, circuits, ouvertures),
avec relevé des écarts.
