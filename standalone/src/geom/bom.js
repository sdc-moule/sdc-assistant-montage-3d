// Nomenclature provisoire et caractéristiques de pièce (pur JS). Valeurs calculées sur le maillage d'affichage.

export function meshStats(positions, index) {
  let vol = 0, area = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = positions[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v;
  }
  for (let t = 0; t < index.length; t += 3) {
    const a = 3 * index[t], b = 3 * index[t + 1], c = 3 * index[t + 2];
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return { volume: Math.abs(vol), area, min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], closedOrientation: vol >= 0 };
}

/** Signature géométrique indépendante de la position : volume, surface, nb faces/triangles. */
export function signature(part, stats) {
  const r = x => (Math.abs(x) < 1e-9 ? 0 : x.toPrecision(5));
  return [r(stats.volume), r(stats.area), part.faces.length, part.index.length / 3].join('|');
}

/**
 * Regroupe les occurrences par nom ET signature géométrique (proposition à valider).
 * Des géométries identiques sous des noms différents ne sont jamais fusionnées : elles sont signalées.
 */
export function buildBom(parts, statsById, overrides = {}) {
  const rows = [];
  const byKey = new Map();
  for (const p of parts) {
    const st = statsById.get(p.id);
    const ref = overrides[p.id]?.reference ?? null;
    const name = overrides[p.id]?.designation ?? p.name;
    const sig = signature(p, st);
    const key = ref ? `ref:${ref}` : `auto:${name}|${sig}`;
    let row = byKey.get(key);
    if (!row) {
      row = { repere: rows.length + 1, designation: name, reference: ref, ids: [], quantite: 0, sousEnsemble: p.path.join(' / '),
        dims: st.size, volume: st.volume, sig, origine: ref ? 'référence saisie' : 'calcul maillage', statut: ref ? 'confirmé' : 'à vérifier', notes: [] };
      byKey.set(key, row); rows.push(row);
    }
    row.ids.push(p.id); row.quantite++;
  }
  for (const row of rows) {
    if (row.quantite > 1 && row.statut !== 'confirmé') { row.statut = 'regroupé (nom + géométrie) à valider'; row.origine = 'nom STEP + signature maillage'; }
    const twins = rows.filter(o => o !== row && o.sig === row.sig && o.designation !== row.designation);
    if (twins.length) row.notes.push(`géométrie identique au repère ${twins.map(t => t.repere).join(', ')} (non fusionné)`);
  }
  return rows;
}

export function toCsv(header, rows) {
  // Neutralise les débuts de formule (=, +, @, - non numérique) sans altérer les nombres négatifs.
  const cell = x => `"${String(x ?? '').replace(/^(?:[=+@\t\r]|-(?![\d.,]))/, "'$&").replaceAll('"', '""')}"`;
  return '﻿' + [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
}
