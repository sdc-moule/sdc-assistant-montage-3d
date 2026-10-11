// Typologie des pièces (tournage / fraisage) et dimensions de brut, déduites du maillage. Module pur : ni DOM ni Three.js.
// TOUT ce que ce module produit est PROPOSÉ (valeurs du maillage d'affichage, ≈ 0,05 mm) : jamais un choix de machine
// ni une gamme d'usinage. Une pièce est « ronde » si la quasi-totalité de ses faces latérales est une surface de révolution
// autour d'un même axe (cylindre, cône, tore, sphère…) ; les faces planes perpendiculaires à l'axe sont neutres.

export const TYPES = ['tournage', 'mixte', 'fraisage'];
export const SEUIL_TOURNAGE = 90; // % de surface latérale de révolution : au moins → tournage
export const SEUIL_MIXTE = 50;    // entre les deux seuils → mixte (rond + usinages) ; en dessous → fraisage
export const TOLERANCE_MM = 0.05; // tolérance du maillage appliquée aux comparaisons de dimensions

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const r2 = x => Math.round(x * 100) / 100;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const perp = a => { const ref = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = unit(cross(a, ref)); return [u, cross(a, u)]; };

// ------------------------------------------------------------------ triangles
function triangles(part) {
  const P = part.positions, I = part.index, n = I.length / 3;
  const N = new Float64Array(3 * n), C = new Float64Array(3 * n), A = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) continue; // triangle dégénéré : aire 0
    A[t] = l / 2; N[3 * t] = nx / l; N[3 * t + 1] = ny / l; N[3 * t + 2] = nz / l;
    C[3 * t] = (P[a] + P[b] + P[c]) / 3; C[3 * t + 1] = (P[a + 1] + P[b + 1] + P[c + 1]) / 3; C[3 * t + 2] = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
  }
  return { N, C, A, n };
}

// ------------------------------------------------------------------ repère propre de la pièce (brut)
// Les faces planes les plus étendues donnent les directions du brut ; on garde le repère qui enferme la pièce
// dans la plus petite boîte (repère assemblage ou repère des faces dominantes).
function boite(P, base, origine = [0, 0, 0]) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    const v = [P[i] - origine[0], P[i + 1] - origine[1], P[i + 2] - origine[2]];
    for (let k = 0; k < 3; k++) { const d = dot(v, base[k]); if (d < mn[k]) mn[k] = d; if (d > mx[k]) mx[k] = d; }
  }
  const dims = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const centre = [0, 1, 2].map(i => origine[i] + base.reduce((s, b, k) => s + b[i] * (mn[k] + mx[k]) / 2, 0));
  return { dims, volume: dims[0] * dims[1] * dims[2], centre };
}
function reperePropre(part, T) {
  const clusters = [];
  for (const f of part.faces) {
    let sx = 0, sy = 0, sz = 0, aire = 0;
    for (let t = f.first; t <= f.last; t++) { const w = T.A[t]; sx += T.N[3 * t] * w; sy += T.N[3 * t + 1] * w; sz += T.N[3 * t + 2] * w; aire += w; }
    const l = Math.hypot(sx, sy, sz);
    if (aire <= 0 || l < 0.995 * aire) continue; // face non plane
    const n = [sx / l, sy / l, sz / l], k = clusters.find(c => Math.abs(dot(c.n, n)) > 0.99985);
    if (k) k.aire += aire; else clusters.push({ n, aire });
  }
  clusters.sort((a, b) => b.aire - a.aire);
  const monde = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let base = monde;
  if (clusters.length) {
    const e1 = clusters[0].n, c2 = clusters.find(c => Math.abs(dot(c.n, e1)) < 0.02);
    if (c2) { const e3 = unit(cross(e1, c2.n)); base = [e1, cross(e3, e1), e3]; } else base = [e1, ...perp(e1)];
  }
  const bm = boite(part.positions, monde), bb = boite(part.positions, base);
  return bb.volume < bm.volume * 0.999 ? { base, ...bb } : { base: monde, ...bm };
}

// ------------------------------------------------------------------ taux de révolution autour d'un axe candidat
// Un triangle appartient à une surface de révolution d'axe a si sa normale est dans le plan (a, r̂) : n·(a × r̂) ≈ 0.
function tauxRevolution(T, a, p) {
  let lat = 0, rev = 0;
  for (let t = 0; t < T.n; t++) {
    const w = T.A[t]; if (!w) continue;
    const nx = T.N[3 * t], ny = T.N[3 * t + 1], nz = T.N[3 * t + 2];
    if (Math.abs(nx * a[0] + ny * a[1] + nz * a[2]) > 0.985) continue; // face plane perpendiculaire à l'axe : neutre
    const dx = T.C[3 * t] - p[0], dy = T.C[3 * t + 1] - p[1], dz = T.C[3 * t + 2] - p[2], h = dx * a[0] + dy * a[1] + dz * a[2];
    const rx = dx - h * a[0], ry = dy - h * a[1], rz = dz - h * a[2], rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-6) continue; // sur l'axe : direction radiale indéfinie
    lat += w;
    const tx = (a[1] * rz - a[2] * ry) / rl, ty = (a[2] * rx - a[0] * rz) / rl, tz = (a[0] * ry - a[1] * rx) / rl;
    if (Math.abs(nx * tx + ny * ty + nz * tz) < 0.06) rev += w;
  }
  return lat > 1e-9 ? rev / lat : 0;
}

/**
 * Typologie d'une pièce : { type, revolution_pct, axe, diametre_mm, longueur_mm, brut_mm, dim_max_mm, dim_min_mm }.
 * cyl (facultatif) : résultat de extractCylinders(part) ; sert à proposer les axes réels des cylindres.
 */
export function analyserTypologie(part, cyl) {
  const T = triangles(part), rep = reperePropre(part, T);
  const cands = [];
  const cylindres = [...(cyl?.bosses ?? []), ...(cyl?.holes ?? [])].sort((x, y) => y.diameter * y.length - x.diameter * x.length).slice(0, 4);
  for (const c of cylindres) cands.push({ a: unit(c.axis), p: c.start });
  for (const a of rep.base) cands.push({ a, p: rep.centre });
  let best = { taux: -1 };
  for (const c of cands) { const taux = tauxRevolution(T, c.a, c.p); if (taux > best.taux + 0.005) best = { taux, ...c }; }
  const pct = Math.round(Math.max(0, best.taux) * 1000) / 10;
  const type = pct >= SEUIL_TOURNAGE ? 'tournage' : pct >= SEUIL_MIXTE ? 'mixte' : 'fraisage';
  const res = { type, revolution_pct: pct, axe: null, diametre_mm: null, longueur_mm: null };
  let brut = [...rep.dims];
  if (type !== 'fraisage') {
    const P = part.positions; let rmax = 0, hmin = Infinity, hmax = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      const dx = P[i] - best.p[0], dy = P[i + 1] - best.p[1], dz = P[i + 2] - best.p[2], h = dx * best.a[0] + dy * best.a[1] + dz * best.a[2];
      rmax = Math.max(rmax, Math.hypot(dx - h * best.a[0], dy - h * best.a[1], dz - h * best.a[2])); if (h < hmin) hmin = h; if (h > hmax) hmax = h;
    }
    res.axe = best.a.map(x => Math.round(x * 1e4) / 1e4); res.diametre_mm = r2(2 * rmax); res.longueur_mm = r2(hmax - hmin);
    if (type === 'tournage') brut = [res.diametre_mm, res.diametre_mm, res.longueur_mm]; // barre Ø × longueur
  }
  res.brut_mm = brut.map(r2).sort((x, y) => y - x);
  res.dim_max_mm = res.brut_mm[0]; res.dim_min_mm = res.brut_mm[2];
  return res;
}

// ------------------------------------------------------------------ filtre (partagé par la fenêtre de saisie et les commandes JSON)
const PLAGES = { diametre_mm: 'diametre_mm', longueur_mm: 'longueur_mm', plus_grande_dim_mm: 'dim_max_mm', plus_petite_dim_mm: 'dim_min_mm' };
export const CLES_CRITERES = ['type', 'famille', 'sauf_famille', 'nom', ...Object.keys(PLAGES)];
const ALIAS_TYPE = { tournage: 'tournage', tourne: 'tournage', rond: 'tournage', ronde: 'tournage', ronds: 'tournage', revolution: 'tournage', fraisage: 'fraisage', prismatique: 'fraisage', prismatiques: 'fraisage', mixte: 'mixte' };
export const normaliserType = v => ALIAS_TYPE[norm(v)] ?? null;

/** Message d'erreur (texte) si les critères sont invalides, sinon null. Les clés étrangères sont ignorées. */
export function validerCriteres(c) {
  if (c.type !== undefined) {
    const l = Array.isArray(c.type) ? c.type : [c.type];
    if (!l.length) return '« type » : au moins une valeur attendue (tournage, fraisage, mixte).';
    for (const t of l) if (typeof t !== 'string' || !normaliserType(t)) return `« type » : « ${t} » inconnu. Admis : tournage, fraisage (ou prismatique), mixte.`;
  }
  for (const k of ['famille', 'sauf_famille', 'nom']) if (c[k] !== undefined && !(typeof c[k] === 'string' && c[k].trim())) return `« ${k} » : texte non vide attendu.`;
  for (const k of Object.keys(PLAGES)) {
    const r = c[k]; if (r === undefined) continue;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return `« ${k} » : plage {"min": …, "max": …} attendue (mm).`;
    const ks = Object.keys(r);
    if (!ks.length || ks.some(x => x !== 'min' && x !== 'max')) return `« ${k} » : seules les clés min et max sont admises, au moins une.`;
    for (const x of ks) if (!Number.isFinite(r[x]) || r[x] < 0) return `« ${k}.${x} » : nombre positif attendu (mm).`;
    if (r.min !== undefined && r.max !== undefined && r.min > r.max) return `« ${k} » : mini (${r.min}) supérieur au maxi (${r.max}).`;
  }
  return null;
}

/** La pièce (enregistrement : type_usinage, diametre_mm, dim_max_mm, famille, famille_label, nom…) respecte-t-elle les critères ? */
export function correspond(p, c) {
  if (c.type !== undefined && !(Array.isArray(c.type) ? c.type : [c.type]).map(normaliserType).includes(p.type_usinage)) return false;
  for (const [k, champ] of Object.entries(PLAGES)) {
    const r = c[k]; if (r === undefined) continue;
    const v = p[champ]; if (v === null || v === undefined) return false; // Ø et longueur n'existent que pour les pièces rondes
    if (r.min !== undefined && v < r.min - TOLERANCE_MM) return false;
    if (r.max !== undefined && v > r.max + TOLERANCE_MM) return false;
  }
  if (c.nom && !norm(p.nom).includes(norm(c.nom))) return false;
  if (c.famille) { const t = norm(c.famille); if (!(norm(p.famille) === t || norm(p.famille_label).startsWith(t) || norm(p.famille_label).includes(t))) return false; }
  if (c.sauf_famille) { const t = norm(c.sauf_famille); if (norm(p.famille) === t || norm(p.famille_label).startsWith(t)) return false; }
  return true;
}

/** Résumé lisible des critères (origine d'un groupe créé depuis le filtre). */
export function resumeCriteres(c) {
  const parts = [];
  if (c.type !== undefined) parts.push((Array.isArray(c.type) ? c.type : [c.type]).map(normaliserType).join(' + '));
  const lib = { diametre_mm: 'Ø', longueur_mm: 'longueur', plus_grande_dim_mm: 'plus grande dim.', plus_petite_dim_mm: 'plus petite dim.' };
  for (const [k, l] of Object.entries(lib)) { const r = c[k]; if (!r) continue; parts.push(`${l}${r.min !== undefined ? ' ≥ ' + r.min : ''}${r.min !== undefined && r.max !== undefined ? ' et' : ''}${r.max !== undefined ? ' ≤ ' + r.max : ''} mm`); }
  if (c.famille) parts.push(`famille « ${c.famille} »`);
  if (c.sauf_famille) parts.push(`sans ${c.sauf_famille}`);
  if (c.nom) parts.push(`nom contient « ${c.nom} »`);
  return parts.length ? 'Filtre : ' + parts.join(' · ') : 'Toutes les pièces';
}
