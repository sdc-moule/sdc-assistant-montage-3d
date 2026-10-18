"""Cotation sur image : distance, cercle par 3 points, angle par 3 points.

Les points sont en pixels (origine en haut à gauche). Résultats **indicatifs** : on suppose l'objet plan et
perpendiculaire à l'axe optique, sans correction de distorsion. L'incertitude donnée vaut ±1 px de pointé.
"""
import math

STATUT = "indicatif"


def _pt(p):
    if len(p) != 2:
        raise ValueError("Un point = [x, y].")
    return float(p[0]), float(p[1])


def distance(points, px_par_mm):
    a, b = (_pt(p) for p in points)
    return {"type": "distance", "valeur": math.dist(a, b) / px_par_mm, "unite": "mm",
            "incertitude": 1.0 / px_par_mm, "statut": STATUT}


def cercle_3_points(points, px_par_mm):
    """Cercle passant par 3 points du contour : diamètre et centre (px)."""
    (ax, ay), (bx, by), (cx, cy) = (_pt(p) for p in points)
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-9:
        raise ValueError("Les 3 points sont alignés : pas de cercle.")
    ux = ((ax**2 + ay**2) * (by - cy) + (bx**2 + by**2) * (cy - ay) + (cx**2 + cy**2) * (ay - by)) / d
    uy = ((ax**2 + ay**2) * (cx - bx) + (bx**2 + by**2) * (ax - cx) + (cx**2 + cy**2) * (bx - ax)) / d
    r_px = math.hypot(ax - ux, ay - uy)
    return {"type": "cercle", "valeur": 2 * r_px / px_par_mm, "unite": "mm", "incertitude": 2.0 / px_par_mm,
            "centre_px": [ux, uy], "rayon_px": r_px, "statut": STATUT}


def angle_3_points(points, px_par_mm=None):
    """Angle en degrés au sommet = 2e point (de 0 à 180°)."""
    a, s, b = (_pt(p) for p in points)
    u, v = (a[0] - s[0], a[1] - s[1]), (b[0] - s[0], b[1] - s[1])
    nu, nv = math.hypot(*u), math.hypot(*v)
    if nu < 1e-9 or nv < 1e-9:
        raise ValueError("Un bras de l'angle est de longueur nulle.")
    cos = max(-1.0, min(1.0, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)))
    return {"type": "angle", "valeur": math.degrees(math.acos(cos)), "unite": "°",
            "incertitude": math.degrees(math.atan(1.0 / min(nu, nv))), "statut": STATUT}


NB_POINTS = {"distance": 2, "cercle": 3, "angle": 3}
_OUTILS = {"distance": distance, "cercle": cercle_3_points, "angle": angle_3_points}


def mesurer(type_, points, px_par_mm):
    if type_ not in _OUTILS:
        raise ValueError(f"Mesure inconnue « {type_} » (attendu : {', '.join(_OUTILS)}).")
    if len(points) != NB_POINTS[type_]:
        raise ValueError(f"« {type_} » demande {NB_POINTS[type_]} points, {len(points)} reçus.")
    r = _OUTILS[type_](points, px_par_mm)
    r["points_px"] = [list(map(float, p)) for p in points]
    return r
