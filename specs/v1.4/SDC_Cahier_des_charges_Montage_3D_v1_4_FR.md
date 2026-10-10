# Cahier des charges — SDC Assistant Montage 3D

**Version 1.4 — 10 octobre 2026** · remplace la v1.3 (archivée dans `specs/v1.3/`, inchangée ; la v1.2 reste dans `specs/v1.2/`)  
**Périmètre :** consultation, repérage, documentation et compréhension des perçages et circuits d'assemblages de moules caoutchouc/silicone et de BCR, pour l'atelier (usinage et montage).

> Les deux fichiers de cette version (`.md` et `.json`) disent la même chose. Le JSON fait foi pour les identifiants
> d'exigence et leur statut ; un test (`tests/specs.test.js`) vérifie qu'ils restent alignés.

## 1. Objectif
Application HTML **indépendante** (un seul fichier, hors ligne, sans FreeCAD ni installation) permettant aux
professionnels de l'atelier, **non formés en CAO**, d'ouvrir un STEP d'assemblage, de le décortiquer (sélectionner,
masquer, rendre transparent, couper, éclater, ouvrir), de lire repères et dimensions, et de comprendre les perçages,
circuits de refroidissement et réseaux de distribution matière. Le fichier source n'est jamais modifié.

## 2. Livrables
| Livrable | Dossier | Lecture STEP | État |
| --- | --- | --- | --- |
| Application autonome 1.1 | `standalone/` → `dist-standalone/SDC_Montage_3D.html` (4,6 Mo, hors ligne) et `SDC_Montage_3D_leger.html` (0,35 Mo, Internet) | OpenCascade WASM dans le navigateur | livrable atelier |
| Application Windows 0.2 | `frontend/`, `backend/`, `packaging/` | FreeCAD headless local | existant (développé avec Codex) |

## 3. Import et identification
STEP AP203/AP214/AP242, STP, IGES, éventuellement **zippés**. Arbre, occurrences, transformations, noms et couleurs
du STEP conservés. Accents ISO-8859-1 bruts corrigés en mémoire. Maillage mémorisé sur le poste : un STEP de 44 Mo
s'ouvre en ≈ 3 min la première fois, ≈ 10 s ensuite. Encombrement X/Y/Z et volume calculés sur le maillage, signalés
comme tels. Rapprochement d'une nomenclature externe : à faire.

## 4. Nomenclature et repérage
Repères uniques ; regroupement des occurrences par nom + signature géométrique **à valider** ; géométries identiques
sous des noms différents signalées et jamais fusionnées. Référence saisie et validation par repère. Bulles numérotées
à flèche en option. Export CSV et rapport PDF ; XLSX à faire.

## 5. Navigation et sélection (atelier)
Gros boutons, utilisable sur tablette. Vues standard, tout voir, cadrer. Sélection par clic, Ctrl / « Multi » et par
**fenêtre** (gauche → droite : pièces entièrement dedans ; droite → gauche : pièces touchées). Masquer, isoler, tout
afficher, transparence 0–100 %, fantôme, annuler / rétablir, recherche (repère, nom, dimension, Ø). Familles BCR
proposées et corrigeables. **Retirer une face** d'une pièce pour voir logements, formes et perçages. **Cotation** : Ø / R d'un cylindre, distance ou angle entre faces, axes, face + axe, points ; cotes conservées et masquables. Panneaux **réductibles et détachables**, barre d'outils déplaçable.

## 6. Éclaté et ouverture paramétrée
Éclaté tout / sélection, empilage Z, X, Y ou radial, animation, retour exact. **Ouverture paramétrée** par groupes
mobiles : translation (axe, sens, course) ou **rotation sur charnière** (axe pris en touchant une pièce cylindrique ou
une arête droite, angle). Groupes enchaînables, curseur fermé → ouvert, retour exact au STEP. Aucune faisabilité
mécanique n'est garantie.

## 7. Coupes
Plans XZ, YZ, XY simultanés, curseur en mm sur tout le volume, inversion, combinables avec éclaté et ouverture.
Matière coupée **pleine, hachurage léger, contour des pièces coupées en trait épais** ; poches, logements et perçages apparaissent en vide. Coupe visuelle : la section
B-Rep exacte reste à faire.

## 8. Module perçages & circuits
Détection des forages cylindriques, perçages étagés (lamages), forages interrompus, pièces logées (obturateurs, vis).
Réseaux par forages sécants et continuité coaxiale entre pièces (collecteur → busettes → buse) ; types circuit,
passage aligné, perçage isolé, alésage / logement (au-delà du Ø maxi forage, 32 mm réglable). Classement **proposé**
(distribution matière, refroidissement, fixation…) validé par l'opérateur. Squelette, « circuits seuls », forages pleins
Ø3–20 mm, étiquettes Ø en option, fiche CSV des perçages (Ø, longueur, axe, extrémités depuis le coin de la pièce).
Limites : valeurs du maillage (≈ 0,05 mm), taraudages non détectables, pas d'analyse de collision.

## 9. Annotations, scènes, sorties
Commentaires en français typés (observation, montage, contrôle, anomalie), auteur, statut. **Scènes** avec vignette
(caméra, éclaté, ouverture, coupes, masquages, transparences, faces retirées, circuits) ; chaque scène s'enregistre en
**PNG qui contient la scène** et se recharge ; copie presse-papiers. Projet JSON + sauvegarde automatique ;
« Enregistrer sous » ouvert sur Téléchargements. Capture PNG annotée, rapport imprimable / PDF.

## 9 bis. Pilotage par commandes JSON (assistant IA)
Onglet **Commande** et API `window.SDC` : l'assistant écrit un bloc JSON `{"sdc":1,"commandes":[…]}`, l'opérateur le colle et l'exécute.
Liste blanche de commandes (sélection, masquage, isolation, opacité, vues, coupes, éclaté, ouverture et groupes mobiles, circuits,
scènes, exports, lectures de nomenclature et de perçages). Toute la série est **validée avant exécution** ; arrêt à la première erreur ;
« ↩ Avant la commande » restaure l'affichage. Les **écritures** (commentaire, validation de repère ou de circuit, référence, classement
de famille, Ø maxi de forage) demandent l'accord de l'opérateur et sont refusées via l'API sans confirmation. Collision, jeu, tolérance,
serrage et simulation sont refusés. « Copier le contexte pour l'IA » fournit le mode d'emploi, l'état et la nomenclature réelle.
Guide et bibliothèque de demandes : `docs/pilotage-ia.md`. Pilotage direct par MCP : à faire (PIL-05).

## 10. Exclusions explicites
Pas de détection de collisions, calcul de jeux, vérification de tolérances, simulation mécanique ni contrôle
automatique des serrages. L'outil assiste des monteurs professionnels ; il ne remplace pas leurs vérifications.

## 11. Exigences et état (identifiants stables)
| Id | Exigence | Statut | Réception atelier |
| --- | --- | --- | --- |
| IMP-01 | Ouvrir STEP AP203/AP214/AP242, STP, IGES, aussi zippés (le plus gros fichier CAO de l'archive) | fait | partiel : ZIP du moule 10970 ouvert |
| IMP-02 | Conserver toutes les occurrences, transformations, noms, couleurs et l'arbre du STEP | fait | partiel : moule 10970 (228 occurrences) |
| IMP-03 | Fichier source en lecture seule ; empreinte SHA-256 liant annotations et fichier | fait | à faire |
| IMP-04 | Accents ISO-8859-1 bruts (STEP non conformes) corrigés en mémoire en \X\HH | fait | fait : noms du moule 10970 lisibles |
| IMP-05 | Mémoriser le maillage converti sur le poste (IndexedDB, 6 derniers fichiers) pour une réouverture rapide | fait | à faire |
| IMP-06 | Rapprocher une nomenclature externe CSV / XLSX / JSON avec validation des ambiguïtés | à faire | à faire |
| NOM-01 | Repères uniques ; regroupement nom + signature géométrique « à valider » ; géométries identiques sous noms différents signalées, jamais fusionnées | fait | à faire |
| NOM-02 | Bulles numérotées à flèche, anti-chevauchement, déplaçables, cliquables, en option (tous / sélection) | partiel | à faire |
| NOM-03 | Saisir une référence et valider un repère | fait | à faire |
| NOM-04 | Export nomenclature CSV (Excel FR) et dans le rapport PDF | fait | à faire |
| NOM-05 | Export nomenclature XLSX natif | à faire | à faire |
| NAV-01 | Orbite, panoramique, zoom, vues Iso/Dessus/Face/Droite, tout voir, cadrer la sélection | fait | à faire |
| NAV-02 | Sélection : clic, Ctrl / « Multi », fenêtre (gauche→droite : entièrement dedans ; droite→gauche : touchées) ; synchronisation 3D / arborescence / nomenclature / bulles | fait | à faire |
| NAV-03 | Masquer, isoler, tout afficher, par pièce, sous-ensemble, famille ; annuler / rétablir | fait | à faire |
| NAV-04 | Transparence 0–100 % par sélection, mode fantôme autour de la sélection | fait | à faire |
| NAV-05 | Recherche par repère, nom, référence, dimension, sous-ensemble, Ø de perçage | fait | à faire |
| NAV-06 | Cotation (remplace « Mesurer ») : toucher un cylindre → Ø (ou R si arc) ; deux éléments (faces, axes, face + axe, points) → distance si parallèles, angle sinon ; cotes conservées à l'écran, masquables une à une ou toutes, mémorisées dans projet et scènes | fait | à faire |
| NAV-07 | Retirer une ou plusieurs faces B-Rep d'une pièce pour voir logements, formes et perçages ; remettre ; annulable | fait | à faire |
| NAV-08 | Mode BCR : familles de pièces proposées par les noms (plaques, collecteurs, busettes, obturateurs, résistances, visserie, guidage, refroidissement), corrigeables, filtrables | fait | à faire |
| REN-01 | Rendu lisible : éclairage studio embarqué, couleurs CAO, arêtes par défaut, intérieur de matière éclairé | fait | à faire |
| IHM-01 | Panneaux Outils et Pièces réductibles par poignée (bande verticale) et détachables en fenêtres flottantes déplaçables et redimensionnables ; barre d'outils 3D déplaçable par sa poignée et repliable ; disposition mémorisée sur le poste | fait | à faire |
| ECL-01 | Éclaté tout / sélection, empilage Z, X, Y ou radial (écartement ×4), animation, retour exact à 0 | fait | à faire |
| ECL-02 | Vecteurs d'éclaté éditables pièce par pièce | à faire | à faire |
| OUV-01 | Ouverture paramétrée par groupes mobiles en translation (axe, sens, course mm), curseur fermé → ouvert, animation, groupes enchaînés | fait | à faire |
| OUV-02 | Rotation autour d'une charnière : axe pris sur une pièce cylindrique (axe, goupille, alésage) ou une arête droite ; angle en degrés | fait | à faire |
| OUV-03 | Retour exact à fermé (position et orientation du STEP) | fait | à faire |
| COU-01 | Coupes XZ, YZ, XY simultanées, curseur en mm sur toute l'étendue, inversion, combinables avec éclaté et ouverture | fait | à faire |
| COU-02 | Matière coupée pleine, hachurage léger, contour des pièces coupées en trait épais (calcul par pièce et par plan) ; contour du plan en option | fait | fait : coupe du moule 10970 contrôlée en capture |
| COU-03 | Section B-Rep exacte et export des profils (calcul OpenCascade dédié) | à faire | à faire |
| PER-01 | Détecter les perçages (cylindres concaves), perçages étagés, forages interrompus par une poche | fait | à faire |
| PER-02 | Détecter les pièces logées dans un perçage (obturateurs, vis, busettes) | fait | à faire |
| PER-03 | Réseaux : forages sécants et continuité coaxiale entre pièces ; types circuit / passage aligné / perçage isolé / alésage-logement ; Ø maxi forage réglable (32 mm) | fait | à faire |
| PER-04 | Classement des réseaux proposé (distribution matière, refroidissement, fixation) et validé par l'opérateur | fait | à faire |
| PER-05 | Squelette des circuits, « circuits seuls », forages pleins Ø3–20 (réglable), étiquettes Ø en option, filtres type et Ø | fait | à faire |
| PER-06 | Fiche des perçages CSV : Ø, longueur, axe, extrémités en mm depuis le coin mini de la pièce, débouchant, pièce logée | fait | à faire |
| PER-07 | Taraudages, perçages coniques, obliques complexes, pointes de forêt | non détectable | à faire |
| DOC-01 | Commentaires en français liés aux pièces : type (observation, montage, contrôle, anomalie), auteur, date, statut | fait | à faire |
| DOC-02 | Scènes mémorisées avec vignette (caméra, éclaté, ouverture, coupes, masquages, transparences, faces retirées, circuits) ; PNG contenant la scène, rechargeable ; copie presse-papiers | fait | à faire |
| DOC-03 | Projet JSON + sauvegarde automatique par fichier ; réimport sur STEP modifié par nom + signature avec avertissement | fait | à faire |
| DOC-04 | Capture PNG annotée, rapport imprimable / PDF (vue, nomenclature, circuits, commentaires) | fait | à faire |
| DOC-05 | Enregistrement via « Enregistrer sous » ouvert sur Téléchargements (Chrome / Edge) | fait | à faire |
| ARC-01 | Application en un seul fichier HTML hors ligne (4,6 Mo) + variante légère 0,35 Mo (moteur via Internet) | fait | à faire |
| ARC-02 | Application Windows 0.2 (Vite + moteur FreeCAD local) maintenue en parallèle | existant | à faire |
| REC-01 | Réception sur un moule réel | partiel | à faire |
| REC-02 | Réception sur un BCR réel, avec et sans nomenclature | à faire | à faire |
| PIL-01 | Piloter l'application par commandes JSON (onglet Commande + window.SDC) : liste blanche (sélection, visibilité, opacité, vues, coupes, éclaté, ouverture, groupes mobiles, circuits, scènes, exports, lectures), JSON tolérant (bloc ```json, guillemets typographiques), validation complète avant exécution, arrêt à la première erreur | fait | à faire |
| PIL-02 | Écritures par commande (commentaire, validation de repère ou de circuit, référence, classement de famille, Ø maxi de forage) soumises à la confirmation de l'opérateur ; refusées par défaut via l'API programmatique ; commandes de collision, jeu, tolérance, serrage, simulation refusées | fait | à faire |
| PIL-03 | Retour « avant commande » (restaure caméra, visibilité, coupes, éclaté, ouverture, circuits) et annulation ; une série invalide n'exécute rien ; retour exact à 0 de l'éclaté et de l'ouverture par commande | fait | à faire |
| PIL-04 | Mode d'emploi, état et nomenclature réelle copiables pour l'assistant (« Copier le contexte pour l'IA »), résultats copiables, bibliothèque de demandes montage / usinage / circuits (docs/pilotage-ia.md) | fait | à faire |
| PIL-05 | Pilotage direct depuis le chat par serveur MCP local (WebSocket vers la page, mêmes validations et confirmations que window.SDC), avec capture d'écran de la vue | à faire | à faire |
| PIL-06 | Commandes JSON non encore couvertes : retrait de faces B-Rep, cotation, vecteurs d'éclaté par pièce, rapprochement d'une nomenclature externe | à faire | à faire |

## 12. Réception
Essais automatiques : `npm test` (géométrie sur STEP synthétique) et `tests/e2e/standalone_e2e.py` (navigateur).
Réception atelier : moule 10970 en cours ; BCR réel à fournir. Ne jamais versionner de STEP client.

## 13. Critères de succès
Un opérateur retrouve un composant, lit son repère et ses dimensions, l'isole, le voit en éclaté, en ouverture ou en
coupe pleine, identifie un circuit et ses perçages, mémorise une scène et imprime une fiche, sans modifier le STEP.
Toute identification incertaine est signalée « proposé » ou « à vérifier ».
