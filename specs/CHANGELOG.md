# Historique du cahier des charges

## 1.19 — 13 octobre 2026 (Claude Code, **décision écrite de Christophe** : annotations sur captures, plans et images)
Texte de Christophe : « peut-on prévoir de faire des annotations sur les copies écrans, mise en plan ou autres, comme annotation, flèche, écriture, droite, cercle, carré, épaisseurs du trait, et palette de couleur avec une correction du tracé et de l'écriture (reconnaissance de chiffre et lettre pour les réécrire en police standard, tracé à la souris = polyligne avec poignée aux extrémités pour les redimensionner) […] créer, comme pour la mise en plan, un onglet ? ». Plan proposé (mode plein écran « Annoter » plutôt qu'un onglet, trois étapes : outils et tracé corrigé ; annotations de la mise en plan avec export DXF/PDF ; écriture manuscrite) validé par Christophe : « je valide ».
- Nouveau domaine **ANN** (ANN-01 à ANN-08) : mode « Annoter » sur capture 3D, plan ou image (le fond n'est jamais modifié) ; tracé libre corrigé en droite / cercle / rectangle / flèche ou polyligne à poignées ; sélection, poignées, annuler/rétablir ; enregistrement dans le projet lié au SHA-256 ; export PNG et PDF ; annotations en mm sur la mise en plan exportées en DXF/PDF sur un calque **ANNOTATIONS** (décision écrite : ce calque s'ajoute aux exports MEP-08/09) ; écriture manuscrite **proposée, à vérifier**.
- Limites consignées : reconnaissance d'écriture évaluée seulement sur des écritures synthétiques (≈ 96 % par caractère), minuscules lues comme majuscules, lettres moins fiables que les chiffres ; pas d'épaisseur de trait en DXF R12 ; les annotations ne sont jamais des cotes. Aucune fonction supprimée.
- Application autonome 1.13.0 → **1.14.0**. La v1.18 passe en archive figée.

## 1.18 — 12 octobre 2026 (Claude Code, **décision écrite de Christophe** : lève trois limites du niveau 2)
Texte de Christophe : « tout fonctionne, continue sur vues auxiliaires, coupes décalées. L'export DXF/PDF ». Ces trois points étaient listés hors périmètre en 1.17 ; cette décision écrite les met dans le périmètre.
- **MEP-06** : vues auxiliaires (projection perpendiculaire à une droite choisie dans une vue, vraie grandeur d'une face ou d'un perçage inclinés ; sens du regard proposé, inversable). **MEP-07** : coupes décalées à plans parallèles (2 à 5 plans, décrochements non tracés, hachures continues, tracé en palier avec repères épais). **MEP-08** : export DXF R12 du plan (vues, coupes, cotes en géométrie, cartouche, 1:1). **MEP-09** : export PDF vectoriel 1:1 (A4 à A0 ou page sur mesure, cartouche).
- **MEP-05** mis à jour : restent hors périmètre la cotation automatique de la mise en plan, les vues isométriques/perspective, les coupes brisées/obliques, tolérances, ajustements, collisions, validation de fabrication. Exports = plan PROPOSÉ : la mention « valeurs INDICATIVES (maillage d'affichage ≈ ±0,05 mm), à vérifier avant toute fabrication » est écrite dans le cartouche du DXF et du PDF.
- **MEP-01** (note) : ellipses toujours non reconnues (polylignes). Aucune fonction supprimée ; le CSV des cotes est conservé.
- Application autonome 1.12.0 → **1.13.0**. La v1.17 passe en archive figée.

## 1.17 — 12 octobre 2026 (Claude Code, **décision écrite de Christophe** : limites du niveau 2)
Texte de Christophe : « nous allons utiliser le niveau 2 uniquement pour la projection d'une pièce 3D en mise en plan 2D à l'échelle 1 avec les 3 vues orthogonales, et si c'est un diamètre, une coupe sur le plan ZX passant par l'axe du diamètre ; possibilité de faire une coupe par rapport à une vue choisie sur le plan XZ ou YZ par rapport à une sélection cliquable (centre de cercle, intersection ou milieu de droite) ; la cotation se fera par l'opérateur en cliquant sur les éléments, si cercle détecté mettre le signe Ø, faire les traits de cote et les lignes de rappel en trait fin, et l'endroit de la mise en place de la cotation est fait par l'opérateur en cliquant sur une zone hors pièce ».
- **MEP-01** : bouton « Mise en plan » — trois vues 1:1 en projection européenne, arêtes cachées en pointillé, cercles/arcs reconnus. **MEP-02** : coupe A-A automatique suivant l'axe d'une pièce de révolution. **MEP-03** : coupe XZ ou YZ par un point cliqué. **MEP-04** : cotation par l'opérateur (H, V, alignée, Ø/R), Ø automatique, traits fins, placement par clic hors pièce. **MEP-05** : garde-fous.
- Limites consignées (hors périmètre sauf nouvelle décision) : pas de cotation automatique sur la mise en plan, pas de vues auxiliaires/isométriques, pas de coupes décalées ou brisées, pas d'export DXF/PDF du plan, ellipses (cercles non parallèles aux axes) non reconnues. Plan généré = proposé, valeurs indicatives (maillage ≈ ±0,05 mm), aucune validation de fabrication.
- Application autonome 1.11.0 → **1.12.0**. La v1.16 passe en archive figée.

## 1.16 — 12 octobre 2026 (Claude Code, **décision écrite de Christophe** : « Commençons avec le niveau 1 — pour le niveau 2, nous allons établir des limites »)
- **DXF-09** (niveau 1) : cotation automatique proposée sur plan 2D — référence + zone, cotes ordonnées X/Y et Ø/R groupés, à valider/ignorer/supprimer, CSV avec statut.
- **Niveau 2 (mise en plan automatique depuis une pièce 3D isolée) : NON commencé.** Christophe doit d'abord fixer les limites (vues, cotes, formats, ce qui reste hors périmètre) ; elles seront consignées ici avant tout code. Rappel : plan généré = proposé, non contractuel, aucune validation de fabrication.
- Application autonome 1.10.0 → **1.11.0**. La v1.15 passe en archive figée.

## 1.15 — 12 octobre 2026 (Claude Code, demande de Christophe : charger un PDF, cotes déplaçables, survol)
- **DXF-06** : ouverture directe d'un plan PDF vectoriel (pdf.js embarqué, hors ligne), traits/couleurs/textes, cercles et arcs reconnus, mm papier + échelle par vue.
- **DXF-07** : survol en surbrillance avec nature et taille réelle de l'élément. **DXF-08** : étiquettes de cotes déplaçables, cotes masquables.
- Application autonome 1.9.0 → **1.10.0** (fichier complet 4,8 → 5,5 Mo : pdf.js embarqué). La v1.14 passe en archive figée.

## 1.14 — 12 octobre 2026 (Claude Code, demande de Christophe : lire un plan DXF et prendre des cotes)
- Nouveau domaine **DXF** (DXF-01 à DXF-04) : ouverture d'un plan 2D DXF, affichage plein écran avec calques, cotation (distance, ΔX/ΔY, Ø/R, angle, accroches, export CSV). Pas de coupe ni de détection sur un plan 2D.
- **DXF-03** complétée : échelle par vue (liste, lecture dans le plan, calibrage) — les cotes sont affichées en vraie grandeur.
- **DXF-05** : outil `tools/pdf_vers_dxf.py` (PDF vectoriel → DXF).
- Limite signalée (DXF-04) : un DXF exporté d'une vue isométrique se mesure en longueurs projetées.
- Application autonome 1.8.0 → **1.9.0**. La v1.13 passe en archive figée.

## 1.13 — 12 octobre 2026 (Claude Code, demande de Christophe : écran tactile de 125 mm et circuits)
- **PER-09** : une couleur propre à chaque circuit / passage aligné (au lieu d'une couleur par classement) ; perçages isolés et alésages en gris.
- **IHM-03** : affichage adaptatif à la taille de l'écran — mode compact automatique (étapes en icônes, panneaux en recouvrement, barre d'outils 3D repliée) pour un petit écran tactile, réglage manuel « Taille d'écran » dans Réglages ; l'affichage du grand écran (27") reste inchangé. Aucune fonction supprimée.
- Application autonome 1.7.1 → **1.8.0**. La v1.12 passe en archive figée.

## 1.12 — 11 octobre 2026 (Claude Code, **décision écrite de Christophe** : « je valide les 5 recommandations à retirer »)
- **IHM-02** : cinq fonctions retirées de l'interface — type/statut/auteur des commentaires, bouton « Valider le repère », choix des bulles « Sélection seulement », filtres Ø mini/maxi des perçages, bouton « Fantôme autour ». Le code et les commandes JSON sont conservés (aucune suppression de fonction) ; notes ajoutées à NAV-02, NAV-04, NOM-03, DOC-01. Réintégration possible sur simple décision.
- Application autonome 1.7.0 → **1.7.1**. La v1.11 passe en archive figée.

## 1.11 — 11 octobre 2026 (Claude Code, demande de Christophe : refonte pour le personnel d'atelier)
- Nouveau domaine **ATELIER** (ATE-01 à ATE-06) et **NAV-09** : parcours en 7 étapes numérotées, guide contextuel « Que faire maintenant ? », liste unique des pièces (arborescence et nomenclature rassemblées), vert = fini, démonstration retirée de la barre du haut, réglages rares regroupés, design sobre ; cotes dont le texte se déplace au glisser.
- Les onglets « Arborescence » / « Nomenclature » deviennent « Pièces » / « Tableau » et le bouton « Reste à faire » devient l'étape « Suivi » : **aucune fonction supprimée**, identifiants et commandes JSON inchangés. ATE-06 (tri des fonctions discutables avec les monteurs) à faire : rien n'est retiré sans décision écrite ici.
- Application autonome 1.6.0 → **1.7.0**. La v1.10 passe en archive figée.

## 1.10 — 11 octobre 2026 (Claude Code, demande de Christophe : écran tactile de présentation de 1 m)
- Nouveau domaine **TACTILE** (TAC-01 à TAC-03) : mode tactile dans le même fichier (pas de version séparée, pour ne pas dupliquer le code) — interface agrandie à échelle réglable A− / A+, appui long sur une pièce = menu contextuel. TAC-03 (lasso au doigt, gestes multi-doigts, réception sur l'écran réel) à faire.
- Application autonome 1.5.1 → **1.6.0**. La v1.9 passe en archive figée.

## 1.9 — 11 octobre 2026 (Claude Code, décision de Christophe)
- **Décision écrite** : les marqueurs d'intersection et d'extrémité des circuits (billes) sont **annulés** à l'affichage. La fonction n'est pas supprimée : option « Marqueurs d'intersection » (désactivée par défaut), exigence **PER-08**.
- Application autonome 1.5.0 → **1.5.1**. La v1.8 passe en archive figée.

## 1.8 — 11 octobre 2026 (Claude Code, signalement de Christophe)
- Nouvelle exigence **IMP-07** : le sélecteur « Affichage rapide / normal / fin » ne s'appliquait qu'à l'ouverture d'un fichier ; il agit désormais à chaud sur le fichier ouvert (maillage recalculé ou relu du cache), avec conservation des annotations, groupes, coches, noms et de la vue.
- Application autonome 1.4.0 → **1.5.0**. La v1.7 passe en archive figée.

## 1.7 — 11 octobre 2026 (Claude Code, demande de Christophe)
- Nouvelles exigences **DES-01 à DES-04** : renommer un repère par double clic dans la nomenclature (fiche, Reste à faire) ; nom enregistré dans le projet, nom d'origine du STEP conservé et visible ; commande `repere_renommer` (confirmée). DES-04 (renommer dans l'arborescence) à faire.
- Application autonome 1.3.0 → **1.4.0**. La v1.6 passe en archive figée.

## 1.6 — 11 octobre 2026 (Claude Code, demande de Christophe)
- Nouveau domaine **AVANCEMENT** (AVA-01 à AVA-05) : onglet « Reste à faire », coche « fini » par repère (barre de sélection, nomenclature, fiche), pièces **achetées** (vis, écrous, rondelles, joints, bagues, colonnes) détectées d'office d'après la désignation (« proposé », corrigeable) et exclues du reste à faire.
- Décision : coche par **repère** (toutes les occurrences) ; coche par occurrence = AVA-05 à faire. Application autonome 1.2.0 → **1.3.0**. La v1.5 passe en archive figée.
- Correctif : l'enregistrement local différé (400 ms) est forcé à la fermeture / au rechargement de la page.

## 1.5 — 11 octobre 2026 (Claude Code, demande de Christophe)
- Nouveaux domaines **TYPOLOGIE** (TYP-01 à TYP-04) et **GROUPES** (GRP-01 à GRP-03) : fenêtre de filtre par type de pièce (tournage / fraisage / mixte, Ø, longueur, dimensions) et groupes de sélection nommés (« partie injection »…), utilisables pour sélectionner, isoler, masquer, colorer et déplacer selon un axe.
- Type, Ø et brut sont **proposés** d'après le maillage (≈ 0,05 mm) ; aucune gamme d'usinage ni choix de machine. TYP-04 (réception sur pièces réelles, correction manuelle du type) reste à faire.
- Commandes JSON étendues (cibles type / dimensions / groupe ; `groupe_*`). Application autonome 1.1.0 → **1.2.0**. La v1.4 passe en archive figée.

## 1.4 — 10 octobre 2026, nuit (Claude Code, demande de Christophe)
- Nouveau domaine **PILOTAGE** (PIL-01 à PIL-06) : l'application se pilote par commandes JSON collées depuis un assistant IA (onglet Commande, `window.SDC`), sans MCP ni installation. Écritures soumises à confirmation de l'opérateur ; collisions, jeux, tolérances, serrages, simulation refusés.
- Décision : étape 1 = commandes JSON collées (hors ligne, tablette d'atelier possible) ; étape 2 = serveur MCP local (PIL-05), à décider selon l'usage au bureau d'études.
- Application autonome 1.0.0 → **1.1.0**. La v1.3 passe en archive figée (`specs/v1.3/`, empreintes dans `INTEGRITE.json`).

## 1.3 — mise à jour du 10 octobre 2026, soir (Claude Code, demande de Christophe)
- « Mesurer » remplacé par **Cotation** (NAV-06) : Ø / R, distances et angles entre faces, axes, face + axe, points ; cotes persistantes, masquables.
- Coupes (COU-02) : hachurage atténué, contours des pièces coupées mis en évidence.
- Nouvelle exigence **IHM-01** : panneaux réductibles / détachables / déplaçables, barre d'outils déplaçable et repliable.

## 1.3 — 10 octobre 2026 (Claude Code, validé au fil des essais par Christophe)
- Ajout du livrable **application autonome** (HTML unique hors ligne + variante légère) ; l'application Windows 0.2 reste.
- Ajout du **module perçages & circuits** (PER-01 à PER-07) : forages, perçages étagés et interrompus, pièces logées,
  réseaux sécants/coaxiaux, alésages/logements séparés (Ø maxi forage 32 mm), squelette, forages pleins Ø3–20, fiche CSV.
- Décisions atelier : extrémités des circuits non dessinées ; étiquettes Ø en option ; plan de coupe sans plaque translucide.
- Ouverture paramétrée : translation **et rotation sur charnière** (axe pris sur un cylindre ou une arête) — retirée puis
  rétablie le même jour après explication de son usage.
- Sélection par fenêtre, retrait de faces, scènes avec PNG rechargeable, coupes pleines hachurées, STEP zippés,
  correction des accents ISO-8859-1, cache des maillages.
- Exigences désormais identifiées (ids stables) avec statut et preuve.

## 1.2 — 10 octobre 2026
- Version consolidée d'origine (archivée dans `v1.2/`).
