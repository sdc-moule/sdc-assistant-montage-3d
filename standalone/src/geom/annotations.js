// Annotations vectorielles (flèche, droite, rectangle, cercle, texte, polyligne) posées sur une capture, un plan ou une image.
// Module pur (sans DOM), testable sous Node. Les annotations sont INDICATIVES : ce ne sont pas des cotes et elles ne modifient jamais le fond.
// Coordonnées : celles du fond (pixels, axe Y vers le bas, pour une capture ou une image). Même modèle pour toutes les sorties
// (écran, PNG, PDF) grâce à `tracer()`, qui ramène chaque annotation à des primitives simples.
import { largeurTexte, chainePdf, sansAccent } from './export-plan.js';

export const PALETTE = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#212121', '#ffffff'];
export const EPAISSEURS = [2, 4, 6, 10];
export const TYPES = ['fleche', 'ligne', 'rect', 'cercle', 'texte', 'poly'];

const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const num = v => { const s = (Math.abs(v) < 5e-7 ? 0 : v).toFixed(4); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };
const ok = v => typeof v === 'number' && Number.isFinite(v);

export function creer(type, pts, { id = '', couleur = PALETTE[0], epais = 4, texte = '', taille = 24, ferme = false, propose = false } = {}) {
  if (!TYPES.includes(type)) throw new Error(`Type d'annotation inconnu : ${type}`);
  const a = { id, type, pts: pts.map(p => [p[0], p[1]]), couleur, epais };
  if (type === 'texte') { a.texte = texte; a.taille = taille; if (propose) a.propose = true; }
  if (type === 'poly' && ferme) a.ferme = true;
  return a;
}
export function idSuivant(liste) { let m = 0; for (const a of liste) { const n = /^a(\d+)$/.exec(a.id); if (n) m = Math.max(m, +n[1]); } return `a${m + 1}`; }

// Valide et nettoie une liste lue dans un projet ou un localStorage (jamais de confiance dans un fichier).
export function nettoyer(liste) {
  const out = [];
  for (const a of Array.isArray(liste) ? liste : []) {
    if (!a || !TYPES.includes(a.type) || !Array.isArray(a.pts)) continue;
    const pts = a.pts.filter(p => Array.isArray(p) && ok(p[0]) && ok(p[1])).map(p => [p[0], p[1]]);
    const n = a.type === 'texte' ? 1 : a.type === 'poly' ? 2 : 2;
    if (pts.length < n || (a.type !== 'poly' && pts.length !== n)) continue;
    const c = /^#[0-9a-f]{6}$/i.test(a.couleur) ? a.couleur : PALETTE[0];
    const o = { id: String(a.id ?? '').slice(0, 24), type: a.type, pts, couleur: c, epais: ok(a.epais) && a.epais > 0 ? Math.min(a.epais, 1000) : 4 };
    if (a.type === 'texte') { o.texte = String(a.texte ?? '').slice(0, 2000); o.taille = ok(a.taille) && a.taille > 0 ? Math.min(a.taille, 10000) : 24; if (a.propose) o.propose = true; }
    if (a.type === 'poly' && a.ferme) o.ferme = true;
    out.push(o);
  }
  return out;
}

// ——— Tracé à main levée : simplification et redressement ———
export function longueur(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += d2(pts[i - 1], pts[i]); return L; }
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
// Ramer-Douglas-Peucker : conserve toujours les deux extrémités.
export function simplifier(pts, tol) {
  if (pts.length < 3) return pts.map(p => [p[0], p[1]]);
  const garde = new Uint8Array(pts.length); garde[0] = garde[pts.length - 1] = 1;
  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [i, j] = pile.pop(); let dm = 0, k = -1;
    for (let q = i + 1; q < j; q++) { const d = distSeg(pts[q], pts[i], pts[j]); if (d > dm) { dm = d; k = q; } }
    if (k >= 0 && dm > tol) { garde[k] = 1; pile.push([i, k], [k, j]); }
  }
  return pts.filter((_, i) => garde[i]).map(p => [p[0], p[1]]);
}
export function reechantillonner(pts, n) {
  const L = longueur(pts); if (L === 0 || n < 2) return pts.map(p => [p[0], p[1]]);
  const out = [[pts[0][0], pts[0][1]]], pas = L / (n - 1); let reste = pas, i = 1, p = pts[0];
  while (i < pts.length && out.length < n) {
    const d = d2(p, pts[i]);
    if (d >= reste) { const t = reste / d; p = [p[0] + (pts[i][0] - p[0]) * t, p[1] + (pts[i][1] - p[1]) * t]; out.push(p); reste = pas; } else { reste -= d; p = pts[i]; i++; }
  }
  while (out.length < n) out.push([pts.at(-1)[0], pts.at(-1)[1]]);
  return out;
}
// Cercle moyen (Kåsa) d'un nuage de points ; renvoie aussi l'écart quadratique relatif et le balayage angulaire (radians).
export function cercleMoyen(pts) {
  const n = pts.length; if (n < 5) return null;
  let mx = 0, my = 0; for (const [x, y] of pts) { mx += x; my += y; } mx /= n; my /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, y] of pts) { const u = x - mx, v = y - my; suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; }
  const det = suu * svv - suv * suv; if (Math.abs(det) < 1e-9) return null;
  const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2, cx = mx + (a * svv - b * suv) / det, cy = my + (b * suu - a * suv) / det;
  let r = 0; for (const p of pts) r += d2(p, [cx, cy]); r /= n; if (!(r > 1e-9)) return null;
  let q = 0; for (const p of pts) q += (d2(p, [cx, cy]) - r) ** 2;
  let tot = 0, prev = Math.atan2(pts[0][1] - cy, pts[0][0] - cx);
  for (let i = 1; i < n; i++) { const t = Math.atan2(pts[i][1] - cy, pts[i][0] - cx); let d = t - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; tot += d; prev = t; }
  return { c: [cx, cy], r, rms: Math.sqrt(q / n) / r, balayage: Math.abs(tot) };
}
const boite2 = pts => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };

// Analyse d'un tracé à main levée. Renvoie { type, pts, ferme? } : « ligne », « fleche », « rect », « cercle » ou « poly ».
// `corriger:false` : on garde seulement la simplification en polyligne (poignée à chaque sommet).
export function reconnaitre(brut, { corriger = true, tol = 0 } = {}) {
  if (brut.length < 2) return null;
  const [x0, y0, x1, y1] = boite2(brut), diag = Math.hypot(x1 - x0, y1 - y0), L = longueur(brut);
  if (diag < 3 || L < 3) return null;                                // simple clic : pas de tracé
  const tolPoly = tol > 0 ? tol : Math.max(2, 0.015 * diag);
  const A = brut[0], B = brut.at(-1), corde = d2(A, B);
  const poly = () => { const s = simplifier(brut, tolPoly); return s.length >= 2 ? { type: 'poly', pts: s } : null; };
  if (!corriger) return poly();

  // Tracé fermé (le stylo revient près du départ) : rectangle ou cercle.
  if (corde < 0.22 * L && L > 40) {
    const fermeP = [...brut, A], s = simplifier(fermeP, Math.max(tolPoly, 0.05 * diag));
    const som = s.slice(0, -1);
    if (som.length === 4) {
      const bon = som.every((p, i) => {
        const a = som[(i + 3) % 4], b = som[(i + 1) % 4], u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
        const cos = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1);
        return Math.abs(cos) < 0.42 && Math.hypot(...u) > 0.12 * diag;       // angle à 90° ± ~25°
      });
      if (bon) {
        const horiz = som.every((p, i) => { const q = som[(i + 1) % 4], a = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0])) % (Math.PI / 2); return Math.min(a, Math.PI / 2 - a) < 0.26; });   // côtés à ± 15° des axes
        if (horiz) return { type: 'rect', pts: [[x0, y0], [x1, y1]] };
        return { type: 'poly', pts: som, ferme: true };
      }
    }
    const f = cercleMoyen(reechantillonner(brut, 64));
    if (f && f.rms < 0.09 && f.balayage > 0.85 * 2 * Math.PI && f.r > 4) return { type: 'cercle', pts: [f.c, [f.c[0] + f.r, f.c[1]]] };
    return poly();
  }

  // Tracé ouvert : droite si le tracé reste près de la corde.
  const dev = Math.max(...brut.map(p => distSeg(p, A, B)));
  if (corde > 0.8 * L && dev <= 0.06 * corde) return { type: 'ligne', pts: [A, B] };

  // Flèche tracée d'un seul geste : hampe presque droite, puis retour en « V » près de la pointe.
  let k = 0, dmax = 0; brut.forEach((p, i) => { const d = d2(p, A); if (d > dmax) { dmax = d; k = i; } });
  if (k > 0 && k < brut.length - 1) {
    const P = brut[k], hampe = brut.slice(0, k + 1), reste = brut.slice(k), Lr = longueur(reste), devH = Math.max(...hampe.map(p => distSeg(p, A, P)));
    const ecart = Math.max(...reste.map(p => distSeg(p, A, P)));
    if (dmax >= 0.6 * L && devH <= 0.07 * dmax && Lr >= 0.15 * dmax && Lr <= 0.85 * dmax && reste.every(p => d2(p, P) <= 0.45 * dmax) && ecart >= 0.06 * dmax) return { type: 'fleche', pts: [A, P] };
  }
  return poly();
}

// ——— Édition ———
export function boite(a) {
  if (a.type === 'texte') {
    const lg = String(a.texte).split('\n'), w = Math.max(...lg.map(t => largeurTexte(t, a.taille)), a.taille * 0.5), [x, y] = a.pts[0];
    return [x, y - a.taille * 0.8, x + w, y + a.taille * 1.2 * (lg.length - 1) + a.taille * 0.25];
  }
  if (a.type === 'cercle') { const r = d2(a.pts[0], a.pts[1]); return [a.pts[0][0] - r, a.pts[0][1] - r, a.pts[0][0] + r, a.pts[0][1] + r]; }
  return boite2(a.pts);
}
export function poignees(a) {
  if (a.type === 'rect') { const [[x0, y0], [x1, y1]] = a.pts; return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
  return a.pts.map(p => [p[0], p[1]]);
}
export function deplacerPoignee(a, i, p) {
  const pts = a.pts.map(q => [q[0], q[1]]);
  if (a.type === 'rect') {
    if (i === 0) pts[0] = [p[0], p[1]]; else if (i === 2) pts[1] = [p[0], p[1]];
    else if (i === 1) { pts[1][0] = p[0]; pts[0][1] = p[1]; } else { pts[0][0] = p[0]; pts[1][1] = p[1]; }
  } else if (a.type === 'cercle') {
    if (i === 0) { const dx = p[0] - pts[0][0], dy = p[1] - pts[0][1]; pts[0] = [p[0], p[1]]; pts[1] = [pts[1][0] + dx, pts[1][1] + dy]; } else pts[1] = [p[0], p[1]];
  } else pts[i] = [p[0], p[1]];
  return { ...a, pts };
}
export function deplacer(a, dx, dy) { return { ...a, pts: a.pts.map(p => [p[0] + dx, p[1] + dy]) }; }
// Distance d'un point à l'annotation (sélection au doigt ou à la souris) ; 0 sur le contour, ou dans la zone d'un texte.
export function distance(a, p) {
  const seg = (pts, ferme) => { let m = Infinity; for (let i = 0; i + 1 < pts.length; i++) m = Math.min(m, distSeg(p, pts[i], pts[i + 1])); if (ferme && pts.length > 2) m = Math.min(m, distSeg(p, pts.at(-1), pts[0])); return m; };
  switch (a.type) {
    case 'ligne': case 'fleche': return seg(a.pts);
    case 'poly': return seg(a.pts, a.ferme);
    case 'rect': return seg(poignees(a), true);
    case 'cercle': return Math.abs(d2(p, a.pts[0]) - d2(a.pts[0], a.pts[1]));
    case 'texte': { const [x0, y0, x1, y1] = boite(a); return Math.hypot(Math.max(x0 - p[0], 0, p[0] - x1), Math.max(y0 - p[1], 0, p[1] - y1)); }
  }
  return Infinity;
}
// Annotation la plus proche du point (la plus récente en cas d'égalité) sous le seuil `tol`, sinon -1.
export function trouver(liste, p, tol) {
  let best = -1, bd = tol;
  for (let i = liste.length - 1; i >= 0; i--) { const d = distance(liste[i], p); if (d <= bd) { if (d < bd || best < 0) best = i; bd = d; } }
  return best;
}
// Poignée la plus proche (index) sous le seuil, sinon -1.
export function trouverPoignee(a, p, tol) {
  let best = -1, bd = tol;
  poignees(a).forEach((h, i) => { const d = d2(h, p); if (d <= bd) { bd = d; best = i; } });
  return best;
}

// ——— Changement de repère (capture ↔ plan en mm) ———
// f = { kx, ky, tx, ty } : p' = [kx·x + tx, ky·y + ty] ; |kx| = |ky| (similitude, éventuellement avec miroir de l'axe Y).
// Les épaisseurs et tailles de texte suivent l'échelle ; les annotations d'origine ne sont pas modifiées.
export function transformer(liste, f) {
  const k = Math.abs(f.kx);
  return liste.map(a => {
    const o = { ...a, pts: a.pts.map(p => [f.kx * p[0] + f.tx, f.ky * p[1] + f.ty]), epais: a.epais * k };
    if (a.type === 'texte') o.taille = a.taille * k;
    return o;
  });
}
export const inverse = f => ({ kx: 1 / f.kx, ky: 1 / f.ky, tx: -f.tx / f.kx, ty: -f.ty / f.ky });

// Annotations en mm (axe Y vers le haut) → entités du plan exporté (calque « Annotations », couleur propre à chaque entité).
export function itemsAnnotations(liste) {
  const items = [], base = { layer: 'Annotations', snap: [], pointille: false };
  for (const a of liste) for (const o of tracer(a, { sens: -1 })) {
    if (o.t === 'poly') items.push({ ...base, kind: o.pts.length === 2 && !o.ferme ? 'line' : 'poly', pts: o.ferme ? [...o.pts, o.pts[0]] : o.pts, rgb: o.couleur, lw: o.epais });
    else if (o.t === 'cercle') {
      const pts = Array.from({ length: 73 }, (_, i) => [o.c[0] + o.r * Math.cos(i * Math.PI / 36), o.c[1] + o.r * Math.sin(i * Math.PI / 36)]);
      items.push({ ...base, kind: 'circle', pts, c: [o.c[0], o.c[1]], r: o.r, rgb: o.couleur, lw: o.epais });
    } else if (o.t === 'tete') items.push({ ...base, kind: 'poly', plein: true, pts: o.pts, rgb: o.couleur });
    else if (o.t === 'texte') o.lignes.forEach((t, i) => { if (t.trim()) items.push({ ...base, kind: 'text', texte: t, h: o.taille, rot: 0, pts: [[o.p[0], o.p[1] + i * o.pas]], rgb: o.couleur }); });
  }
  return items;
}

// ——— Primitives de dessin communes à l'écran, au PNG et au PDF ———
// { t:'poly', pts, ferme, epais, couleur } · { t:'cercle', c, r, epais, couleur } · { t:'tete', pts:[3 pts], couleur } (triangle plein) ·
// { t:'texte', p, lignes, taille, couleur, pas } ; `sens` = +1 si l'axe Y descend (image), −1 s'il monte (plan en mm).
export function tracer(a, { sens = 1 } = {}) {
  const base = { couleur: a.couleur, epais: a.epais };
  switch (a.type) {
    case 'ligne': return [{ t: 'poly', pts: a.pts, ferme: false, ...base }];
    case 'poly': return [{ t: 'poly', pts: a.pts, ferme: !!a.ferme, ...base }];
    case 'rect': return [{ t: 'poly', pts: poignees(a), ferme: true, ...base }];
    case 'cercle': return [{ t: 'cercle', c: a.pts[0], r: d2(a.pts[0], a.pts[1]), ...base }];
    case 'fleche': {
      const [A, B] = a.pts, L = d2(A, B); if (L < 1e-9) return [];
      const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], hl = Math.min(5.5 * a.epais, 0.6 * L), lg = 0.38 * hl, base2 = [B[0] - u[0] * hl, B[1] - u[1] * hl];
      return [{ t: 'poly', pts: [A, [B[0] - u[0] * hl * 0.8, B[1] - u[1] * hl * 0.8]], ferme: false, ...base },
        { t: 'tete', pts: [B, [base2[0] - u[1] * lg, base2[1] + u[0] * lg], [base2[0] + u[1] * lg, base2[1] - u[0] * lg]], couleur: a.couleur }];
    }
    case 'texte': return [{ t: 'texte', p: a.pts[0], lignes: String(a.texte).split('\n'), taille: a.taille, pas: 1.2 * a.taille * sens, couleur: a.couleur }];
  }
  return [];
}

// ——— Export PDF d'une capture annotée : fond JPEG + annotations vectorielles (page ISO A4, paysage ou portrait) ———
const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255) : [0, 0, 0]; };
// jpeg : octets d'une image JPEG de w × h pixels. Renvoie { octets, largeur, hauteur, format } (mm).
export function ecrirePdfImage(jpeg, w, h, annots, { fichier = '', date = '', legende = '' } = {}) {
  const [pw, ph] = w >= h ? [297, 210] : [210, 297], MARGE = 8, BANDE = 10;
  const s = Math.min((pw - 2 * MARGE) / w, (ph - 2 * MARGE - BANDE) / h);
  const ox = (pw - w * s) / 2, oy = BANDE + MARGE + (ph - 2 * MARGE - BANDE - h * s) / 2;
  const X = x => ox + x * s, Y = y => oy + (h - y) * s, n = num, rgb = c => hex(c).map(n).join(' ');
  const S = [`${n(72 / 25.4)} 0 0 ${n(72 / 25.4)} 0 0 cm`];
  S.push('q', `${n(w * s)} 0 0 ${n(h * s)} ${n(ox)} ${n(oy)} cm /Im1 Do`, 'Q');
  S.push('1 J 1 j', '0.35 w 0 0 0 RG', `${n(MARGE / 2)} ${n(MARGE / 2)} ${n(pw - MARGE)} ${n(ph - MARGE)} re S`);
  const txt = (t, x, y, hh, c) => S.push(`${rgb(c)} rg BT /F1 ${n(hh)} Tf 1 0 0 1 ${n(x)} ${n(y)} Tm (${chainePdf(t)}) Tj ET`);
  txt(legende || `SDC Montage 3D · ${fichier} · annotations indicatives, non contractuelles`, MARGE, MARGE + 1, 3.2, '#1f4462');
  if (date) txt(date, pw - MARGE - 38, MARGE + 1, 3.2, '#1f4462');
  S.push('q', `${n(ox)} ${n(oy)} ${n(w * s)} ${n(h * s)} re W n`);                // les annotations sortant du fond sont rognées, comme dans le PNG
  for (const a of annots) for (const o of tracer(a, { sens: 1 })) {
    if (o.t === 'poly') {
      const P = o.pts.map(p => `${n(X(p[0]))} ${n(Y(p[1]))}`);
      S.push(`${rgb(o.couleur)} RG ${n(Math.max(o.epais * s, 0.15))} w [] 0 d ${P.map((q, i) => `${q} ${i ? 'l' : 'm'}`).join(' ')}${o.ferme ? ' h' : ''} S`);
    } else if (o.t === 'cercle') {
      const cx = X(o.c[0]), cy = Y(o.c[1]), r = o.r * s, k = 0.5522847498 * r;
      S.push(`${rgb(o.couleur)} RG ${n(Math.max(o.epais * s, 0.15))} w [] 0 d ${n(cx + r)} ${n(cy)} m ${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c ${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c ${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c ${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c h S`);
    } else if (o.t === 'tete') {
      S.push(`${rgb(o.couleur)} rg ${rgb(o.couleur)} RG 0.1 w ${o.pts.map((p, i) => `${n(X(p[0]))} ${n(Y(p[1]))} ${i ? 'l' : 'm'}`).join(' ')} h B`);
    } else if (o.t === 'texte') o.lignes.forEach((t, i) => { if (t.trim()) txt(t, X(o.p[0]), Y(o.p[1] + i * o.pas), o.taille * s, o.couleur); });
  }
  S.push('Q');
  const contenu = S.join('\n');
  const entete = `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`;
  const parts = []; const pos = []; let len = 0;
  const push = b => { const u = typeof b === 'string' ? Uint8Array.from([...b].map(ch => ch.charCodeAt(0) & 255)) : b; parts.push(u); len += u.length; };
  const objet = (i, corps) => { pos[i] = len; push(`${i} 0 obj\n`); for (const c of corps) push(c); push('\nendobj\n'); };
  push('%PDF-1.4\n%âãÏÓ\n');
  objet(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  objet(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
  objet(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pw * 72 / 25.4)} ${n(ph * 72 / 25.4)}] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>`]);
  objet(4, [`<< /Length ${contenu.length} >>\nstream\n${contenu}\nendstream`]);
  objet(5, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
  objet(6, [entete, '\nstream\n', jpeg, '\nendstream']);
  objet(7, [`<< /Title (${chainePdf(sansAccent(`Annotations ${fichier}`))}) /Creator (SDC Montage 3D) /Producer (SDC Montage 3D) >>`]);
  const x0 = len;
  push(`xref\n0 8\n0000000000 65535 f \n` + [1, 2, 3, 4, 5, 6, 7].map(i => String(pos[i]).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size 8 /Root 1 0 R /Info 7 0 R >>\nstartxref\n${x0}\n%%EOF\n`);
  const octets = new Uint8Array(len); let o = 0; for (const p of parts) { octets.set(p, o); o += p.length; }
  return { octets, format: pw > ph ? 'A4 paysage' : 'A4 portrait', largeur: pw, hauteur: ph };
}
