# SDC Caméra — acquisition d'image, étalonnage et cotation (prototype 0.1)

Petit service local (Python + OpenCV, ~50 Mo en exe) qui pilote une caméra USB (UVC), par exemple un microscope
Dino-Lite, et expose une **API HTTP sur `127.0.0.1`** que d'autres applications (web, Electron, Windows) appellent
pour acquérir une image, l'étalonner en mm et coter. **Consultation / contrôle visuel indicatif** : aucune
validation de fabrication. Toute valeur est marquée « proposé » ou « indicatif ».

Réécriture indépendante à partir du besoin et des fonctions documentées publiquement ; **aucun code, binaire,
image ni texte de DinoCapture (AnMo Electronics) n'est repris ni analysé** (licence : rétro-ingénierie interdite).

## Essai sans caméra
```bash
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests            # 18 tests : calculs chiffrés + API de bout en bout
python -m sdc_camera --demo       # image synthétique à 100 px/mm (disque Ø 4 mm, barre 5 mm)
```

## Avec la caméra (Windows)
```powershell
python -m sdc_camera --camera 0 --largeur 1280 --hauteur 960
```
Fermer DinoCapture avant : une caméra ne s'ouvre que dans une application à la fois. La résolution réellement
négociée est donnée par `GET /api/etat` (le pilote peut refuser celle demandée).

## API (JSON, UTF-8)
| Route | Rôle |
| --- | --- |
| `GET /api/etat` | version, source, résolution, étalonnage actif |
| `GET /api/cameras` | indices de caméras disponibles |
| `GET /api/image.jpg` · `GET /api/flux.mjpg` | image courante · aperçu live (balise `<img>`) |
| `GET /api/calibrations` · `POST /api/calibrations` | liste · créer `{nom, p1:[x,y], p2:[x,y], distance_mm, activer}` |
| `POST /api/calibrations/active` | `{nom}` : choisir l'étalonnage (un par position de molette) |
| `POST /api/mesure` | `{type: distance\|cercle\|angle, points:[[x,y],…]}` en px d'image → valeur, unité, incertitude |
| `GET/POST /api/eclairage` | avec `--eclairage` : `{action}` parmi `led_on`, `led_off`, `flc_on`, `led_dim`, `led_brighten`, `toggle_led_1..4`, `toggle_auto_exposure`, `increase_exposure_time`, `decrease_exposure_time` |
| `GET /api/controles` · `POST /api/controle` | avec `--eclairage` : contrôles UVC standard, `{nom, valeur?}` (ex. Brightness) |
| `POST /api/capture` | `{projet, reference, empreinte, mesures:[…]}` → PNG, `_cotes.png`, fiche `.json` (SHA-256) |

Une capture est écrite dans `<donnees>/captures/<projet>/<reference>_<empreinte>_<AAAAMMJJ-HHMMSS>.png`, sans
jamais écraser un fichier existant.

Exemple d'intégration web :
```js
const api = "http://127.0.0.1:8765/api";
document.querySelector("img").src = api + "/flux.mjpg";
await fetch(api + "/calibrations", {method: "POST", headers: {"Content-Type": "application/json"},
  body: JSON.stringify({nom: "x40", p1: [100, 880], p2: [600, 880], distance_mm: 5})});
const m = await (await fetch(api + "/mesure", {method: "POST", headers: {"Content-Type": "application/json"},
  body: JSON.stringify({type: "distance", points: [[0, 0], [300, 400]]})})).json();   // m.valeur en mm
```
Une page web doit être déclarée : `--origine https://mon-appli.exemple` (CORS). `--jeton SECRET` exige l'en-tête
`X-SDC-Token`.

## Sécurité
Écoute sur `127.0.0.1` seulement ; en-tête `Host` vérifié ; CORS limité aux origines déclarées ; POST en JSON
uniquement ; jeton optionnel ; noms de fichiers assainis (pas de `..`) ; étalonnages écrits de façon atomique.

## Limites connues
- Objet supposé **plan et perpendiculaire** à l'axe optique, **sans correction de distorsion** ; incertitude donnée
  = ±1 px de pointé. Vérifier chaque échelle sur une mire ou une cote connue.
- Le grossissement du Dino-Lite se règle à la main : un étalonnage par position de molette (à nommer), à refaire
  si on touche la molette. Un étalonnage refuse une image de proportions différentes.
- LED, FLC et exposition : **facultatif**, via le module tiers `dinoliteuvccontrol` (option `--eclairage`, désactivée
  par défaut). Les noms de méthodes viennent de son exemple d'usage ; sa source, sa licence et sa compatibilité
  Windows n'ont **pas** pu être vérifiées. Il passe par l'USB bas niveau : **ne pas remplacer le pilote de la caméra**
  (type Zadig/libusbK) pour le faire marcher, la caméra disparaîtrait des autres applications. Essayer d'abord
  sur une caméra de test. Non testé sur matériel (tests avec un module simulé). MicroTouch et mise au point non pilotés.
- **Non testé sur une vraie caméra** : seules la source de démonstration et la chaîne de calcul sont testées.
- Pas encore d'interface (aperçu + pointage à la souris) : l'API est prête, l'IHM reste à écrire.

## Exe Windows
`powershell -File build_windows.ps1` (PyInstaller, à lancer sur Windows ; non testé depuis Linux).
