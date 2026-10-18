"""Éclairage et réglages caméra via le module tiers `dinoliteuvccontrol` (facultatif, désactivé par défaut).

Les noms de méthodes viennent de l'exemple d'utilisation du module ; sa source n'a pas pu être vérifiée ici.
Il passe par l'USB bas niveau : l'essayer d'abord sur une caméra de test.
"""
import importlib

ACTIONS = ("led_on", "led_off", "flc_on", "led_dim", "led_brighten",
           "toggle_led_1", "toggle_led_2", "toggle_led_3", "toggle_led_4",
           "toggle_auto_exposure", "increase_exposure_time", "decrease_exposure_time")


class Indisponible(Exception):
    pass


def _serialisable(v):
    return v if v is None or isinstance(v, (bool, int, float, str)) else repr(v)


class EclairageDinoLite:
    def __init__(self, index=0):
        try:
            mod = importlib.import_module("dinoliteuvccontrol")
        except ImportError:
            raise Indisponible("Module « dinoliteuvccontrol » non installé.")

        class args:  # le module attend un objet portant l'attribut `debug`
            debug = False

        try:
            self._cam = mod.DinoLiteUVCControl(args).ourDevices[index]
        except (IndexError, AttributeError, OSError) as e:
            raise Indisponible(f"Caméra {index} non pilotable par le module ({e}).")

    def executer(self, action):
        if action not in ACTIONS:
            raise ValueError(f"Action inconnue « {action} » (attendu : {', '.join(ACTIONS)}).")
        return _serialisable(getattr(self._cam, action)())

    def controles(self):
        return _serialisable(self._cam.list_standard_controls())

    def lire(self, nom):
        return _serialisable(self._cam.get_standard_control_value(str(nom)))

    def regler(self, nom, valeur):
        # Le module attend des chaînes (exemple : set_standard_control_value("Brightness", "27")).
        return _serialisable(self._cam.set_standard_control_value(str(nom), str(valeur)))
