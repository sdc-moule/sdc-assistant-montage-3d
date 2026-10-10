# Cahier des charges — SDC Assistant Montage 3D

**Version 1.2 — 10 octobre 2026**  
**Périmètre :** consultation, repérage et documentation d'assemblages de moules caoutchouc/silicone et de BCR.

## 1. Objectif
Mettre à disposition des professionnels de l'atelier une application HTML de consultation d'assemblages STEP, indépendante de FreeCAD pour l'utilisation quotidienne. Les fichiers source ne sont jamais modifiés. Les annotations et états d'affichage sont conservés dans un projet distinct.

## 2. Import et identification
Importer les STEP AP203/AP214/AP242, reprendre l'arbre d'assemblage, les occurrences, transformations, noms et couleurs quand disponibles. Si l'arbre est absent, proposer une structure provisoire par solides, à corriger manuellement. Rapprocher les composants d'une nomenclature CSV/XLSX/JSON ; ne pas fusionner automatiquement des références ambiguës. Sans correspondance, calculer l'encombrement X/Y/Z, volume et caractéristiques détectables ; distinguer valeurs calculées et déductions.

## 3. Nomenclature et repérage
Créer des numéros de repère uniques par référence confirmée, quantités par occurrences, désignations et dimensions. Afficher des bulles numérotées et flèches reliées aux pièces, repositionnables et filtrables. Synchroniser clic sur pièce, ligne de nomenclature, arbre et bulle. Export CSV, XLSX et PDF.

## 4. Navigation 3D
Orbite, panoramique, zoom, cadrage, recherche, mesure indicative de distance. Masquer/réafficher une occurrence, une référence, une plaque ou un sous-ensemble ; isoler une sélection, masquer les autres, tout afficher, annuler/rétablir. Opacité de 0 à 100 %, mode fantôme. États mémorisables par vue.

## 5. Éclatés et positions
Éclaté global, par plaque, sous-ensemble de l'arbre ou sélection manuelle ; amplitude réglable et vecteurs éditables. Positions fermée (STEP) et ouverte (déplacement paramétré par l'utilisateur) avec curseur continu et retour exact à l'état initial. Les déplacements ne garantissent aucune faisabilité mécanique.

## 6. Coupes
Plans XZ (déplacement selon Y), YZ (selon X), XY (selon Z), curseurs sur toute l'étendue du modèle, inversion du côté visible, contours, affichage du plan, coupe et éclaté simultanés. Le clipping Three.js est une coupe visuelle ; une section B-Rep exacte nécessite un calcul OpenCascade distinct.

## 7. Mode BCR
Filtres par plaques, busettes, obturateurs, collecteurs, résistances et circuits de refroidissement, seulement si les composants sont identifiés ; classement manuel dans le cas contraire.

## 8. Annotations, vues et sorties
Commentaires et notations exclusivement en français, liés à une pièce ou un sous-ensemble. Enregistrer caméra, zoom, masquages, opacités, éclaté, ouverture, coupes et bulles. Captures PNG annotées et rapport PDF. Recherche par repère, référence, désignation, dimensions et sous-ensemble.

## 9. Architecture
Prétraitement STEP sur PC via FreeCAD/OpenCascade + Python : extraction des occurrences, dimensions et maillages. Export GLB et métadonnées JSON. Consultation HTML/CSS/JavaScript avec Three.js/WebGL2 sur PC ou tablette, éventuellement hors ligne après conversion. Persistance en fichiers de projet JSON ; SQLite facultatif pour plusieurs projets.

## 10. Exclusions explicites
Pas de détection de collisions, calcul de jeux, vérification de tolérances, simulation mécanique ni contrôle automatique des serrages. L'outil assiste des monteurs professionnels ; il ne remplace pas leurs vérifications.

## 11. Développement et réception
1. Lecture STEP, arborescence, occurrences, dimensions, nomenclature.
2. Visualisation, repérage, recherche, masquage, isolation, transparence.
3. Éclatés, ouverture paramétrée et coupes dynamiques XZ/YZ/XY.
4. Annotations, vues enregistrées, sauvegarde et exports.

**Jeux de tests requis :** au moins un assemblage de moule et un de BCR, avec et sans nomenclature associée si possible. Tester la réimportation et la stabilité des repères.

## 12. Préparation de l'environnement
Vérifier d'abord les versions de FreeCAD, OpenCascade/OCCT, Python, Git et Node.js déjà installées. Éviter toute seconde installation de moteur CAO sans diagnostic. Le PC de préparation convertit le STEP ; les appareils de consultation n'ont besoin que d'un navigateur compatible WebGL2.

## 13. Critères de succès
Un opérateur peut retrouver un composant, lire son repère et ses dimensions, l'isoler, visualiser sa position en éclaté ou en coupe, mémoriser une vue et imprimer une fiche sans modifier le STEP original. Toute identification incertaine est signalée.
