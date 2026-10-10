# Consignes pour les agents de code (Codex, Claude Code, …)

Lire ce fichier en entier avant toute modification. Les règles métier priment sur la vitesse.

## Ce que fait le dépôt
Consultation d'assemblages STEP (moules caoutchouc/silicone, BCR) pour l'atelier SDC : repérage, nomenclature,
masquage/isolation/transparence, éclatés, ouverture paramétrée, coupes, perçages et circuits. **Consultation
uniquement** : aucune modification du STEP, aucune validation de fabrication.

Deux livrables coexistent :

| Dossier | Livrable | Lecture STEP |
| --- | --- | --- |
| `standalone/` | **Application autonome** : un seul fichier HTML (`dist-standalone/SDC_Montage_3D.html`) | OpenCascade WASM (`occt-import-js`) dans le navigateur |
| `frontend/` + `backend/` + `packaging/` | Application Windows 0.2 (Vite + moteur Python FreeCAD local) | FreeCAD headless |

Le code géométrique pur est dans `standalone/src/geom/` (sans Three.js, testable sous Node) :
`from-occt.js` (pièces), `bom.js` (nomenclature, CSV), `holes.js` (cylindres/perçages), `circuits.js` (réseaux).

## Commandes
```bash
npm ci
npm test                       # tests Node (dont géométrie sur tests/fixtures/bcr_synthetique.step)
npm run build:standalone       # → dist-standalone/SDC_Montage_3D.html (~5 Mo, hors ligne)
python tests/e2e/standalone_e2e.py   # essai navigateur (Playwright + Chromium), doit afficher uniquement des OK
npm run build                  # application Vite 0.2
```
Données d'essai : `python tools/make_test_step.py tests/fixtures/bcr_synthetique.step` (OCP : `pip install cadquery-ocp-novtk`).
Ajouter un nouveau cas = ajouter une géométrie au générateur + un test qui vérifie le résultat attendu chiffré.

## Règles non négociables
1. Le fichier source est en **lecture seule**. Les annotations vivent dans le projet JSON / localStorage, liés à l'empreinte SHA-256.
2. Interface, messages, exports et commentaires **en français**.
3. Toute valeur déduite est marquée (« proposé », « à vérifier », « indicatif »). Jamais de fusion automatique de références ambiguës.
4. Hors périmètre : collisions, jeux, tolérances, serrages, simulation. Ne pas en ajouter sans décision écrite.
5. Le retour à zéro de l'éclaté et de l'ouverture doit restituer **exactement** la position du STEP (décalage = 0).
6. Pas de dépendance réseau à l'exécution (pas de CDN) : tout est embarqué par `standalone/build.mjs`.
7. Ne jamais committer de STEP client (`*.step` ignoré, sauf `tests/fixtures/` synthétiques).

## Pièges connus
- `three-mesh-bvh` réordonne l'index de la géométrie : toujours lui donner une **copie** (`p.index.slice()`), l'analyse des perçages utilise les plages de faces B-Rep de l'index d'origine.
- Sous `file://`, un Worker `blob:` ne peut pas faire `importScripts(blob:)` : le moteur OCCT est concaténé dans la source du Worker.
- `[hidden]` doit rester `display:none !important` (sinon les classes `display:flex` l'emportent).
- Les dimensions et diamètres proviennent du maillage d'affichage : tolérance ~0,05 mm en qualité normale.

## Définition de « terminé »
`npm test` vert, `npm run build:standalone` OK, `tests/e2e/standalone_e2e.py` sans ÉCHEC, captures relues,
README/feuille de route mis à jour avec le comportement **réel** (pas les intentions). Une fonction n'est pas
« faite » parce qu'un bouton existe.
