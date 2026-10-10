# Architecture — socle WIP

Flux 0.2.0 : navigateur → upload STEP local protégé → API Python standard → processus Python FreeCAD isolé / Import.insert → contrôle BRep et BOP → tessellation → GLB autonome + métadonnées JSON → Three.js → projet de consultation JSON.

La source n’est pas éditée et aucun document FreeCAD interactif n’est utilisé. Le processus de conversion crée un document temporaire non sauvegardé puis le ferme. L’import prend les groupes, noms et placements lus par FreeCAD ; chaque solide terminal reçoit un nœud GLB nommé par son identifiant. Les positions globales sont portées par les sommets, dans le repère assemblage et en millimètres. Ce contrat mm est spécifique SDC, à distinguer des outils glTF génériques utilisant les mètres.

Le backend utilise les modules fournis par FreeCAD et la bibliothèque standard Python pour l’API HTTP, les jobs et le stockage en dossiers JSON. Aucun module pip, base de données ou clé API n’est nécessaire. Le frontend se construit localement avec npm ; ses dépendances sont dans dist. Le lanceur .NET détecte Python FreeCAD puis démarre backend/start_workshop.py en arrière-plan.

Les métadonnées et le GLB doivent former une paire ; tous les noms de maillages doivent correspondre exactement aux identifiants des occurrences. Le chargement refuse les ressources externes. Les textes utilisateurs sont affichés avec textContent, et le CSV neutralise les débuts de formules.

La bibliothèque d’imports est dans un dossier de données distinct de l’application. Une seule conversion est acceptée à la fois ; upload limité à 512 Mo, conversion limitée à 30 minutes. L’API vérifie Host, Origin et un jeton de session pour les opérations d’écriture. Elle refuse les chemins hors des dossiers autorisés et ne fournit aucun accès arbitraire au système de fichiers. Fermer le lanceur arrête le serveur et son processus de conversion en cours.

Les groupes standards et pièces répétées sont testés. Un objet multi-solide ou lien d’assemblage composé peut être décomposé en solides sans restituer toute sa sous-structure ; ce cas est signalé et demande une réception sur les sources réelles. Les couleurs STEP natives ne sont pas extraites par le mode headless actuel.
