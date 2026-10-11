# Application autonome — SDC Montage 3D 1.2

Deux variantes, même application :
- `SDC_Montage_3D.html` (~4,6 Mo) : complète, **hors ligne**. Le moteur OpenCascade (3,9 Mo compressé) est embarqué.
- `SDC_Montage_3D_leger.html` (~0,35 Mo) : moteur téléchargé depuis jsDelivr à la première ouverture d'un STEP ; **Internet requis**.

Double-clic → Chrome ou Edge. Pas d'installation, pas de FreeCAD. Le STEP est lu sur le poste par OpenCascade compilé en WebAssembly (même noyau que FreeCAD).

## Fonctions (état réel)
| Domaine | Disponible |
| --- | --- |
| Ouverture | STEP/STP AP203/214/242, IGES, aussi en archive ZIP (le plus gros fichier CAO de l'archive est ouvert) ; accents ISO-8859-1 bruts corrigés en mémoire ; maillage mémorisé sur le poste (IndexedDB, 6 derniers fichiers) : moule 44 Mo = ~3 min la 1ʳᵉ fois, ~10 s ensuite ; glisser-déposer ; 3 finesses d'affichage ; empreinte SHA-256 |
| Arborescence / nomenclature | Sous-ensembles du STEP, repères uniques, regroupement nom + signature géométrique **à valider**, jumeaux de noms différents signalés non fusionnés, référence et validation saisies par repère |
| Sélection | Clic 3D, arborescence, nomenclature, bulles ; Ctrl ou bouton « Multi » ; **fenêtre** (« ▭ Fenêtre » ou Maj + glisser : gauche → droite = pièces entièrement dedans, droite → gauche = pièces touchées) ; recherche (repère, nom, dimension, Ø de perçage) ; Entrée = sélectionner tous les résultats |
| Visibilité | Masquer, isoler, tout afficher, transparence 0–100 %, fantôme autour de la sélection, familles BCR (plaques, collecteurs, busettes, obturateurs, résistances, visserie, guidage, refroidissement) proposées par les noms et corrigeables, annuler/rétablir |
| Repérage | Bulles numérotées à flèche, anti-chevauchement, déplaçables à la souris, tous / sélection |
| Éclaté | Tout / sélection, empilage Z, X, Y ou radial (écartement ×4), animation, retour exact à 0 |
| Ouverture paramétrée | Groupes mobiles = sélection ; **translation** (axe X/Y/Z, sens, course mm) ou **rotation / charnière** (axe pris en touchant un cylindre — axe, goupille, alésage — ou une arête droite, angle °) ; groupes enchaînés (plaque qui coulisse puis volet qui pivote) ; curseur fermé → ouvert, animation ; retour exact à fermé ; mémorisé dans projet et scènes |
| Faces | « ✂ Face » : retirer une face B-Rep d'une pièce pour voir logements, formes et perçages ; « ↺ Faces » : remettre (sélection ou tout) ; annulable |
| Coupes | XZ, YZ, XY simultanées, curseur en mm sur toute l'étendue, inversion, matière coupée **pleine, hachurage léger, contours des pièces coupées en trait épais** (remplissage par stencil, exact quelle que soit la forme intérieure), contour du plan en option (pas de plaque translucide), compatibles éclaté |
| Perçages & circuits | Voir ci-dessous |
| Cotation | « 📏 Cotation » : cylindre → Ø (R si arc) ; 2 faces, 2 axes, face + axe, points → distance (angle si non parallèles) ; cotes persistantes, « 👁 Cotes » pour tout masquer, liste dans Notes & vues ; indicatif |
| Interface | Panneaux réductibles (‹ ›) et détachables (⧉) en fenêtres déplaçables / redimensionnables ; barre d'outils 3D déplaçable (poignée ⠿, double-clic = remise en place) et repliable ; disposition mémorisée |
| Notes et scènes | Commentaires typés (observation, montage, contrôle, anomalie), auteur, statut ; « 📷 Scène » mémorise caméra, éclaté, coupes, masquages, transparences, faces retirées, circuits (vignette) ; PNG d'une scène = image + scène intégrée, rechargeable par « Charger projet / scène » ; « ⧉ Copier » vers le presse-papiers ; sauvegarde automatique par fichier + projet JSON ; réimport sur un STEP modifié par nom + signature avec avertissement |
| Exports | Nomenclature CSV (Excel FR), fiche des perçages CSV, capture PNG annotée (avec scène), rapport imprimable / PDF ; boîte « Enregistrer sous » ouverte sur Téléchargements (Chrome/Edge) |
| Filtres & groupes | Onglet **Filtres groupes** : type d'usinage **proposé** (tournage / mixte / fraisage d'après le taux de surface de révolution du maillage), Ø, longueur, plus grande / plus petite dimension, famille, nom, sans visserie ; sélectionner, isoler. **Groupes nommés** (« partie injection ») enregistrés dans le projet : sélectionner, isoler, masquer, colorer, ou servir de pièces mobiles (translation / rotation, retour exact à 0). Valeurs à vérifier sur plan (≈ 0,05 mm) ; pas de gamme ni de choix de machine. Réception sur pièces réelles : à faire (TYP-04) |
| Pilotage IA | Onglet **Commande** : coller un bloc JSON fourni par l'assistant, **Exécuter** ; API `window.SDC` ; validation de toute la série avant exécution, écritures confirmées par l'opérateur, « ↩ Avant la commande », contexte copiable pour l'IA (mode d'emploi + nomenclature). Guide et demandes types : [`pilotage-ia.md`](pilotage-ia.md) |
| Rendu | Éclairage studio embarqué, couleurs STEP en sRGB (fidèles à la CAO), arêtes par défaut |

## Module perçages & circuits
1. Chaque face B-Rep maillée est testée : normales coplanaires → cylindre ; ajustement de cercle (rayon, axe, étendue) ; concave = perçage, convexe = arbre (vis, obturateur, busette…).
2. Les faces coaxiales d'un même cylindre sont fusionnées ; les segments coaxiaux contigus d'une pièce forment un **perçage étagé** (lamage, chambrage).
3. Liaisons : forages **sécants** (axes à moins de la somme des rayons) et continuité **coaxiale** entre pièces (collecteur → busette → buse).
4. Réseaux : *circuit* (au moins un croisement), *passage aligné* (empilage coaxial), *perçage isolé*.
5. Éléments logés : pièce coaxiale de même Ø dans le perçage (obturateur, vis…), colonne « Logé » et fiche CSV. Les extrémités ne sont pas dessinées.
6. Classement **proposé** d'après les noms (distribution matière, refroidissement, fixation) ; l'opérateur valide ou corrige.
7. Alésages / logements : au-delà du « Ø maxi d'un forage » (32 mm par défaut, réglable) ou si court et large (L < 0,6 D, D > 12), le cylindre est un logement (insert, busette, empreinte) : listé à part, jamais relié aux circuits.
8. Un forage de même Ø interrompu par une poche ou un autre perçage reste **un seul forage** (longueur d'usinage totale, marqué « interrompu »).
10. Forages pleins : Ø 3 à 20 mm (réglable) dessinés opaques ; étiquettes « P… Ø » en option (sinon seule celle du perçage sélectionné).
11. Squelette : axe + volume de fluide translucide par segment, nœuds de croisement ; mode « Circuits seuls » ; filtres type et Ø ; fiche avec Ø, longueur, axe, extrémités en mm depuis le coin mini de la pièce.

Limites : taraudages non détectables (le STEP ne porte pas le filetage) ; perçages coniques, obliques complexes et
pointes de forêt non caractérisés ; débouchage estimé par l'étendue de la pièce selon l'axe ; valeurs issues du maillage.
Un croisement détecté entre un canal et un perçage de vis est un fait géométrique à vérifier, pas une analyse de collision.

## Réception
`tests/standalone-geom.test.js` vérifie les valeurs attendues sur l'assemblage synthétique ; `tests/e2e/standalone_e2e.py`
vérifie l'interface. À faire : réception sur un moule réel et un BCR réel (nombre de perçages, circuits, ouvertures),
avec relevé des écarts.
