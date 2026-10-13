// Reconnaissance d'écriture manuscrite hors ligne : chiffres, symboles de cotation (Ø × ± ° , . - +) et lettres majuscules.
// Module pur (sans DOM), testable sous Node. Méthode : nuage de points ($P, Vatavu 2012) comparé à des modèles de tracés générés ici.
// Le résultat est une PROPOSITION (« proposé, à vérifier ») : l'opérateur la corrige dans une zone de texte avant qu'elle soit retenue.
// Limites : pas de minuscules (lues comme majuscules), O/I/Q lus 0/1 ; lettres moins fiables que chiffres ; non évalué sur des écritures réelles.

const rad = d => d * Math.PI / 180;
const ar = (cx, cy, rx, ry, a0, a1, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const a = rad(a0 + (a1 - a0) * i / n); return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
const rot180 = ss => ss.map(s => s.map(([x, y]) => [0.6 - x, 1 - y]));

// Modèles : { c: caractère, s: [tracés] } dans un cadre de hauteur 1 (axe Y vers le haut). Plusieurs variantes par caractère.
const six = [[[.5, 1], [.25, .8], [.05, .45], [.02, .3], ...ar(.3, .3, .28, .3, 180, -180, 16)]];
const trois = [[...ar(.28, .76, .26, .24, 150, -90, 10), ...ar(.28, .27, .3, .27, 90, -150, 12)]];
const GLYPHES = [
  { c: '0', s: [ar(.3, .5, .3, .5, 90, 450, 18)] }, { c: '0', s: [ar(.3, .5, .3, .5, 90, -270, 18)] },
  { c: '1', s: [[[.3, 1], [.3, 0]]] }, { c: '1', s: [[[.1, .8], [.3, 1], [.3, 0]]] }, { c: '1', s: [[[.1, .8], [.3, 1], [.3, 0]], [[.1, 0], [.5, 0]]] },
  { c: '2', s: [[...ar(.3, .72, .28, .28, 160, -35, 10), [0, 0], [.6, 0]]] }, { c: '2', s: [[[.02, .78], [.15, .98], [.4, 1], [.58, .82], [.5, .6], [0, 0], [.6, 0]]] },
  { c: '2', s: [[...ar(.3, .7, .3, .3, 180, -20, 10), [.55, .5], [.1, .1], [0, 0], [.62, 0]]] },
  { c: '3', s: trois }, { c: '3', s: [[[.05, 1], [.55, 1], [.25, .6], ...ar(.28, .3, .3, .3, 100, -150, 12)]] },
  { c: '4', s: [[[.45, 0], [.45, 1], [0, .3], [.6, .3]]] }, { c: '4', s: [[[.5, 1], [0, .3], [.6, .3]], [[.45, .62], [.45, 0]]] }, { c: '4', s: [[[0, 1], [0, .3], [.6, .3]], [[.45, .65], [.45, 0]]] },
  { c: '5', s: [[[.55, 1], [.1, 1], [.05, .55], ...ar(.3, .32, .3, .31, 125, -140, 12)]] }, { c: '5', s: [[[.1, 1], [.1, .55]], [[.55, 1], [.1, 1]], ar(.3, .32, .3, .31, 125, -140, 12)] },
  { c: '6', s: six }, { c: '6', s: [[...ar(.3, .3, .28, .3, 180, -180, 16)], [[.5, 1], [.2, .75], [.02, .35]]] },
  { c: '7', s: [[[0, 1], [.6, 1], [.2, 0]]] }, { c: '7', s: [[[0, 1], [.6, 1], [.2, 0]], [[.12, .5], [.45, .5]]] },
  { c: '8', s: [[...ar(.3, .76, .25, .24, -90, 270, 14), ...ar(.3, .27, .3, .27, 90, -270, 16)]] }, { c: '8', s: [ar(.3, .76, .25, .24, 0, 360, 14), ar(.3, .27, .3, .27, 0, 360, 16)] },
  { c: '9', s: rot180(six) }, { c: '9', s: rot180([[...ar(.3, .3, .28, .3, 180, -180, 16)], [[.5, 1], [.2, .75], [.02, .35]]]) },
  { c: 'Ø', s: [ar(.3, .5, .3, .5, 90, 450, 18), [[-.05, -.05], [.65, 1.05]]] }, { c: 'Ø', s: [ar(.3, .5, .3, .5, 90, 450, 18), [[.65, 1.05], [-.05, -.05]]] },
  { c: '×', s: [[[0, 1], [.6, 0]], [[0, 0], [.6, 1]]] },
  { c: '+', s: [[[.3, .1], [.3, .9]], [[0, .5], [.6, .5]]] },
  { c: '±', s: [[[.3, .5], [.3, 1]], [[0, .75], [.6, .75]], [[0, .2], [.6, .2]]] },
  // lettres majuscules
  { c: 'A', s: [[[0, 0], [.3, 1], [.6, 0]], [[.12, .4], [.48, .4]]] },
  { c: 'B', s: [[[0, 1], [0, 0]], [[0, 1], [.28, 1], ...ar(.28, .75, .27, .25, 90, -90, 8), [0, .5]], [[.28, .5], ...ar(.28, .25, .32, .25, 90, -90, 8), [0, 0]]] },
  { c: 'B', s: [[[0, 0], [0, 1], [.28, 1], ...ar(.28, .75, .27, .25, 90, -90, 8), [0, .5], [.28, .5], ...ar(.28, .25, .32, .25, 90, -90, 8), [0, 0]]] },
  { c: 'C', s: [ar(.35, .5, .35, .5, 40, 320, 16)] },
  { c: 'D', s: [[[0, 1], [0, 0]], [[0, 1], [.2, 1], ...ar(.2, .5, .4, .5, 90, -90, 12), [0, 0]]] }, { c: 'D', s: [[[0, 1], [0, 0], [.2, 0], ...ar(.2, .5, .4, .5, -90, 90, 12), [0, 1]]] },
  { c: 'E', s: [[[.55, 1], [0, 1], [0, 0], [.55, 0]], [[0, .5], [.4, .5]]] },
  { c: 'F', s: [[[.55, 1], [0, 1], [0, 0]], [[0, .5], [.4, .5]]] },
  { c: 'G', s: [[...ar(.35, .5, .35, .5, 40, 355, 16), [.38, .47]]] },
  { c: 'H', s: [[[0, 0], [0, 1]], [[.6, 0], [.6, 1]], [[0, .5], [.6, .5]]] },
  { c: 'J', s: [[[.5, 1], [.5, .25], ...ar(.25, .25, .25, .25, 0, -180, 8)]] },
  { c: 'K', s: [[[0, 0], [0, 1]], [[.55, 1], [0, .45]], [[.15, .6], [.6, 0]]] },
  { c: 'L', s: [[[0, 1], [0, 0], [.5, 0]]] },
  { c: 'M', s: [[[0, 0], [0, 1], [.4, .35], [.8, 1], [.8, 0]]] },
  { c: 'N', s: [[[0, 0], [0, 1], [.6, 0], [.6, 1]]] },
  { c: 'P', s: [[[0, 0], [0, 1], [.3, 1], ...ar(.3, .74, .28, .26, 90, -90, 8), [0, .48]]] },
  { c: 'R', s: [[[0, 0], [0, 1], [.3, 1], ...ar(.3, .74, .28, .26, 90, -90, 8), [0, .48]], [[.25, .48], [.6, 0]]] },
  { c: 'R', s: [[[0, 0], [0, 1], [.3, 1], ...ar(.3, .74, .28, .26, 90, -90, 8), [0, .48], [.25, .48], [.6, 0]]] },
  { c: 'S', s: [[...ar(.3, .75, .3, .25, 30, 270, 10), ...ar(.3, .27, .3, .27, 90, -150, 12)]] },
  { c: 'T', s: [[[0, 1], [.7, 1]], [[.35, 1], [.35, 0]]] },
  { c: 'U', s: [[[0, 1], [0, .25], ...ar(.3, .25, .3, .25, 180, 360, 10), [.6, 1]]] },
  { c: 'V', s: [[[0, 1], [.3, 0], [.6, 1]]] },
  { c: 'W', s: [[[0, 1], [.2, 0], [.4, .6], [.6, 0], [.8, 1]]] },
  { c: 'Y', s: [[[0, 1], [.3, .5], [.6, 1]], [[.3, .5], [.3, 0]]] },
  { c: 'Z', s: [[[0, 1], [.6, 1], [0, 0], [.6, 0]]] },
];
// Paires que le contexte départage : un chiffre voisin favorise le chiffre, une lettre voisine la lettre.
const CONFUS = { S: '5', Z: '2', B: '8', D: '0', G: '6' };

// ——— Nuage de points ———
const N = 32;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lon = s => { let l = 0; for (let i = 1; i < s.length; i++) l += dist(s[i - 1], s[i]); return l; };
function reech(s, n) {
  if (s.length === 1 || n <= 1) return Array.from({ length: Math.max(1, n) }, () => [s[0][0], s[0][1]]);
  const L = lon(s); if (L < 1e-12) return Array.from({ length: n }, () => [s[0][0], s[0][1]]);
  const pas = L / (n - 1), out = [[s[0][0], s[0][1]]]; let reste = pas, p = s[0], i = 1;
  while (i < s.length && out.length < n) {
    const d = dist(p, s[i]);
    if (d >= reste && d > 0) { const t = reste / d; p = [p[0] + (s[i][0] - p[0]) * t, p[1] + (s[i][1] - p[1]) * t]; out.push(p); reste = pas; } else { reste -= d; p = s[i]; i++; }
  }
  while (out.length < n) out.push([s.at(-1)[0], s.at(-1)[1]]);
  return out;
}
function nuage(strokes) {
  const L = strokes.reduce((t, s) => t + lon(s), 0) || 1;
  let ns = strokes.map(s => Math.max(2, Math.round(N * lon(s) / L)));
  let tot = ns.reduce((a, b) => a + b, 0);
  while (tot > N) { const i = ns.indexOf(Math.max(...ns)); if (ns[i] <= 2) break; ns[i]--; tot--; }
  while (tot < N) { const i = ns.indexOf(Math.max(...ns)); ns[i]++; tot++; }
  let pts = strokes.flatMap((s, i) => reech(s, ns[i]));
  if (pts.length > N) pts = pts.slice(0, N);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const k = Math.max(x1 - x0, y1 - y0) || 1, cx = pts.reduce((t, p) => t + p[0], 0) / pts.length, cy = pts.reduce((t, p) => t + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [(x - cx) / k, (y - cy) / k]);
}
function distNuage(a, b) {   // $P : appariement glouton, essayé depuis plusieurs points de départ
  const n = a.length, pas = Math.floor(Math.sqrt(n)); let min = Infinity;
  for (let start = 0; start < n; start += pas) {
    for (const [A, B] of [[a, b], [b, a]]) {
      const pris = new Uint8Array(n); let somme = 0, i = start;
      do {
        let best = Infinity, k = -1;
        for (let j = 0; j < n; j++) if (!pris[j]) { const d = dist(A[i], B[j]); if (d < best) { best = d; k = j; } }
        pris[k] = 1; const w = 1 - ((i - start + n) % n) / n; somme += w * best; i = (i + 1) % n;
      } while (i !== start);
      if (somme < min) min = somme;
    }
  }
  return min;
}
let MODELES = null;
const modeles = () => MODELES ??= GLYPHES.map(g => ({ c: g.c, p: nuage(g.s) }));

// Reconnaît UN caractère (tous ses tracés). Renvoie [{ c, d }] triés (d plus petit = plus proche), sans doublon de caractère.
export function classer(strokes, famille = null) {
  const p = nuage(strokes), best = new Map();
  for (const m of modeles()) {
    const lettre = /[A-Z]/.test(m.c); if ((famille === 'chiffres' && lettre) || (famille === 'lettres' && !lettre)) continue;
    const d = distNuage(p, m.p) * (lettre ? 1.12 : 1); if (!best.has(m.c) || d < best.get(m.c)) best.set(m.c, d); }   // en cotation les chiffres sont plus probables que les lettres
  return [...best].map(([c, d]) => ({ c, d })).sort((a, b) => a.d - b.d);
}

// ——— Mise en ligne : regroupement des tracés en caractères, puis reconnaissance ———
const boite = ss => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of ss) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
const droit = s => { const a = s[0], b = s.at(-1), L = dist(a, b); if (L < 1e-9) return false; let dm = 0; for (const p of s) dm = Math.max(dm, Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L); return dm < 0.18 * L; };
const ferme = s => s.length > 5 && dist(s[0], s.at(-1)) < 0.35 * lon(s);

// strokes : tracés en coordonnées ÉCRAN (axe Y vers le bas). `hauteur` : hauteur d'écriture connue (facultatif).
// Renvoie { texte, car: [{ c, alt, d, doute }], taille, ancre: [x, y], hauteur } ; texte vide si rien n'est reconnu.
export function reconnaitreTexte(strokes, { hauteur = 0 } = {}) {
  const S = strokes.filter(s => s.length >= 1).map(s => s.map(([x, y]) => [x, -y]));      // axe Y vers le haut pour la reconnaissance
  if (!S.length) return { texte: '', car: [], taille: 0, ancre: [0, 0], hauteur: 0 };
  // Groupes : composantes connexes du recouvrement horizontal des tracés (Ø, ×, 4, H… sont écrits en plusieurs tracés).
  const bs = S.map(s => boite([s])), tout = boite(S), H0 = hauteur || Math.max(...bs.map(b => b.h), tout.h * 0.4) || 1, eps = 0.05 * H0;
  const parent = S.map((_, i) => i), trouve = i => (parent[i] === i ? i : (parent[i] = trouve(parent[i])));
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) if (bs[i].x0 <= bs[j].x1 + eps && bs[j].x0 <= bs[i].x1 + eps) parent[trouve(i)] = trouve(j);
  const m = new Map(); S.forEach((s, i) => { const r = trouve(i); if (!m.has(r)) m.set(r, []); m.get(r).push(s); });
  const groupes = [...m.values()].map(ss => ({ ss, b: boite(ss) })).sort((a, b) => a.b.x0 - b.b.x0);
  const Href = hauteur || Math.max(...groupes.filter(g => g.b.h > 0.45 * Math.max(...groupes.map(q => q.b.h))).map(g => g.b.h)) || Math.max(...groupes.map(g => g.b.h)) || 1;
  const bas = [...groupes.filter(g => g.b.h > 0.6 * Href).map(g => g.b.y0)].sort((a, b) => a - b), ligneBas = bas.length ? bas[Math.floor(bas.length / 2)] : tout.y0;
  const car = [];
  groupes.forEach((g, gi) => {
    const { b, ss } = g, un = ss.length === 1, seul = groupes.length === 1;
    const ref = seul ? Math.max(b.w, b.h) : Href;
    let c = null, alt = [], d = 0, d2 = 9;
    if (un && b.w > 2.2 * Math.max(b.h, 0.02 * ref) && b.h < 0.3 * (seul ? b.w : Href) && droit(ss[0]) && b.w > 0.25 * ref) c = '-';                       // trait court horizontal
    else if (un && ferme(ss[0]) && b.h < 0.45 * Href && b.y0 > ligneBas + 0.4 * Href && !seul) c = '°';                                                    // petit cercle en haut
    else if (b.w < 0.3 * ref && b.h < 0.4 * ref && !(seul && b.h > 0.5 * b.w && b.h > 4)) c = un && b.h > 1.4 * b.w && b.y0 < ligneBas + 0.15 * ref ? ',' : '.';    // point ou virgule
    if (!c) {
      const r = classer(ss); c = r[0].c; d = r[0].d; d2 = r[1]?.d ?? 9; alt = r.slice(1, 3).map(x => x.c);
      // contexte : lettre confondable avec un chiffre voisin (S/5, Z/2, B/8, D/0, G/6)
      const voisin = k => car[gi + k] ?? null;
    }
    car.push({ c, alt, d, d2, b, g });
  });
  // Contexte : une lettre confondable (S, Z, B, D, G) au milieu de chiffres, ou après une lettre sûre (M8, R5, H7), est relue parmi les chiffres seulement ;
  // un chiffre entouré de lettres sûres est relu parmi les lettres. La virgule, le point et le tiret ne comptent pas comme voisins.
  const estChiffre = c => /[0-9]/.test(c), estLettre = c => /[A-Z]/.test(c), sure = c => estLettre(c) && !CONFUS[c], ponct = c => /[,.\- °]/.test(c);
  const voisin = (i, d) => { for (let j = i + d; j >= 0 && j < car.length; j += d) if (!ponct(car[j].c)) return car[j]; return null; };
  car.forEach((k, i) => {
    const prev = voisin(i, -1), next = voisin(i, 1);
    if (CONFUS[k.c]) {
      if ((prev && estChiffre(prev.c)) || (next && estChiffre(next.c)) || (prev && sure(prev.c) && !(next && sure(next.c)))) { const r = classer(k.g.ss, 'chiffres'); k.alt = [k.c, ...r.slice(1, 2).map(x => x.c)]; k.c = r[0].c; k.d = r[0].d; k.d2 = r[1]?.d ?? 9; }
    } else if (estChiffre(k.c) && prev && next && sure(prev.c) && sure(next.c)) { const r = classer(k.g.ss, 'lettres'); k.alt = [k.c]; k.c = r[0].c; k.d = r[0].d; k.d2 = r[1]?.d ?? 9; }
  });
  let texte = '';
  car.forEach((k, i) => { if (i) { const gap = k.b.x0 - car[i - 1].b.x1; if (gap > 0.75 * Href) texte += ' '; } texte += k.c; });
  // Doute : distance au modèle élevée, ou second choix presque aussi proche.
  const sortie = car.map(k => ({ c: k.c, alt: k.alt, d: +k.d.toFixed(3), doute: k.d > 0.75 || k.d2 < 1.08 * k.d }));
  return { texte, car: sortie, taille: Href / 0.72, ancre: [tout.x0, -ligneBas], hauteur: Href };
}
export const CARACTERES = [...new Set(GLYPHES.map(g => g.c))].join('') + ',.-°';
// Tracés d'un caractère du jeu de modèles, pour les essais (variante `v`), en coordonnées écran (Y vers le bas).
export function modeleTraces(c, v = 0) { const l = GLYPHES.filter(g => g.c === c); return l.length ? l[v % l.length].s.map(s => s.map(([x, y]) => [x, -y])) : null; }
