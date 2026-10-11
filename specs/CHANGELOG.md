# Historique du cahier des charges

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
