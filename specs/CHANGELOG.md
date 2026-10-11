# Historique du cahier des charges

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
