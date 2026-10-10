// Conversion du résultat occt-import-js vers la structure « pièces » commune (pur JS).
export function partsFromOcct(result) {
  const parts = result.meshes.map((m, i) => {
    const positions = Float32Array.from(m.attributes.position.array);
    const index = m.index ? Uint32Array.from(m.index.array) : Uint32Array.from({ length: positions.length / 3 }, (_, k) => k);
    const faces = (m.brep_faces?.length ? m.brep_faces : [{ first: 0, last: index.length / 3 - 1 }])
      .map(f => ({ first: f.first, last: f.last, color: f.color ?? null }));
    return {
      id: `O${String(i + 1).padStart(3, '0')}`, meshIndex: i, name: (m.name || `Solide ${i + 1}`).trim(),
      color: m.color ?? null, positions, index, faces, path: [],
      normals: m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null,
    };
  });
  const groups = [];
  const walk = (node, ancestors) => {
    for (const mi of node.meshes ?? []) if (parts[mi]) parts[mi].path = ancestors;
    const here = node.name ? [...ancestors, node.name] : ancestors;
    if (node.children?.length && here.length) groups.push(here.join(' / '));
    for (const c of node.children ?? []) walk(c, here);
  };
  walk(result.root, []);
  return { parts, groups };
}
