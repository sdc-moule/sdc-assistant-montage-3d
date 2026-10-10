"""Écriture d'un GLB autonome : positions en mm, indices, noms d'occurrences."""
import json
import math
import struct


def encode_glb(meshes):
    document = {"asset": {"version": "2.0", "generator": "SDC WIP mm"},
                "scene": 0, "scenes": [{"nodes": []}], "nodes": [],
                "meshes": [], "accessors": [], "bufferViews": [], "buffers": []}
    binary = bytearray()
    names = set()
    for mesh in meshes:
        name, points, faces = mesh["id"], mesh["points"], mesh["triangles"]
        if name in names or not points or not faces:
            raise ValueError("Identifiant dupliqué ou maillage vide")
        names.add(name)
        if any(len(p) != 3 or any(not math.isfinite(v) for v in p) for p in points):
            raise ValueError("Coordonnées invalides")
        if any(len(f) != 3 or any(not isinstance(i, int) or i < 0 or i >= len(points) for i in f) for f in faces):
            raise ValueError("Indices invalides")
        position_offset = len(binary)
        for point in points:
            binary.extend(struct.pack("<3f", *point))
        index_offset = len(binary)
        for face in faces:
            binary.extend(struct.pack("<3I", *face))
        view = len(document["bufferViews"])
        document["bufferViews"].extend([
            {"buffer": 0, "byteOffset": position_offset, "byteLength": len(points) * 12, "target": 34962},
            {"buffer": 0, "byteOffset": index_offset, "byteLength": len(faces) * 12, "target": 34963}])
        accessor = len(document["accessors"])
        document["accessors"].extend([
            {"bufferView": view, "componentType": 5126, "count": len(points), "type": "VEC3",
             "min": [min(p[i] for p in points) for i in range(3)],
             "max": [max(p[i] for p in points) for i in range(3)]},
            {"bufferView": view + 1, "componentType": 5125, "count": len(faces) * 3, "type": "SCALAR"}])
        index = len(document["meshes"])
        document["meshes"].append({"name": name, "primitives": [{"attributes": {"POSITION": accessor}, "indices": accessor + 1, "mode": 4}]})
        document["nodes"].append({"name": name, "mesh": index})
        document["scenes"][0]["nodes"].append(index)
    if not names:
        raise ValueError("Aucun maillage")
    document["buffers"] = [{"byteLength": len(binary)}]
    payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
    payload += b" " * (-len(payload) % 4)
    binary += b"\0" * (-len(binary) % 4)
    length = 12 + 8 + len(payload) + 8 + len(binary)
    return (struct.pack("<3I", 0x46546C67, 2, length) + struct.pack("<2I", len(payload), 0x4E4F534A)
            + payload + struct.pack("<2I", len(binary), 0x004E4942) + binary)
