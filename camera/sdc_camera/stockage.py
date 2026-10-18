"""Enregistrement d'une capture : image PNG + fiche JSON (étalonnage, cotes, empreinte SHA-256)."""
import hashlib
import json
import os
import re
from datetime import datetime

import cv2
import numpy as np


def nettoyer(texte, defaut="sans-nom"):
    """Nom sûr pour un fichier ou un dossier : pas de séparateur, pas de « .. »."""
    t = re.sub(r"[^A-Za-z0-9._-]+", "_", str(texte or "").strip()).strip("._")
    return t[:60] or defaut


def annoter(image, mesures):
    """Copie de l'image avec les cotes incrustées (texte ASCII : police OpenCV sans accents)."""
    img = image.copy()
    for m in mesures:
        pts = [tuple(int(round(c)) for c in p) for p in m["points_px"]]
        if m["type"] == "cercle":
            c = tuple(int(round(v)) for v in m["centre_px"])
            cv2.circle(img, c, int(round(m["rayon_px"])), (0, 160, 0), 2, cv2.LINE_AA)
        else:
            sommets = pts if m["type"] == "distance" else [pts[0], pts[1], pts[2]]
            cv2.polylines(img, [np.array(sommets)], False, (0, 160, 0), 2, cv2.LINE_AA)
        unite = "deg" if m["unite"] == "°" else m["unite"]
        cv2.putText(img, f"{m['valeur']:.3f} {unite} (indicatif)", (pts[0][0] + 8, pts[0][1] - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 120, 0), 2, cv2.LINE_AA)
    return img


def enregistrer(racine, image, projet, reference, empreinte, calibration, mesures, camera, maintenant=None):
    maintenant = maintenant or datetime.now()
    dossier = os.path.join(racine, nettoyer(projet, "projet"))
    os.makedirs(dossier, exist_ok=True)
    base = "_".join([nettoyer(reference, "ref"), nettoyer(empreinte, "emp"), maintenant.strftime("%Y%m%d-%H%M%S")])
    n, nom = 1, base
    while os.path.exists(os.path.join(dossier, nom + ".png")):  # jamais d'écrasement
        n += 1
        nom = f"{base}-{n}"
    ok, png = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("Encodage PNG impossible.")
    chemin_png = os.path.join(dossier, nom + ".png")
    with open(chemin_png, "wb") as f:
        f.write(png.tobytes())
    fiche = {"fichier": nom + ".png", "sha256": hashlib.sha256(png.tobytes()).hexdigest(),
             "date": maintenant.isoformat(timespec="seconds"), "projet": projet, "reference": reference,
             "empreinte": empreinte, "camera": camera, "calibration": calibration, "mesures": mesures,
             "avertissement": "Valeurs indicatives, à vérifier : objet supposé plan, sans correction de distorsion."}
    if mesures:
        ok, png2 = cv2.imencode(".png", annoter(image, mesures))
        with open(os.path.join(dossier, nom + "_cotes.png"), "wb") as f:
            f.write(png2.tobytes())
        fiche["fichier_cotes"] = nom + "_cotes.png"
    with open(os.path.join(dossier, nom + ".json"), "w", encoding="utf-8") as f:
        json.dump(fiche, f, ensure_ascii=False, indent=2)
    return {"dossier": dossier, **{k: fiche[k] for k in ("fichier", "sha256")}, "fiche": nom + ".json",
            **({"fichier_cotes": fiche["fichier_cotes"]} if mesures else {})}
