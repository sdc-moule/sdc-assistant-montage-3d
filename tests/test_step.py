"""Essais CAO synthétiques, dans des fichiers temporaires ; aucun STEP client."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
try:
    import FreeCAD as App
    import Part
    import Import
except ImportError:
    App = None
from sdc_converter.convert_step import convert


def make_fixture(path, bcr=False):
    doc = App.newDocument('Synthetic_SDC_Test')
    try:
        root = doc.addObject('App::Part', 'Root')
        root.Label = 'BCR synthétique' if bcr else 'Assemblage synthétique'
        root.Placement.Base = App.Vector(100, 50, 10)
        group = doc.addObject('App::Part', 'Group')
        group.Label = 'Sous-ensemble'
        group.Placement = App.Placement(App.Vector(20, 0, 0), App.Rotation(App.Vector(0, 0, 1), 90))
        root.addObject(group)
        a = doc.addObject('Part::Feature', 'First'); a.Label = 'Collecteur test' if bcr else 'Plaque test A'
        a.Shape = Part.makeCylinder(5, 20) if bcr else Part.makeBox(20, 30, 5)
        group.addObject(a)
        b = doc.addObject('Part::Feature', 'Second'); b.Label = 'Busette test' if bcr else 'Plaque test B'
        b.Shape = Part.makeCylinder(2, 12) if bcr else Part.makeBox(10, 15, 8)
        b.Placement.Base = App.Vector(40, 0, 20); group.addObject(b)
        if not bcr:
            link = doc.addObject('App::Link', 'Repeated'); link.Label = 'Plaque répétée'
            link.setLink(a); link.Placement.Base = App.Vector(60, 10, 20); group.addObject(link)
        doc.recompute()
        expected = []
        for obj in (a, b) if bcr else (a, b, link):
            shape = obj.Shape.copy()
            shape.transformShape(root.Placement.multiply(group.Placement).toMatrix())
            box = shape.BoundBox
            expected.append((obj.Label, shape.Volume, [box.XMin, box.YMin, box.ZMin, box.XMax, box.YMax, box.ZMax]))
        Import.export([root], str(path))
        # Référence indépendante : relire les positions effectivement écrites dans le STEP.
        source_shape = Part.Shape(); source_shape.read(str(path))
        result = []
        for index, solid in enumerate(source_shape.Solids):
            box = solid.BoundBox
            result.append((expected[index][0], solid.Volume, [box.XMin, box.YMin, box.ZMin, box.XMax, box.YMax, box.ZMax]))
        return result
    finally:
        App.closeDocument(doc.Name)


@unittest.skipIf(App is None, 'FreeCAD requis pour ces essais de conversion')
class StepTests(unittest.TestCase):
    def test_nested_assembly_positions_instances_and_reimport(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); source = folder / 'nested.step'
            expected = make_fixture(source)
            initial = hashlib.sha256(source.read_bytes()).hexdigest()
            data = convert(source, folder / 'converted')
            self.assertEqual(len(data['occurrences']), 3)
            self.assertTrue(any(node['name'] == 'Sous-ensemble' for node in data['tree']))
            self.assertIn('Plaque test A', [item['name'] for item in data['occurrences']])
            self.assertIn('Plaque test B', [item['name'] for item in data['occurrences']])
            for record, (_, volume, expected_box) in zip(data['occurrences'], expected):
                self.assertAlmostEqual(record['volume_mm3'], volume, places=5)
                for value, expected_value in zip(record['dimensions_mm'], [expected_box[3+i] - expected_box[i] for i in range(3)]):
                    self.assertAlmostEqual(value, expected_value, places=5)
            glb = (folder / 'converted/assembly.glb').read_bytes()
            import struct
            length = struct.unpack_from('<I', glb, 12)[0]
            gltf = json.loads(glb[20:20+length])
            by_id = {item['id']: item for item in data['occurrences']}
            for node in gltf['nodes']:
                occurrence_index = next(index for index, record in enumerate(data['occurrences']) if record['id'] == node['name'])
                expected_box = expected[occurrence_index][2]
                accessor = gltf['accessors'][gltf['meshes'][node['mesh']]['primitives'][0]['attributes']['POSITION']]
                for value, expected_value in zip(accessor['min'] + accessor['max'], expected_box):
                    self.assertAlmostEqual(value, expected_value, places=5)
            self.assertEqual(initial, hashlib.sha256(source.read_bytes()).hexdigest())
            again = convert(source, folder / 'converted-again')
            self.assertEqual([x['id'] for x in data['occurrences']], [x['id'] for x in again['occurrences']])
            self.assertEqual(data['source_sha256'], initial)
            with self.assertRaises(FileExistsError): convert(source, folder / 'converted')

    def test_bcr_cylinders_and_invalid_step(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); source = folder / 'bcr.stp'
            expected = make_fixture(source, bcr=True)
            data = convert(source, folder / 'converted')
            self.assertEqual(len(data['occurrences']), 2)
            self.assertEqual(sorted(item['name'] for item in data['occurrences']), sorted(item[0] for item in expected))
            for item in data['occurrences']:
                self.assertTrue(item['brep_valid']); self.assertEqual(item['strict_bop'], 'PASS')
            bad = folder / 'bad.step'; bad.write_text('ceci est un faux STEP')
            with self.assertRaises(Exception): convert(bad, folder / 'bad-output')
            self.assertFalse((folder / 'bad-output').exists())
