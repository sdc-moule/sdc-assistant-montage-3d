// Export DXF et PDF d'une mise en plan (vues projetées + cotes posées par l'opérateur).
// Module pur (sans DOM), testable sous Node. Unités : mm, échelle 1:1, axe Y vers le haut.
// Lecture seule : le STEP n'est jamais modifié ; le plan exporté porte la mention « valeurs indicatives ».
// DXF : format R12 (AC1009), le plus largement lu (AutoCAD, LibreCAD, FreeCAD, DraftSight…), texte en ANSI 1252.
// PDF : vectoriel, police Helvetica standard (aucune police embarquée), page ISO A4…A0 ou format sur mesure si le plan est plus grand.

// ——— Texte : largeurs Helvetica (millièmes d'em) pour centrer les cotes sans moteur de police ———
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
export function largeurTexte(txt, h) {
  let w = 0;
  for (const ch of String(txt)) { const c = ch.codePointAt(0); w += c >= 32 && c <= 126 ? HELV[c - 32] : c === 0xD8 ? 778 : c === 0xB0 ? 400 : c === 0xB1 ? 584 : c === 0xB7 ? 278 : 556; }
  return (w / 1000) * h;
}
// ANSI 1252 : les caractères hors de la page sont remplacés (pas d'erreur d'export pour un « ≈ » ou un « → »).
const SPEC1252 = { 0x20AC: 0x80, 0x2026: 0x85, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97 };
const REMPL = { '≈': '~', '→': '->', '⟂': 'perp.', '≤': '<=', '≥': '>=' };
export function versAnsi(txt) {
  const s = [...String(txt)].map(ch => REMPL[ch] ?? ch).join(''), out = [];
  for (const ch of s) { const c = ch.codePointAt(0); out.push(c < 128 || (c >= 160 && c <= 255) ? c : SPEC1252[c] ?? 63); }
  return Uint8Array.from(out);
}
const sansAccent = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
const fmt = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2).replace('.', ',');
const num = v => { const s = (Math.abs(v) < 5e-7 ? 0 : v).toFixed(4); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };

// ——— Cotes → entités de dessin (traits fins, flèches pleines, valeur) ———
const unit = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const valeurCote = c => c.t === 'ph' ? Math.abs(c.b.x - c.a.x) : c.t === 'pv' ? Math.abs(c.b.y - c.a.y) : c.t === 'pa' ? Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) : c.t === 'pdia' ? 2 * c.r : c.r;
export const texteCote = c => (c.t === 'pdia' || c.dia ? 'Ø ' : c.t === 'prad' ? 'R ' : '') + fmt(valeurCote(c));
export function itemsCotes(cotes, h = 3.5) {
  const out = [], La = h, G = 0.3 * h, O = 0.6 * h, L = 'Cotes';
  const trait = (a, b) => out.push({ kind: 'line', layer: L, pointille: false, pts: [a, b], snap: [], cote: true });
  const pointe = (tip, d) => { const bx = tip[0] - d[0] * La, by = tip[1] - d[1] * La, w = 0.32 * La; out.push({ kind: 'poly', layer: L, pointille: false, plein: true, pts: [tip, [bx - d[1] * w, by + d[0] * w], [bx + d[1] * w, by - d[0] * w], tip], snap: [], cote: true }); };
  const texte = (txt, cx, cy, rot, ancre, off) => {    // (cx, cy) : centre visuel du texte ; stocké en position de base (gauche, ligne de base)
    let X = cx, Y = cy;
    if (off && (off[0] || off[1])) { trait([cx, cy], [cx + off[0], cy + off[1]]); X += off[0]; Y += off[1]; }
    const w = largeurTexte(txt, h), u = [Math.cos(rot), Math.sin(rot)], n = [-u[1], u[0]];
    out.push({ kind: 'text', layer: L, texte: txt, h, rot, pts: [[X - (w / 2) * u[0] - 0.36 * h * n[0], Y - (w / 2) * u[1] - 0.36 * h * n[1]]], snap: [], pointille: false, cote: true });
  };
  for (const c of cotes) {
    if (!c || !c.t || c.t[0] !== 'p') continue;
    const txt = texteCote(c), P = [c.p.x, c.p.y], off = c.off?.m ?? null;
    if (c.t === 'pdia' || c.t === 'prad') {
      const C = [c.c.x, c.c.y], r = c.r, d = unit([P[0] - C[0], P[1] - C[1]]), P2 = [C[0] + d[0] * r, C[1] + d[1] * r], P1 = [C[0] - d[0] * r, C[1] - d[1] * r];
      if (c.t === 'pdia') { trait(P1, P); pointe(P1, [-d[0], -d[1]]); pointe(P2, 2 * r >= 3.4 * La ? d : [-d[0], -d[1]]); } else { trait(C, P); pointe(P2, d); }
      const w = largeurTexte(txt, h), horiz = Math.abs(d[0]) >= 0.5 * Math.abs(d[1]) || Math.abs(d[0]) > 0.35;
      const ctr = horiz ? [P[0] + Math.sign(d[0] || 1) * (0.5 * h + w / 2), P[1] + d[1] * 0.5 * h] : [P[0], P[1] + Math.sign(d[1] || 1) * 0.9 * h];
      texte(txt, ctr[0], ctr[1], 0, null, off); continue;
    }
    const A = [c.a.x, c.a.y], B = [c.b.x, c.b.y];
    let A1, B1, ea, eb;
    if (c.t === 'ph') { A1 = [A[0], P[1]]; B1 = [B[0], P[1]]; ea = [0, Math.sign(P[1] - A[1]) || 1]; eb = [0, Math.sign(P[1] - B[1]) || 1]; }
    else if (c.t === 'pv') { A1 = [P[0], A[1]]; B1 = [P[0], B[1]]; ea = [Math.sign(P[0] - A[0]) || 1, 0]; eb = [Math.sign(P[0] - B[0]) || 1, 0]; }
    else {
      const e = unit([B[0] - A[0], B[1] - A[1]]), nn = [-e[1], e[0]], dd = (P[0] - A[0]) * nn[0] + (P[1] - A[1]) * nn[1], sg = Math.sign(dd) || 1;
      A1 = [A[0] + nn[0] * dd, A[1] + nn[1] * dd]; B1 = [B[0] + nn[0] * dd, B[1] + nn[1] * dd]; ea = eb = [nn[0] * sg, nn[1] * sg];
    }
    for (const [Q, Q1, e] of [[A, A1, ea], [B, B1, eb]]) trait([Q[0] + e[0] * G, Q[1] + e[1] * G], [Q1[0] + e[0] * O, Q1[1] + e[1] * O]);   // lignes de rappel (trait fin)
    const Ld = Math.hypot(B1[0] - A1[0], B1[1] - A1[1]);
    let e = [1, 0];
    if (Ld > 1e-9) {
      e = unit([B1[0] - A1[0], B1[1] - A1[1]]);
      if (Ld >= 3.4 * La) { trait(A1, B1); pointe(A1, [-e[0], -e[1]]); pointe(B1, e); }
      else { trait([A1[0] - e[0] * 1.6 * La, A1[1] - e[1] * 1.6 * La], [B1[0] + e[0] * 1.6 * La, B1[1] + e[1] * 1.6 * La]); pointe(A1, e); pointe(B1, [-e[0], -e[1]]); }   // cote courte : flèches à l'extérieur
    }
    let rot = c.t === 'ph' ? 0 : c.t === 'pv' ? Math.PI / 2 : Math.atan2(e[1], e[0]);
    if (rot > Math.PI / 2 + 1e-9) rot -= Math.PI; else if (rot <= -Math.PI / 2 + 1e-9) rot += Math.PI;
    texte(txt, (A1[0] + B1[0]) / 2 + ea[0] * 0.7 * h, (A1[1] + B1[1]) / 2 + ea[1] * 0.7 * h, rot, ea, off);
  }
  return out;
}

// ——— Emprise, cartouche ———
export function emprisePlan(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pt = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const o of items) {
    if (o.layer === 'Cartouche') continue;
    if (o.kind === 'text') { const w = largeurTexte(o.texte, o.h), c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0), [x, y] = o.pts[0]; pt(x, y); pt(x + w * c - o.h * s, y + w * s + o.h * c); pt(x + w * c, y + w * s); pt(x - o.h * s, y + o.h * c); continue; }
    for (const [x, y] of o.pts) pt(x, y);
    if (o.kind === 'circle' && o.c) { pt(o.c[0] - o.r, o.c[1] - o.r); pt(o.c[0] + o.r, o.c[1] + o.r); }
  }
  if (!Number.isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }
  return [x0, y0, x1, y1];
}
export function lignesCartouche(nom, date) {
  return [`${nom} - Mise en plan 1:1 - projection européenne : vue de face, dessous = dessus, à droite = gauche - cotes en mm`,
    `Valeurs INDICATIVES issues du maillage d'affichage (~±0,05 mm), non validées : à vérifier avant toute fabrication - ${date}`];
}
// Réunit dessin + cotes (+ cartouche sous le dessin pour le DXF) en un plan prêt à écrire.
export function composerPlan(dessin, cotes = [], { nom = 'piece', date = '', cartouche = false } = {}) {
  const base = emprisePlan(dessin.items), taille = Math.max(base[2] - base[0], base[3] - base[1]);
  const hCote = Math.min(7, Math.max(3, taille / 200));
  const items = [...dessin.items, ...itemsCotes(cotes, hCote)], calques = dessin.calques.map(c => ({ ...c }));
  if (items.some(o => o.layer === 'Cotes') && !calques.some(c => c.nom === 'Cotes')) calques.push({ nom: 'Cotes', rgb: '#12324b', couleur: 7, ltype: 'CONTINUOUS', gele: false, nb: 0 });
  const e = emprisePlan(items);
  if (cartouche) {
    if (!calques.some(c => c.nom === 'Cartouche')) calques.push({ nom: 'Cartouche', rgb: '#4a5a6a', couleur: 8, ltype: 'CONTINUOUS', gele: false, nb: 0 });
    lignesCartouche(nom, date).forEach((t, i) => items.push({ kind: 'text', layer: 'Cartouche', texte: t, h: i ? 2.5 : 3.5, rot: 0, pts: [[e[0], e[1] - 8 - i * 6]], snap: [], pointille: false }));
  }
  const b = emprisePlan(items);
  return { items, calques, cadre: { x0: b[0], y0: b[1], x1: b[2], y1: b[3] }, emprise: b };
}

// ——— DXF R12 ———
const ACI = { Contours: 7, 'Arêtes cachées': 8, Hachures: 8, Axes: 1, 'Plan de coupe': 1, Titres: 5, Cotes: 3, Cartouche: 8 };
const nomCalque = n => sansAccent(n).toUpperCase().replace(/[^A-Z0-9_$-]/g, '_') || '0';
const chaine = o => (o.layer === 'Axes' || o.layer === 'Plan de coupe') ? 'CENTER' : 'DASHED';
export function ecrireDxf(plan, { date = '' } = {}) {
  const L = [], g = (c, v) => L.push(String(c), String(v));
  const e = plan.emprise;
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(9, '$MEASUREMENT'); g(70, 1); g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252'); g(9, '$LTSCALE'); g(40, 1);
  g(9, '$EXTMIN'); g(10, num(e[0])); g(20, num(e[1])); g(30, 0); g(9, '$EXTMAX'); g(10, num(e[2])); g(20, num(e[3])); g(30, 0);
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, 'Dashed'); g(72, 65); g(73, 2); g(40, 6); g(49, 4); g(49, -2);
  g(0, 'LTYPE'); g(2, 'CENTER'); g(70, 0); g(3, 'Center'); g(72, 65); g(73, 4); g(40, 13); g(49, 8); g(49, -2); g(49, 1); g(49, -2);
  g(0, 'ENDTAB');
  const noms = new Map([['0', { couleur: 7 }]]);
  for (const c of plan.calques) noms.set(nomCalque(c.nom), { couleur: ACI[c.nom] ?? 7 });
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, noms.size);
  for (const [n, c] of noms) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, c.couleur); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1); g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, ''); g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const tete = (type, o) => { g(0, type); g(8, nomCalque(o.layer)); g(6, o.pointille ? chaine(o) : 'CONTINUOUS'); };
  const norm360 = a => { a = (a * 180) / Math.PI % 360; return a < 0 ? a + 360 : a; };
  for (const o of plan.items) {
    if (o.kind === 'text') { if (!String(o.texte).trim()) continue; tete('TEXT', o); g(10, num(o.pts[0][0])); g(20, num(o.pts[0][1])); g(30, 0); g(40, num(o.h)); g(1, o.texte); if (o.rot) g(50, num(norm360(o.rot))); g(7, 'STANDARD'); continue; }
    if (o.kind === 'circle' && o.c) { tete('CIRCLE', o); g(10, num(o.c[0])); g(20, num(o.c[1])); g(30, 0); g(40, num(o.r)); continue; }
    if (o.kind === 'arc' && o.c) {
      const a = o.pts[0], b = o.pts.at(-1), t0 = Math.atan2(a[1] - o.c[1], a[0] - o.c[0]), t1 = Math.atan2(b[1] - o.c[1], b[0] - o.c[0]);
      tete('ARC', o); g(10, num(o.c[0])); g(20, num(o.c[1])); g(30, 0); g(40, num(o.r)); g(50, num(norm360(o.sens > 0 ? t0 : t1))); g(51, num(norm360(o.sens > 0 ? t1 : t0))); continue;
    }
    if (o.plein && o.pts.length >= 3) { const [p, q, r] = o.pts; tete('SOLID', o); [[10, p], [11, q], [12, r], [13, r]].forEach(([c, P]) => { g(c, num(P[0])); g(c + 10, num(P[1])); g(c + 20, 0); }); continue; }
    if (o.pts.length === 2 && o.kind === 'line') { tete('LINE', o); g(10, num(o.pts[0][0])); g(20, num(o.pts[0][1])); g(30, 0); g(11, num(o.pts[1][0])); g(21, num(o.pts[1][1])); g(31, 0); continue; }
    if (o.pts.length >= 2) {   // tracé quelconque : POLYLINE R12
      const ferme = o.pts.length > 2 && Math.hypot(o.pts[0][0] - o.pts.at(-1)[0], o.pts[0][1] - o.pts.at(-1)[1]) < 1e-9, pts = ferme ? o.pts.slice(0, -1) : o.pts;
      tete('POLYLINE', o); g(66, 1); g(70, ferme ? 1 : 0); g(10, 0); g(20, 0); g(30, 0);
      for (const p of pts) { g(0, 'VERTEX'); g(8, nomCalque(o.layer)); g(10, num(p[0])); g(20, num(p[1])); g(30, 0); }
      g(0, 'SEQEND'); g(8, nomCalque(o.layer));
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return versAnsi(L.join('\r\n') + '\r\n');
}

// ——— PDF ———
export const FORMATS = [['A4', 297, 210], ['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]];
const MARGE = 10, BANDE = 13;   // marge intérieure autour du dessin et hauteur du cartouche (mm)
export function choisirPage(l, h) {
  for (const [nom, a, b] of FORMATS) for (const [pw, ph] of [[a, b], [b, a]]) if (l + 2 * MARGE <= pw && h + 2 * MARGE + BANDE <= ph) return { nom, pw, ph, normalise: true };
  return { nom: 'sur mesure', pw: Math.ceil(l + 2 * MARGE), ph: Math.ceil(h + 2 * MARGE + BANDE), normalise: false };
}
const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255) : [0, 0, 0]; };
const largeurTrait = o => o.epais ? 0.8 : o.layer === 'Contours' ? 0.5 : (o.layer === 'Hachures' || o.layer === 'Cotes' || o.layer === 'Axes') ? 0.18 : 0.25;
function chainePdf(txt) {   // texte ANSI → chaîne PDF littérale ASCII (octal pour les octets hauts)
  let s = '';
  for (const c of versAnsi(txt)) s += c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c < 32 || c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c);
  return s;
}
export function ecrirePdf(plan, { nom = 'piece', date = '' } = {}) {
  const e = emprisePlan(plan.items), l = e[2] - e[0], h = e[3] - e[1], page = choisirPage(l, h);
  const tx = MARGE + (page.pw - 2 * MARGE - l) / 2 - e[0], ty = MARGE + BANDE + (page.ph - 2 * MARGE - BANDE - h) / 2 - e[1];
  const couleur = new Map(plan.calques.map(c => [c.nom, hex(c.rgb)]));
  const S = [], n = v => num(v), rgb = c => c.map(n).join(' ');
  S.push(`${n(72 / 25.4)} 0 0 ${n(72 / 25.4)} 0 0 cm`);                       // 1 unité = 1 mm
  S.push('1 J 1 j', '0.35 w 0 0 0 RG', `5 5 ${n(page.pw - 10)} ${n(page.ph - 10)} re S`, `5 ${5 + BANDE} m ${n(page.pw - 5)} ${5 + BANDE} l S`);   // cadre et cartouche
  const texte = (t, x, y, hh, rot, c) => { const u = [Math.cos(rot || 0), Math.sin(rot || 0)]; S.push(`${rgb(c)} rg BT /F1 ${n(hh)} Tf ${n(u[0])} ${n(u[1])} ${n(-u[1])} ${n(u[0])} ${n(x)} ${n(y)} Tm (${chainePdf(t)}) Tj ET`); };
  lignesCartouche(nom, date).forEach((t, i) => texte(t, 8, 5 + BANDE - 5 - i * 5, i ? 2.6 : 3.4, 0, [0.1, 0.15, 0.2]));
  for (const o of plan.items) {
    const c = couleur.get(o.layer) ?? [0, 0, 0], P = o.pts.map(p => [p[0] + tx, p[1] + ty]);
    if (o.kind === 'text') { if (String(o.texte).trim()) texte(o.texte, P[0][0], P[0][1], o.h, o.rot, c); continue; }
    if (P.length < 2) continue;
    const trace = P.map((p, i) => `${n(p[0])} ${n(p[1])} ${i ? 'l' : 'm'}`).join(' ');
    if (o.plein) { S.push(`${rgb(c)} rg ${rgb(c)} RG 0.1 w [] 0 d ${trace} h B`); continue; }
    const tirets = o.pointille ? ((o.layer === 'Axes' || o.layer === 'Plan de coupe') ? '[8 2 1 2] 0 d' : '[3 1.5] 0 d') : '[] 0 d';
    S.push(`${rgb(c)} RG ${n(largeurTrait(o))} w ${tirets} ${trace} S`);
  }
  const contenu = S.join('\n');
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.pw * 72 / 25.4)} ${n(page.ph * 72 / 25.4)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${contenu.length} >>\nstream\n${contenu}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Title (${chainePdf(sansAccent(`Mise en plan ${nom}`))}) /Creator (SDC Montage 3D) /Producer (SDC Montage 3D) >>`,
  ];
  let pdf = '%PDF-1.4\n%âãÏÓ\n'; const pos = [];
  objets.forEach((o, i) => { pos.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x0 = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n` + pos.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${x0}\n%%EOF\n`;
  // chaque caractère = un octet (latin-1) : le commentaire binaire de l'en-tête est écrit tel quel
  return { octets: Uint8Array.from([...pdf].map(ch => ch.charCodeAt(0) & 255)), format: page.nom, largeur: page.pw, hauteur: page.ph, normalise: page.normalise };
}

// ——— Points d'entrée pour l'interface ———
export function exporterDxf(dessin, cotes, opts = {}) { return ecrireDxf(composerPlan(dessin, cotes, { ...opts, cartouche: true }), opts); }
export function exporterPdf(dessin, cotes, opts = {}) { return ecrirePdf(composerPlan(dessin, cotes, { ...opts, cartouche: false }), opts); }
