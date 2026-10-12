# Cahier des charges — SDC Assistant Montage 3D

**Version 1.18 — 12 octobre 2026** · remplace la v1.17 (archivée dans `specs/v1.17/`, inchangée ; la v1.16 reste dans `specs/v1.16/` ; la v1.15 reste dans `specs/v1.15/` ; la v1.14 reste dans `specs/v1.14/` ; la v1.13 reste dans `specs/v1.13/` ; la v1.12 reste dans `specs/v1.12/` ; la v1.11 reste dans `specs/v1.11/` ; la v1.10 reste dans `specs/v1.10/` ; la v1.9 reste dans `specs/v1.9/` ; la v1.7 reste dans `specs/v1.7/` ; la v1.6 reste dans `specs/v1.6/` ; la v1.5 reste dans `specs/v1.5/` ; la v1.4 reste dans `specs/v1.4/` ; les v1.3 et v1.2 restent dans `specs/v1.3/` et `specs/v1.2/`)  
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

## 9 ter. Filtres par type de pièce et groupes nommés
Onglet **Filtres groupes** : l'opérateur choisit un type d'usinage (**tournage** = pièce de révolution, **fraisage** = prismatique, **mixte**),
des plages de Ø, de longueur, de plus grande ou plus petite dimension, une famille, un nom, « sans visserie ». Le compteur indique le nombre
de pièces trouvées ; on peut les sélectionner, les isoler ou en faire un **groupe nommé** (ex. « partie injection »). Un groupe peut
être sélectionné, isolé, masqué, coloré (« Par groupe ») et servir de **pièces mobiles** pour un déplacement selon un axe ou une rotation.
Les groupes sont enregistrés dans le projet (liés à l'empreinte du fichier). Type, Ø, longueur et brut sont **proposés** d'après le maillage
(≈ 0,05 mm) : à vérifier sur plan ; aucune gamme d'usinage, machine ni temps de cycle. Mêmes critères disponibles en commandes JSON.

## 9 quater. Reste à faire (avancement de fabrication)
Onglet **Reste à faire** : l'atelier coche **« fini »** quand un repère est usiné — depuis la barre de sélection (clic sur la pièce ou
sélection dans la nomenclature), la colonne Fini de la nomenclature, la fiche de la pièce ou l'onglet lui-même. La coche vaut pour
**toutes les occurrences du repère**. Les pièces **achetées** (désignation contenant vis, écrou, rondelle, joint, bague, colonne) sont
mises d'office dans « Achetées » (**proposé**, corrigeable) et ne comptent pas dans le reste à faire. Listes À faire / Faites / Achetées,
totaux et pourcentage, sélection, isolement, coloration par avancement. Mêmes fonctions en commandes JSON (écritures confirmées).
Saisie manuelle de l'atelier : ni validation de fabrication ni contrôle qualité.

## 9 quinquies. Renommer un repère
Double clic (ou double appui) sur un nom dans la **nomenclature**, la fiche de la pièce ou l'onglet Reste à faire : champ de saisie, Entrée valide,
Échap annule, champ vide rétablit le nom du STEP. Le nom d'origine reste visible sous le nouveau nom. Le nom est enregistré dans le projet
(par repère), repris dans le CSV, le rapport, la recherche et le contexte IA ; le STEP n'est jamais modifié.

## 9 sexies. Mode tactile (écran de présentation, table tactile)
Même application, même fichier. Détection d'un écran tactile → interface agrandie ; bouton « Tactile » pour forcer ou quitter, **A− / A+** pour
l'échelle (100 à 250 %, mémorisée sur le poste). **Appui long sur une pièce** : menu à l'endroit touché (fini, isoler, masquer, cadrer, transparent,
groupe, renommer) — sur un écran d'un mètre, aucun bouton à aller chercher au bord. Un doigt tourne, deux doigts zooment et déplacent (inchangé).
Essais réalisés avec des touches simulées : réception sur l'écran réel à faire (TAC-03).

## 9 septies. Interface d'atelier (refonte 1.7)
Public : monteurs et opérateurs non formés à la CAO. Principes : une action évidente à la fois, des mots d'atelier, un retour immédiat.
- **Parcours en 7 étapes** numérotées dans la barre de gauche (Voir, Trouver, Démonter, Couper, Perçages, Suivi, Notes) ; « Avancé » (commandes JSON) en bas.
- **Guide « Que faire maintenant ? »** : après un clic sur une pièce ou une fonction, un message court propose les actions utiles selon l'avancement
  (pièce à usiner → « Marquer fini », cadrer, isoler, mesurer ; pièce finie → « Pièce suivante à faire » ; pièce achetée → masquer ; cotation → consignes).
- **Liste unique des pièces** (ex-arborescence + nomenclature) : œil, case « fini », repère, nom, quantité, encombrement ; classement par sous-ensemble ou par repère. L'onglet « Tableau » garde la nomenclature détaillée.
- **Vert = fini** dans la liste, le tableau, les sous-ensembles (compteur faites / à usiner) et l'onglet Suivi ; achetées en gris.
- **Cotes** : le texte se déplace au glisser, double clic = retour en place.
- **Démonstration** retirée de la barre du haut (elle remplaçait le fichier de travail) : accueil sans fichier et aide, avec confirmation.
- **Réglages** : finesse d'affichage, mode tactile, ouverture d'un projet.

## 9 octies. Fonctions retirées de l'interface (décision du 11 octobre 2026)
Sur validation de Christophe, cinq fonctions ne sont plus proposées aux opérateurs. Le code est conservé et les commandes JSON fonctionnent toujours ; aucune donnée existante n'est perdue.
1. Type, statut et auteur des commentaires (défauts « observation » / « ouvert »).
2. Bouton « Valider le repère » (doublon de la coche « fini »).
3. Choix des bulles « Sélection seulement » (bulles de tous les repères visibles).
4. Filtres Ø mini / Ø maxi des perçages (le Ø maxi d'un forage reste réglable).
5. Bouton « Fantôme autour ».

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
| IMP-07 | Finesse d'affichage (rapide / normal / fin) modifiable à chaud sur le fichier ouvert : le maillage est recalculé (ou relu du cache) sans rouvrir le fichier ; annotations, groupes, coches, noms, caméra, visibilité, coupes, éclaté et ouverture conservés ; le STEP n'est pas modifié | fait | à faire |
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
| IHM-02 | Cinq fonctions retirées de l'interface par décision de Christophe (11/10/2026), sans effacer le code ni les commandes JSON : (1) type, statut et auteur des commentaires ; (2) bouton « Valider le repère » (doublon de « fini ») ; (3) choix des bulles « Sélection seulement » ; (4) filtres Ø mini / Ø maxi des perçages (le Ø maxi d'un forage reste réglable) ; (5) bouton « Fantôme autour » | fait | à faire |
| IHM-03 | Affichage adaptatif à la taille de l'écran : mode « compact » automatique pour une fenêtre étroite (petit côté ≤ 700 px ou largeur < 1100 px) — étapes en icônes, panneaux en recouvrement de la vue 3D (repliés au départ, un seul ouvert à la fois), barre d'outils 3D repliée en bandeau, explications longues masquées ; réglage manuel « Taille d'écran » (automatique / compact / normal) mémorisé ; échelle A− / A+ par densité (80 à 250 %) | fait | à faire |
| DXF-01 | Ouverture d'un plan 2D au format DXF (texte ASCII, bouton « Ouvrir », glisser-déposer ou dossier) : lecture des entités LINE, CIRCLE, ARC, ELLIPSE (y compris arcs et normale −Z), SPLINE (B-spline/NURBS), LWPOLYLINE/POLYLINE (arcs par bulge), TEXT/MTEXT et INSERT (blocs) ; unité lue dans $INSUNITS (mm supposé et signalé si absente) ; entités non gérées listées, jamais cachées. Fichier en lecture seule, aucune interprétation 3D. | fait | à faire |
| DXF-02 | Affichage 2D plein écran : zoom molette ou pincement, déplacement au doigt/souris, « Ajuster », calques affichables/masquables avec compteur, traits cachés (HIDDEN, DASH…) en pointillés, bouton « Fermer » de retour à l'application 3D. | fait | à faire |
| DXF-03 | Cotation sur le plan 2D : distance entre deux points, ΔX / ΔY, diamètre et rayon d'un cercle ou arc de cercle (ellipse de rapport 1 reconnue comme cercle), angle à trois points ; accroche aux extrémités, milieux, centres, quadrants et intersections ; export CSV des cotes. Valeurs affichées comme indicatives (dessin 2D, non contractuelles). Échelle de la vue : liste, échelles lues dans le plan (proposées, à vérifier) ou saisie ; outil « Calibrer » (deux points + vraie longueur). Chaque cote mémorise son échelle et affiche la valeur réelle (papier ÷ échelle) ; CSV avec colonne Échelle. | fait | à faire |
| DXF-04 | Limites déclarées du plan DXF : pas de coupe, pas de détection (perçages, circuits), pas de lecture des cotes DIMENSION du fichier ni des hachures ; une vue isométrique ou en perspective exportée en DXF se mesure en longueurs PROJETÉES (non vraies grandeurs) — à vérifier par l'utilisateur. | fait | à faire |
| DXF-05 | Outil `tools/pdf_vers_dxf.py` : conversion d'un plan PDF vectoriel en DXF 2D (polylignes par calque, textes avec rotation, mm papier). Images et remplissages non repris ; PDF scanné non convertible ; cotes = cotes papier à diviser par l'échelle de la vue. | fait | à faire |
| DXF-06 | Ouverture directe d'un plan PDF VECTORIEL dans l'application (bouton Ouvrir ou glisser-déposer) : traits, courbes et textes lus avec pdf.js embarqué (hors ligne, chargé à l'ouverture d'un PDF), page 1 ; couleurs et pointillés conservés en calques ; cercles et arcs reconnus (Ø/R mesurables) ; unité mm papier avec choix de l'échelle de chaque vue. Images, remplissages pleins et rognages non repris ; un PDF scanné est refusé avec un message clair. | fait | à faire |
| DXF-07 | Survol : l'élément du plan sous la souris change de couleur (magenta, trait épaissi) et sa nature et sa taille réelle (Ø, R, longueur, calque, échelle appliquée) s'affichent. En mode Ø / R seuls les cercles et arcs sont visés. | fait | à faire |
| DXF-08 | Cotes déplaçables et masquables : chaque étiquette de cote se déplace par glisser (trait de rappel pointillé, décalage mémorisé et suivant le zoom) ; bouton « Masquer cotes / Afficher cotes » pour voir le dessin dessous. | fait | à faire |
| DXF-09 | Cotation automatique PROPOSÉE sur plan 2D (DXF/PDF) : référence + zone choisies par l'utilisateur ; cotes ordonnées X/Y (une par valeur) et Ø/R groupés pour centres de perçages, coins des traits forts et intersections ; catégories cochables, plafond 60 par axe, échelle de la vue appliquée ; cotes bleues « proposées » à valider, ignorer ou supprimer (double-clic) ; CSV avec Statut. Hors périmètre : tolérances, validation de fabrication. | fait | à faire |
| MEP-01 | Mise en plan 2D d'une pièce 3D : bouton « 📐 Mise en plan » (barre d'outils et barre de sélection). Pièces projetées = sélection, sinon pièces visibles (confirmation si plusieurs pièces sans sélection ou plus de 400 000 triangles). Trois vues orthogonales à l'ÉCHELLE 1:1 en projection européenne : vue de face, vue de dessus placée dessous (alignée en X), vue de gauche placée à droite (alignée en Z). Contours en trait fort, arêtes cachées en pointillé, cercles et arcs reconnus (Ø/R exacts du maillage), croix de centre des cercles, titres des vues. Affichage dans la visionneuse 2D (zoom, calques, survol). Arêtes issues du maillage d'affichage (≈ ±0,05 mm) : valeurs indicatives. | fait | à faire |
| MEP-02 | Coupe automatique suivant l'axe d'une pièce de révolution (« si c'est un diamètre, une coupe sur le plan ZX passant par l'axe ») : une pièce dont le cercle extérieur d'une vue égale l'encombrement (± 1 %) reçoit une coupe A-A passant par son axe (plan XZ pour un axe Z ou X, YZ pour un axe Y), hachurée à 45°, sans arêtes cachées, axe en trait mixte rouge. Traits de coupe, lettres et flèches de visée tracés sur les vues sources. La coupe est PROPOSÉE ; Retirer coupe l'enlève. | fait | à faire |
| MEP-03 | Coupe choisie par l'opérateur : outil « Coupe », plan XZ (Y fixe) ou YZ (X fixe), puis clic sur un point d'accroche d'une vue (centre de cercle, intersection ou milieu de droite) : vue de dessus ou de gauche pour XZ, de dessus ou de face pour YZ. Le plan passe par ce point ; la coupe (B-B, C-C… 8 au plus) est ajoutée à droite, hachurée (règle pair-impair, évidements non hachurés), avec traits de coupe sur les vues. Doublon et plan hors pièce refusés avec un message ; « Retirer coupe » supprime la dernière. | fait | à faire |
| MEP-04 | Cotation par l'opérateur sur la mise en plan : outils Cote horizontale, verticale, alignée (deux points d'accroche — extrémité, milieu, centre, intersection — ou un trait entier) et Ø / R (clic sur le trait d'un cercle ou d'un arc). Le signe Ø est posé automatiquement pour un cercle, pour deux points opposés d'un même cercle et pour deux points symétriques par rapport à l'axe d'une coupe de révolution. Traits de cote, lignes de rappel (jeu et dépassement) et flèches en TRAIT FIN. L'emplacement de la cote est choisi par un clic de l'opérateur dans une zone HORS pièce (refus si le clic tombe sur une vue ou une coupe) avec aperçu sous le curseur ; étiquette déplaçable, double-clic pour supprimer ; CSV avec valeur indicative et échelle 1:1. Aucune cote n'est posée automatiquement. | fait | à faire |
| MEP-05 | Garde-fous de la mise en plan (limites fixées par Christophe, niveau 2, assouplies le 12 octobre 2026 pour les vues auxiliaires, les coupes décalées et l'export DXF/PDF — CHANGELOG 1.18) : consultation seule — le STEP et son maillage ne sont jamais modifiés ; plan généré = PROPOSÉ, non contractuel (« valeurs INDICATIVES … à vérifier avant toute fabrication » affiché en permanence et reporté dans le cartouche des exports) ; reste hors périmètre : cotation automatique de la mise en plan, vues isométriques ou en perspective, coupes brisées/obliques, tolérances, ajustements, collisions, validation de fabrication. | fait | à faire |
| MEP-06 | Vue auxiliaire : outil « Vue auxiliaire » — l'opérateur clique deux points d'accroche (ou une droite entière) d'une arête inclinée dans la vue de face, de dessus ou de gauche. La pièce est projetée sur le plan perpendiculaire à cette droite et à la vue source (regard perpendiculaire à la droite, dans le plan de la vue) ; la droite devient l'horizontale de la nouvelle vue, ce qui montre en VRAIE GRANDEUR une face ou un perçage inclinés (un cercle perpendiculaire au regard est reconnu comme cercle, Ø exact du maillage). Mêmes règles de tracé que les vues principales (arêtes cachées en pointillé, croix de centre). Le sens du regard est PROPOSÉ (on regarde la pièce depuis l'extérieur de la droite choisie) et s'inverse par un bouton avant création. La vue (A, B, C… lettre libre) est placée à droite des vues et coupes existantes, avec sa flèche de visée et sa lettre dans la vue source ; 6 au plus ; doublon et droite trop courte refusés ; « Retirer vue aux. » supprime la dernière. Cotation possible dans la vue comme dans les vues principales. | fait | à faire |
| MEP-07 | Coupe décalée (coupe à plans parallèles) : outil « Coupe décalée », plan XZ (Y fixe) ou YZ (X fixe). Dans la vue de DESSUS, l'opérateur clique un point d'accroche pour chaque plan (centre de cercle, intersection, milieu de droite : sa coordonnée fixe donne le plan) et la position de chaque décrochement (2 à 5 plans), puis « Terminer » (ou Entrée) ; aperçu orange du tracé pendant la saisie. La pièce est conservée plan par plan sur sa bande ; la coupe est tracée dans une seule vue, hachurée (règle pair-impair, réseau de hachures continu d'un plan à l'autre), sans arêtes cachées et SANS trait au droit des décrochements (usage du dessin technique). Dans la vue de dessus : tracé en palier en trait mixte, repères épais aux extrémités et aux décrochements, flèches de visée et lettres. Les décrochements peuvent être saisis dans un sens ou dans l'autre ; plans consécutifs identiques, décrochements non monotones, doublon et plan hors pièce refusés avec un message. | fait | à faire |
| MEP-08 | Export DXF du plan généré : bouton « Export DXF » de la mise en plan. Fichier DXF R12 (AC1009, le plus largement lu), texte en ANSI 1252, unité mm, ÉCHELLE 1:1. Contient tous les tracés des vues, coupes et vues auxiliaires (CIRCLE, ARC, LINE, POLYLINE, hachures, axes, traits de coupe, flèches pleines en SOLID, textes), les COTES posées par l'opérateur en géométrie (lignes de rappel et de cote en trait fin, flèches, valeur avec Ø/R, position déplacée conservée) et un cartouche sous le dessin portant la mention « valeurs INDICATIVES … à vérifier avant toute fabrication » et la date. Calques à noms ASCII (CONTOURS, ARETES_CACHEES, HACHURES, AXES, PLAN_DE_COUPE, TITRES, COTES, CARTOUCHE), types de trait DASHED/CENTER pour les arêtes cachées et les axes. Le fichier est relisible par le lecteur DXF de l'application et par ezdxf (audit strict sans erreur). | fait | à faire |
| MEP-09 | Export PDF du plan généré : bouton « Export PDF ». PDF 1.4 VECTORIEL à l'échelle 1:1 (1 unité = 1 mm), police Helvetica standard (aucune police embarquée, texte ANSI 1252 dont Ø et °), page ISO A4 à A0 (paysage ou portrait, la plus petite qui contienne le plan avec marges) ou page sur mesure si le plan dépasse l'A0 (annoncé). Contient les mêmes tracés et cotes que l'export DXF, épaisseurs de trait par nature (contours 0,5 mm, repères de coupe épais, traits fins, pointillés et traits mixtes), cadre et cartouche avec la mention d'indicatif et la date. Structure valide (qpdf), relisible par pdf.js. | fait | à faire |
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
| PER-08 | Marqueurs d'intersection (billes aux croisements et aux extrémités des réseaux) masqués par défaut ; réaffichables par l'option « Marqueurs d'intersection » (décision de l'atelier du 11 octobre 2026, la fonction n'est pas supprimée) | fait | à faire |
| PER-09 | Couleur propre à chaque circuit et à chaque passage aligné (16 teintes bien distinctes, puis angle d'or), fixée par le rang du réseau et indépendante de son classement ; perçages isolés et alésages en gris ; le jaune reste réservé au perçage sélectionné ; liseré de la même couleur dans la liste, sur le squelette et sur les étiquettes | fait | à faire |
| TAC-01 | Mode tactile dans le même fichier HTML : activé d'office si un écran tactile est détecté (bouton « Tactile » pour forcer ou quitter) ; boutons, champs, listes, cases et curseurs agrandis ; échelle réglable A− / A+ (100 à 250 %) mémorisée sur le poste ; barre de sélection en bas de la vue | fait | à faire |
| TAC-02 | Appui long (≈ 0,5 s) sur une pièce : menu contextuel à l'endroit touché (fini / remettre à faire, isoler, masquer, cadrer, transparent / opaque, ajouter à un groupe, renommer) ; la pièce touchée est sélectionnée, le relâchement ne désélectionne pas ; Échap ou appui ailleurs ferme le menu ; pas de menu natif au doigt | fait | à faire |
| TAC-03 | Sélection au lasso ou au rectangle au doigt avec gestes à plusieurs doigts ; réception sur l'écran de présentation de 1 m de l'atelier (taille des boutons, distance de lecture, résolution) | à faire | à faire |
| NAV-09 | Cotes : le texte d'une cote se déplace en le faisant glisser (doigt ou souris) pour une meilleure lisibilité, avec un trait fin de rappel vers la cote ; double clic (ou double appui) sur le texte = retour en place ; décalage mémorisé dans le projet et les scènes ; bouton ↺ dans la liste des cotes | fait | à faire |
| ATE-01 | Guide contextuel « Que faire maintenant ? » en haut du panneau Outils : message court et boutons d'action selon la sélection (pièce à usiner, finie, achetée, plusieurs pièces), la présence de pièces masquées, l'avancement (pièce suivante à faire) et la fonction en cours (cotation, face, étape active) ; aucune valeur calculée, conseils seulement | fait | à faire |
| ATE-02 | Liste unique des pièces (arborescence et nomenclature rassemblées) : par ligne œil, case « fini », repère, nom (double clic = renommer), quantité, encombrement, famille (pastille) ; classement au choix par sous-ensemble ou par repère ; l'onglet « Tableau » conserve la nomenclature détaillée (statut, référence, notes) | fait | à faire |
| ATE-03 | Pièce finie = vert : ligne verte (liste des pièces, tableau, onglet Suivi), en-tête de sous-ensemble vert quand toutes ses pièces à usiner sont faites avec compteur « faites / à usiner » ; pièce achetée grisée ; légende fini / à faire / acheté | fait | à faire |
| ATE-04 | Démonstration retirée de la barre du haut (un clic accidentel remplaçait le fichier de travail) : proposée seulement sur l'écran d'accueil sans fichier et dans l'aide, avec confirmation si un fichier est ouvert | fait | à faire |
| ATE-05 | Parcours en 7 étapes numérotées (Voir, Trouver, Démonter, Couper, Perçages, Suivi, Notes) dans des termes d'atelier ; fonction avancée « Avancé » (commandes JSON) séparée en bas ; réglages rares (finesse d'affichage, mode tactile, ouverture d'un projet) regroupés dans le menu « Réglages » ; design sobre à contraste renforcé | fait | à faire |
| ATE-06 | Tri des fonctions discutables avec les monteurs : retirer, masquer ou regrouper les fonctions peu utiles ; vérifier les textes d'aide sur de vrais cas d'atelier | à faire | à faire |
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
| TYP-01 | Type d'usinage PROPOSÉ par pièce, déduit du maillage : tournage (≥ 90 % de surface de révolution), mixte (50–90 %), fraisage (< 50 %) ; Ø et longueur pour les pièces de révolution ; marqué « proposé / à vérifier » (±0,05 mm) | fait | à faire |
| TYP-02 | Brut proposé (3 dimensions triées) et plus grande / plus petite dimension, dans le repère de la pièce (le plus petit du repère monde ou des plans dominants) | fait | à faire |
| TYP-03 | Fenêtre « Filtres & groupes » : type (tournage / mixte / fraisage), plages de Ø, longueur, plus grande et plus petite dimension, famille, nom, sans visserie ; compteur, sélectionner, isoler ; plage incohérente refusée | fait | à faire |
| TYP-04 | Réception du taux de révolution sur pièces réelles (moule 10970) et possibilité de corriger le type à la main | à faire | à faire |
| GRP-01 | Groupes de sélection nommés (ex. « partie injection ») : créer depuis la sélection ou le filtre, renommer, ajouter / retirer des pièces, supprimer ; noms uniques (accents et casse ignorés) ; enregistrés dans le projet lié à l'empreinte du fichier | fait | à faire |
| GRP-02 | Utilisation d'un groupe : sélectionner, isoler, masquer / afficher, colorer (« Par groupe »), source des pièces mobiles pour un déplacement selon un axe ou une rotation ; retour exact à 0 | fait | à faire |
| GRP-03 | Commandes JSON : cibles type / Ø / longueur / dimensions / groupe ; groupe_creer, groupe_ajouter, lister_groupes ; groupe_retirer et groupe_supprimer soumis à confirmation | fait | à faire |
| AVA-01 | Pièces ACHETÉES détectées d'office d'après la désignation (vis, écrou, rondelle, joint, bague, colonne, et équivalents anglais) : marquées « proposé », exclues du reste à faire, corrigeables (« À usiner » / « Acheté », retour à la détection automatique) | fait | à faire |
| AVA-02 | Coche « fini » par repère (toutes les occurrences du repère) saisie par l'opérateur : barre de sélection (clic sur la pièce), colonne Fini de la nomenclature, fiche de la pièce, onglet Reste à faire ; sans effet sur une pièce achetée ; enregistrée dans le projet, restaurée au rechargement | fait | à faire |
| AVA-03 | Onglet « Reste à faire » : totaux (repères et pièces à faire / faits / achetés, % fini hors achetées), listes À faire / Faites / Achetées / Toutes, sélectionner, isoler, colorer par avancement (orange / vert / gris), colonne « avancement » du CSV de nomenclature | fait | à faire |
| AVA-04 | Commandes JSON : cible {avancement}, lister_reste_a_faire ; marquer_fini et marquer_achete soumis à confirmation de l'opérateur | fait | à faire |
| AVA-05 | Coche par occurrence (et non par repère) ; liste des mots « achetés » réglable ; date et auteur de la coche ; réception atelier | à faire | à faire |
| DES-01 | Renommer un repère par double clic (ou double appui) sur son nom dans la nomenclature, la fiche de la pièce ou l'onglet Reste à faire : Entrée valide, Échap annule, champ vide rétablit le nom du STEP ; le nom d'origine reste affiché sous le nouveau nom ; 80 caractères maximum ; enregistré dans le projet, jamais dans le STEP | fait | à faire |
| DES-02 | Le nom saisi est repris dans le CSV de nomenclature (colonne designation_origine ajoutée), le rapport, la recherche et le contexte IA ; la détection des pièces achetées reste fondée sur le nom d'origine du STEP | fait | à faire |
| DES-03 | Commande JSON repere_renommer (écriture confirmée par l'opérateur ; retablir:true rend le nom d'origine) | fait | à faire |
| DES-04 | Renommer aussi les pièces dans l'arborescence (par occurrence) ; réception atelier | à faire | à faire |

## 12. Réception
Essais automatiques : `npm test` (géométrie sur STEP synthétique) et `tests/e2e/standalone_e2e.py` (navigateur).
Réception atelier : moule 10970 en cours ; BCR réel à fournir. Ne jamais versionner de STEP client.

## 13. Critères de succès
Un opérateur retrouve un composant, lit son repère et ses dimensions, l'isole, le voit en éclaté, en ouverture ou en
coupe pleine, identifie un circuit et ses perçages, mémorise une scène et imprime une fiche, sans modifier le STEP.
Toute identification incertaine est signalée « proposé » ou « à vérifier ».
