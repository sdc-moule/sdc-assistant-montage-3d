# Feuille de route liée aux spécifications 1.2

1. **Phase 1 — réception de l’import :** chargement STEP direct, noms/groupes/placements et instances répétées disponibles en 0.2.0. Réceptionner les fichiers industriels et liens complexes ; ajouter les couleurs STEP natives, repères pièce et rapprochement d’une nomenclature externe avec validation des ambiguïtés.
2. **Phase 2 — repérage atelier :** arbre hiérarchique, multisélection, actions par groupes et références, bulles numérotées à flèche, cadrage de sélection, historique et mesure indicative.
3. **Phase 3 — états :** éclatés par plaque/groupe, vecteurs éditables, ouverture paramétrée avec groupes mobiles explicites, contours et représentation des plans de coupe, filtres BCR classés manuellement si identification absente.
4. **Phase 4 — documentation :** vues nommées multiples, annotations auteur/date/type, export XLSX, capture PNG annotée, rapport PDF dédié, réimport avec correspondances proposées à confirmer.

Chaque phase exige une réception sur un moule et un BCR, avec et sans nomenclature. Aucune fonction annoncée dans la cible n’est considérée terminée par la seule présence d’un bouton ou d’un dossier.

## Application autonome 1.0 (`standalone/`)
Couvre en HTML unique les phases 1 à 4 côté consultation (voir [standalone.md](standalone.md)) et ajoute le module
perçages & circuits. Restent à faire : import d'une nomenclature externe CSV/XLSX, export XLSX natif, vecteurs d'éclaté
édités pièce par pièce, sections B-Rep exactes (backend OpenCascade/FreeCAD), réception sur moule et BCR réels.
Pistes : diagramme 2D schématique des circuits (entrées/sorties numérotées pour le branchement des raccords),
volume d'eau par circuit, export DXF des axes de perçage par face pour la FAO, lecture des couleurs de faces STEP.
