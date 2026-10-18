"""Sources d'images : caméra USB (UVC) ou source de démonstration sans matériel."""
import sys
import threading
import time

import cv2
import numpy as np


def lister_cameras(max_index=6):
    """Indices de caméras qui s'ouvrent et donnent une image."""
    trouvees = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i, _backend())
        ok = cap.isOpened() and cap.read()[0]
        cap.release()
        if ok:
            trouvees.append(i)
    return trouvees


def _backend():
    return cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY


class _Source:
    """Boucle d'acquisition en arrière-plan : on ne garde que la dernière image."""

    def __init__(self):
        self._image = None
        self._verrou = threading.Lock()
        self._actif = False
        self._fil = None

    def ouvrir(self):
        self._ouvrir()
        self._actif = True
        self._fil = threading.Thread(target=self._boucle, daemon=True)
        self._fil.start()
        return self

    def fermer(self):
        self._actif = False
        if self._fil:
            self._fil.join(timeout=2)
        self._fermer()

    def derniere_image(self, attente_s=3.0):
        """Copie BGR de la dernière image ; lève TimeoutError si la caméra ne répond pas."""
        fin = time.time() + attente_s
        while time.time() < fin:
            with self._verrou:
                if self._image is not None:
                    return self._image.copy()
            time.sleep(0.02)
        raise TimeoutError("Aucune image reçue de la caméra.")

    def _boucle(self):
        while self._actif:
            img = self._lire()
            if img is not None:
                with self._verrou:
                    self._image = img
            else:
                time.sleep(0.05)


class SourceCamera(_Source):
    def __init__(self, index=0, largeur=1280, hauteur=960):
        super().__init__()
        self.index, self.largeur, self.hauteur = index, largeur, hauteur
        self._cap = None

    def _ouvrir(self):
        cap = cv2.VideoCapture(self.index, _backend())
        if not cap.isOpened():
            raise RuntimeError(f"Caméra {self.index} introuvable ou déjà utilisée (DinoCapture ouvert ?).")
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.largeur)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.hauteur)
        self._cap = cap

    def _fermer(self):
        if self._cap:
            self._cap.release()

    def _lire(self):
        ok, img = self._cap.read()
        return img if ok else None

    def info(self):
        # Résolution réellement négociée : le pilote peut refuser celle demandée.
        return {"type": "camera", "index": self.index,
                "largeur": int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                "hauteur": int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}


class SourceDemo(_Source):
    """Image synthétique à échelle connue (100 px/mm) : disque Ø 4 mm et barre de 5 mm."""

    PX_PAR_MM = 100.0
    DIAMETRE_DISQUE_MM = 4.0
    BARRE_MM = 5.0
    BARRE_PX = ((100, 880), (600, 880))
    CENTRE_DISQUE_PX = (640, 400)

    def __init__(self, largeur=1280, hauteur=960):
        super().__init__()
        self.largeur, self.hauteur = largeur, hauteur

    def _ouvrir(self):
        img = np.full((self.hauteur, self.largeur, 3), 235, np.uint8)
        for x in range(0, self.largeur, 100):
            cv2.line(img, (x, 0), (x, self.hauteur), (215, 215, 215), 1)
        for y in range(0, self.hauteur, 100):
            cv2.line(img, (0, y), (self.largeur, y), (215, 215, 215), 1)
        rayon = int(self.DIAMETRE_DISQUE_MM * self.PX_PAR_MM / 2)
        cv2.circle(img, self.CENTRE_DISQUE_PX, rayon, (40, 40, 40), 3, cv2.LINE_AA)
        (x0, y0), (x1, _) = self.BARRE_PX
        cv2.line(img, (x0, y0), (x1, y0), (0, 0, 180), 3)
        for x in range(x0, x1 + 1, 100):
            cv2.line(img, (x, y0 - 12), (x, y0 + 12), (0, 0, 180), 3)
        self._img = img

    def _fermer(self):
        pass

    def _lire(self):
        time.sleep(1 / 15)
        return self._img

    def info(self):
        return {"type": "demo", "largeur": self.largeur, "hauteur": self.hauteur}
