"""Lancement : python -m sdc_camera [--demo] [--camera 0] [--port 8765] ..."""
import argparse
import os
import sys

from . import __version__
from .api import Etat, creer_serveur
from .calibration import MagasinCalibrations
from .source import SourceCamera, SourceDemo


def _dossier_donnees():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "SDC_Camera" if sys.platform == "win32" else ".sdc_camera")


def main(argv=None):
    p = argparse.ArgumentParser(prog="sdc_camera", description="Acquisition caméra + API locale (127.0.0.1).")
    p.add_argument("--camera", type=int, default=0, help="indice de la caméra (défaut 0)")
    p.add_argument("--largeur", type=int, default=1280)
    p.add_argument("--hauteur", type=int, default=960)
    p.add_argument("--demo", action="store_true", help="image synthétique, sans caméra")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--donnees", default=_dossier_donnees(), help="dossier des étalonnages")
    p.add_argument("--captures", default=None, help="dossier des captures (défaut : <donnees>/captures)")
    p.add_argument("--origine", action="append", default=[], help="origine web autorisée (CORS), répétable")
    p.add_argument("--jeton", default=None, help="jeton exigé dans l'en-tête X-SDC-Token")
    a = p.parse_args(argv)

    source = SourceDemo(a.largeur, a.hauteur) if a.demo else SourceCamera(a.camera, a.largeur, a.hauteur)
    try:
        source.ouvrir()
    except RuntimeError as e:
        print(f"ERREUR : {e}", file=sys.stderr)
        return 1
    etat = Etat(source, MagasinCalibrations(os.path.join(a.donnees, "calibrations.json")),
                a.captures or os.path.join(a.donnees, "captures"), a.origine, a.jeton)
    srv = creer_serveur(etat, a.port)
    print(f"SDC Caméra {__version__} — http://127.0.0.1:{a.port}/api/etat  (Ctrl+C pour arrêter)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
        source.fermer()
    return 0


if __name__ == "__main__":
    sys.exit(main())
