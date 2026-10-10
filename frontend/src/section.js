// Contour d'une coupe graphique : intersection triangles / plan n·x + d = 0 (repère local du maillage).
// Retourne [x1,y1,z1,x2,y2,z2, ...]. Ce n'est pas une section BRep exacte.
export function planeSegments(pos, index, n, d, eps = 1e-6) {
  const nv = pos.length / 3, s = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const v = n[0] * pos[3 * i] + n[1] * pos[3 * i + 1] + n[2] * pos[3 * i + 2] + d;
    s[i] = Math.abs(v) <= eps ? 0 : v;
  }
  const out = [], nt = index ? Math.floor(index.length / 3) : Math.floor(nv / 3);
  const at = (i, j, t) => {
    // Interpolation toujours dans l'ordre des indices : deux triangles voisins donnent le même point.
    if (i > j) { [i, j] = [j, i]; t = 1 - t; }
    for (let k = 0; k < 3; k++) out.push(pos[3 * i + k] + (pos[3 * j + k] - pos[3 * i + k]) * t);
  };
  const vertex = i => { for (let k = 0; k < 3; k++) out.push(pos[3 * i + k]); };
  for (let t = 0; t < nt; t++) {
    const tri = index ? [index[3 * t], index[3 * t + 1], index[3 * t + 2]] : [3 * t, 3 * t + 1, 3 * t + 2];
    const v = [s[tri[0]], s[tri[1]], s[tri[2]]];
    if ((v[0] > 0 && v[1] > 0 && v[2] > 0) || (v[0] < 0 && v[1] < 0 && v[2] < 0) || (v[0] === 0 && v[1] === 0 && v[2] === 0)) continue;
    const parts = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3], sa = v[k], sb = v[(k + 1) % 3];
      if (sa === 0) parts.push(() => vertex(a));
      if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) parts.push(() => at(a, b, sa / (sa - sb)));
    }
    if (parts.length === 2) { parts[0](); parts[1](); }
  }
  return Float32Array.from(out);
}
