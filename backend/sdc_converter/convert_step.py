"""CLI à exécuter avec le Python fourni par FreeCAD, jamais sur le document actif."""
import argparse
import hashlib
import json
import math
import uuid
from pathlib import Path

from sdc_converter.glb import encode_glb


def convert(source, destination, deflection=0.2):
    import FreeCAD
    import Part
    import Import
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source.suffix.lower() not in (".step", ".stp"):
        raise ValueError("Un fichier STEP/STP est requis")
    if not math.isfinite(deflection) or deflection <= 0:
        raise ValueError("La déviation doit être positive, en mm")
    if destination.exists():
        raise FileExistsError("Utiliser un nouveau dossier de sortie ; aucun écrasement autorisé")
    fingerprint = hashlib.sha256(source.read_bytes()).hexdigest()
    records, meshes, tree, alerts = [], [], [], []
    document = FreeCAD.newDocument('SDC_ReadOnly_' + uuid.uuid4().hex)
    try:
        Import.insert(str(source), document.Name)
        document.recompute()
        def children(obj):
            # Group/ElementList expriment les occurrences ; OutList inclut aussi les repères.
            return list(getattr(obj, 'Group', getattr(obj, 'ElementList', getattr(obj, 'Links', []))))
        def visit(obj, parent, parent_id, ancestors):
            if obj.Name in ancestors:
                raise ValueError('Cycle dans la hiérarchie importée')
            if obj.TypeId.startswith(('App::Origin', 'App::Line', 'App::Plane', 'App::Point')):
                return
            path = parent_id + '/' + obj.Name
            group_children = children(obj)
            if group_children and obj.TypeId != 'App::Link':
                tree.append({'id': path, 'name': obj.Label, 'parent_id': parent_id or None, 'type': 'group'})
                local = getattr(obj, 'Placement', FreeCAD.Placement())
                for child in group_children:
                    visit(child, parent.multiply(local), path, ancestors + [obj.Name])
                return
            if not hasattr(obj, 'Shape') or obj.Shape.isNull() or not obj.Shape.Solids:
                return
            placed = obj.Shape.copy()
            # Shape contient déjà le placement local ; seul le placement du parent est ajouté.
            placed.transformShape(parent.toMatrix())
            parts = placed.Solids
            if len(parts) > 1:
                alerts.append(f'{obj.Label} : {len(parts)} solides repérés séparément, sous-structure à vérifier.')
            for index, solid in enumerate(parts, 1):
                if solid.isNull() or not solid.isValid() or solid.Volume <= 0:
                    raise ValueError(f'{obj.Label} : BRep invalide ou volume non positif ; aucune réparation.')
                strict, strict_error = 'PASS', None
                try:
                    solid.check(True)
                except Exception as error:
                    # Une géométrie lisible reste consultable en REVIEW, sans autorisation de booléenne.
                    strict, strict_error = 'REVIEW', str(error)
                    alerts.append(f'{obj.Label} : contrôle BOP strict à revoir.')
                points, triangles = solid.tessellate(deflection)
                identity = 'occ-' + hashlib.sha256(f'{path}/{index}'.encode()).hexdigest()[:20]
                box = solid.BoundBox
                name = obj.Label if len(parts) == 1 else f'{obj.Label} / solide {index}'
                records.append({'id': identity, 'name': name, 'reference': None,
                                'reference_confirmed': False, 'group': parent_id or 'Assemblage',
                                'parent_id': parent_id or None, 'freecad_name': obj.Name,
                                'dimensions_mm': [box.XLength, box.YLength, box.ZLength],
                                'dimension_frame': 'assemblage', 'volume_mm3': solid.Volume,
                                'status': 'REVIEW' if strict != 'PASS' else 'A_VERIFIER',
                                'brep_valid': True, 'strict_bop': strict, 'strict_bop_error': strict_error,
                                'origin_information': 'Nom STEP et dimensions BRep',
                                'placement_matrix': list(parent.multiply(getattr(obj, 'Placement', FreeCAD.Placement())).toMatrix().A)})
                tree.append({'id': identity, 'name': name, 'parent_id': parent_id or None, 'type': 'occurrence'})
                meshes.append({'id': identity, 'points': [[p.x, p.y, p.z] for p in points],
                               'triangles': [list(t) for t in triangles]})
        roots = [obj for obj in document.Objects if not obj.InList]
        for obj in roots:
            visit(obj, FreeCAD.Placement(), '', [])
        if not records:
            raise ValueError('Le STEP ne contient aucun solide exploitable')
        if any(obj.State and 'Invalid' in obj.State for obj in document.Objects):
            alerts.append('Le document importé contient des objets signalés Invalid.')
    finally:
        FreeCAD.closeDocument(document.Name)
    result = {"schema_version": "1.0", "units": "mm", "assembly_id": fingerprint,
              "source_sha256": fingerprint, "source_name": source.name, "status": "WIP",
              "freecad_version": list(FreeCAD.Version()), "mesh_deflection_mm": deflection,
              "occt_version": Part.OCC_VERSION,
              "hierarchy_status": "FREECAD_IMPORTED", "tree": tree, "occurrences": records,
              "alerts": alerts,
              "warning": 'STEP chargé : noms et positions lus dans FreeCAD. Références à confirmer ; couleurs de présentation par défaut.' + ('\n' + '\n'.join(alerts) if alerts else '')}
    glb = encode_glb(meshes)
    if hashlib.sha256(source.read_bytes()).hexdigest() != fingerprint:
        raise RuntimeError("La source a changé pendant la lecture")
    destination.mkdir(parents=True)
    (destination / "assembly.glb").write_bytes(glb)
    (destination / "assembly.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description="STEP vers GLB/JSON de consultation SDC WIP")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--deflection", type=float, default=0.2, help="Déviation du maillage en mm (affichage uniquement)")
    args = parser.parse_args()
    try:
        result = convert(args.source, args.destination, args.deflection)
    except Exception as error:
        parser.exit(1, f"Conversion arrêtée : {error}\n")
    print(f"WIP : {len(result['occurrences'])} solides, sortie {args.destination}")


if __name__ == "__main__":
    main()
