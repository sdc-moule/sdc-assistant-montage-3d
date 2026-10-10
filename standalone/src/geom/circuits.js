// Regroupement des perçages en réseaux (circuits de refroidissement, distribution matière…).
// Module pur. Les liaisons et classements sont des PROPOSITIONS à valider par l'opérateur.
import { vec, axisLabel, openEnds } from './holes.js';
const { dot, sub, add, mul, len } = vec;

/** Points les plus proches entre deux segments [p0,p1] et [q0,q1]. */
export function closestSegments(p0, p1, q0, q1) {
  const d1 = sub(p1, p0), d2 = sub(q1, q0), r = sub(p0, q0);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a < 1e-12 && e < 1e-12) { s = t = 0; }
  else if (a < 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e < 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const cp = add(p0, mul(d1, s)), cq = add(q0, mul(d2, t));
  return { s, t, cp, cq, distance: len(sub(cp, cq)) };
}

const parallel = (a, b) => Math.abs(Math.abs(dot(a, b)) - 1) < 2e-3;
function lineDist(a, b) { const d = sub(b.start, a.start); return len(sub(d, mul(a.axis, dot(d, a.axis)))); }
function span(h, axis) { const a = dot(h.start, axis), b = dot(h.end, axis); return [Math.min(a, b), Math.max(a, b)]; }

const KEYWORDS = {
  distribution: /collect|manifold|busett|buse|nozzle|bcr|injection|carott|sprue|canal.?chaud|hot.?runner/i,
  refroidissement: /refroid|cool|eau|water|regul|thermo/i,
  fixation: /vis|screw|chc|bolt|goujon|ecrou|nut|taraud|fix/i,
  obturation: /obtur|bouch|plug|bouchon|cap/i,
};

/**
 * parts : [{ id, name, positions }]
 * cylinders : Map partId → { holes, bosses } (sortie de extractCylinders)
 */
export function buildNetworks(parts, cylinders, options = {}) {
  const gapTol = options.gapTol ?? 0.6; // mm entre extrémités coaxiales
  const byId = new Map(parts.map(p => [p.id, p]));

  // 1. Perçages étagés : segments coaxiaux contigus d'une même pièce → une seule « opération ».
  const features = [];
  for (const [partId, { holes }] of cylinders) {
    const segs = holes.map(h => ({ ...h }));
    const used = new Set();
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue;
      const group = [segs[i]]; used.add(i);
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < segs.length; j++) {
          if (used.has(j)) continue;
          const b = segs[j];
          if (!group.some(a => parallel(a.axis, b.axis) && lineDist(a, b) < Math.max(0.05, 0.02 * Math.min(a.radius, b.radius)) && (() => {
            const [a0, a1] = span(a, a.axis), [b0, b1] = span(b, a.axis);
            return b0 <= a1 + gapTol && b1 >= a0 - gapTol;
          })())) continue;
          group.push(b); used.add(j); grew = true;
        }
      }
      const axis = group[0].axis;
      group.sort((a, b) => span(a, axis)[0] - span(b, axis)[0]);
      const t0 = Math.min(...group.map(g => span(g, axis)[0])), t1 = Math.max(...group.map(g => span(g, axis)[1]));
      const base = group[0].start, o = dot(base, axis);
      const start = add(base, mul(axis, t0 - o)), end = add(base, mul(axis, t1 - o));
      const part = byId.get(partId);
      const ends = part ? openEnds({ axis, start, end }, part.positions) : { start: false, end: false };
      features.push({
        id: `P${features.length + 1}`, partId, axis, start, end, length: t1 - t0,
        segments: group.map(g => ({ diameter: g.diameter, length: g.length, start: g.start, end: g.end })),
        diameter: Math.min(...group.map(g => g.diameter)), maxDiameter: Math.max(...group.map(g => g.diameter)),
        kind: group.length > 1 ? 'étagé' : 'simple', direction: axisLabel(axis), open: ends, occupants: [],
      });
    }
  }

  // 2. Éléments logés : cylindre convexe d'une autre pièce, coaxial et de même diamètre (vis, obturateur, busette…).
  for (const f of features) {
    for (const [partId, { bosses }] of cylinders) {
      if (partId === f.partId) continue;
      for (const b of bosses) {
        if (!parallel(f.axis, b.axis)) continue;
        if (lineDist(f, b) > Math.max(0.1, 0.03 * b.radius)) continue;
        const seg = f.segments.find(s => Math.abs(s.diameter - b.diameter) <= Math.max(0.15, 0.03 * b.diameter));
        if (!seg) continue;
        const [f0, f1] = span(f, f.axis), [b0, b1] = span(b, f.axis);
        if (b0 > f1 + 0.1 || b1 < f0 - 0.1) continue;
        const atStart = b0 <= f0 + 0.5, atEnd = b1 >= f1 - 0.5;
        if (!f.occupants.some(o => o.partId === partId)) f.occupants.push({ partId, atStart, atEnd, name: byId.get(partId)?.name ?? partId });
      }
    }
  }

  // 3. Liaisons : intersections (perçages sécants) et continuité coaxiale entre pièces différentes.
  const links = [];
  for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++) {
    const a = features[i], b = features[j];
    if (parallel(a.axis, b.axis)) {
      if (a.partId === b.partId) continue; // déjà fusionnés en perçage étagé
      if (lineDist(a, b) > Math.max(0.2, 0.05 * Math.min(a.diameter, b.diameter))) continue;
      const [a0, a1] = span(a, a.axis), [b0, b1] = span(b, a.axis);
      if (b0 > a1 + gapTol || b1 < a0 - gapTol) continue;
      const tm = (Math.max(a0, b0) + Math.min(a1, b1)) / 2, o = dot(a.start, a.axis);
      links.push({ a: a.id, b: b.id, type: 'coaxial', point: add(a.start, mul(a.axis, tm - o)) });
    } else {
      const c = closestSegments(a.start, a.end, b.start, b.end);
      const ra = a.diameter / 2, rb = b.diameter / 2;
      if (c.distance > 0.95 * (ra + rb)) continue;
      // les points proches doivent être à l'intérieur des deux segments (tolérance = rayon de l'autre)
      const inA = c.s * a.length >= -rb && c.s * a.length <= a.length + rb;
      const inB = c.t * b.length >= -ra && c.t * b.length <= b.length + ra;
      if (!inA || !inB) continue;
      links.push({ a: a.id, b: b.id, type: 'sécant', point: mul(add(c.cp, c.cq), 0.5), offset: c.distance });
    }
  }

  // 4. Composantes connexes.
  const parent = new Map(features.map(f => [f.id, f.id]));
  const find = x => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const l of links) parent.set(find(l.a), find(l.b));
  const groups = new Map();
  for (const f of features) { const r = find(f.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(f); }

  const networks = [];
  for (const members of groups.values()) {
    const ids = new Set(members.map(m => m.id));
    const nl = links.filter(l => ids.has(l.a));
    const hasJunction = nl.some(l => l.type === 'sécant');
    const kind = members.length === 1 ? 'isolé' : hasJunction ? 'circuit' : 'alignement';
    const partIds = [...new Set(members.map(m => m.partId))];
    const names = partIds.map(id => byId.get(id)?.name ?? '').join(' ');
    // Extrémités débouchantes et leur état (libre / logé).
    const ports = [];
    for (const f of members) for (const side of ['start', 'end']) {
      if (!f.open[side]) continue;
      const occ = f.occupants.find(o => (side === 'start' ? o.atStart : o.atEnd));
      // une extrémité qui touche un autre perçage du réseau par liaison coaxiale n'est pas une ouverture extérieure
      const p = f[side];
      const joined = nl.some(l => l.type === 'coaxial' && (l.a === f.id || l.b === f.id) && len(sub(l.point, p)) < f.diameter);
      if (joined) continue;
      ports.push({ featureId: f.id, side, point: p, diameter: f.segments[side === 'start' ? 0 : f.segments.length - 1].diameter, state: occ ? 'logé' : 'libre', occupant: occ?.name ?? null });
    }
    let suggestion = 'non classé';
    const occNames = members.flatMap(m => m.occupants.map(o => o.name)).join(' ');
    if (kind === 'alignement' && KEYWORDS.fixation.test(occNames)) suggestion = 'fixation';
    else if (kind === 'circuit' || kind === 'alignement') {
      if (KEYWORDS.distribution.test(names)) suggestion = 'distribution matière';
      else if (KEYWORDS.refroidissement.test(names)) suggestion = 'refroidissement';
      else if (kind === 'circuit') suggestion = 'refroidissement ?';
      else suggestion = 'passage aligné';
    } else {
      const occ = members[0].occupants.map(o => o.name).join(' ');
      if (KEYWORDS.fixation.test(occ)) suggestion = 'fixation';
      else if (members[0].kind === 'étagé') suggestion = 'lamage / perçage étagé';
      else suggestion = 'perçage';
    }
    networks.push({
      id: '', kind, suggestion, features: members.map(m => m.id), links: nl, partIds, ports,
      totalLength: members.reduce((s, m) => s + m.length, 0),
      diameters: [...new Set(members.flatMap(m => m.segments.map(s => +s.diameter.toFixed(2))))].sort((a, b) => a - b),
    });
  }
  const order = { circuit: 0, alignement: 1, 'isolé': 2 };
  networks.sort((a, b) => order[a.kind] - order[b.kind] || b.features.length - a.features.length || b.totalLength - a.totalLength);
  networks.forEach((n, i) => { n.id = `R${i + 1}`; });
  return { features, links, networks };
}
