"""API HTTP locale (127.0.0.1 uniquement) pour intégrer la caméra dans d'autres applications.

Protections : écoute sur la boucle locale, en-tête Host vérifié (anti « DNS rebinding »), CORS limité aux origines
déclarées, POST en JSON exclusivement (impose une requête préalable CORS), jeton optionnel (en-tête X-SDC-Token).
"""
import hmac
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import cv2

from . import __version__, calibration as calib, measures, stockage
from .source import lister_cameras


class Etat:
    def __init__(self, source, magasin, dossier_captures, origines=(), jeton=None):
        self.source, self.magasin, self.dossier_captures = source, magasin, dossier_captures
        self.origines, self.jeton = set(origines), jeton


class Erreur(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def _points(v):
    if not isinstance(v, list) or not all(isinstance(p, list) and len(p) == 2 and
                                          all(isinstance(c, (int, float)) for c in p) for p in v):
        raise Erreur(400, "« points » : liste de [x, y] en pixels.")
    return v


def creer_serveur(etat, port=8765):
    class Gestionnaire(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        # ---- outils ----
        def _entetes_cors(self):
            origine = self.headers.get("Origin")
            if origine and origine in etat.origines:
                self.send_header("Access-Control-Allow-Origin", origine)
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-SDC-Token")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Vary", "Origin")

        def _json(self, code, obj):
            corps = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(corps)))
            if code >= 400:  # corps de requête éventuellement non lu : on ferme plutôt que de désynchroniser
                self.send_header("Connection", "close")
                self.close_connection = True
            self._entetes_cors()
            self.end_headers()
            self.wfile.write(corps)

        def _verifier(self, ecriture):
            hote = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            if hote not in ("127.0.0.1", "localhost"):
                raise Erreur(403, "Hôte refusé.")
            origine = self.headers.get("Origin")
            if origine and origine not in etat.origines:
                raise Erreur(403, f"Origine « {origine} » non autorisée (option --origine).")
            if etat.jeton and not hmac.compare_digest(self.headers.get("X-SDC-Token", ""), etat.jeton):
                raise Erreur(401, "Jeton absent ou invalide.")
            if ecriture and "application/json" not in (self.headers.get("Content-Type") or ""):
                raise Erreur(415, "Content-Type application/json requis.")

        def _corps(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > 1_000_000:
                raise Erreur(413, "Corps trop grand.")
            try:
                d = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                raise Erreur(400, "JSON invalide.")
            if not isinstance(d, dict):
                raise Erreur(400, "Objet JSON attendu.")
            return d

        def _image(self):
            try:
                return etat.source.derniere_image()
            except TimeoutError as e:
                raise Erreur(503, str(e))

        def _echelle(self, image):
            cal = etat.magasin.courant()
            if not cal:
                raise Erreur(409, "Aucun étalonnage actif : faire POST /api/calibrations.")
            h, l = image.shape[:2]
            try:
                return cal, calib.echelle_pour(cal, l, h)
            except ValueError as e:
                raise Erreur(409, str(e))

        def _mesurer(self, d, image):
            cal, px = self._echelle(image)
            try:
                return measures.mesurer(d.get("type"), _points(d.get("points")), px)
            except ValueError as e:
                raise Erreur(400, str(e))

        # ---- routage ----
        def _traiter(self, methode):
            chemin = urlparse(self.path).path
            try:
                self._verifier(methode == "POST")
                if methode == "GET":
                    return self._get(chemin)
                return self._post(chemin, self._corps())
            except Erreur as e:
                self._json(e.code, {"erreur": e.message})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as e:  # ne jamais laisser une requête sans réponse
                self._json(500, {"erreur": f"Erreur interne : {e}"})

        def do_GET(self):
            self._traiter("GET")

        def do_POST(self):
            self._traiter("POST")

        def do_OPTIONS(self):
            try:
                self._verifier(False)
            except Erreur as e:
                return self._json(e.code, {"erreur": e.message})
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self._entetes_cors()
            self.end_headers()

        def _get(self, chemin):
            if chemin == "/api/etat":
                img = self._image()
                cal = etat.magasin.courant()
                return self._json(200, {"version": __version__, "source": etat.source.info(),
                                        "image": {"largeur": img.shape[1], "hauteur": img.shape[0]},
                                        "calibration_active": cal.nom if cal else None})
            if chemin == "/api/cameras":
                return self._json(200, {"cameras": lister_cameras()})
            if chemin == "/api/calibrations":
                return self._json(200, {"actif": etat.magasin.actif,
                                        "calibrations": {k: v.__dict__ for k, v in etat.magasin.items.items()}})
            if chemin == "/api/image.jpg":
                ok, jpg = cv2.imencode(".jpg", self._image(), [cv2.IMWRITE_JPEG_QUALITY, 92])
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(jpg)))
                self.send_header("Cache-Control", "no-store")
                self._entetes_cors()
                self.end_headers()
                return self.wfile.write(jpg.tobytes())
            if chemin == "/api/flux.mjpg":
                return self._flux()
            raise Erreur(404, "Route inconnue.")

        def _flux(self):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=image")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self._entetes_cors()
            self.end_headers()
            self.close_connection = True
            try:
                while True:
                    ok, jpg = cv2.imencode(".jpg", self._image(), [cv2.IMWRITE_JPEG_QUALITY, 80])
                    self.wfile.write(b"--image\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(jpg))
                    self.wfile.write(jpg.tobytes() + b"\r\n")
                    time.sleep(0.1)
            except (BrokenPipeError, ConnectionResetError, Erreur):
                pass

        def _post(self, chemin, d):
            if chemin == "/api/calibrations":
                img = self._image()
                try:
                    cal = calib.depuis_deux_points(d.get("nom"), *_points([d.get("p1"), d.get("p2")]),
                                                   d.get("distance_mm"), img.shape[1], img.shape[0])
                except ValueError as e:
                    raise Erreur(400, str(e))
                etat.magasin.ajouter(cal, activer=d.get("activer", True))
                return self._json(201, cal.__dict__)
            if chemin == "/api/calibrations/active":
                try:
                    etat.magasin.activer(d.get("nom"))
                except KeyError:
                    raise Erreur(404, "Étalonnage inconnu.")
                return self._json(200, {"actif": etat.magasin.actif})
            if chemin == "/api/mesure":
                return self._json(200, self._mesurer(d, self._image()))
            if chemin == "/api/capture":
                img = self._image()
                liste = d.get("mesures") or []
                if not isinstance(liste, list):
                    raise Erreur(400, "« mesures » : liste.")
                res = [self._mesurer(m, img) for m in liste]
                cal = etat.magasin.courant()
                return self._json(201, stockage.enregistrer(
                    etat.dossier_captures, img, d.get("projet"), d.get("reference"), d.get("empreinte"),
                    {**cal.__dict__, "px_par_mm_image": self._echelle(img)[1]} if cal else None,
                    res, etat.source.info()))
            raise Erreur(404, "Route inconnue.")

    class Serveur(ThreadingHTTPServer):
        daemon_threads = True

        def handle_error(self, requete, adresse):
            if not isinstance(sys.exc_info()[1], ConnectionError):  # client parti en cours de route : sans importance
                super().handle_error(requete, adresse)

    return Serveur(("127.0.0.1", port), Gestionnaire)
