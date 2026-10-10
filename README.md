# SDC Assistant Montage 3D

Application Windows en français pour ouvrir directement un **STEP/STP**, consulter ses composants en 3D, rechercher un repère, isoler des pièces ou sous-ensembles, modifier l’opacité, afficher un éclaté ou une coupe, et sauvegarder un projet de consultation.

**Version 0.2.0 : chargement STEP local fonctionnel.** La démonstration est une option distincte, désactivée au démarrage. Statut de développement **WIP** : essais de conversion et de consultation réussis sur assemblages STEP synthétiques ; réception sur les moules et BCR de l’atelier à effectuer.

## Installation atelier

Construire le paquet avec les commandes ci-dessous, ou télécharger l’artefact **SDC-Atelier-Windows** du workflow GitHub Actions « Vérification du socle ». Extraire tout le ZIP puis lancer **Install.exe**. L’installateur crée un raccourci sur le bureau pour l’utilisateur courant.

FreeCAD est nécessaire sur ce PC pour convertir les STEP. L’installateur réutilise une installation existante. S’il n’en trouve aucune, il propose **Installer_FreeCAD.exe** : téléchargement depuis les [publications officielles FreeCAD](https://github.com/FreeCAD/FreeCAD/releases/latest), contrôle de l’empreinte SHA-256 fournie par GitHub, puis lancement de l’installateur officiel. Terminer cette installation, puis démarrer SDC.

**Prérequis :** Windows 10/11, .NET Framework 4.8, FreeCAD avec son Python intégré, Chrome ou Edge récent avec WebGL2. Aucun Node.js, pip, pythonocc ou OCP supplémentaire n’est requis pour l’utilisation atelier. Internet est nécessaire seulement pour installer FreeCAD s’il est absent. Les exécutables SDC ne sont pas signés ; respecter la politique du service informatique.

Pour utiliser SDC sans l’installer, lancer **Portable\Demarrer_SDC.bat** en conservant le dossier complet. Une version portable de FreeCAD est utilisable en sélectionnant son `bin\python.exe` dans le menu de configuration du lanceur.

## Ouvrir un STEP et travailler

1. Lancer le raccourci SDC ou `Demarrer_SDC.bat`.
2. Sélectionner un fichier `.step` ou `.stp`, puis **Ouvrir le STEP**.
3. Attendre la conversion locale ; les noms, composants et dimensions apparaissent dans l’interface.
4. Sélectionner une occurrence dans la 3D ou la nomenclature, rechercher, masquer/isoler ou choisir un sous-ensemble.
5. Régler l’opacité, l’éclaté global ou les coupes XZ/YZ/XY. Ajouter des commentaires en français.
6. **Télécharger le projet JSON** pour conserver commentaires, caméra et affichage. La nomenclature s’exporte en CSV ; l’impression navigateur permet un PDF de la vue et du tableau.

Les assemblages récemment importés sont conservés et peuvent être rouverts sans reconversion. Le STEP original n’est jamais réécrit ; une copie d’import et les résultats sont dans `%LOCALAPPDATA%\SDC\Montage3DData\projects`. Conserver ce dossier pour garder la bibliothèque. Les mises à jour de l’application ne l’effacent pas.

Le serveur écoute exclusivement sur `http://127.0.0.1:18740/`. Aucun accès LAN ni port pare-feu n’est ajouté. Pour arrêter le moteur, utiliser l’icône SDC près de l’horloge, **Quitter SDC**. Une conversion en cours est alors interrompue proprement, sans modifier sa source.

## Ce qui est réellement pris en charge

| Fonction | Version 0.2.0 |
| --- | --- |
| Sélection directe STEP/STP | Conversion locale FreeCAD, progression, erreurs lisibles |
| Assemblage | Noms, groupes et placements lus depuis l’import FreeCAD ; solides multiples signalés |
| Contrôles | BRep, volume positif, contrôle BOP strict, empreinte source avant/après |
| Repérage | Repères provisoires uniques, pas de fusion automatique de références incertaines |
| Consultation | Sélection synchronisée, recherche, orbite/panoramique/zoom/cadrage, masquage/isolation/opacité |
| Sous-ensembles | Liste des groupes importés et isolation de leurs occurrences |
| Éclaté et coupes | Éclaté global provisoire, clipping XZ/YZ/XY, inversion, combinaison coupe/éclaté |
| Persistance | Bibliothèque d’imports locale, projet JSON téléchargé, restauration sur même source |
| Documentation | Commentaires, CSV, impression navigateur/PDF |

À compléter selon le cahier des charges : bulles à flèche, import de nomenclature externe, confirmation/modification de références dans l’interface, couleurs STEP natives, ouverture paramétrée, vecteurs d’éclaté éditables, multisélection, annuler/rétablir, vues nommées multiples, mesure indicative, mode BCR classé, XLSX et PNG/PDF dédiés. La [feuille de route](docs/roadmap.md) conserve ces écarts explicites.

Les dimensions sont des encombrements dans le **repère assemblage**, pas des cotes fonctionnelles. Les couleurs servent à la présentation. Un composant contenant plusieurs solides est séparé avec une alerte ; un arbre absent du STEP ne peut pas être inventé. Les instances ou assemblages complexes sous forme de liens demandent une réception sur les fichiers concernés.

Un BRep invalide bloque la conversion. Une erreur BOP stricte sur un BRep lisible autorise seulement une consultation **REVIEW**, sans réparation ni usage en booléenne/fabrication. Taille maximale d’import : 512 Mo ; durée maximale de conversion : 30 minutes. Le maillage utilise une déviation de 0,2 mm, réglable dans la CLI ; cela concerne uniquement l’affichage.

## Développement et construction

```powershell
git clone https://github.com/sdc-moule/sdc-assistant-montage-3d.git
cd sdc-assistant-montage-3d
npm ci
npm test
npm run build
```

Pour construire le paquet Windows avec le Python FreeCAD déjà installé :

```powershell
& "C:\Program Files\FreeCAD 1.1\bin\python.exe" packaging/windows/build_installer.py
```

Le script utilise le compilateur .NET fourni par Windows et produit le dossier d’installation et le ZIP. Les sources C# du lanceur, de l’installateur et de l’assistant FreeCAD sont conservées dans le dépôt. `dist/` contient la version web construite et ses dépendances ; pas de CDN à l’exécution.

Pour les tests CAO/API, utiliser le Python fourni par FreeCAD :

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'backend'
& "C:\Program Files\FreeCAD 1.1\bin\python.exe" -m unittest discover -s tests -p "test_*.py" -v
```

Sans FreeCAD, les tests purement Python restent disponibles et les essais CAO sont explicitement ignorés. Pour développer le frontend, lancer le paquet SDC puis `npm run dev` : Vite transmet les requêtes API au moteur local sur 18740. Ne pas ouvrir `index.html` par `file://`.

La CLI de conversion reste utilisable :

```powershell
.\scripts\convert-step.ps1 -Source "C:\Modeles\assemblage.step" -Destination ".\data\projects\essai-01" -FreeCADBin "C:\Program Files\FreeCAD 1.1\bin"
```

## Structure et documentation

```text
frontend/src/              Interface Three.js et consultation
backend/sdc_converter/     Import FreeCAD, GLB et API locale
backend/start_workshop.py   Démarrage du moteur Python
packaging/windows/         Lanceur BAT/EXE, installateur et construction
public/examples/demo/      Démonstration optionnelle, sans données client
docs/                      Architecture, données et plan de réception
schemas/                   Contrats JSON
scripts/                   Diagnostic et CLI de conversion
tests/                     Tests Node, Python, STEP et API
data/                      Entrées/sorties locales ignorées par Git
.github/workflows/         Vérifications et construction du paquet Windows
```

Voir [architecture](docs/architecture.md), [données](docs/data-format.md), [réception](docs/acceptance.md) et [contribution](CONTRIBUTING.md).

## Périmètre et licence

Consultation et documentation uniquement. Pas de calcul de collisions, jeux, tolérances, résistance ou serrage. Une coupe graphique n’est pas une section BRep exacte ; un déplacement visuel ne prouve pas sa faisabilité mécanique. Seule une validation humaine peut donner le statut industriel `APPROVED`.

Aucune licence de redistribution du code SDC n’a encore été choisie par le propriétaire. FreeCAD et les dépendances tierces conservent leurs propres licences.
