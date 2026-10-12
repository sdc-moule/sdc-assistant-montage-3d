// Cotation automatique PROPOSÉE sur un plan 2D (DXF ou PDF) : cotes ordonnées depuis une référence choisie par l'utilisateur.
// Code pur (sans DOM), testable sous Node. Rien n'est validé d'office : tout est « proposé, à vérifier ».
// Hors périmètre : tolérances, ajustements, vérification de fabrication.
import { intersectionsItems } from './dxf.js';

const PRIORITE = { centre: 0, coin: 1, inter: 2 };

// Traits forts : calques « contours / épais » s'il y en a (plans PDF), sinon tous les traits pleins visibles (hors textes et pointillés).
export function traitsForts(dessin, visible = () => true) {
  const epais = dessin.calques.filter(c => /épais|contour|outline|thick/i.test(c.nom) && !/tirets/i.test(c.nom)).map(c => c.nom);
  const garde = o => o.kind !== 'text' && !o.pointille && visible(o);
  const items = dessin.items.filter(garde);
  return epais.length ? items.filter(o => epais.includes(o.layer)) : items;
}

// Cercles et arcs retenus pour les Ø : tout tracé plein visible, hors calques de cotes, axes, hachures (gris) et textes.
export function cerclesRetenus(dessin, visible = () => true) {
  const exclu = new Set(dessin.calques.filter(c => /cote|axe|gris|texte|tirets/i.test(c.nom)).map(c => c.nom));
  return dessin.items.filter(o => (o.kind === 'circle' || o.kind === 'arc') && o.r != null && !o.pointille && visible(o) && !exclu.has(o.layer));
}

const dansZone = (z, x, y, m = 1e-6) => x >= z.x0 - m && x <= z.x1 + m && y >= z.y0 - m && y <= z.y1 + m;
const boite = o => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of o.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; };

// origine : {x,y} ; zone : {x0,y0,x1,y1} ; categories : {centres, coins, inter} ; tol : pas de regroupement (unités du dessin)
export function proposerCotes(dessin, { origine, zone, categories = { centres: true, coins: true, inter: true }, visible = () => true, tol = 0.01, max = 60 } = {}) {
  const forts = traitsForts(dessin, visible).filter(o => { const b = boite(o); return b.x1 >= zone.x0 && b.x0 <= zone.x1 && b.y1 >= zone.y0 && b.y0 <= zone.y1; });
  const pts = [], dias = new Map();

  if (categories.centres) {
    for (const o of cerclesRetenus(dessin, visible)) {
      if (!dansZone(zone, o.c[0], o.c[1])) continue;
      pts.push({ x: o.c[0], y: o.c[1], cat: 'centre' });
      const k = `${o.kind}|${Math.round(o.r / tol)}`, g = dias.get(k);
      if (g) g.n++; else dias.set(k, { kind: o.kind, r: o.r, n: 1, c: [o.c[0], o.c[1]] });
    }
  }
  if (categories.coins) for (const o of forts) if (o.kind !== 'circle') for (const s of o.snap) if (s.t === 'extrémité' && dansZone(zone, s.x, s.y)) pts.push({ x: s.x, y: s.y, cat: 'coin' });
  if (categories.inter) {
    const bx = forts.map(boite);
    for (let i = 0; i < forts.length; i++) for (let j = i + 1; j < forts.length; j++) {
      const a = bx[i], b = bx[j];
      if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) continue;
      for (const q of intersectionsItems(forts[i], forts[j])) if (dansZone(zone, q[0], q[1])) pts.push({ x: q[0], y: q[1], cat: 'inter' });
    }
  }

  // Ordonnées uniques (une cote par valeur), la catégorie la plus « utile » l'emporte ; le point d'ancrage est celui le plus proche du bord de cotation.
  const regrouper = (cle, ancre, meilleur) => {
    const m = new Map();
    for (const p of pts) {
      const v = Math.round((p[cle] - origine[cle]) / tol) * tol, e = m.get(Math.round(v / tol));
      if (!e) m.set(Math.round(v / tol), { v, cat: p.cat, a: p[ancre] });
      else { if (PRIORITE[p.cat] < PRIORITE[e.cat]) e.cat = p.cat; if (meilleur(p[ancre], e.a)) e.a = p[ancre]; }
    }
    return [...m.values()];
  };
  let xs = regrouper('x', 'y', (n, o) => n > o), ys = regrouper('y', 'x', (n, o) => n < o);
  const tronque = { x: 0, y: 0 };
  const borner = (L, cle) => { if (L.length <= max) return L; L = [...L].sort((a, b) => PRIORITE[a.cat] - PRIORITE[b.cat] || a.v - b.v); tronque[cle] = L.length - max; return L.slice(0, max); };
  xs = borner(xs, 'x').sort((a, b) => a.v - b.v); ys = borner(ys, 'y').sort((a, b) => a.v - b.v);

  return {
    dias: [...dias.values()].sort((a, b) => b.r - a.r),
    xs: xs.map(e => ({ x: origine.x + e.v, py: e.a, cat: e.cat })),
    ys: ys.map(e => ({ y: origine.y + e.v, px: e.a, cat: e.cat })),
    tronque, nbForts: forts.length,
  };
}
