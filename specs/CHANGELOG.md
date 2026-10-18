# Historique du cahier des charges

## Hors cahier des charges 1.3 — 18 octobre 2026 (Claude Code, demande en session, à confirmer par Christophe)
- Nouveau périmètre indépendant **`camera/`** : service local d'acquisition caméra USB (UVC), étalonnage px→mm et
  cotation indicative (distance, cercle, angle), API HTTP sur 127.0.0.1 pour l'intégrer dans d'autres applications.
  Prototype 0.1 sans interface ; non testé sur caméra réelle. Aucune exigence rédigée : à formaliser dans une v1.x si retenu.
- Réécriture indépendante : rien de DinoCapture (AnMo Electronics) n'est repris ; son code n'a pas été analysé (licence).
- `standalone/`, `frontend/`, `backend/`, `packaging/` inchangés.

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
