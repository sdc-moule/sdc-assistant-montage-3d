"""Étalonnage pixels → millimètres.

Une échelle est propre à une position de la molette (grossissement) et à une résolution d'image.
Toute valeur est « proposée » : l'opérateur doit la vérifier sur une mire ou une cote connue.
"""
import json
import math
import os
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime

DISTANCE_PX_MIN = 20.0  # en dessous, l'échelle serait dominée par l'erreur de pointé


@dataclass
class Calibration:
    nom: str
    px_par_mm: float
    largeur_px: int
    hauteur_px: int
    cote_connue_mm: float
    date: str
    statut: str = "proposé"


def depuis_deux_points(nom, p1, p2, distance_mm, largeur_px, hauteur_px):
    """Échelle à partir de deux points pointés sur une cote connue (mire, bille, réglet)."""
    nom = str(nom).strip()
    if not nom:
        raise ValueError("Nom d'étalonnage vide.")
    if not distance_mm or distance_mm <= 0:
        raise ValueError("La cote connue doit être strictement positive (mm).")
    d_px = math.dist(p1, p2)
    if d_px < DISTANCE_PX_MIN:
        raise ValueError(f"Points trop proches ({d_px:.1f} px) : choisir une cote plus longue à l'écran.")
    return Calibration(nom, d_px / distance_mm, int(largeur_px), int(hauteur_px), float(distance_mm),
                       datetime.now().isoformat(timespec="seconds"))


def echelle_pour(cal, largeur_px, hauteur_px):
    """px/mm applicable à une image de taille donnée ; refuse un changement de proportions."""
    if (cal.largeur_px, cal.hauteur_px) == (largeur_px, hauteur_px):
        return cal.px_par_mm
    if abs(cal.largeur_px / cal.hauteur_px - largeur_px / hauteur_px) > 0.01:
        raise ValueError(f"Étalonnage « {cal.nom} » fait en {cal.largeur_px}×{cal.hauteur_px} : "
                         f"image {largeur_px}×{hauteur_px} de proportions différentes, refaire l'étalonnage.")
    return cal.px_par_mm * largeur_px / cal.largeur_px  # même cadrage, autre résolution


class MagasinCalibrations:
    """Étalonnages nommés (un par position de molette), enregistrés en JSON."""

    def __init__(self, chemin):
        self.chemin = chemin
        self.items = {}
        self.actif = None
        if os.path.exists(chemin):
            with open(chemin, encoding="utf-8") as f:
                d = json.load(f)
            self.items = {k: Calibration(**v) for k, v in d.get("calibrations", {}).items()}
            self.actif = d.get("actif") if d.get("actif") in self.items else None

    def ajouter(self, cal, activer=True):
        self.items[cal.nom] = cal
        if activer:
            self.actif = cal.nom
        self._ecrire()

    def activer(self, nom):
        if nom not in self.items:
            raise KeyError(nom)
        self.actif = nom
        self._ecrire()

    def courant(self):
        return self.items.get(self.actif) if self.actif else None

    def _ecrire(self):
        os.makedirs(os.path.dirname(self.chemin) or ".", exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.chemin) or ".", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"actif": self.actif, "calibrations": {k: asdict(v) for k, v in self.items.items()}},
                      f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.chemin)  # écriture atomique : jamais de fichier à moitié écrit
