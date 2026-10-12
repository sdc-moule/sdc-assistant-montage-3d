// Lecture DXF 2D (texte ASCII) — code géométrique pur, sans DOM ni Three.js, testable sous Node.
// Entités : LINE, CIRCLE, ARC, ELLIPSE, SPLINE, LWPOLYLINE, POLYLINE/VERTEX, TEXT, MTEXT, INSERT (blocs).
// Tout est ramené dans le plan XY (Z ignoré). Lecture seule : le fichier n'est jamais modifié.

const UNITES = { 0: '', 1: 'po', 2: 'pi', 4: 'mm', 5: 'cm', 6: 'm', 10: 'yd' };
const MM = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };

export function decoderTexte(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let txt = new TextDecoder('utf-8').decode(u8);
  // Pas de UTF-8 valide (caractère de remplacement) → page ANSI 1252, courante dans les DXF anciens.
  if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(u8);
  return txt;
}

export function estDxf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const t = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 4096)));
  return /^\s*0\s*\r?\n\s*SECTION/.test(t) || /\n\s*SECTION\s*\r?\n\s*2\s*\r?\n\s*(HEADER|ENTITIES|TABLES|BLOCKS|CLASSES)/.test(t);
}

function paires(txt) {
  const L = txt.split(/\r?\n/), out = [];
  for (let i = 0; i + 1 < L.length; i += 2) {
    const c = parseInt(L[i].trim(), 10);
    if (Number.isNaN(c)) continue;
    out.push([c, L[i + 1].trim()]);
  }
  return out;
}

// Regroupe les paires en entités : [{type, g:[[code,valeur]...]}], par section.
function sections(p) {
  const sec = {}; let cur = null, nom = null, ent = null;
  for (const [c, v] of p) {
    if (c === 0 && v === 'SECTION') { nom = null; cur = null; ent = null; continue; }
    if (c === 2 && nom === null && cur === null) { nom = v; cur = (sec[nom] = []); continue; }
    if (c === 0 && v === 'ENDSEC') { cur = null; nom = null; ent = null; continue; }
    if (!cur) continue;
    if (c === 0) { ent = { type: v, g: [] }; cur.push(ent); } else if (ent) ent.g.push([c, v]);
  }
  return sec;
}

const num = (g, code, def = 0) => { for (const [c, v] of g) if (c === code) { const x = parseFloat(v.replace('D', 'E')); return Number.isFinite(x) ? x : def; } return def; };
const str = (g, code, def = '') => { for (const [c, v] of g) if (c === code) return v; return def; };
const toutes = (g, code) => g.filter(([c]) => c === code).map(([, v]) => parseFloat(v));

// OCS → monde : algorithme « arbitrary axis » de la norme DXF. Seul le sens de Z compte pour un dessin 2D :
// une normale (0,0,-1) retourne l'axe X.
function sensX(g) { return num(g, 230, 1) < 0 ? -1 : 1; }

const TWO_PI = Math.PI * 2;

function arcPts(cx, cy, rx, ry, rot, t0, t1, pas = 0.05) {
  let d = t1 - t0; while (d <= 0) d += TWO_PI;
  const n = Math.max(8, Math.ceil(d / pas)), c = Math.cos(rot), s = Math.sin(rot), out = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (d * i) / n, x = rx * Math.cos(t), y = ry * Math.sin(t);
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}

// B-spline (de Boor) avec poids éventuels (NURBS).
function splinePts(deg, noeuds, ctrl, poids) {
  const n = ctrl.length - 1, p = deg;
  if (n < p || noeuds.length !== n + p + 2) return ctrl.slice();
  const t0 = noeuds[p], t1 = noeuds[n + 1], N = Math.max(24, Math.min(600, ctrl.length * 24)), out = [];
  for (let k = 0; k <= N; k++) {
    const u = k === N ? t1 - 1e-12 : t0 + ((t1 - t0) * k) / N;
    let s = p; while (s < n && u >= noeuds[s + 1]) s++;
    const d = []; for (let j = 0; j <= p; j++) { const w = poids[s - p + j] ?? 1; d.push([ctrl[s - p + j][0] * w, ctrl[s - p + j][1] * w, w]); }
    for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
      const den = noeuds[j + 1 + s - r] - noeuds[j + s - p]; const a = den === 0 ? 0 : (u - noeuds[j + s - p]) / den;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
    }
    out.push([d[p][0] / d[p][2], d[p][1] / d[p][2]]);
  }
  return out;
}

function bulgeArc(a, b, bulge, pas = 0.05) {
  const dx = b[0] - a[0], dy = b[1] - a[1], c = Math.hypot(dx, dy);
  if (!c || !bulge) return [a, b];
  const th = 4 * Math.atan(bulge), r = c / (2 * Math.sin(th / 2)), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const h = r * Math.cos(th / 2), cx = mx - (dy / c) * h, cy = my + (dx / c) * h;
  const a0 = Math.atan2(a[1] - cy, a[0] - cx), n = Math.max(2, Math.ceil(Math.abs(th) / pas)), out = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (th * i) / n; out.push([cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)]); }
  return out;
}

// Transformation affine 2D [a b c d e f] : x' = a·x + c·y + e ; y' = b·x + d·y + f
const ID = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const apv = (m, p) => [m[0] * p[0] + m[2] * p[1], m[1] * p[0] + m[3] * p[1]];
const det = m => m[0] * m[3] - m[1] * m[2];

// Convertit une entité en objets de dessin : { kind, layer, pts (tracé), snap, ... }.
function convertir(e, m, ctx, prof) {
  const g = e.g, layer = str(g, 8, '0'), out = [];
  const T = (x, y) => ap(m, [x, y]);
  const sx = sensX(g);
  switch (e.type) {
    case 'LINE': {
      const a = T(num(g, 10), num(g, 20)), b = T(num(g, 11), num(g, 21));
      out.push({ kind: 'line', layer, pts: [a, b], snap: [{ x: a[0], y: a[1], t: 'extrémité' }, { x: b[0], y: b[1], t: 'extrémité' }, { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, t: 'milieu' }] });
      break;
    }
    case 'CIRCLE': case 'ARC': {
      // Calcul dans le repère propre à l'entité (OCS), puis miroir en X si la normale pointe vers -Z.
      const W = q => ap(m, [sx * q[0], q[1]]);
      const cx = num(g, 10), cy = num(g, 20), r = num(g, 40), arc = e.type === 'ARC';
      const t0 = arc ? (num(g, 50) * Math.PI) / 180 : 0; let t1 = arc ? (num(g, 51) * Math.PI) / 180 : TWO_PI;
      while (t1 <= t0) t1 += TWO_PI;
      const pts = arcPts(cx, cy, r, r, 0, t0, t1).map(W), c = W([cx, cy]), k = Math.sqrt(Math.abs(det(m))) || 1;
      const o = { kind: arc ? 'arc' : 'circle', layer, pts, c, r: r * k, snap: [{ x: c[0], y: c[1], t: 'centre' }] };
      if (arc) o.snap.push({ x: pts[0][0], y: pts[0][1], t: 'extrémité' }, { x: pts.at(-1)[0], y: pts.at(-1)[1], t: 'extrémité' });
      else for (let q = 0; q < 4; q++) { const P = W([cx + r * Math.cos(q * Math.PI / 2), cy + r * Math.sin(q * Math.PI / 2)]); o.snap.push({ x: P[0], y: P[1], t: 'quadrant' }); }
      out.push(o); break;
    }
    case 'ELLIPSE': {
      // Centre et axe majeur sont en coordonnées MONDE (pas en OCS). La normale -Z inverse le sens de balayage
      // du paramètre (anti-horaire autour de la normale) : le petit axe est orienté par N × axe majeur.
      const W = q => ap(m, q);
      const cx = num(g, 10), cy = num(g, 20), mx = num(g, 11), my = num(g, 21), ratio = num(g, 40, 1);
      const t0 = num(g, 41, 0), t1 = num(g, 42, TWO_PI);
      const rx = Math.hypot(mx, my), ry = rx * ratio * sx, rot = Math.atan2(my, mx);
      const pts = arcPts(cx, cy, rx, ry, rot, t0, t1).map(W), c = W([cx, cy]), k = Math.sqrt(Math.abs(det(m))) || 1;
      const d = (((t1 - t0) % TWO_PI) + TWO_PI) % TWO_PI;
      const entiere = d < 1e-6 || Math.abs(d - TWO_PI) < 1e-6;
      const rond = Math.abs(ratio - 1) < 1e-6;
      const o = { kind: rond ? (entiere ? 'circle' : 'arc') : 'ellipse', layer, pts, c, snap: [{ x: c[0], y: c[1], t: 'centre' }] };
      if (rond) o.r = rx * k;
      if (!entiere) o.snap.push({ x: pts[0][0], y: pts[0][1], t: 'extrémité' }, { x: pts.at(-1)[0], y: pts.at(-1)[1], t: 'extrémité' });
      out.push(o); break;
    }
    case 'SPLINE': {
      const deg = num(g, 71, 3), kn = toutes(g, 40), wt = toutes(g, 41);
      const xs = toutes(g, 10), ys = toutes(g, 20), ctrl = xs.map((x, i) => [x, ys[i] ?? 0]);
      const bruts = splinePts(deg, kn, ctrl, wt.length === ctrl.length ? wt : []);
      const pts = bruts.map(q => ap(m, q));
      out.push({ kind: 'spline', layer, pts, snap: [{ x: pts[0][0], y: pts[0][1], t: 'extrémité' }, { x: pts.at(-1)[0], y: pts.at(-1)[1], t: 'extrémité' }] });
      break;
    }
    case 'LWPOLYLINE': {
      const v = []; let cur = null;
      for (const [c, val] of g) {
        if (c === 10) { cur = { x: parseFloat(val), y: 0, b: 0 }; v.push(cur); } else if (c === 20 && cur) cur.y = parseFloat(val); else if (c === 42 && cur) cur.b = parseFloat(val);
      }
      polyligne(v, (num(g, 70) & 1) === 1, layer, m, out); break;
    }
    case 'TEXT': case 'MTEXT': {
      const t = str(g, 1).replace(/\\P/g, ' ').replace(/\{?\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '');
      if (t.trim()) { const p = T(num(g, 10), num(g, 20)); out.push({ kind: 'text', layer, texte: t, h: num(g, 40, 2.5) * (Math.sqrt(Math.abs(det(m))) || 1), pts: [p], snap: [] }); }
      break;
    }
    case 'INSERT': {
      const b = ctx.blocs[str(g, 2)];
      if (!b || prof > 6) break;
      const rot = (num(g, 50) * Math.PI) / 180, sxx = num(g, 41, 1), syy = num(g, 42, 1), c = Math.cos(rot), s = Math.sin(rot);
      const loc = [c * sxx, s * sxx, -s * syy, c * syy, num(g, 10), num(g, 20)];
      const mm = mul(m, mul(loc, [1, 0, 0, 1, -b.base[0], -b.base[1]]));
      for (const sub of b.ents) for (const o of convertir(sub, mm, ctx, prof + 1)) { if (layer !== '0' && o.layer === '0') o.layer = layer; out.push(o); }
      break;
    }
    default: break;
  }
  return out;
}

function polyligne(v, ferme, layer, m, out) {
  if (v.length < 2) return;
  const pts = []; const n = ferme ? v.length : v.length - 1;
  for (let i = 0; i < n; i++) {
    const a = [v[i].x, v[i].y], b = [v[(i + 1) % v.length].x, v[(i + 1) % v.length].y];
    const seg = bulgeArc(a, b, v[i].b); if (pts.length) seg.shift(); pts.push(...seg);
  }
  const P = pts.map(q => ap(m, q));
  out.push({ kind: 'poly', layer, pts: P, snap: v.map(q => { const r = ap(m, [q.x, q.y]); return { x: r[0], y: r[1], t: 'extrémité' }; }) });
}

// ——— Lecture principale ———
export function lireDxf(source) {
  const txt = typeof source === 'string' ? source : decoderTexte(source);
  const p = paires(txt), sec = sections(p);
  if (!sec.ENTITIES) throw new Error('Fichier DXF sans section ENTITIES (non reconnu).');

  // Unités
  let insunits = 0;
  for (let i = 0; i < p.length - 1; i++) if (p[i][0] === 9 && p[i][1] === '$INSUNITS') { insunits = parseInt(p[i + 1][1], 10) || 0; break; }
  const unite = UNITES[insunits] ?? '';
  const facteurMm = MM[insunits] ?? 1;

  // Calques
  const calques = new Map();
  const ajoutCalque = (nom, o = {}) => { if (!calques.has(nom)) calques.set(nom, { nom, couleur: o.couleur ?? 7, ltype: o.ltype ?? 'CONTINUOUS', gele: !!o.gele, nb: 0 }); };
  const tables = sec.TABLES ?? [];
  for (const t of tables) if (t.type === 'LAYER') { const f = num(t.g, 70); ajoutCalque(str(t.g, 2), { couleur: Math.abs(num(t.g, 62, 7)), ltype: str(t.g, 6, 'CONTINUOUS'), gele: (f & 1) === 1 || num(t.g, 62, 7) < 0 }); }

  // Blocs
  const blocs = {}; let bc = null;
  for (const e of sec.BLOCKS ?? []) {
    if (e.type === 'BLOCK') { bc = { base: [num(e.g, 10), num(e.g, 20)], ents: [] }; blocs[str(e.g, 2)] = bc; } else if (e.type === 'ENDBLK') bc = null; else if (bc) bc.ents.push(e);
  }

  // POLYLINE/VERTEX (ancien format) → LWPOLYLINE équivalente
  const ents = []; let poly = null;
  for (const e of sec.ENTITIES) {
    if (e.type === 'POLYLINE') { poly = { type: 'POLYLINE', g: e.g, v: [] }; } else if (e.type === 'VERTEX' && poly) { poly.v.push({ x: num(e.g, 10), y: num(e.g, 20), b: num(e.g, 42) }); } else if (e.type === 'SEQEND' && poly) {
      ents.push({ type: 'LWPOLYLINE', g: [[8, str(poly.g, 8, '0')], [70, String(num(poly.g, 70) & 1)], ...poly.v.flatMap(q => [[10, String(q.x)], [20, String(q.y)], [42, String(q.b)]])] }); poly = null;
    } else ents.push(e);
  }

  const items = [], ignores = new Map();
  const connus = new Set(['LINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE', 'LWPOLYLINE', 'TEXT', 'MTEXT', 'INSERT']);
  for (const e of ents) {
    if (!connus.has(e.type)) { ignores.set(e.type, (ignores.get(e.type) ?? 0) + 1); continue; }
    const lt = str(e.g, 6, '');
    for (const o of convertir(e, ID, { blocs }, 0)) { o.ltype = lt; items.push(o); ajoutCalque(o.layer); }
  }
  const cachee = t => /HIDDEN|DASH|CACH|PHANT|CENTER/i.test(t || '');
  items.forEach((o, i) => { o.id = i; calques.get(o.layer).nb++; o.pointille = cachee(o.ltype && o.ltype.toUpperCase() !== 'BYLAYER' ? o.ltype : calques.get(o.layer).ltype); });

  // Cadre
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of items) for (const [x, y] of o.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!Number.isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }

  return { items, calques: [...calques.values()], cadre: { x0, y0, x1, y1 }, unite, unite_inconnue: insunits === 0, facteurMm, ignores: Object.fromEntries(ignores) };
}

// ——— Mesures (fonctions pures, utilisées par la vue 2D et testées sous Node) ———
export const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const angleEntre = (s, a, b) => { // angle en degrés au sommet s entre s→a et s→b (0–180)
  const u = [a.x - s.x, a.y - s.y], v = [b.x - s.x, b.y - s.y], n = Math.hypot(...u) * Math.hypot(...v);
  if (!n) return 0; return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / n))) * 180) / Math.PI;
};

// Point d'accroche le plus proche (rayon en unités du dessin). Ajoute les intersections segment/segment.
export function accroche(dessin, x, y, rayon, filtre = () => true) {
  let best = null, bd = rayon;
  for (const o of dessin.items) {
    if (!filtre(o)) continue;
    for (const s of o.snap) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = { ...s, item: o.id }; } }
  }
  // Intersections entre lignes proches du curseur
  const prox = dessin.items.filter(o => filtre(o) && o.kind !== 'text' && distanceItem(o, x, y) < rayon * 4);
  for (let i = 0; i < prox.length; i++) for (let j = i + 1; j < prox.length; j++) {
    for (const q of intersections(prox[i], prox[j])) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd * 0.9) { bd = d; best = { x: q[0], y: q[1], t: 'intersection', item: prox[i].id }; } }
  }
  return best;
}

export function distanceItem(o, x, y) {
  let d = Infinity; const P = o.pts;
  for (let i = 0; i + 1 < P.length; i++) d = Math.min(d, distSeg(P[i], P[i + 1], x, y));
  if (P.length === 1) d = Math.hypot(P[0][0] - x, P[0][1] - y);
  return d;
}
function distSeg(a, b, x, y) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)) : 0;
  return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
}
function intersections(A, B) {
  const out = [], pa = A.pts, pb = B.pts;
  if (pa.length * pb.length > 4000) return out;
  for (let i = 0; i + 1 < pa.length; i++) for (let j = 0; j + 1 < pb.length; j++) {
    const r = interSeg(pa[i], pa[i + 1], pb[j], pb[j + 1]); if (r) out.push(r);
  }
  return out;
}
function interSeg(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

// Entité la plus proche du curseur (pour mesurer un Ø / R).
export function entiteProche(dessin, x, y, rayon, filtre = () => true) {
  let best = null, bd = rayon;
  for (const o of dessin.items) { if (!filtre(o) || o.kind === 'text') continue; const d = distanceItem(o, x, y); if (d < bd) { bd = d; best = o; } }
  return best;
}
