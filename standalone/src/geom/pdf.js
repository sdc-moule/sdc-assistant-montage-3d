// Lecture d'un plan PDF VECTORIEL → même structure de dessin que geom/dxf.js (calques, polylignes, cercles/arcs, textes).
// Code pur : la bibliothèque pdf.js est passée en paramètre (testable sous Node, chargée à la demande dans le navigateur).
// Unité : mm PAPIER (1 pt = 25,4/72 mm). Chaque vue d'un plan a sa propre échelle : voir l'outil « Échelle » de la vue 2D.
// Reprend les traits (stroke) et les textes. Images, remplissages pleins (flèches) et rognages ne sont pas repris.
// Un PDF scanné (image seule) ne contient aucun tracé : on le signale clairement, sans inventer de géométrie.

const PT = 25.4 / 72;
const COULEUR_NOIR = '#15202b';

const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function classe(rgb, largeurPt, tirets) {
  const [r, g, b] = rgb, gris = Math.abs(r - g) < 6 && Math.abs(g - b) < 6;
  let nom, couleur = hex(r, g, b);
  if (gris && r > 80) nom = 'Gris';
  else if (r < 40 && g < 40 && b > 200) nom = 'Cotes (bleu)';
  else if (r > 200 && g < 40 && b < 40) nom = 'Axes (rouge)';
  else if (gris) { nom = largeurPt >= 1.2 ? 'Contours (noir épais)' : 'Détails (noir fin)'; couleur = COULEUR_NOIR; } else nom = 'Couleur ' + couleur;
  return { nom: nom + (tirets ? ' · tirets' : ''), couleur };
}

// Cercle moyen par moindres carrés (Kåsa) ; null si le tracé n'est pas circulaire.
export function ajusteCercle(pts) {
  const n = pts.length; if (n < 6) return null;
  let sx = 0, sy = 0; for (const [x, y] of pts) { sx += x; sy += y; }
  const mx = sx / n, my = sy / n; let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, y] of pts) { const u = x - mx, v = y - my; suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; }
  const det = suu * svv - suv * suv; if (Math.abs(det) < 1e-12) return null;
  const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2, uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const cx = mx + uc, cy = my + vc; let r = 0; for (const [x, y] of pts) r += Math.hypot(x - cx, y - cy); r /= n;
  if (!(r > 1e-6)) return null;
  let dev = 0; for (const [x, y] of pts) dev = Math.max(dev, Math.abs(Math.hypot(x - cx, y - cy) - r));
  if (dev > 0.004 * r + 0.002) return null;                       // tolérance : 0,4 % du rayon + 2 µm papier
  // Balayage angulaire : un « arc » presque droit n'est pas un arc.
  let tot = 0, prev = Math.atan2(pts[0][1] - cy, pts[0][0] - cx);
  for (let i = 1; i < n; i++) { const a2 = Math.atan2(pts[i][1] - cy, pts[i][0] - cx); let d = a2 - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; tot += d; prev = a2; }
  if (Math.abs(tot) < 0.35) return null;                          // < 20° : on garde la polyligne
  return { c: [cx, cy], r, balayage: Math.abs(tot) };
}

function sommets(pts) { // extrémités + angles marqués : points d'accroche d'une polyligne (pas chaque petit segment d'une courbe)
  if (pts.length <= 40) return pts.map(p => p);
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]], b = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]], n = Math.hypot(...a) * Math.hypot(...b);
    if (n > 0 && (a[0] * b[0] + a[1] * b[1]) / n < Math.cos(0.35)) out.push(pts[i]);
  }
  out.push(pts.at(-1)); return out;
}

const TAILLE = { moveTo: 2, lineTo: 2, curveTo: 6, curveTo2: 4, curveTo3: 4, rectangle: 4, closePath: 0 };

// pdfjs : module pdf.js (getDocument, OPS) ; bytes : ArrayBuffer/Uint8Array ; page : numéro (1 = première)
export async function lirePdf(pdfjs, bytes, { page = 1 } = {}) {
  const O = pdfjs.OPS, u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(u8), useSystemFonts: false, verbosity: 0, isEvalSupported: false }).promise;
  const nbPages = doc.numPages, pg = await doc.getPage(Math.min(Math.max(1, page), nbPages));
  const [vx0, vy0, vx1, vy1] = pg.view, W = vx1 - vx0, H = vy1 - vy0;
  const ol = await pg.getOperatorList();
  const nom = {}; for (const [k, v] of Object.entries(O)) nom[v] = k;

  let ctm = [1, 0, 0, 1, 0, 0]; const pile = [];
  let largeur = 1, tirets = false, rgb = [0, 0, 0], sousChemins = [], cur = null, x0 = 0, y0 = 0, lx = 0, ly = 0;
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const P = (x, y) => [(ctm[0] * x + ctm[2] * y + ctm[4] - vx0) * PT, (ctm[1] * x + ctm[3] * y + ctm[5] - vy0) * PT];

  const items = [], calques = new Map(); let images = 0, remplissages = 0, rognes = 0, hors = 0;
  const lim = 1.02, borne = ([x, y]) => x >= -0.02 * W * PT && x <= lim * W * PT && y >= -0.02 * H * PT && y <= lim * H * PT;

  const emettre = () => {
    const echelle = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1, lp = largeur * echelle;
    const { nom: layer, couleur } = classe(rgb, lp, tirets);
    for (const s of sousChemins) {
      if (s.pts.length < 2) continue;
      if (!s.pts.every(borne)) { hors++; continue; }               // chemins de rognage démesurés présents dans certains PDF
      if (!calques.has(layer)) calques.set(layer, { nom: layer, rgb: couleur, couleur: 7, ltype: tirets ? 'DASHED' : 'CONTINUOUS', gele: false, nb: 0 });
      const ferme = Math.hypot(s.pts[0][0] - s.pts.at(-1)[0], s.pts[0][1] - s.pts.at(-1)[1]) < 1e-4;
      const o = { kind: 'poly', layer, pts: s.pts, pointille: tirets, snap: sommets(s.noeuds.length > 1 ? s.noeuds : s.pts).map(q => ({ x: q[0], y: q[1], t: 'extrémité' })) };
      const f = ajusteCercle(ferme ? s.pts.slice(0, -1) : s.pts);
      if (f) {
        o.kind = ferme ? 'circle' : 'arc'; o.c = f.c; o.r = f.r;
        o.snap = [{ x: f.c[0], y: f.c[1], t: 'centre' }];
        if (ferme) for (let q = 0; q < 4; q++) o.snap.push({ x: f.c[0] + f.r * Math.cos(q * Math.PI / 2), y: f.c[1] + f.r * Math.sin(q * Math.PI / 2), t: 'quadrant' });
        else o.snap.push({ x: s.pts[0][0], y: s.pts[0][1], t: 'extrémité' }, { x: s.pts.at(-1)[0], y: s.pts.at(-1)[1], t: 'extrémité' });
      }
      items.push(o);
    }
  };

  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i];
    switch (f) {
      case O.save: pile.push([ctm.slice(), largeur, tirets, rgb.slice()]); break;
      case O.restore: if (pile.length) [ctm, largeur, tirets, rgb] = pile.pop(); break;
      case O.transform: ctm = mul(ctm, Array.from(a)); break;
      case O.setLineWidth: largeur = a[0]; break;
      case O.setDash: tirets = Array.isArray(a[0]) && a[0].length > 0; break;
      case O.setStrokeRGBColor: rgb = [a[0], a[1], a[2]]; break;
      case O.setStrokeGray: rgb = [a[0], a[0], a[0]]; break;
      case O.setStrokeCMYKColor: { const [c, m, y, k] = Array.from(a).map(v => v / 255); rgb = [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)]; break; }
      case O.constructPath: {
        // L'état du chemin (point courant, sous-chemin ouvert) se poursuit d'un constructPath au suivant jusqu'au tracé.
        const ops = a[0], co = a[1]; let k = 0;
        const debut = (x, y) => { cur = { pts: [P(x, y)], noeuds: [P(x, y)] }; sousChemins.push(cur); x0 = lx = x; y0 = ly = y; };
        for (const op of ops) {
          const n = TAILLE[nom[op]] ?? 0;
          if (op === O.moveTo) debut(co[k], co[k + 1]);
          else if (op === O.lineTo) { if (!cur) debut(lx, ly); cur.pts.push(P(co[k], co[k + 1])); cur.noeuds.push(P(co[k], co[k + 1])); lx = co[k]; ly = co[k + 1]; }
          else if (op === O.curveTo || op === O.curveTo2 || op === O.curveTo3) {
            if (!cur) debut(lx, ly);
            let c1, c2, e;
            if (op === O.curveTo) { c1 = [co[k], co[k + 1]]; c2 = [co[k + 2], co[k + 3]]; e = [co[k + 4], co[k + 5]]; }
            else if (op === O.curveTo2) { c1 = [lx, ly]; c2 = [co[k], co[k + 1]]; e = [co[k + 2], co[k + 3]]; }
            else { c1 = [co[k], co[k + 1]]; c2 = [co[k + 2], co[k + 3]]; e = c2; }
            for (let j = 1; j <= 12; j++) { const t = j / 12, u = 1 - t; cur.pts.push(P(u * u * u * lx + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0], u * u * u * ly + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1])); }
            cur.noeuds.push(P(e[0], e[1])); lx = e[0]; ly = e[1];
          } else if (op === O.rectangle) {
            const [x, y, w, h] = [co[k], co[k + 1], co[k + 2], co[k + 3]]; debut(x, y);
            for (const q of [[x + w, y], [x + w, y + h], [x, y + h], [x, y]]) { cur.pts.push(P(q[0], q[1])); cur.noeuds.push(P(q[0], q[1])); } lx = x; ly = y;
          } else if (op === O.closePath && cur) { cur.pts.push(P(x0, y0)); cur.noeuds.push(P(x0, y0)); lx = x0; ly = y0; }
          k += n;
        }
        break;
      }
      case O.stroke: case O.closeStroke: case O.fillStroke: case O.eoFillStroke: case O.closeFillStroke: case O.closeEOFillStroke: emettre(); sousChemins = []; cur = null; break;
      case O.fill: case O.eoFill: remplissages++; sousChemins = []; cur = null; break;
      case O.clip: case O.eoClip: rognes++; break;
      case O.endPath: sousChemins = []; cur = null; break;
      case O.paintImageXObject: case O.paintInlineImageXObject: case O.paintImageMaskXObject: images++; break;
      default: break;
    }
  }

  // Textes (position, rotation, corps) — le plan reste lisible et les échelles « 4:1 » peuvent être proposées.
  const tc = await pg.getTextContent();
  for (const t of tc.items) {
    if (!t.str || !t.str.trim()) continue;
    const m = t.transform, corps = Math.hypot(m[0], m[1]) * PT, p = [(m[4] - vx0) * PT, (m[5] - vy0) * PT];
    const layer = 'Textes';
    if (!calques.has(layer)) calques.set(layer, { nom: layer, rgb: COULEUR_NOIR, couleur: 7, ltype: 'CONTINUOUS', gele: false, nb: 0 });
    items.push({ kind: 'text', layer, texte: t.str, h: corps * 0.8, rot: Math.atan2(m[1], m[0]), pts: [p], snap: [], pointille: false });
  }

  const cal = [...calques.values()];
  items.forEach((o, i) => { o.id = i; calques.get(o.layer).nb++; });
  const traits = items.filter(o => o.kind !== 'text').length;
  return {
    items, calques: cal, cadre: { x0: 0, y0: 0, x1: W * PT, y1: H * PT }, unite: 'mm', unite_inconnue: false, facteurMm: 1,
    papier: true, source: 'pdf', pages: nbPages, page: Math.min(Math.max(1, page), nbPages), traits,
    ignores: { ...(images ? { images } : {}), ...(remplissages ? { remplissages } : {}), ...(hors ? { 'chemins hors page': hors } : {}) },
  };
}
