# Piloter SDC Montage 3D avec un assistant IA (étape 1 : sans MCP)

L'application accepte des **commandes JSON** : l'assistant les écrit, l'opérateur les colle dans l'onglet **Commande** (rail de gauche) et clique **Exécuter**. Aucune installation, fonctionne hors ligne, le STEP n'est jamais modifié.

## Mise en route (30 s)
1. Ouvrir le STEP dans l'application.
2. Onglet **Commande** → **Copier le contexte pour l'IA** → coller dans la conversation avec l'assistant (une fois par conversation). Il contient le mode d'emploi, les règles de prudence, l'état et la nomenclature réelle (repères, familles, dimensions).
3. Demander en français ce qu'on veut voir. L'assistant répond par un bloc JSON.
4. Coller le bloc dans l'onglet, **Exécuter** (Ctrl + Entrée). Un bloc entouré de ```` ```json ```` est accepté tel quel.
5. Si l'assistant doit lire un résultat (liste de perçages, réseaux…) : **Copier le résultat** → le coller dans la conversation.
6. **↩ Avant la commande** restaure l'affichage d'avant la dernière série. **Annuler** (Ctrl + Z) annule masquages / transparences / familles.

## Garanties
- Toute la série est **validée avant exécution** : une faute (commande inconnue, repère inexistant, valeur hors plage) bloque tout, rien n'est à moitié appliqué. Les fautes de frappe proposent la bonne commande.
- **Écritures** (commentaire, validation d'un repère ou d'un circuit, référence, classement de famille, Ø maxi de forage) : une boîte liste ce qui va être écrit, l'opérateur accepte ou refuse. Via l'API `window.SDC` sans confirmation, elles sont refusées.
- Hors périmètre, refusé explicitement : collision, jeu, tolérance, serrage, simulation.
- Valeurs = maillage d'affichage (≈ 0,05 mm), indicatives. Circuits et familles restent « proposés » tant qu'ils ne sont pas validés. Une ouverture ou un éclaté est un déplacement paramétré, jamais une preuve de faisabilité.

## Format
```json
{"sdc": 1, "commandes": [ {"cmd": "isoler", "cible": {"reperes": [3, 4]}}, {"cmd": "coupe", "plan": "XZ", "position_mm": 120} ]}
```
**Cible** (quelles pièces) : `"selection"`, `"tout"`, `3`, `[3, 4]` ou `{"reperes": [..], "nom": "vis", "famille": "busettes", "sous_ensemble": "..", "recherche": "ø8", "visibles": true}` — critères cumulés (ET). Préférer les **repères** : un `nom` est une recherche par morceau de texte (« collecteur » peut aussi toucher un obturateur de collecteur).
Liste complète des commandes : commande `aide`, ou le contexte copié. Console du navigateur : `await SDC.isoler({cible: [3]})`, `await SDC.executer(json, {confirmer: 'operateur'})`.

## Bibliothèque de demandes (testées : chaque bloc est validé par `npm test`)

### Montage
**« Montre-moi comment ça se démonte. »**
```json
{"sdc": 1, "commandes": [{"cmd": "tout_afficher"}, {"cmd": "eclater", "pct": 70, "direction": "z"}, {"cmd": "vue", "nom": "iso"}, {"cmd": "cadrer", "cible": "tout"}]}
```
**« Isole la visserie et donne-m'en la liste. »**
```json
{"sdc": 1, "commandes": [{"cmd": "isoler", "cible": {"famille": "visserie"}}, {"cmd": "lister_pieces", "cible": {"famille": "visserie"}}]}
```
**« Ouvre le volet de 90° autour de la goupille Ø12 du repère 14 (le volet est le repère 15). »**
```json
{"sdc": 1, "commandes": [{"cmd": "groupe_mobile", "type": "rotation", "cible": [15], "axe_cylindre": {"repere": 14, "diametre_mm": 12}, "angle_deg": 90}, {"cmd": "ouverture", "pct": 100}]}
```
**« Fais coulisser la plaque 6 de 150 mm vers le haut. »**
```json
{"sdc": 1, "commandes": [{"cmd": "groupe_mobile", "type": "translation", "cible": [6], "axe": "z", "sens": 1, "course_mm": 150}, {"cmd": "ouverture", "pct": 100}]}
```
**« Prépare la fiche de montage : fermé, éclaté, coupe. »**
```json
{"sdc": 1, "commandes": [{"cmd": "tout_afficher"}, {"cmd": "eclater", "pct": 0}, {"cmd": "ouverture", "pct": 0}, {"cmd": "bulles", "actif": true}, {"cmd": "scene_sauver", "nom": "1 Fermé"}, {"cmd": "eclater", "pct": 70, "direction": "z"}, {"cmd": "scene_sauver", "nom": "2 Éclaté"}, {"cmd": "eclater", "pct": 0}, {"cmd": "coupe", "plan": "XZ", "position_pct": 50}, {"cmd": "scene_sauver", "nom": "3 Coupe XZ"}, {"cmd": "coupes_retirer"}, {"cmd": "exporter", "quoi": "rapport"}]}
```

### Usinage
**« Fiche des perçages de la plaque repère 5. »**
```json
{"sdc": 1, "commandes": [{"cmd": "fiche_percages", "cible": [5]}]}
```
**« Quelles pièces ont un perçage Ø8 ? »**
```json
{"sdc": 1, "commandes": [{"cmd": "chercher", "texte": "ø8"}]}
```
**« Exporte la fiche des perçages en CSV. »**
```json
{"sdc": 1, "commandes": [{"cmd": "exporter", "quoi": "percages"}]}
```
**« Coupe la plaque 5 à 40 mm de hauteur et masque le reste. »**
```json
{"sdc": 1, "commandes": [{"cmd": "isoler", "cible": [5]}, {"cmd": "coupe", "plan": "XY", "position_mm": 40}, {"cmd": "vue", "nom": "dessus"}]}
```

### Circuits et distribution matière
**« Isole le circuit R2 en squelette avec les Ø. »**
```json
{"sdc": 1, "commandes": [{"cmd": "mode", "nom": "percages"}, {"cmd": "circuits", "afficher": true, "seuls": true, "reseau": "R2", "etiquettes": true, "cadrer": true}]}
```
**« Quels réseaux sont des circuits, et lesquels sont déjà validés ? »**
```json
{"sdc": 1, "commandes": [{"cmd": "lister_reseaux", "type": "circuit"}]}
```
**« Quels forages sont bouchés par un obturateur ? »** (l'assistant lit la colonne `element_loge` du résultat)
```json
{"sdc": 1, "commandes": [{"cmd": "fiche_percages"}]}
```
**« Je confirme : R1 est la distribution matière. »** (écriture : confirmation demandée)
```json
{"sdc": 1, "commandes": [{"cmd": "classer_circuit", "reseau": "R1", "classement": "distribution matière"}]}
```
**« Remets l'affichage normal. »**
```json
{"sdc": 1, "commandes": [{"cmd": "circuits", "seuls": false, "reseau": "aucun"}, {"cmd": "tout_afficher"}, {"cmd": "coupes_retirer"}, {"cmd": "eclater", "pct": 0}, {"cmd": "ouverture", "pct": 0}]}
```

### Type de pièce et groupes
Type, Ø et brut sont **proposés** d'après le maillage (≈ 0,05 mm) : à vérifier sur plan. Types : `tournage` (pièces de révolution), `fraisage` (ou `prismatique`), `mixte`. Plages : `{"min": …, "max": …}` en mm.

**« Montre-moi les pièces à tourner de Ø 12 maxi. »**
```json
{"sdc": 1, "commandes": [{"cmd": "isoler", "cible": {"type": "tournage", "diametre_mm": {"max": 12}}}, {"cmd": "lister_pieces", "cible": {"type": "tournage", "diametre_mm": {"max": 12}}}]}
```
**« Isole les pièces prismatiques (fraisage) de plus de 200 mm. »**
```json
{"sdc": 1, "commandes": [{"cmd": "isoler", "cible": {"type": "prismatique", "plus_grande_dim_mm": {"min": 200}}}]}
```
**« Crée le groupe « partie injection » avec les pièces tournées hors visserie. »**
```json
{"sdc": 1, "commandes": [{"cmd": "groupe_creer", "nom": "partie injection", "cible": {"type": "tournage", "sauf_famille": "visserie"}}, {"cmd": "isoler", "cible": {"groupe": "partie injection"}}]}
```
**« Descends le groupe « partie injection » de 100 mm selon Z. »**
```json
{"sdc": 1, "commandes": [{"cmd": "groupe_mobile", "type": "translation", "cible": {"groupe": "partie injection"}, "axe": "z", "sens": -1, "course_mm": 100}, {"cmd": "ouverture", "pct": 100}]}
```
**« Quels groupes existent ? »** (retirer des pièces ou supprimer un groupe demande ta confirmation)
```json
{"sdc": 1, "commandes": [{"cmd": "lister_groupes"}]}
```

### Reste à faire
Les pièces dont la désignation évoque vis, écrou, rondelle, joint, bague ou colonne sont « achetées » d'office (**proposé**) et ne comptent pas dans le reste à faire. La coche « fini » est un suivi de l'atelier, par repère. Marquer = écriture : l'opérateur confirme.

**« Qu'est-ce qui reste à usiner ? »**
```json
{"sdc": 1, "commandes": [{"cmd": "lister_reste_a_faire"}, {"cmd": "isoler", "cible": {"avancement": "a_faire"}}]}
```
**« Montre ce qui est fait (en vert) et ce qui reste (en orange). »**
```json
{"sdc": 1, "commandes": [{"cmd": "tout_afficher"}, {"cmd": "isoler", "cible": {"avancement": ["a_faire", "fini"]}}]}
```
**« Les repères 3 et 4 sont finis. »** (écriture : confirmation demandée)
```json
{"sdc": 1, "commandes": [{"cmd": "marquer_fini", "cible": [3, 4]}]}
```
**« La bague du repère 9 est usinée chez nous, pas achetée. »** (écriture : confirmation demandée)
```json
{"sdc": 1, "commandes": [{"cmd": "marquer_achete", "cible": [9], "achete": false}]}
```

### Contrôle et notes
**« Note une anomalie sur les vis du repère 9. »** (écriture : confirmation demandée)
```json
{"sdc": 1, "commandes": [{"cmd": "commentaire_ajouter", "cible": [9], "type": "anomalie", "texte": "Longueur de vis à contrôler avant montage", "auteur": "Atelier"}]}
```
**« Je me suis trompé, reviens en arrière. »**
```json
{"sdc": 1, "commandes": [{"cmd": "retour_avant_commande"}]}
```

## Étape 2 (prévue, PIL-05) : pilotage direct depuis le chat
Un petit serveur MCP local relié à la page par WebSocket exposerait les mêmes commandes comme outils (`isoler`, `coupe`, `fiche_percages`…) et une capture d'écran de la vue, sans copier-coller. Il réutilise `window.SDC.executer`, donc les mêmes validations et confirmations. Nécessite un PC avec l'application ouverte : à décider selon l'usage au bureau d'études (pas pour une tablette d'atelier seule).
