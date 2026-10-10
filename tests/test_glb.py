import json
import struct
import unittest
from sdc_converter.glb import encode_glb


class GlbTests(unittest.TestCase):
    def test_structure_and_binary_offsets(self):
        mesh = {"id": "one", "points": [[0, 0, 0], [1, 0, 0], [0, 1, 0]], "triangles": [[0, 1, 2]]}
        data = encode_glb([mesh, {**mesh, "id": "two"}])
        magic, version, length = struct.unpack_from("<3I", data)
        self.assertEqual((magic, version, length), (0x46546C67, 2, len(data)))
        json_length = struct.unpack_from("<I", data, 12)[0]
        doc = json.loads(data[20:20 + json_length])
        self.assertEqual([n["name"] for n in doc["nodes"]], ["one", "two"])
        self.assertEqual(doc["bufferViews"][2]["byteOffset"], 48)
        binary_start = 20 + json_length + 8
        self.assertEqual(struct.unpack_from("<3I", data, binary_start + 36), (0, 1, 2))

    def test_invalid_geometry(self):
        with self.assertRaises(ValueError):
            encode_glb([])
        with self.assertRaises(ValueError):
            encode_glb([{"id": "x", "points": [[0, 0, 0]], "triangles": [[0, 1, 2]]}])


if __name__ == "__main__":
    unittest.main()
