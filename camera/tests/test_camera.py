"""Tests du module caméra : calculs chiffrés + API de bout en bout sur la source de démonstration."""
import http.client
import json
import math
import os
import threading

import cv2
import numpy as np
import pytest

from sdc_camera import calibration as calib, measures, stockage
from sdc_camera.api import Etat, creer_serveur
from sdc_camera.source import SourceDemo


# ---------- étalonnage ----------
def test_echelle_deux_points():
    c = calib.depuis_deux_points("x20", [0, 0], [500, 0], 5.0, 1280, 960)
    assert c.px_par_mm == pytest.approx(100.0) and c.statut == "proposé"


@pytest.mark.parametrize("p2,mm", [([5, 0], 5.0), ([500, 0], 0), ([500, 0], -1)])
def test_etalonnage_refuse_points_proches_ou_cote_invalide(p2, mm):
    with pytest.raises(ValueError):
        calib.depuis_deux_points("x", [0, 0], p2, mm, 1280, 960)


def test_echelle_autre_resolution_meme_cadrage_et_refus_autre_proportion():
    c = calib.depuis_deux_points("x", [0, 0], [500, 0], 5.0, 1280, 960)
    assert calib.echelle_pour(c, 640, 480) == pytest.approx(50.0)
    with pytest.raises(ValueError):
        calib.echelle_pour(c, 1280, 1024)


def test_magasin_persistant(tmp_path):
    f = tmp_path / "c.json"
    m = calib.MagasinCalibrations(str(f))
    m.ajouter(calib.depuis_deux_points("a", [0, 0], [100, 0], 1, 1280, 960))
    m.ajouter(calib.depuis_deux_points("b", [0, 0], [200, 0], 1, 1280, 960), activer=False)
    m2 = calib.MagasinCalibrations(str(f))
    assert m2.actif == "a" and set(m2.items) == {"a", "b"} and m2.items["b"].px_par_mm == pytest.approx(200)


# ---------- mesures ----------
def test_distance_3_4_5():
    r = measures.mesurer("distance", [[0, 0], [300, 400]], 100.0)
    assert r["valeur"] == pytest.approx(5.0) and r["statut"] == "indicatif" and r["incertitude"] == pytest.approx(0.01)


def test_cercle_3_points_diametre_connu():
    pts = [[640 + 200 * math.cos(t), 400 + 200 * math.sin(t)] for t in (0.3, 2.0, 4.5)]
    r = measures.mesurer("cercle", pts, 100.0)
    assert r["valeur"] == pytest.approx(4.0, abs=1e-9)
    assert r["centre_px"] == pytest.approx([640, 400])


def test_cercle_points_alignes_refuse():
    with pytest.raises(ValueError):
        measures.mesurer("cercle", [[0, 0], [1, 1], [2, 2]], 1.0)


def test_angle_droit_et_plat():
    assert measures.mesurer("angle", [[1, 0], [0, 0], [0, 1]], 1)["valeur"] == pytest.approx(90.0)
    assert measures.mesurer("angle", [[-1, 0], [0, 0], [1, 0]], 1)["valeur"] == pytest.approx(180.0)


def test_mesure_nb_points_et_type_invalides():
    with pytest.raises(ValueError):
        measures.mesurer("distance", [[0, 0]], 1)
    with pytest.raises(ValueError):
        measures.mesurer("surface", [[0, 0]], 1)


# ---------- stockage ----------
def test_nettoyer_bloque_les_chemins():
    assert stockage.nettoyer("../../etc/passwd") == "etc_passwd"
    assert stockage.nettoyer("") == "sans-nom" and stockage.nettoyer(None, "x") == "x"


# ---------- API de bout en bout (source de démonstration) ----------
@pytest.fixture()
def serveur(tmp_path):
    src = SourceDemo().ouvrir()
    etat = Etat(src, calib.MagasinCalibrations(str(tmp_path / "c.json")), str(tmp_path / "cap"),
                origines=["http://appli.test"])
    srv = creer_serveur(etat, 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1], tmp_path
    srv.shutdown()
    srv.server_close()
    src.fermer()


def appel(port, methode, chemin, corps=None, entetes=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    h = dict(entetes or {})
    data = None
    if corps is not None:
        data = json.dumps(corps)
        h.setdefault("Content-Type", "application/json")
    c.request(methode, chemin, data, h)
    r = c.getresponse()
    brut = r.read()
    c.close()
    return r.status, r, brut


def test_chaine_complete_etalonner_mesurer_capturer(serveur):
    port, tmp = serveur
    (x0, y0), (x1, y1) = SourceDemo.BARRE_PX[0], SourceDemo.BARRE_PX[1]
    # sans étalonnage : mesure refusée
    s, _, b = appel(port, "POST", "/api/mesure", {"type": "distance", "points": [[0, 0], [10, 0]]})
    assert s == 409
    # étalonnage sur la barre de 5 mm, puis mesure du disque Ø 4 mm par 3 points
    s, _, b = appel(port, "POST", "/api/calibrations", {"nom": "x40", "p1": [x0, y0], "p2": [x1, y1], "distance_mm": 5})
    assert s == 201 and json.loads(b)["px_par_mm"] == pytest.approx(100.0)
    cx, cy = SourceDemo.CENTRE_DISQUE_PX
    pts = [[cx + 200 * math.cos(t), cy + 200 * math.sin(t)] for t in (0.0, 2.1, 4.2)]
    s, _, b = appel(port, "POST", "/api/mesure", {"type": "cercle", "points": pts})
    assert s == 200 and json.loads(b)["valeur"] == pytest.approx(4.0, abs=0.02)
    # capture : PNG + fiche + image annotée, sans écrasement
    corps = {"projet": "Moule A", "reference": "MC-12", "empreinte": "E3", "mesures": [{"type": "cercle", "points": pts}]}
    s, _, b = appel(port, "POST", "/api/capture", corps)
    r = json.loads(b)
    assert s == 201
    dossier = r["dossier"]
    img = cv2.imdecode(np.fromfile(os.path.join(dossier, r["fichier"]), np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[:2] == (960, 1280) and os.path.exists(os.path.join(dossier, r["fichier_cotes"]))
    fiche = json.load(open(os.path.join(dossier, r["fiche"]), encoding="utf-8"))
    assert fiche["mesures"][0]["statut"] == "indicatif" and fiche["calibration"]["statut"] == "proposé"
    assert len(r["sha256"]) == 64


def test_image_jpeg_et_etat(serveur):
    port, _ = serveur
    s, r, b = appel(port, "GET", "/api/image.jpg")
    assert s == 200 and r.getheader("Content-Type") == "image/jpeg"
    assert cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR).shape[:2] == (960, 1280)
    s, _, b = appel(port, "GET", "/api/etat")
    assert s == 200 and json.loads(b)["source"]["type"] == "demo"


def test_protections(serveur):
    port, _ = serveur
    assert appel(port, "GET", "/api/etat", entetes={"Host": "evil.example"})[0] == 403          # DNS rebinding
    assert appel(port, "GET", "/api/etat", entetes={"Origin": "http://evil.example"})[0] == 403  # CORS
    s, r, _ = appel(port, "GET", "/api/etat", entetes={"Origin": "http://appli.test"})
    assert s == 200 and r.getheader("Access-Control-Allow-Origin") == "http://appli.test"
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)                                  # POST non JSON
    c.request("POST", "/api/mesure", "x=1", {"Content-Type": "text/plain"})
    assert c.getresponse().status == 415
    assert appel(port, "GET", "/api/inconnue")[0] == 404


def test_jeton(tmp_path):
    src = SourceDemo().ouvrir()
    srv = creer_serveur(Etat(src, calib.MagasinCalibrations(str(tmp_path / "c.json")), str(tmp_path), jeton="s3cret"), 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    try:
        assert appel(port, "GET", "/api/etat")[0] == 401
        assert appel(port, "GET", "/api/etat", entetes={"X-SDC-Token": "s3cret"})[0] == 200
    finally:
        srv.shutdown()
        srv.server_close()
        src.fermer()
