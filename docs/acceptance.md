# Plan de réception

Statut : WIP, essais sur données industrielles à réaliser. Aucun STEP client n’est versionné.

| Essai | Résultat attendu | Situation |
| --- | --- | --- |
| Démonstration synthétique | Trois blocs, sélection synchronisée | Disponible pour vérification |
| Export/restauration JSON | Même caméra, opacité, masquage, coupe, éclaté, commentaire | Tests de contrat + essai navigateur requis |
| Source différente | Restauration refusée | Test automatisé |
| Références ambiguës | Aucune fusion automatique | Test automatisé |
| GLB | En-tête, alignement, indices, noms cohérents | Test automatisé |
| Retour éclaté à zéro | Positions initiales exactes | Essai navigateur requis |
| Import STEP depuis l’interface | Upload, conversion, affichage sans manipulation GLB/JSON | Réussi sur un STEP synthétique |
| Bibliothèque locale | Réouverture sans reconversion | Vérifiée API et navigateur |
| STEP moule réel | Solides, positions, dimensions vérifiables | Fichier à fournir ; non réceptionné |
| STEP BCR réel | Idem, fonctions non supposées | Fichier à fournir ; non réceptionné |
| Arbre et instances STEP | Toutes les occurrences sans double comptage | Groupes et répétitions synthétiques testés ; liens complexes à réceptionner |
| Nomenclature associée | Références et quantités rapprochées | Non implémenté |
| Source inchangée | SHA-256 avant/après identique | Vérifié par le convertisseur |
| Cotation (plans, axes, cylindres, rayons) | Valeurs identiques aux cotes du STEP/FreeCAD sur un moule réel | Tests synthétiques et essai navigateur ; à réceptionner sur STEP réel (découpage en faces du convertisseur FreeCAD supposé) |
| Coupe | Remplissage, hachures atténuées, contours nets | Essai navigateur sur solides synthétiques ; pièces non fermées à vérifier |
| Impression | Vue + tableau, sans commandes | Essai navigateur requis |

Documenter pour chaque STEP : empreinte, version FreeCAD/OCCT, nombres de solides et occurrences, volumes, boîtes englobantes, erreurs BRep/BOP, capture et décision humaine. Les tests automatiques sans FreeCAD ne remplacent pas ces essais.
