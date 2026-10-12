// Mise en plan 2D d'une pièce 3D isolée : trois vues orthogonales à l'échelle 1:1 (projection européenne) et coupes.
// Module pur (sans DOM ni Three.js), testable sous Node. Toutes les valeurs sont en mm, repère de l'assemblage (Z vers le haut).
// Les arêtes viennent du MAILLAGE D'AFFICHAGE : précision ~0,05 mm, jamais une géométrie validée pour la fabrication.
// Arêtes retenues : bords de faces B-Rep vifs (> 20°), silhouettes, bords libres ; visibles en trait plein, cachées en pointillé.
import { ajusteCercle } from './pdf.js';

// Projection : U = droite de l'image, V = haut de l'image, D = direction du regard (de l'observateur vers la pièce).
export const VUES = {
  face: { nom: 'Vue de face', U: [1, 0, 0], V: [0, 0, 1], D: [0, 1, 0] },
  dessus: { nom: 'Vue de dessus', U: [1, 0, 0], V: [0, 1, 0], D: [0, 0, -1] },
  gauche: { nom: 'Vue de gauche', U: [0, -1, 0], V: [0, 0, 1], D: [1, 0, 0] },
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const TWO_PI = Math.PI * 2;

// ——— Préparation du maillage : soudure des sommets, une liste de triangles avec leur face B-Rep ———
export function preparer(parts) {
  const cle = new Map(), P = [], T = [], F = []; let base = 0, nFaces = 0;
  const vid = (x, y, z) => {
    const k = `${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(z * 1e3)}`; let i = cle.get(k);
    if (i === undefined) { i = P.length / 3; cle.set(k, i); P.push(x, y, z); } return i;
  };
  for (const part of parts) {
    const pos = part.positions, idx = part.index, faces = part.faces?.length ? part.faces : [{ first: 0, last: idx.length / 3 - 1 }];
    faces.forEach((f, fi) => {
      for (let t = f.first; t <= f.last; t++) {
        const a = vid(pos[3 * idx[3 * t]], pos[3 * idx[3 * t] + 1], pos[3 * idx[3 * t] + 2]), b = vid(pos[3 * idx[3 * t + 1]], pos[3 * idx[3 * t + 1] + 1], pos[3 * idx[3 * t + 1] + 2]), c = vid(pos[3 * idx[3 * t + 2]], pos[3 * idx[3 * t + 2] + 1], pos[3 * idx[3 * t + 2] + 2]);
        if (a === b || b === c || a === c) continue;
        T.push(a, b, c); F.push(base + fi);
      }
    });
    base += faces.length; nFaces += faces.length;
  }
  return finir({ P: Float64Array.from(P), T: Uint32Array.from(T), F: Int32Array.from(F), nFaces });
}
function finir(m) {
  const nT = m.T.length / 3, N = new Float64Array(3 * nT);
  for (let t = 0; t < nT; t++) {
    const a = 3 * m.T[3 * t], b = 3 * m.T[3 * t + 1], c = 3 * m.T[3 * t + 2], P = m.P;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    N[3 * t] = nx / l; N[3 * t + 1] = ny / l; N[3 * t + 2] = nz / l;
  }
  m.N = N; return m;
}
export function boite3d(m) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.P.length; i += 3) for (let k = 0; k < 3; k++) { if (m.P[i + k] < b[k]) b[k] = m.P[i + k]; if (m.P[i + k] > b[k + 3]) b[k + 3] = m.P[i + k]; }
  return b;
}

// ——— Découpe par un plan (axe 0 = X, 1 = Y) : on garde le côté ≥ valeur ; renvoie le demi-maillage et les segments de coupe ———
export function decouper(m, axe, valeur0) {
  return couper(m, axe, valeur0 + 1.7e-5, 1);   // décalage de 0,017 µm : évite les sommets exactement dans le plan (boucles de coupe rompues)
}
// Découpe générale : signe = +1 garde le côté ≥ valeur, −1 garde le côté ≤ valeur (utilisé pour les bandes des coupes décalées).
function couper(m, axe, valeur, signe = 1) {
  const P = [...m.P], T = [], F = [], seg = [], cle = new Map();
  const vid = (x, y, z) => { const k = `${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(z * 1e3)}`; let i = cle.get(k); if (i === undefined) { i = P.length / 3; cle.set(k, i); P.push(x, y, z); } return i; };
  const eps = 1e-7;
  for (let t = 0; t < m.T.length / 3; t++) {
    const v = [0, 1, 2].map(k => { const i = m.T[3 * t + k]; return [m.P[3 * i], m.P[3 * i + 1], m.P[3 * i + 2], signe * (m.P[3 * i + axe] - valeur), m.T[3 * t + k]]; });
    if (v.every(q => q[3] <= eps)) continue;
    if (v.every(q => q[3] >= -eps)) { T.push(v[0][4], v[1][4], v[2][4]); F.push(m.F[t]); continue; }
    const poly = [], nouv = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      if (a[3] >= -eps) poly.push({ id: a[4], p: a });
      if ((a[3] > eps && b[3] < -eps) || (a[3] < -eps && b[3] > eps)) {
        const s = a[3] / (a[3] - b[3]), x = a[0] + s * (b[0] - a[0]), y = a[1] + s * (b[1] - a[1]), z = a[2] + s * (b[2] - a[2]);
        const q = [x, y, z]; q[axe] = valeur; const id = vid(q[0], q[1], q[2]); poly.push({ id, p: q }); nouv.push(q);
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) { if (poly[0].id !== poly[k].id && poly[k].id !== poly[k + 1].id && poly[0].id !== poly[k + 1].id) { T.push(poly[0].id, poly[k].id, poly[k + 1].id); F.push(m.F[t]); } }
    if (nouv.length === 2) seg.push(nouv);
    else if (nouv.length === 1) { const sur = v.filter(q => Math.abs(q[3]) <= eps); if (sur.length) { const q = [sur[0][0], sur[0][1], sur[0][2]]; seg.push([nouv[0], q]); } }
  }
  const demi = finir({ P: Float64Array.from(P), T: Uint32Array.from(T), F: Int32Array.from(F), nFaces: m.nFaces });
  return { maillage: demi, segments: seg };
}

// ——— Visibilité : grille 2D des triangles projetés ———
function grille(m, vue, emprise) {
  const { U, V, D } = vue, nT = m.T.length / 3, tri = new Float64Array(9 * nT);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const i = 3 * m.T[3 * t + k], p = [m.P[i], m.P[i + 1], m.P[i + 2]];
    tri[9 * t + 3 * k] = dot(p, U); tri[9 * t + 3 * k + 1] = dot(p, V); tri[9 * t + 3 * k + 2] = dot(p, D);
  }
  const [u0, v0, u1, v1] = emprise, n = 256, cu = Math.max(u1 - u0, 1e-6) / n, cv = Math.max(v1 - v0, 1e-6) / n, cell = new Array(n * n);
  for (let t = 0; t < nT; t++) {
    const us = [tri[9 * t], tri[9 * t + 3], tri[9 * t + 6]], vs = [tri[9 * t + 1], tri[9 * t + 4], tri[9 * t + 7]];
    const a = Math.max(0, Math.floor((Math.min(...us) - u0) / cu)), b = Math.min(n - 1, Math.floor((Math.max(...us) - u0) / cu));
    const c = Math.max(0, Math.floor((Math.min(...vs) - v0) / cv)), d = Math.min(n - 1, Math.floor((Math.max(...vs) - v0) / cv));
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) (cell[i + j * n] ??= []).push(t);
  }
  return { tri, cell, n, u0, v0, cu, cv };
}
function masque(g, u, v, w, eps) {
  const i = Math.floor((u - g.u0) / g.cu), j = Math.floor((v - g.v0) / g.cv);
  if (i < 0 || j < 0 || i >= g.n || j >= g.n) return false;
  const L = g.cell[i + j * g.n]; if (!L) return false;
  for (const t of L) {
    const q = g.tri, o = 9 * t, u0 = q[o], v0 = q[o + 1], w0 = q[o + 2], u1 = q[o + 3], v1 = q[o + 4], w1 = q[o + 5], u2 = q[o + 6], v2 = q[o + 7], w2 = q[o + 8];
    const den = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2); if (Math.abs(den) < 1e-12) continue;
    const l0 = ((v1 - v2) * (u - u2) + (u2 - u1) * (v - v2)) / den, l1 = ((v2 - v0) * (u - u2) + (u0 - u2) * (v - v2)) / den, l2 = 1 - l0 - l1;
    if (l0 < -1e-7 || l1 < -1e-7 || l2 < -1e-7) continue;
    if (l0 * w0 + l1 * w1 + l2 * w2 < w - eps) return true;
  }
  return false;
}
// Point dans l'ensemble de boucles (règle pair-impair)
function dansBoucles(boucles, x, y) {
  let dedans = false;
  for (const B of boucles) for (let i = 0, j = B.length - 1; i < B.length; j = i++) {
    const [xi, yi] = B[i], [xj, yj] = B[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

// ——— Arêtes d'un maillage ———
function aretes(m) {
  const nV = m.P.length / 3, map = new Map(), E = [];
  for (let t = 0; t < m.T.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = m.T[3 * t + k], b = m.T[3 * t + (k + 1) % 3], lo = Math.min(a, b), hi = Math.max(a, b), key = lo * nV + hi;
    let e = map.get(key); if (e === undefined) { e = { a: lo, b: hi, t: [t] }; map.set(key, e); E.push(e); } else e.t.push(t);
  }
  return E;
}

// Tracés 2D d'une vue : chaînes d'arêtes retenues, chaînées en 3D (sommets soudés) puis projetées et découpées visible / caché.
// Chaîner en 3D évite de mélanger des polygones différents qui se projettent au même endroit (entrée et sortie d'un perçage).
function chainesVue(m, E, vue, opts) {
  const { D, U, V } = vue, { caps = null, ignorer = null } = opts;   // caps : [{ boucles, w, bande }] zones coupées qui masquent ce qui est derrière ; ignorer : plans [{axe, val}] dont les bords libres ne sont pas tracés
  const proj = i => { const p = [m.P[3 * i], m.P[3 * i + 1], m.P[3 * i + 2]]; return [dot(p, U), dot(p, V), dot(p, D)]; };
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i < m.P.length / 3; i++) { const q = proj(i); if (q[0] < u0) u0 = q[0]; if (q[0] > u1) u1 = q[0]; if (q[1] < v0) v0 = q[1]; if (q[1] > v1) v1 = q[1]; }
  if (!Number.isFinite(u0)) return { chaines: [], emprise: [0, 0, 1, 1] };
  const marge = 1e-3, emprise = [u0 - marge, v0 - marge, u1 + marge, v1 + marge], etendue = Math.max(u1 - u0, v1 - v0, 1);
  const g = grille(m, vue, emprise), eps = Math.max(0.03, etendue * 2e-5), pas = Math.max(0.5, etendue / 300);
  const unSeul = m.nFaces <= 1, gardees = [];
  for (const e of E) {
    let garde = false;
    if (e.t.length === 1 && ignorer && ignorer.some(q => Math.abs(m.P[3 * e.a + q.axe] - q.val) < 2e-3 && Math.abs(m.P[3 * e.b + q.axe] - q.val) < 2e-3)) garde = false;   // bord créé par un décrochement de coupe : non tracé
    else if (e.t.length === 1 || e.t.length > 2) garde = true;
    else {
      const [t1, t2] = e.t, n1 = [m.N[3 * t1], m.N[3 * t1 + 1], m.N[3 * t1 + 2]], n2 = [m.N[3 * t2], m.N[3 * t2 + 1], m.N[3 * t2 + 2]];
      const s1 = dot(n1, D), s2 = dot(n2, D), c = dot(n1, n2);
      const a1 = Math.abs(s1), a2 = Math.abs(s2), sil = (s1 * s2 < 0 && a1 + a2 > 0.04) || (a1 < 0.02 && a2 > 0.04) || (a2 < 0.02 && a1 > 0.04);   // contour apparent ; bruit de maillage (parois parallèles au regard) ignoré
      const vif = (m.F[t1] !== m.F[t2] && c < 0.94) || (unSeul && c < 0.7);
      garde = sil || vif;
    }
    if (garde) gardees.push(e);
  }
  // chaînage 3D : on traverse les sommets de degré 2 seulement
  const adj = new Map();
  gardees.forEach((e, i) => { for (const v of [e.a, e.b]) { let l = adj.get(v); if (!l) adj.set(v, l = []); l.push(i); } });
  const vu = new Uint8Array(gardees.length), suiv = (v, i) => { const l = adj.get(v); if (l.length !== 2) return -1; const j = l[0] === i ? l[1] : l[0]; return vu[j] ? -1 : j; };
  const autre = (e, v) => e.a === v ? e.b : e.a, chaines = [];
  for (let i = 0; i < gardees.length; i++) {
    if (vu[i]) continue; vu[i] = 1;
    const e0 = gardees[i], ids = [e0.a, e0.b];
    for (let cur = i, v = e0.b; ;) { const j = suiv(v, cur); if (j < 0) break; vu[j] = 1; v = autre(gardees[j], v); ids.push(v); cur = j; }
    for (let cur = i, v = e0.a; ;) { const j = suiv(v, cur); if (j < 0) break; vu[j] = 1; v = autre(gardees[j], v); ids.unshift(v); cur = j; }
    const ferme = ids.length > 3 && ids[0] === ids[ids.length - 1];
    // visibilité : on échantillonne chaque arête ; elle n'est coupée que là où l'état change (les sommets restent exacts pour l'ajustement des cercles)
    const pts = [], flags = [];   // flags[k] : le tronçon pts[k] → pts[k+1] est caché
    const P3 = ids.map(proj);
    pts.push([P3[0][0], P3[0][1]]);
    for (let k = 0; k + 1 < P3.length; k++) {
      const A = P3[k], B = P3[k + 1], L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), n = Math.max(1, Math.ceil(L / pas)), etat = [];
      for (let q = 0; q < n; q++) {
        const t = (q + 0.5) / n, mid = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]), A[2] + t * (B[2] - A[2])];
        let cache = masque(g, mid[0], mid[1], mid[2], eps);
        if (!cache && caps) for (const c of caps) if (mid[2] > c.w + eps && (!c.bande || (mid[0] >= c.bande[0] - 1e-6 && mid[0] <= c.bande[1] + 1e-6)) && dansBoucles(c.boucles, mid[0], mid[1])) { cache = true; break; }
        etat.push(cache);
      }
      let d = 0;
      for (let q = 1; q <= n; q++) if (q === n || etat[q] !== etat[d]) {
        const t = q / n; flags.push(etat[d]);
        pts.push(q === n ? [B[0], B[1]] : [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
        d = q;
      }
    }
    // découpe en tronçons de même état
    let deb = 0;
    for (let k = 1; k <= flags.length; k++) if (k === flags.length || flags[k] !== flags[deb]) {
      chaines.push({ pts: pts.slice(deb, k + 1), cache: flags[deb], ferme: ferme && deb === 0 && k === flags.length });
      deb = k;
    }
  }
  return { chaines, emprise };
}

// Fusion des segments colinéaires qui se recouvrent ou se touchent (cercle vu par la tranche, arêtes doublées).
// Un tronçon caché recouvert par un tronçon visible de la même droite disparaît (le trait plein l'emporte).
function fusionColineaire(segs, tolC = 0.02) {
  const groupes = new Map(), reste = [];
  for (const s of segs) {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l = Math.hypot(dx, dy);
    if (l < 1e-9) continue;
    let th = Math.atan2(dy, dx); if (th < 0) th += Math.PI; if (th >= Math.PI - 1e-7) th -= Math.PI;
    const ux = Math.cos(th), uy = Math.sin(th), c = -s.a[0] * uy + s.a[1] * ux;
    const k = `${Math.round(th * 2e4)}|${Math.round(c / tolC)}`;
    let g = groupes.get(k); if (!g) groupes.set(k, g = { ux, uy, c, v: [], h: [], n: 0 });
    const t0 = s.a[0] * ux + s.a[1] * uy, t1 = s.b[0] * ux + s.b[1] * uy;
    const iv = t0 <= t1 ? [t0, t1, s.a, s.b] : [t1, t0, s.b, s.a];   // [t début, t fin, point début, point fin] : points d'origine conservés
    (s.cache ? g.h : g.v).push(iv); g.n++;
  }
  const union = (L) => { L.sort((p, q) => p[0] - q[0]); const o = []; for (const q of L) { const d = o[o.length - 1]; if (d && q[0] <= d[1] + 0.05) { if (q[1] > d[1]) { d[1] = q[1]; d[3] = q[3]; } } else o.push([...q]); } return o; };
  const moins = (H, V, pt) => { const o = []; for (const h of H) { let [a, b, pa, pb] = h; for (const [c, d] of V) { if (d <= a || c >= b) continue; if (c > a) o.push([a, c, pa, pt(c)]); a = Math.max(a, d); pa = pt(a); if (a >= b) break; } if (a < b) o.push([a, b, pa, pb]); } return o.filter(q => q[1] - q[0] > 0.05); };
  for (const g of groupes.values()) {
    const pt = (t) => [t * g.ux - g.c * g.uy, t * g.uy + g.c * g.ux];
    const V = union(g.v), H = moins(union(g.h), V, pt);
    for (const q of V) reste.push({ a: q[2], b: q[3], cache: false });
    for (const q of H) reste.push({ a: q[2], b: q[3], cache: true });
  }
  return reste;
}

// Élimine les doublons quasi superposés (arête d'entrée et de sortie d'un perçage débouchant, polygones inscrits dans un même cercle).
// Le plein l'emporte sur le pointillé ; à nature égale, le premier tracé (le plus long) est conservé.
function epurerSegments(segs, tol = 0.08) {
  const cell = 3, make = () => ({ g: new Map(), longues: [] });
  const vis = make(), hid = make();
  const sd = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  const proche = (G, s) => {
    const m = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), t = Math.min(tol, 0.25 * L), dir = [(s.b[0] - s.a[0]) / L, (s.b[1] - s.a[1]) / L];
    const test = (o) => { const dx = o.b[0] - o.a[0], dy = o.b[1] - o.a[1], lo = Math.hypot(dx, dy); if (Math.abs(dir[0] * dy - dir[1] * dx) / lo > 0.35) return false; return sd(m, o.a, o.b) <= t; };
    for (const o of G.longues) if (test(o)) return true;
    const ci = Math.floor(m[0] / cell), cj = Math.floor(m[1] / cell);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const l = G.g.get(i + ',' + j); if (l) for (const o of l) if (test(o)) return true; }
    return false;
  };
  const ajout = (G, s) => {
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); if (L > 20) { G.longues.push(s); return; }
    const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / cell), x1 = Math.floor(Math.max(s.a[0], s.b[0]) / cell), y0 = Math.floor(Math.min(s.a[1], s.b[1]) / cell), y1 = Math.floor(Math.max(s.a[1], s.b[1]) / cell);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = i + ',' + j; (G.g.get(k) ?? G.g.set(k, []).get(k)).push(s); }
  };
  const len = (s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
  const out = [];
  for (const cache of [false, true]) for (const s of segs.filter(q => q.cache === cache).sort((p, q) => len(q) - len(p))) {
    if (len(s) < 1e-9) continue;
    if (proche(vis, s) || (cache && proche(hid, s))) continue;
    ajout(cache ? hid : vis, s); out.push(s);
  }
  return out;
}

// ——— Reconnaissance droites / cercles / arcs sur les tracés ———
const distDroite = (a, b, p) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l; };
function droiteOk(pts, i, j, tol) { for (let k = i + 1; k < j; k++) if (distDroite(pts[i], pts[j], pts[k]) > tol) return false; return true; }
function cercleOk(pts, i, j) { if (j - i < 4) return null; return ajusteCercle(pts.slice(i, j + 1)); }

// Segmentation gloutonne d'un tracé : droites et arcs de cercle les plus longs possible.
function segmenter(pts, tolDroite = 0.015) {
  const out = []; let i = 0; const n = pts.length - 1;
  while (i < n) {
    let jd = i + 1; while (jd + 1 <= n && droiteOk(pts, i, jd + 1, tolDroite)) jd++;
    let jc = i, fc = null;
    if (n - i >= 4 && n <= 600) { for (let j = i + 4; j <= n; j++) { const f = cercleOk(pts, i, j); if (f) { jc = j; fc = f; } else if (jc > i) break; } }
    if (fc && jc > jd) { out.push({ type: 'arc', i, j: jc, f: fc }); i = jc; } else { out.push({ type: 'ligne', i, j: jd }); i = jd; }
  }
  return out;
}

function pointsArc(f, a, b, sens) { // du point a au point b autour du centre, dans le sens donné (+1 anti-horaire)
  const a0 = Math.atan2(a[1] - f.c[1], a[0] - f.c[0]); let d = Math.atan2(b[1] - f.c[1], b[0] - f.c[0]) - a0;
  if (sens > 0) { while (d <= 0) d += TWO_PI; } else { while (d >= 0) d -= TWO_PI; }
  const n = Math.max(8, Math.ceil(Math.abs(d) / 0.05)), out = [];
  for (let k = 0; k <= n; k++) { const t = a0 + (d * k) / n; out.push([f.c[0] + f.r * Math.cos(t), f.c[1] + f.r * Math.sin(t)]); }
  return out;
}
function sensBalayage(pts, c) { let tot = 0, prev = Math.atan2(pts[0][1] - c[1], pts[0][0] - c[0]); for (let i = 1; i < pts.length; i++) { const a = Math.atan2(pts[i][1] - c[1], pts[i][0] - c[0]); let d = a - prev; while (d > Math.PI) d -= TWO_PI; while (d < -Math.PI) d += TWO_PI; tot += d; prev = a; } return Math.sign(tot) || 1; }

function alignes(pts, tol = 0.02) {
  const loin = (p) => { let b = pts[0], d = -1; for (const q of pts) { const e = Math.hypot(q[0] - p[0], q[1] - p[1]); if (e > d) { d = e; b = q; } } return b; };
  const q = loin(pts[0]), r = loin(q); if (Math.hypot(r[0] - q[0], r[1] - q[1]) < 1e-6) return null;
  for (const p of pts) if (distDroite(q, r, p) > tol) return null;
  return [q, r];
}
function itemsDeChaines(chaines, calqueVu, calqueCache) {
  const items = [];
  const ext = (p) => ({ x: p[0], y: p[1], t: 'extrémité' });
  for (const ch of chaines) {
    const layer = ch.cache ? calqueCache : calqueVu, pointille = ch.cache;
    let pts = ch.pts;
    const droite = alignes(pts);   // tracé réduit à une droite (cercle vu par la tranche, arête simple)
    if (droite) { items.push({ kind: 'line', layer, pointille, pts: droite, snap: [ext(droite[0]), ext(droite[1]), { x: (droite[0][0] + droite[1][0]) / 2, y: (droite[0][1] + droite[1][1]) / 2, t: 'milieu' }] }); continue; }
    if (ch.ferme && pts.length > 6) { const f = ajusteCercle(pts.slice(0, -1)); if (f && f.balayage > TWO_PI - 0.6) { const arcs = pointsArc(f, pts[0], pts[0], 1); arcs.push(arcs[0]); items.push({ kind: 'circle', layer, pointille, pts: arcs, c: f.c, r: f.r, snap: [{ x: f.c[0], y: f.c[1], t: 'centre' }, ...[0, 1, 2, 3].map(q => ({ x: f.c[0] + f.r * Math.cos(q * Math.PI / 2), y: f.c[1] + f.r * Math.sin(q * Math.PI / 2), t: 'quadrant' }))] }); continue; } }
    for (const s of segmenter(pts)) {
      const a = pts[s.i], b = pts[s.j];
      if (s.type === 'arc') {
        const sens = sensBalayage(pts.slice(s.i, s.j + 1), s.f.c), arc = pointsArc(s.f, a, b, sens);
        items.push({ kind: 'arc', layer, pointille, sens, pts: arc, c: s.f.c, r: s.f.r, snap: [{ x: s.f.c[0], y: s.f.c[1], t: 'centre' }, ext(a), ext(b)] });
      } else items.push({ kind: 'line', layer, pointille, pts: [a, b], snap: [ext(a), ext(b), { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, t: 'milieu' }] });
    }
  }
  return items;
}

// Dédoublonnage au niveau des entités : cercles/arcs superposés (bords d'entrée et de sortie d'un perçage), cordes de facettes, droites proches.
function epurerItems(items) {
  const norm = (a) => { a %= TWO_PI; return a < 0 ? a + TWO_PI : a; };
  const plage = (o) => { if (o.kind === 'circle') return { a0: 0, bal: TWO_PI }; const a0 = Math.atan2(o.pts[0][1] - o.c[1], o.pts[0][0] - o.c[0]), a1 = Math.atan2(o.pts.at(-1)[1] - o.c[1], o.pts.at(-1)[0] - o.c[0]); let d = o.sens > 0 ? norm(a1 - a0) : norm(a0 - a1); return o.sens > 0 ? { a0, bal: d } : { a0: a1, bal: d }; };
  const dedans = (P, ang) => P.bal >= TWO_PI - 1e-6 || norm(ang - P.a0) <= P.bal + 0.03;
  const angPt = (o, p) => Math.atan2(p[1] - o.c[1], p[0] - o.c[0]);
  const rond = items.filter(o => o.kind === 'circle' || o.kind === 'arc'), autres = items.filter(o => o.kind !== 'circle' && o.kind !== 'arc');
  const tri = [...rond.filter(o => !o.pointille), ...rond.filter(o => o.pointille)].map(o => { o.pl = plage(o); return o; });
  const gardes = [], rejets = [];
  for (const o of tri.sort((p, q) => (p.pointille - q.pointille) || (q.pl.bal * q.r - p.pl.bal * p.r))) {
    const echant = o.kind === 'circle' ? [0, 1.5, 3, 4.5] : [angPt(o, o.pts[0]), angPt(o, o.pts[Math.floor(o.pts.length / 2)]), angPt(o, o.pts.at(-1))];
    const doublon = gardes.some(k => Math.hypot(k.c[0] - o.c[0], k.c[1] - o.c[1]) < 0.12 && Math.abs(k.r - o.r) < 0.12 && (!k.pointille || o.pointille) && echant.every(a => dedans(k.pl, a)));
    if (doublon) rejets.push(o); else gardes.push(o);
  }
  const res = [];
  // cordes : droites dont les deux extrémités reposent sur un cercle/arc conservé (facettes d'un polygone inscrit)
  const sur = (L) => gardes.some(k => (!k.pointille || L.pointille) && L.pts.every(p => Math.abs(Math.hypot(p[0] - k.c[0], p[1] - k.c[1]) - k.r) < 0.08 && dedans(k.pl, angPt(k, p))) && Math.hypot(L.pts[1][0] - L.pts[0][0], L.pts[1][1] - L.pts[0][1]) < 1.2 * k.r);
  const lignes = autres.filter(o => o.kind === 'line' && !sur(o));
  const segs = lignes.map(o => ({ a: o.pts[0], b: o.pts[1], cache: o.pointille, o }));
  const gardL = new Set(epurerSegments(segs).map(q => q.o));
  for (const o of autres) if (o.kind !== 'line' || gardL.has(o)) res.push(o);
  for (const o of gardes) { delete o.pl; res.push(o); }
  return res;
}

// Fusionne les droites colinéaires qui se recouvrent ou se touchent (cercle vu par la tranche, arêtes doublées) ; le plein l'emporte sur le pointillé.
function fusionnerDroites(items) {
  const lignes = items.filter(o => o.kind === 'line'), autres = items.filter(o => o.kind !== 'line');
  const par = new Map(); for (const o of lignes) { const k = o.layer; (par.get(k) ?? par.set(k, []).get(k)).push(o); }
  const res = [...autres];
  const modele = (cache) => lignes.find(o => !!o.pointille === cache);
  const segs = lignes.map(o => ({ a: o.pts[0], b: o.pts[1], cache: !!o.pointille }));
  for (const s of fusionColineaire(segs)) {
    const m = modele(s.cache); const ext = (p) => ({ x: p[0], y: p[1], t: 'extrémité' });
    res.push({ kind: 'line', layer: m.layer, pointille: s.cache, pts: [s.a, s.b], snap: [ext(s.a), ext(s.b), { x: (s.a[0] + s.b[0]) / 2, y: (s.a[1] + s.b[1]) / 2, t: 'milieu' }] });
  }
  return res;
}

// Réunit plusieurs maillages (sommets non soudés entre eux) en un seul.
function fusionner(liste, nFaces) {
  const P = [], T = [], F = []; let base = 0;
  for (const q of liste) { for (const x of q.P) P.push(x); for (const i of q.T) T.push(i + base); for (const f of q.F) F.push(f); base += q.P.length / 3; }
  return finir({ P: Float64Array.from(P), T: Uint32Array.from(T), F: Int32Array.from(F), nFaces });
}

// ——— Hachures d'une section : droites à 45°, règle pair-impair ———
function hachures(boucles, pas) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const B of boucles) for (const [x, y] of B) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const out = [], k0 = y0 - x1, k1 = y1 - x0, d = pas * Math.SQRT2;
  for (let k = Math.ceil(k0 / d) * d; k <= k1; k += d) {   // droites y = x + k
    const xs = [];
    for (const B of boucles) for (let i = 0, j = B.length - 1; i < B.length; j = i++) {
      const [ax, ay] = B[j], [bx, by] = B[i], da = ay - ax - k, db = by - bx - k;
      if ((da < 0) !== (db < 0)) { const t = da / (da - db); xs.push(ax + t * (bx - ax)); }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-3) out.push([[xs[i], xs[i] + k], [xs[i + 1], xs[i + 1] + k]]);
  }
  return out;
}
function boucles2d(segments3d, vue) { // chaîne les segments de coupe 3D en boucles 2D de la vue
  const q = 1e3, pr = p => [dot(p, vue.U), dot(p, vue.V)], k2 = p => `${Math.round(p[0] * q)},${Math.round(p[1] * q)}`;
  const L = segments3d.map(([a, b]) => ({ a: pr(a), b: pr(b) })).filter(s => k2(s.a) !== k2(s.b)), noeuds = new Map();
  L.forEach((s, i) => { for (const k of [k2(s.a), k2(s.b)]) { if (!noeuds.has(k)) noeuds.set(k, []); noeuds.get(k).push(i); } });
  const vu = new Uint8Array(L.length), boucles = [];
  for (let i = 0; i < L.length; i++) {
    if (vu[i]) continue; vu[i] = 1; const pts = [L[i].a, L[i].b]; let cur = i, fin = k2(L[i].b);
    for (;;) { const l = (noeuds.get(fin) || []).filter(j => !vu[j]); if (!l.length) break; const j = l[0]; vu[j] = 1; const s = L[j]; if (k2(s.a) === fin) { pts.push(s.b); fin = k2(s.b); } else { pts.push(s.a); fin = k2(s.a); } cur = j; }
    if (k2(pts[0]) === k2(pts[pts.length - 1]) && pts.length > 3) boucles.push(pts);
  }
  return boucles;
}

// ——— Construction d'une vue (items en repère local de la vue : u, v en mm) ———
function construireVue(m, vue, { coupe = null } = {}) {
  const E = aretes(m);
  // coupe : { segments, w } (plan unique) ou { caps: [{ segments, w, bande }], ignorer } (plans décalés : une bande de la vue par plan)
  const caps = coupe ? (coupe.caps ?? [{ segments: coupe.segments, w: coupe.w }]).map(c => ({ boucles: boucles2d(c.segments, vue), w: c.w, bande: c.bande ?? null })) : null;
  const { chaines, emprise } = chainesVue(m, E, vue, { caps, ignorer: coupe?.ignorer ?? null });
  // En coupe, les arêtes cachées ne sont pas tracées (usage du dessin technique).
  let items = epurerItems(itemsDeChaines(coupe ? chaines.filter(c => !c.cache) : chaines, 'Contours', 'Arêtes cachées'));
  items = fusionnerDroites(items);
  if (caps && caps.some(c => c.boucles.length)) {
    const etendue = Math.max(emprise[2] - emprise[0], emprise[3] - emprise[1]), pas = Math.min(4, Math.max(1, etendue / 40));
    for (const c of caps) for (const [a, b] of hachures(c.boucles, pas)) {
      const h = c.bande ? rogner(a, b, c.bande[0], c.bande[1]) : [a, b];   // hachures de chaque plan limitées à sa bande ; réseau commun donc continu
      if (h) items.push({ kind: 'line', layer: 'Hachures', pointille: false, pts: h, snap: [], hachure: true });
    }
  }
  return { items, emprise };
}
// Rogne un segment (a → b) à la bande x0 ≤ x ≤ x1 ; null s'il n'en reste rien.
function rogner(a, b, x0, x1) {
  if (b[0] < a[0]) [a, b] = [b, a];
  if (b[0] < x0 || a[0] > x1) return null;
  const dx = b[0] - a[0], y = x => a[1] + ((x - a[0]) / (dx || 1)) * (b[1] - a[1]);
  const xa = Math.max(a[0], x0), xb = Math.min(b[0], x1);
  return xb - xa > 1e-3 ? [[xa, dx ? y(xa) : a[1]], [xb, dx ? y(xb) : b[1]]] : null;
}

// Axe de révolution : cercle extérieur d'une vue qui égale son encombrement (± 1 %).
function axeRevolution(vues) {
  const essai = (v) => {
    const b = v.emprise, W = b[2] - b[0], H = b[3] - b[1];
    const cercles = v.items.filter(o => o.kind === 'circle' && !o.pointille).sort((a, c) => c.r - a.r);
    const g = cercles[0]; if (!g) return null;
    if (Math.abs(2 * g.r - W) > 0.01 * W + 0.05 || Math.abs(2 * g.r - H) > 0.01 * H + 0.05) return null;
    return g.c;
  };
  const d = essai(vues.dessus); if (d) return { axe: 'Z', plan: 'XZ', valeur: d[1], c: d };   // Z : plan XZ à Y = cy
  const g = essai(vues.gauche); if (g) return { axe: 'X', plan: 'XZ', valeur: -g[0], c: g };    // X : plan XZ à Y = −u
  const f = essai(vues.face); if (f) return { axe: 'Y', plan: 'YZ', valeur: f[0], c: f };       // Y : plan YZ à X = cx
  return null;
}

// ——— Interface principale ———
export function creerMiseEnPlan(parts, { coupeAuto = true } = {}) {
  const m = preparer(parts);
  if (!m.T.length) throw new Error('Aucune géométrie à projeter.');
  const b3 = boite3d(m);
  const vues = {}; for (const id of Object.keys(VUES)) vues[id] = { id, ...VUES[id], ...construireVue(m, VUES[id]) };
  const W = vues.face.emprise[2] - vues.face.emprise[0], H = vues.face.emprise[3] - vues.face.emprise[1], DP = vues.dessus.emprise[3] - vues.dessus.emprise[1];
  const gap = Math.min(80, Math.max(30, 0.3 * Math.max(W, H, DP)));
  const f = vues.face.emprise, d = vues.dessus.emprise, g = vues.gauche.emprise;
  vues.face.off = [-f[0], -f[1]];                                      // face : coin bas-gauche à l'origine
  vues.dessus.off = [-d[0] - 0 + 0, (f[1] + vues.face.off[1]) - gap - d[3]];  // dessous la vue de face, alignée en X
  vues.dessus.off[0] = vues.face.off[0];
  vues.gauche.off = [(f[2] + vues.face.off[0]) + gap - g[0], vues.face.off[1]];  // à droite, alignée en Z
  const sections = [];
  const etat = { m, b3, vues, sections, gap, items: [], cotes: [] };
  const axe = coupeAuto ? axeRevolution(vues) : null;
  etat.axe = axe;

  const auxiliaires = [], ordre = [];   // ordre : vues supplémentaires (coupes et auxiliaires) dans l'ordre de création ; la mise en page ne bouge plus ensuite
  etat.auxiliaires = auxiliaires; etat.ordre = ordre;
  const lettreLibre = () => { const pris = new Set(ordre.map(q => q.lettre)); for (let i = 0; i < 26; i++) { const l = String.fromCharCode(65 + i); if (!pris.has(l)) return l; } return '?'; };
  const placer = (emprise) => { const prec = ordre.length ? ordre[ordre.length - 1] : null; const dernX = prec ? prec.boite[2] + gap : (g[2] + vues.gauche.off[0]) + gap; return [dernX - emprise[0], vues.face.off[1]]; };
  const caser = (S) => { S.boite = [S.emprise[0] + S.off[0], S.emprise[1] + S.off[1], S.emprise[2] + S.off[0], S.emprise[3] + S.off[1]]; ordre.push(S); return S; };

  etat.ajouterCoupe = (plan, valeur, { auto = false } = {}) => {
    const axeIdx = plan === 'XZ' ? 1 : 0, vueId = plan === 'XZ' ? 'face' : 'gauche', vue = VUES[vueId];
    if (sections.length >= 8 || ordre.length >= 12) throw new Error('Limite de 8 coupes atteinte.');
    if (sections.some(q => q.plan === plan && !q.decalee && Math.abs(q.valeur - valeur) < 0.01)) throw new Error('Cette coupe existe déjà.');
    const { maillage, segments } = decouper(m, axeIdx, valeur);
    if (!maillage.T.length || !segments.length) throw new Error('Le plan de coupe ne rencontre pas la pièce.');
    const v = construireVue(maillage, vue, { coupe: { segments, w: valeur } });
    const lettre = lettreLibre();
    const S = { type: 'coupe', id: `coupe${sections.length + 1}`, nom: `Coupe ${lettre}-${lettre}`, plan, valeur, vueId, auto, lettre, items: v.items, emprise: v.emprise, off: placer(v.emprise) };
    if (auto && axe) S.axeLocal = axe.axe === 'Z' ? { dir: 'V', pos: axe.c[0] + S.off[0] } : { dir: 'H', pos: axe.c[1] + S.off[1] };
    sections.push(S); return caser(S);
  };
  // Coupe décalée (plans parallèles) : plan 'XZ' (Y = valeurs[i], bords = positions X des décrochements) ou 'YZ' (X = valeurs[i], bords = positions Y).
  // La pièce est conservée plan par plan sur sa bande ; les décrochements ne sont pas tracés dans la vue (usage du dessin technique).
  etat.ajouterCoupeDecalee = (plan, valeurs0, bords0) => {
    if (plan !== 'XZ' && plan !== 'YZ') throw new Error('Plan de coupe inconnu.');
    let valeurs = [...valeurs0], bords = [...bords0];
    if (valeurs.length < 2 || valeurs.length > 5 || bords.length !== valeurs.length - 1) throw new Error('Une coupe décalée comporte de 2 à 5 plans, séparés par un décrochement chacun.');
    if (bords.length > 1 && bords[0] > bords[1]) { valeurs.reverse(); bords.reverse(); }
    for (let i = 1; i < bords.length; i++) if (!(bords[i] > bords[i - 1] + 0.01)) throw new Error('Les décrochements doivent se suivre dans un seul sens.');
    for (let i = 1; i < valeurs.length; i++) if (Math.abs(valeurs[i] - valeurs[i - 1]) < 0.01) throw new Error('Deux plans consécutifs sont identiques : ce n’est pas un décrochement.');
    if (sections.length >= 8 || ordre.length >= 12) throw new Error('Limite de 8 coupes atteinte.');
    if (sections.some(q => q.decalee && q.plan === plan && q.valeurs.length === valeurs.length && q.valeurs.every((x, i) => Math.abs(x - valeurs[i]) < 0.01) && q.bords.every((x, i) => Math.abs(x - bords[i]) < 0.01))) throw new Error('Cette coupe existe déjà.');
    const axeIdx = plan === 'XZ' ? 1 : 0, axeBande = plan === 'XZ' ? 0 : 1, vueId = plan === 'XZ' ? 'face' : 'gauche', vue = VUES[vueId], e = 1.7e-5;
    const morceaux = [], caps = [], ignorer = []; let nSeg = 0;
    valeurs.forEach((val, i) => {
      const lo = i > 0 ? bords[i - 1] : -Infinity, hi = i < bords.length ? bords[i] : Infinity;
      const r = couper(m, axeIdx, val + e, 1); nSeg += r.segments.length;
      let mi = r.maillage;
      if (Number.isFinite(lo)) { mi = couper(mi, axeBande, lo + e, 1).maillage; ignorer.push({ axe: axeBande, val: lo + e }); }
      if (Number.isFinite(hi)) { mi = couper(mi, axeBande, hi - e, -1).maillage; ignorer.push({ axe: axeBande, val: hi - e }); }
      morceaux.push(mi);
      const bande = plan === 'XZ' ? [lo, hi] : [-hi, -lo];   // abscisse de la vue : X pour la face, −Y pour la gauche
      caps.push({ segments: r.segments, w: val, bande });
    });
    if (!nSeg) throw new Error('Le plan de coupe ne rencontre pas la pièce.');
    const fusion = fusionner(morceaux, m.nFaces);
    if (!fusion.T.length) throw new Error('Le plan de coupe ne rencontre pas la pièce.');
    const v = construireVue(fusion, vue, { coupe: { caps, ignorer } });
    const lettre = lettreLibre();
    const S = { type: 'coupe', id: `coupe${sections.length + 1}`, nom: `Coupe ${lettre}-${lettre}`, plan, decalee: true, valeur: valeurs[0], valeurs, bords, vueId, auto: false, lettre, items: v.items, emprise: v.emprise, off: placer(v.emprise) };
    sections.push(S); return caser(S);
  };
  // Vue auxiliaire : projection sur un plan perpendiculaire à la vue source et à la droite choisie (a → b, coordonnées locales de la vue source).
  // Le regard est perpendiculaire à la droite, dans le plan de la vue source ; la droite devient l'horizontale de la vue auxiliaire.
  etat.ajouterAuxiliaire = (vueId, a, b, { inverse = false } = {}) => {
    const src = vues[vueId]; if (!src) throw new Error('Vue source inconnue.');
    if (ordre.length >= 12 || auxiliaires.length >= 6) throw new Error('Limite de 6 vues auxiliaires atteinte.');
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 0.5) throw new Error('La droite de référence est trop courte : choisir deux points plus éloignés.');
    let t = [dx / L, dy / L]; if (t[0] < -1e-9 || (Math.abs(t[0]) <= 1e-9 && t[1] < 0)) t = [-t[0], -t[1]];
    let n = [-t[1], t[0]];
    const M = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], e = src.emprise, c = [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2];
    if ((c[0] - M[0]) * n[0] + (c[1] - M[1]) * n[1] < 0) n = [-n[0], -n[1]];   // sens proposé : on regarde la pièce depuis l'extérieur de la droite choisie
    if (inverse) n = [-n[0], -n[1]];
    const comb = (p) => [0, 1, 2].map(k => p[0] * src.U[k] + p[1] * src.V[k]);
    const D = comb(n), U = comb(t), cr = (x, y) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]], Vv = cr(D, U).map(q => -q);
    const vue = { U, V: Vv, D };
    if (auxiliaires.some(q => q.source === vueId && Math.abs(q.regard[0] - n[0]) < 1e-6 && Math.abs(q.regard[1] - n[1]) < 1e-6)) throw new Error('Cette vue auxiliaire existe déjà.');
    const v = construireVue(m, vue);
    if (!v.items.length) throw new Error('Rien à projeter dans cette direction.');
    const lettre = lettreLibre();
    const S = { type: 'auxiliaire', id: `aux${auxiliaires.length + 1}`, nom: `Vue auxiliaire ${lettre}`, lettre, source: vueId, a: [...a], b: [...b], milieu: M, regard: n, angle: Math.atan2(t[1], t[0]) * 180 / Math.PI, vue, items: v.items, emprise: v.emprise, off: placer(v.emprise) };
    auxiliaires.push(S); return caser(S);
  };
  etat.retirerCoupe = () => { const q = sections.pop() ?? null; if (q) ordre.splice(ordre.indexOf(q), 1); return q; };
  etat.retirerAuxiliaire = () => { const q = auxiliaires.pop() ?? null; if (q) ordre.splice(ordre.indexOf(q), 1); return q; };
  const boites = () => [...['face', 'dessus', 'gauche'].map(id => [vues[id].emprise[0] + vues[id].off[0], vues[id].emprise[1] + vues[id].off[1], vues[id].emprise[2] + vues[id].off[0], vues[id].emprise[3] + vues[id].off[1]]), ...ordre.map(q => q.boite)];
  // Le point (feuille) tombe-t-il sur une vue ou une coupe (encombrement) ? Sert à refuser une cote placée sur la pièce.
  etat.dansPiece = (x, y, marge = 0) => boites().some(b => x >= b[0] - marge && x <= b[2] + marge && y >= b[1] - marge && y <= b[3] + marge);
  // Axe de révolution de la coupe qui contient le point (coupe automatique seulement) : { dir:'V'|'H', pos } en coordonnées feuille.
  etat.axeAt = (x, y) => { const q = sections.find(z => z.axeLocal && x >= z.boite[0] - 1e-6 && x <= z.boite[2] + 1e-6 && y >= z.boite[1] - 1e-6 && y <= z.boite[3] + 1e-6); return q ? q.axeLocal : null; };
  if (axe) etat.ajouterCoupe(axe.plan, axe.valeur, { auto: true });

  etat.dessin = () => assembler(etat);
  // Quelle vue contient ce point du plan (repère feuille) ? → coordonnées 3D connues
  etat.vueDe = (x, y, marge = 0) => {
    for (const id of ['face', 'dessus', 'gauche']) {
      const V = vues[id], b = V.emprise, o = V.off;
      if (x >= b[0] + o[0] - marge && x <= b[2] + o[0] + marge && y >= b[1] + o[1] - marge && y <= b[3] + o[1] + marge) {
        const u = x - o[0], w = y - o[1];
        if (id === 'face') return { vue: id, X: u, Z: w, u, v: w };
        if (id === 'dessus') return { vue: id, X: u, Y: w, u, v: w };
        return { vue: id, Y: -u, Z: w, u, v: w };
      }
    }
    return null;
  };
  return etat;
}

const COUL = { 'Contours': '#15202b', 'Arêtes cachées': '#6b7b8c', 'Hachures': '#7a8896', 'Axes': '#d32f2f', 'Plan de coupe': '#d32f2f', 'Titres': '#1f5f8b' };
function assembler(et) {
  const items = [], tr = (p, o) => [p[0] + o[0], p[1] + o[1]];
  const hT = Math.min(10, Math.max(4, 0.035 * Math.max(...['face', 'dessus', 'gauche'].map(id => et.vues[id].emprise[2] - et.vues[id].emprise[0]))));   // hauteur des titres (mm)
  const ajoute = (o, off) => { const c = { ...o, pts: o.pts.map(p => tr(p, off)), snap: (o.snap || []).map(s => ({ ...s, x: s.x + off[0], y: s.y + off[1] })) }; if (o.c) c.c = tr(o.c, off); items.push(c); };
  const texte = (txt, x, y, h, layer = 'Titres', rot = 0) => items.push({ kind: 'text', layer, texte: txt, h, rot, pts: [[x, y]], snap: [], pointille: false });
  const k = hT / 4, ext = 2 * hT;                               // tout le marquage (lettres, flèches, dépassements) suit la taille du dessin
  const z0 = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2).replace('.', ',');
  for (const id of ['face', 'dessus', 'gauche']) { const V = et.vues[id]; for (const o of V.items) ajoute(o, V.off); texte(V.nom, V.emprise[0] + V.off[0], V.emprise[1] + V.off[1] - 4.2 * hT, hT); }
  for (const S of et.sections) {
    for (const o of S.items) ajoute(o, S.off);
    texte(S.nom, S.boite[0], S.boite[1] - 4.2 * hT, hT);
    texte(S.decalee ? `plans ${S.plan} décalés · ${S.plan === 'XZ' ? 'Y' : 'X'} = ${S.valeurs.map(z0).join(' | ')}` : `plan ${S.plan} · ${S.plan === 'XZ' ? 'Y' : 'X'} = ${z0(S.valeur)}${S.auto ? ' · axe' : ''}`, S.boite[0], S.boite[1] - 5.8 * hT, 0.8 * hT);
    const ax = et.axe, marque = (a, b, layer) => items.push({ kind: 'line', layer, pointille: true, pts: [a, b], snap: [], axe: true });
    if (S.auto && ax) {                                        // axe de révolution de la coupe automatique
      if (ax.axe === 'Z') { const x = ax.c[0] + S.off[0]; marque([x, S.emprise[1] + S.off[1] - 1.5 * k * 4], [x, S.emprise[3] + S.off[1] + 1.5 * k * 4], 'Axes'); }
      else { const y = ax.c[1] + S.off[1]; marque([S.emprise[0] + S.off[0] - 1.5 * k * 4, y], [S.emprise[2] + S.off[0] + 1.5 * k * 4, y], 'Axes'); }
    }
    // traits de coupe dans les vues sources, avec lettres et flèches de visée
    const dv = et.vues.dessus, gv = et.vues.gauche, fv = et.vues.face, traits = [];
    if (S.decalee) {   // tracé dans la vue de dessus : plans parallèles reliés par des décrochements perpendiculaires
      const XZ = S.plan === 'XZ', lo = XZ ? dv.emprise[0] + dv.off[0] - ext : dv.emprise[1] + dv.off[1] - ext, hi = XZ ? dv.emprise[2] + dv.off[0] + ext : dv.emprise[3] + dv.off[1] + ext;
      const pos = (c, i) => (XZ ? [c, S.valeurs[i] + dv.off[1]] : [S.valeurs[i] + dv.off[0], c]), bd = S.bords.map(b => b + (XZ ? dv.off[0] : dv.off[1]));
      const chemin = [pos(lo, 0)]; bd.forEach((b, i) => { chemin.push(pos(b, i), pos(b, i + 1)); }); chemin.push(pos(hi, S.valeurs.length - 1));
      items.push({ kind: 'poly', layer: 'Plan de coupe', pointille: true, pts: chemin, snap: [], axe: true });
      chemin.forEach((p, i) => {   // repères épais aux extrémités et aux décrochements
        for (const q of [chemin[i - 1], chemin[i + 1]]) if (q) { const l = Math.hypot(q[0] - p[0], q[1] - p[1]), c = Math.min(6 * k, l / 3); if (l > 1e-6) items.push({ kind: 'line', layer: 'Plan de coupe', pointille: false, epais: true, pts: [p, [p[0] + (q[0] - p[0]) / l * c, p[1] + (q[1] - p[1]) / l * c]], snap: [], axe: true }); }
      });
      traits.push({ a: chemin[0], b: chemin[chemin.length - 1], dir: XZ ? [0, 1] : [1, 0], fleches: true });
    } else if (S.plan === 'XZ') {
      traits.push({ a: [dv.emprise[0] + dv.off[0] - ext, S.valeur + dv.off[1]], b: [dv.emprise[2] + dv.off[0] + ext, S.valeur + dv.off[1]], dir: [0, 1] });
      traits.push({ a: [-S.valeur + gv.off[0], gv.emprise[1] + gv.off[1] - ext], b: [-S.valeur + gv.off[0], gv.emprise[3] + gv.off[1] + ext], dir: [-1, 0] });
    } else {
      traits.push({ a: [S.valeur + dv.off[0], dv.emprise[1] + dv.off[1] - ext], b: [S.valeur + dv.off[0], dv.emprise[3] + dv.off[1] + ext], dir: [1, 0] });
      traits.push({ a: [S.valeur + fv.off[0], fv.emprise[1] + fv.off[1] - ext], b: [S.valeur + fv.off[0], fv.emprise[3] + fv.off[1] + ext], dir: [1, 0] });
    }
    for (const t of traits) {
      if (!t.fleches) items.push({ kind: 'line', layer: 'Plan de coupe', pointille: true, pts: [t.a, t.b], snap: [], axe: true });
      for (const p of [t.a, t.b]) {
        const n = t.dir, q = [-n[1], n[0]], w = 2 * k, tip = [p[0] + n[0] * 8 * k, p[1] + n[1] * 8 * k], base = [p[0] + n[0] * 2 * k, p[1] + n[1] * 2 * k];
        items.push({ kind: 'poly', layer: 'Plan de coupe', pointille: false, plein: true, pts: [tip, [base[0] + q[0] * w, base[1] + q[1] * w], [base[0] - q[0] * w, base[1] - q[1] * w], tip], snap: [], axe: true });
        texte(S.lettre, p[0] + n[0] * 9.5 * k - 0.6 * k * 2.5, p[1] + n[1] * 9.5 * k - 0.6 * k * 2.5, 5 * k, 'Plan de coupe');
      }
    }
  }
  const NOMS = { face: 'vue de face', dessus: 'vue de dessus', gauche: 'vue de gauche' };
  for (const S of et.auxiliaires) {
    for (const o of S.items) ajoute(o, S.off);
    texte(S.nom, S.boite[0], S.boite[1] - 4.2 * hT, hT);
    texte(`regard perpendiculaire à la droite choisie (${NOMS[S.source]}, ${z0(S.angle)}°) · sens proposé`, S.boite[0], S.boite[1] - 5.8 * hT, 0.8 * hT);
    // flèche de visée dans la vue source, sur le prolongement du regard, avec la lettre de la vue
    const sv = et.vues[S.source], bs = [sv.emprise[0] + sv.off[0], sv.emprise[1] + sv.off[1], sv.emprise[2] + sv.off[0], sv.emprise[3] + sv.off[1]];
    const n = S.regard, M = [S.milieu[0] + sv.off[0], S.milieu[1] + sv.off[1]];
    let te = Infinity; for (let i = 0; i < 2; i++) if (Math.abs(n[i]) > 1e-9) te = Math.min(te, n[i] > 0 ? (M[i] - bs[i]) / n[i] : (bs[2 + i] - M[i]) / -n[i]);
    if (!Number.isFinite(te) || te < 0) te = 0;
    const pt = d => [M[0] - n[0] * (te + d * k), M[1] - n[1] * (te + d * k)], q = [-n[1], n[0]], w = 2 * k, tip = pt(3), base = pt(9), queue = pt(20);
    items.push({ kind: 'line', layer: 'Plan de coupe', pointille: false, pts: [queue, base], snap: [], axe: true });
    items.push({ kind: 'poly', layer: 'Plan de coupe', pointille: false, plein: true, pts: [tip, [base[0] + q[0] * w, base[1] + q[1] * w], [base[0] - q[0] * w, base[1] - q[1] * w], tip], snap: [], axe: true });
    const L = pt(24); texte(S.lettre, L[0] - 1.5 * k, L[1] - 2 * k, 5 * k, 'Plan de coupe');
  }
  // Axes des cercles entiers visibles (croix de centre), pour repérer les perçages
  for (const o of [...items]) if (o.kind === 'circle' && !o.pointille && o.r >= 1.5) {
    const [cx, cy] = o.c, r = o.r + 2.5;
    items.push({ kind: 'line', layer: 'Axes', pointille: true, pts: [[cx - r, cy], [cx + r, cy]], snap: [], axe: true });
    items.push({ kind: 'line', layer: 'Axes', pointille: true, pts: [[cx, cy - r], [cx, cy + r]], snap: [], axe: true });
  }
  const calques = new Map();
  items.forEach((o, i) => { o.id = i; if (!calques.has(o.layer)) calques.set(o.layer, { nom: o.layer, rgb: COUL[o.layer] ?? '#15202b', couleur: 7, ltype: o.pointille ? 'DASHED' : 'CONTINUOUS', gele: false, nb: 0 }); calques.get(o.layer).nb++; });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of items) for (const [x, y] of o.pts) { if (o.kind === 'text') continue; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { items, calques: [...calques.values()], cadre: { x0: x0 - 20, y0: y0 - 20, x1: x1 + 20, y1: y1 + 20 }, unite: 'mm', unite_inconnue: false, facteurMm: 1, source: '3d', mise_en_plan: true, ignores: {}, axe: et.axe };
}
