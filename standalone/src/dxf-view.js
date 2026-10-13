// Vue 2D d'un plan DXF avec prise de cotes. Lecture seule : le fichier n'est jamais modifié.
// Le code géométrique (lecture, accroches, mesures) est dans geom/dxf.js ; ici seulement l'interface.
import { accroche, entiteProche, distance, angleEntre } from './geom/dxf.js';
import { proposerCotes } from './geom/cotation-auto.js';
import { exporterDxf, exporterPdf } from './geom/export-plan.js';
import { transformer, itemsAnnotations, nettoyer as nettoyerAnnots } from './geom/annotations.js';
import { dessinerAnnotations } from './annot-view.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); }
  for (const k of kids) e.append(k);
  return e;
};
const suffixe = (c, nomE) => (Math.abs(c.ech - 1) > 1e-9 ? ` · éch. ${nomE(c.ech)}` : '');
const f2 = v => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ACI = { 1: '#d32f2f', 2: '#b58900', 3: '#2e9e44', 4: '#00838f', 5: '#1f5f8b', 6: '#9c27b0', 7: '#15202b', 8: '#7a8896', 9: '#a0a8b0' };

let racine = null, etat = null;

export function dxfOuvert() { return !!racine; }

export function ouvrirDxf(dessin, nom, opts = {}) {
  const { toast = () => {}, mp = null } = opts;
  fermerDxf();
  const PLAN = !!mp;   // mode « mise en plan » : vues projetées d'une pièce 3D à l'échelle 1:1, cotation par clics et coupes
  const u = dessin.unite || 'mm';
  const E = etat = {
    d: dessin, nom, u, outil: 'dist', pend: [], autoOpt: { centres: true, coins: true, inter: true, tout: false }, autoCtx: null, ech: 1, cotesVis: true, survol: null, etiq: [], glisse: null, cotes: [], annots: nettoyerAnnots(opts.annots), annotsVis: true, masque: new Set(), snap: null,
    vue: { s: 1, ox: 0, oy: 0 }, w: 0, h: 0, pointeurs: new Map(), toast, mp, plan: { coupe: 'XZ', inverse: false }, dec: { valeurs: [], bords: [] }, apercu: null,
  };
  if (PLAN) E.outil = 'ph';
  // Échelles lues dans les textes du plan (« 4:1 », « (40:1) », « Echelle: 4/1 ») : proposées, jamais appliquées d'office.
  const detectees = new Map();
  for (const o of PLAN ? [] : dessin.items) if (o.kind === 'text') {
    const m = /(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*[:/]\s*(\d+(?:[.,]\d+)?)(?![\d.,])/.exec(o.texte);
    if (!m) continue; // seulement n:1 ou 1:n retenus ci-dessous (écarte dates, duretés…)
    const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[2].replace(',', '.'));
    if (a > 0 && b > 0 && a !== b && Math.min(a, b) === 1 && Math.max(a, b) <= 1000) detectees.set(`${m[1]}:${m[2]}`.replace(',', '.'), a / b);
  }
  const STANDARD = ['1:1', '2:1', '4:1', '5:1', '10:1', '20:1', '40:1', '1:2', '1:5', '1:10', '1:20', '1:50', '1:100'];
  const parseEch = t => { const m = /^\s*(\d+(?:[.,]\d+)?)\s*[:/]\s*(\d+(?:[.,]\d+)?)\s*$/.exec(t); if (!m) return null; const v = parseFloat(m[1].replace(',', '.')) / parseFloat(m[2].replace(',', '.')); return v > 0 && Number.isFinite(v) ? v : null; };
  const nomEch = r => { const c = [...detectees, ...STANDARD.map(x => [x, parseEch(x)])].find(([, v]) => Math.abs(v - r) < 1e-9); return c ? c[0] : `${+r.toFixed(4)}:1`; };
  const selEch = el('select', { class: 'btn dxf-ech', title: "Échelle de la vue à mesurer (papier : réel). Les cotes suivantes sont ramenées à la vraie grandeur." });
  const remplirEch = () => {
    selEch.textContent = '';
    for (const [k] of detectees) selEch.append(el('option', { value: k }, `${k} (lue dans le plan, à vérifier)`));
    for (const k of STANDARD) if (!detectees.has(k)) selEch.append(el('option', { value: k }, k + (k === '1:1' ? ' (papier = réel)' : '')));
    selEch.append(el('option', { value: 'autre' }, 'Autre…'));
    const cur = nomEch(E.ech);
    if (![...selEch.options].some(o => o.value === cur)) selEch.insertBefore(el('option', { value: cur }, cur), selEch.firstChild);
    selEch.value = cur;
  };
  selEch.onchange = () => {
    if (selEch.value === 'autre') { const t = prompt('Échelle de la vue (papier:réel), par exemple 4:1 ou 1:20'); const v = t && parseEch(t); if (v) E.ech = v; else E.toast('Échelle non reconnue : format attendu 4:1 ou 1:20.'); } else E.ech = parseEch(selEch.value) ?? E.ech;
    remplirEch(); E.pend = []; dessiner();
  };
  const canvas = el('canvas', { class: 'dxf-canvas' });
  const infos = el('div', { class: 'dxf-info' });
  const aide = el('div', { class: 'dxf-aide' });
  const menuCalques = el('div', { class: 'dxf-calques', hidden: '' });
  const panAuto = el('div', { class: 'dxf-auto', hidden: '' });
  const panCoupe = el('div', { class: 'dxf-auto dxf-coupe', hidden: '' });
  const outils = PLAN ? [
    ['ph', 'Cote horizontale', 'Cliquer deux points (ou un trait), puis la zone HORS pièce où placer la cote'],
    ['pv', 'Cote verticale', 'Cliquer deux points (ou un trait), puis la zone HORS pièce où placer la cote'],
    ['pa', 'Cote alignée', 'Cliquer deux points (ou un trait), puis la zone HORS pièce où placer la cote'],
    ['pr', 'Ø / R', 'Cliquer un cercle (Ø) ou un arc (R), puis la zone HORS pièce où placer la cote'],
    ['coupe', 'Coupe', 'Créer une coupe : plan XZ ou YZ passant par un point cliqué (centre de cercle, intersection, milieu de droite)'],
    ['coupd', 'Coupe décalée', 'Coupe à plans parallèles décalés : cliquer un point par plan, et la position de chaque décrochement dans la vue de dessus'],
    ['aux', 'Vue auxiliaire', 'Vue de la pièce perpendiculairement à une droite inclinée : cliquer deux points (ou la droite) dans une vue'],
  ] : [
    ['dist', 'Distance', 'Cliquer deux points : distance directe'],
    ['dxy', 'ΔX / ΔY', 'Cliquer deux points : écarts horizontal et vertical'],
    ['rad', 'Ø / R', 'Cliquer un cercle ou un arc : diamètre et rayon'],
    ['ang', 'Angle', 'Cliquer trois points : sommet, puis les deux côtés'],
    ['auto', 'Cotation auto', "Propose des cotes ordonnées depuis une référence : cliquer la référence, puis deux coins de la zone"],
    ['cal', 'Calibrer', "Cliquer deux points dont vous connaissez la vraie longueur : l'échelle en est déduite"],
  ];
  const bOut = {}; let bCotes = null, bAnnots = null;
  const barre = el('div', { class: 'dxf-bar' },
    el('strong', {}, (PLAN ? 'Mise en plan · ' : 'Plan 2D · ') + nom),
    ...outils.map(([k, t, h]) => (bOut[k] = el('button', { class: 'btn dxf-outil', title: h, onclick: () => choisir(k) }, t))),
    PLAN ? el('span', { class: 'dxf-echl', title: 'Les vues sont à l’échelle 1:1 : valeurs en vraie grandeur' }, 'Échelle 1:1') : el('label', { class: 'dxf-echl' }, 'Échelle ', selEch),
    el('button', { class: 'btn', title: 'Cadrer tout le dessin', onclick: () => cadrer() }, 'Ajuster'),
    el('button', { class: 'btn', title: 'Afficher / masquer des calques', onclick: () => { menuCalques.hidden = !menuCalques.hidden; } }, 'Calques'),
    (bCotes = el('button', { class: 'btn', title: 'Masquer ou afficher les cotes (pour voir le dessin dessous)', onclick: () => { E.cotesVis = !E.cotesVis; bCotes.textContent = E.cotesVis ? 'Masquer cotes' : 'Afficher cotes'; planifier(); } }, 'Masquer cotes')),
    ...(PLAN ? [el('button', { class: 'btn', title: 'Retirer la dernière coupe créée', onclick: () => retirerCoupe() }, 'Retirer coupe'), el('button', { class: 'btn', title: 'Retirer la dernière vue auxiliaire créée', onclick: () => retirerAux() }, 'Retirer vue aux.')] : []),
    el('button', { class: 'btn', title: 'Annuler la dernière cote', onclick: () => { E.pend = []; E.cotes.pop(); dessiner(); } }, 'Annuler'),
    el('button', { class: 'btn', title: 'Effacer toutes les cotes', onclick: () => { E.pend = []; E.cotes = []; dessiner(); } }, 'Effacer'),
    el('button', { class: 'btn', title: 'Exporter les cotes en CSV', onclick: () => exporter() }, 'Cotes CSV'),
    ...(PLAN ? [el('button', { class: 'btn', title: 'Exporter le plan et ses cotes en DXF (1:1, mm)', onclick: () => exporterPlan('dxf') }, 'Export DXF'), el('button', { class: 'btn', title: 'Exporter le plan et ses cotes en PDF vectoriel (1:1)', onclick: () => exporterPlan('pdf') }, 'Export PDF')] : []),
    ...(PLAN ? [(bAnnots = el('button', { class: 'btn', title: 'Masquer ou afficher les annotations (elles sont exportées en DXF / PDF sur le calque ANNOTATIONS quand elles sont affichées)', onclick: () => { E.annotsVis = !E.annotsVis; bAnnots.textContent = E.annotsVis ? 'Masquer annotations' : 'Afficher annotations'; planifier(); } }, 'Masquer annotations'))] : []),
    ...(opts.annoter ? [el('button', { class: 'btn', title: 'Annoter une capture de ce plan : flèches, textes, formes (indicatif, le plan n’est pas modifié)', onclick: () => annoterCapture() }, '📝 Annoter')] : []),
    el('button', { class: 'btn primary', title: 'Revenir à la vue 3D', onclick: () => fermerDxf() }, 'Fermer'),
  );
  racine = el('div', { id: 'dxf-view', class: 'dxf-view' }, barre, el('div', { class: 'dxf-zone' }, canvas, menuCalques, panAuto, panCoupe, aide, infos));
  document.body.append(racine);

  function annoterCapture() {
    dessiner();
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(canvas, 0, 0);
    // En mise en plan, les annotations sont gardées en mm (repère du plan) : on transmet le repère de la capture.
    const k = c.width / E.w, map = PLAN ? { kx: k * E.vue.s, ky: -k * E.vue.s, tx: k * E.vue.ox, ty: k * E.vue.oy } : null;
    opts.annoter(c, map, E.annots, items => { E.annots = items; opts.onAnnots?.(items); planifier(); });
  }

  function remplirCalques() {
    menuCalques.textContent = '';
    for (const c of E.d.calques) {
      if (c.gele && !E.vus) E.masque.add(c.nom);                 // calques gelés : masqués à l'ouverture seulement
      const cb = el('input', { type: 'checkbox' }); cb.checked = !E.masque.has(c.nom);
      cb.onchange = () => { if (cb.checked) E.masque.delete(c.nom); else E.masque.add(c.nom); dessiner(); };
      menuCalques.append(el('label', { class: 'mi' }, cb, `${c.nom} (${c.nb})`));
    }
    E.vus = new Set(E.d.calques.map(c => c.nom));
  }
  remplirCalques();
  const ig = Object.entries(E.d.ignores);
  const texteInfos = () => PLAN ? `Mise en plan 1:1 · projection européenne (face, dessous = dessus, à droite = gauche) · ${E.d.items.length} entités · valeurs INDICATIVES (maillage d'affichage, ≈ ±0,05 mm) : à vérifier avant toute fabrication` : null;
  infos.textContent = texteInfos() ?? (E.d.papier ? 'Plan PDF : mm papier — choisir l\'échelle de chaque vue · ' : '') + `${E.d.items.length} entités · unité : ${E.d.unite_inconnue ? 'mm (supposée, non indiquée dans le fichier)' : u}` + (ig.length ? ` · ignoré : ${ig.map(([k, n]) => `${k} ×${n}`).join(', ')}` : '');

  const ctx = canvas.getContext('2d');
  const px = (x, y) => [x * E.vue.s + E.vue.ox, -y * E.vue.s + E.vue.oy];       // monde → écran
  const mond = (X, Y) => [(X - E.vue.ox) / E.vue.s, -(Y - E.vue.oy) / E.vue.s];  // écran → monde
  const visible = o => !E.masque.has(o.layer);
  // En mise en plan, hachures, axes, plan de coupe et titres ne se désignent pas (ce ne sont pas des arêtes de la pièce).
  const filtre = o => visible(o) && (!PLAN || (!o.hachure && !o.axe && o.layer !== 'Titres' && o.layer !== 'Axes' && o.layer !== 'Plan de coupe'));

  function redim() {
    const r = canvas.parentElement.getBoundingClientRect(), k = devicePixelRatio || 1;
    E.w = Math.max(50, r.width); E.h = Math.max(50, r.height);
    canvas.width = Math.round(E.w * k); canvas.height = Math.round(E.h * k);
    canvas.style.width = E.w + 'px'; canvas.style.height = E.h + 'px';
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }
  function cadrer() {
    const c = E.d.cadre, dw = Math.max(1e-6, c.x1 - c.x0), dh = Math.max(1e-6, c.y1 - c.y0), m = 0.9;
    E.vue.s = Math.min(E.w * m / dw, E.h * m / dh);
    E.vue.ox = E.w / 2 - ((c.x0 + c.x1) / 2) * E.vue.s;
    E.vue.oy = E.h / 2 + ((c.y0 + c.y1) / 2) * E.vue.s;
    dessiner();
  }
  E.cadrer = cadrer;

  // reg = { c, cle } : étiquette de cote déplaçable (décalage mémorisé en unités du dessin, suit le zoom).
  function etiquette(txt, X, Y, couleur = '#12324b', reg = null, _decale = false, nu = false) {
    ctx.font = (nu ? '600 15px' : '600 14px') + ' system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(txt).width + 10;
    if (reg) {
      const off = reg.c.off?.[reg.cle];
      if (off && (off[0] || off[1])) {
        const X1 = X + off[0] * E.vue.s, Y1 = Y - off[1] * E.vue.s;
        ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = couleur; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X1, Y1); ctx.stroke(); ctx.restore();
        X = X1; Y = Y1;
      }
      E.etiq.push({ c: reg.c, cle: reg.cle, x: X - w / 2, y: Y - 11, w, h: 22 });
    }
    ctx.fillStyle = nu ? 'rgba(255,255,255,.88)' : 'rgba(255,255,255,.93)'; ctx.fillRect(X - w / 2, Y - 11, w, 22);
    if (!nu) { ctx.strokeStyle = couleur; ctx.lineWidth = 1; ctx.strokeRect(X - w / 2, Y - 11, w, 22); }
    ctx.fillStyle = couleur; ctx.fillText(txt, X, Y);
  }
  function fleche(a, b, couleur) {
    ctx.strokeStyle = couleur; ctx.fillStyle = couleur; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    for (const [p, q] of [[a, b], [b, a]]) {
      const t = Math.atan2(q[1] - p[1], q[0] - p[0]), L = 9;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + L * Math.cos(t - 0.35), p[1] + L * Math.sin(t - 0.35)); ctx.lineTo(p[0] + L * Math.cos(t + 0.35), p[1] + L * Math.sin(t + 0.35)); ctx.closePath(); ctx.fill();
    }
  }
  function point(p, couleur, r = 4) { const [X, Y] = px(p.x, p.y); ctx.fillStyle = couleur; ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fill(); }

  const COL_PROP = '#1f77d0', COL_OK = '#e8730c';
  function dessinerCote(c) {
    if (c.t === 'ordx' || c.t === 'ordy') return;   // dessinées ensemble (étagement des étiquettes)
    if (c.t[0] === 'p') return dessinerCotePlan(c);
    const col = c.auto && !c.valide ? COL_PROP : COL_OK;
    if (c.t === 'dist') {
      const A = px(c.a.x, c.a.y), B = px(c.b.x, c.b.y); fleche(A, B, col);
      etiquette(`${f2(distance(c.a, c.b) / c.ech)} ${u}${suffixe(c, nomEch)}`, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, col, { c, cle: 'm' });
    } else if (c.t === 'dxy') {
      const C = { x: c.b.x, y: c.a.y }, A = px(c.a.x, c.a.y), B = px(c.b.x, c.b.y), K = px(C.x, C.y);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#9aa7b4'; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.setLineDash([]);
      if (Math.abs(c.b.x - c.a.x) > 1e-9) { fleche(A, K, col); etiquette(`ΔX ${f2(Math.abs(c.b.x - c.a.x) / c.ech)} ${u}${suffixe(c, nomEch)}`, (A[0] + K[0]) / 2, (A[1] + K[1]) / 2 + (B[1] > A[1] ? -16 : 16), col, { c, cle: 'x' }); }
      if (Math.abs(c.b.y - c.a.y) > 1e-9) { fleche(K, B, col); etiquette(`ΔY ${f2(Math.abs(c.b.y - c.a.y) / c.ech)} ${u}`, K[0] + (B[0] > A[0] ? 34 : -34), (K[1] + B[1]) / 2, col, { c, cle: 'y' }); }
    } else if (c.t === 'rad') {
      const C = px(c.c.x, c.c.y), r = c.r * E.vue.s, n = c.n > 1 ? `${c.n}× ` : '';
      const txt = c.arc ? `${n}R ${f2(c.r / c.ech)} ${u}${suffixe(c, nomEch)}` : `${n}Ø ${f2(2 * c.r / c.ech)} · R ${f2(c.r / c.ech)} ${u}${suffixe(c, nomEch)}`;
      if (c.auto) {   // proposition : étiquette sortie du cercle avec un trait de rappel, pour ne pas masquer le dessin
        const A = [C[0] + r * 0.7071, C[1] - r * 0.7071];
        ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(C[0], C[1], r, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(A[0] + 14, A[1] - 14); ctx.stroke();
        etiquette(txt, A[0] + 14, A[1] - 14, col, { c, cle: 'm' }, true);
      } else {
        ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(C[0] - r * Math.cos(0.7), C[1] + r * Math.sin(0.7)); ctx.lineTo(C[0] + r * Math.cos(0.7), C[1] - r * Math.sin(0.7)); ctx.stroke();
        etiquette(txt, C[0], C[1], col, { c, cle: 'm' });
      }
    } else if (c.t === 'ang') {
      const S = px(c.s.x, c.s.y), A = px(c.a.x, c.a.y), B = px(c.b.x, c.b.y);
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(S[0], S[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      const a0 = Math.atan2(A[1] - S[1], A[0] - S[0]), a1 = Math.atan2(B[1] - S[1], B[0] - S[0]); let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      ctx.beginPath(); ctx.arc(S[0], S[1], 30, a0, a0 + d, d < 0); ctx.stroke();
      const mid = a0 + d / 2; etiquette(`${f2(angleEntre(c.s, c.a, c.b))} °`, S[0] + 52 * Math.cos(mid), S[1] + 52 * Math.sin(mid), col, { c, cle: 'm' });
    }
    for (const k of ['a', 'b', 's']) if (c[k]) point(c[k], col, 3.5);
  }


  // ——— Cotes de la mise en plan : traits fins (ligne de cote, lignes de rappel, flèches), valeur et Ø/R posés à l'endroit cliqué par l'opérateur ———
  const COL_DIM = '#12324b';
  function valeurPlan(c) {
    if (c.t === 'ph') return Math.abs(c.b.x - c.a.x);
    if (c.t === 'pv') return Math.abs(c.b.y - c.a.y);
    if (c.t === 'pa') return distance(c.a, c.b);
    return c.t === 'pdia' ? 2 * c.r : c.r;
  }
  const textePlan = c => (c.t === 'pdia' || c.dia ? 'Ø ' : c.t === 'prad' ? 'R ' : '') + f2(valeurPlan(c));
  function pointe(tip, d) {      // flèche pleine : pointe en tip, d = direction unitaire de la queue vers la pointe
    const L = 10, Wd = 3.2, bx = tip[0] - d[0] * L, by = tip[1] - d[1] * L;
    ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(bx - d[1] * Wd, by + d[0] * Wd); ctx.lineTo(bx + d[1] * Wd, by - d[0] * Wd); ctx.closePath(); ctx.fill();
  }
  function dessinerCotePlan(c, apercu = false) {
    const col = apercu ? '#e8730c' : COL_DIM, G = 3, O = 6;
    ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]);
    const seg = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
    const P = px(c.p.x, c.p.y);
    let T = null;                                   // point d'ancrage du texte (écran)
    if (c.t === 'pdia' || c.t === 'prad') {
      const C = px(c.c.x, c.c.y), r = c.r * E.vue.s;
      let d = [P[0] - C[0], P[1] - C[1]]; const n = Math.hypot(d[0], d[1]) || 1; d = [d[0] / n, d[1] / n];
      const P2 = [C[0] + d[0] * r, C[1] + d[1] * r], P1 = [C[0] - d[0] * r, C[1] - d[1] * r];
      if (c.t === 'pdia') {
        seg(P1, P); pointe(P1, [-d[0], -d[1]]);
        if (2 * r >= 30) pointe(P2, d); else pointe(P2, [-d[0], -d[1]]);   // petit cercle : flèche côté extérieur
      } else { seg(C, P); pointe(P2, d); ctx.beginPath(); ctx.arc(C[0], C[1], 2, 0, 7); ctx.fill(); }
      T = [P[0] + d[0] * 6, P[1] + d[1] * 6];
    } else {
      const A = px(c.a.x, c.a.y), B = px(c.b.x, c.b.y);
      let A1, B1, ea, eb;                           // pieds de la ligne de cote ; direction des lignes de rappel
      if (c.t === 'ph') { A1 = [A[0], P[1]]; B1 = [B[0], P[1]]; ea = [0, Math.sign(P[1] - A[1]) || 1]; eb = [0, Math.sign(P[1] - B[1]) || 1]; }
      else if (c.t === 'pv') { A1 = [P[0], A[1]]; B1 = [P[0], B[1]]; ea = [Math.sign(P[0] - A[0]) || 1, 0]; eb = [Math.sign(P[0] - B[0]) || 1, 0]; }
      else {
        const l = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, e = [(B[0] - A[0]) / l, (B[1] - A[1]) / l], nn = [-e[1], e[0]], dd = (P[0] - A[0]) * nn[0] + (P[1] - A[1]) * nn[1], sg = Math.sign(dd) || 1;
        A1 = [A[0] + nn[0] * dd, A[1] + nn[1] * dd]; B1 = [B[0] + nn[0] * dd, B[1] + nn[1] * dd]; ea = eb = [nn[0] * sg, nn[1] * sg];
      }
      // lignes de rappel (trait fin) : de l'objet vers la ligne de cote, avec jeu à l'objet et dépassement
      for (const [Q, Q1, e] of [[A, A1, ea], [B, B1, eb]]) seg([Q[0] + e[0] * G, Q[1] + e[1] * G], [Q1[0] + e[0] * O, Q1[1] + e[1] * O]);
      const L = Math.hypot(B1[0] - A1[0], B1[1] - A1[1]);
      if (L > 1) {
        const e = [(B1[0] - A1[0]) / L, (B1[1] - A1[1]) / L];
        if (L >= 34) { seg(A1, B1); pointe(A1, [-e[0], -e[1]]); pointe(B1, e); }
        else { seg([A1[0] - e[0] * 16, A1[1] - e[1] * 16], [B1[0] + e[0] * 16, B1[1] + e[1] * 16]); pointe(A1, e); pointe(B1, [-e[0], -e[1]]); }   // cote courte : flèches à l'extérieur
      }
      T = [(A1[0] + B1[0]) / 2, (A1[1] + B1[1]) / 2];
    }
    ctx.restore();
    if (apercu) { etiquette(textePlan(c), T[0], T[1], col, null, false, true); return; }
    etiquette(textePlan(c), T[0], T[1], col, { c, cle: 'm' }, false, true);
  }

  function dessiner() {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, E.w, E.h); E.etiq = [];
    const cal = new Map(E.d.calques.map(c => [c.nom, c]));
    for (const o of E.d.items) {
      if (!visible(o)) continue;
      const cl = cal.get(o.layer), col = cl?.rgb ?? ACI[cl?.couleur] ?? ACI[7];
      ctx.strokeStyle = o.pointille && !PLAN ? '#6b7b8c' : col; ctx.lineWidth = PLAN ? (o.epais ? 3 : o.layer === 'Contours' ? 2 : o.layer === 'Hachures' ? 0.8 : 1) : (o.pointille ? 1 : 1.5);   // plan : contours forts, le reste en trait fin
      ctx.setLineDash(o.pointille ? [7, 4] : []);
      if (o.kind === 'text') { const [X, Y] = px(o.pts[0][0], o.pts[0][1]); ctx.setLineDash([]); if (o.h * E.vue.s < 3) continue; ctx.fillStyle = col; ctx.font = `${o.h * E.vue.s}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.save(); ctx.translate(X, Y); ctx.rotate(-(o.rot || 0)); ctx.fillText(o.texte, 0, 0); ctx.restore(); continue; }
      ctx.beginPath();
      o.pts.forEach((p, i) => { const [X, Y] = px(p[0], p[1]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      if (o.plein) { ctx.fillStyle = col; ctx.fill(); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (PLAN && E.outil === 'coupd') dessinerTraceDecale();
    if (E.survol && filtre(E.survol)) {          // élément sous la souris : changement de couleur et trait épaissi
      ctx.strokeStyle = '#d81b9a'; ctx.lineWidth = 3.5; ctx.beginPath();
      E.survol.pts.forEach((p, i) => { const [X, Y] = px(p[0], p[1]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke();
    }
    if (E.cotesVis) { for (const c of E.cotes) dessinerCote(c); dessinerOrdonnees(); }
    if (E.annotsVis && E.annots.length) { ctx.save(); ctx.setLineDash([]); dessinerAnnotations(ctx, transformer(E.annots, { kx: E.vue.s, ky: -E.vue.s, tx: E.vue.ox, ty: E.vue.oy })); ctx.restore(); }
    if (PLAN && E.apercu) { const t = coteEnCours(E.apercu); if (t) dessinerCotePlan(t, true); }
    if (E.outil === 'auto' && E.pend.length === 2 && E.snap) {   // zone en cours de tracé
      const A = px(E.pend[1].x, E.pend[1].y), B = px(E.snap.x, E.snap.y); ctx.setLineDash([5, 4]); ctx.strokeStyle = COL_PROP; ctx.lineWidth = 1.2; ctx.strokeRect(Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1])); ctx.setLineDash([]);
    }
    for (const p of E.pend) point(p, '#e8730c', 5);
    if (E.snap) {
      const [X, Y] = px(E.snap.x, E.snap.y); ctx.strokeStyle = '#1d8a4b'; ctx.lineWidth = 2; ctx.strokeRect(X - 7, Y - 7, 14, 14);
      etiquette(E.snap.t, X + 10, Y - 20, '#1d8a4b'); ctx.textAlign = 'left';
    }
    aide.textContent = texteAide() + (E.survol ? ' ▸ ' + decrire(E.survol) : '');
  }
  // Cotes ordonnées : une ligne d'attache par valeur, étiquettes alignées au-dessus (X) et à gauche (Y) de la zone, étagées pour ne pas se chevaucher.
  function dessinerOrdonnees() {
    const lot = E.cotes.filter(c => c.t === 'ordx' || c.t === 'ordy');
    for (const t of ['ordx', 'ordy']) {
      const L = lot.filter(c => c.t === t); if (!L.length) continue;
      const horiz = t === 'ordx', pad = 7;                 // distance de la zone, en unités du dessin
      const items = L.map(c => {
        const z = c.zone, ancre = horiz ? px(c.x, c.py) : px(c.px, c.y), base = horiz ? px(c.x, z.y1 + pad) : px(z.x0 - pad, c.y);
        const val = horiz ? (c.x - c.o.x) / c.ech : (c.y - c.o.y) / c.ech;
        return { c, ancre, base, txt: f2(val), col: c.auto && !c.valide ? COL_PROP : COL_OK };
      }).sort((a, b) => horiz ? a.base[0] - b.base[0] : a.base[1] - b.base[1]);
      ctx.font = '600 14px system-ui, sans-serif';
      const fin = [0, 0, 0, 0]; // fin occupée de chaque rangée (px)
      for (const it of items) {
        const w = ctx.measureText(it.txt).width + 10, deb = horiz ? it.base[0] - w / 2 : it.base[1] - 11, taille = horiz ? w : 22;
        let r = 0; while (r < 3 && deb < fin[r] + 2) r++;
        r = Math.min(r, 3); fin[r] = deb + taille;
        const X = horiz ? it.base[0] : it.base[0] - 8 - w / 2 - r * 72, Y = horiz ? it.base[1] - 8 - r * 24 : it.base[1];
        ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = it.col; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(it.ancre[0], it.ancre[1]); ctx.lineTo(X, Y); ctx.stroke(); ctx.restore();
        ctx.fillStyle = it.col; ctx.beginPath(); ctx.arc(it.ancre[0], it.ancre[1], 2.5, 0, 7); ctx.fill();
        etiquette(it.txt, X, Y, it.col, { c: it.c, cle: 'm' });
      }
    }
  }
  let rafId = 0;
  const planifier = () => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; if (racine) dessiner(); }); };
  function decrire(o) {
    const k = E.ech, l = o.pts.reduce((t, p, i) => (i ? t + Math.hypot(p[0] - o.pts[i - 1][0], p[1] - o.pts[i - 1][1]) : 0), 0);
    if (o.kind === 'circle') return `Cercle Ø ${f2(2 * o.r / k)} ${u} (${o.layer})`;
    if (o.kind === 'arc') return `Arc R ${f2(o.r / k)} ${u} (${o.layer})`;
    return `${o.kind === 'line' ? 'Segment' : 'Tracé'} ${f2(l / k)} ${u} (${o.layer})`;
  }

  function texteAide() {
    const o = E.outil, n = E.pend.length;
    if (PLAN) {
      if (o === 'coupe') return `Coupe ${E.plan.coupe} : cliquer un centre de cercle, une intersection ou un milieu de droite.`;
      if (o === 'aux') return n ? 'Vue auxiliaire : cliquer le 2e point de la droite (dans la même vue).' : 'Vue auxiliaire : cliquer le 1er point (ou la droite entière) dans la vue de face, de dessus ou de gauche.';
      if (o === 'coupd') { const q = E.dec; return !q.valeurs.length ? `Coupe décalée ${E.plan.coupe} : cliquer, dans la vue de DESSUS, un point (centre, intersection, milieu) du 1er plan.` : q.valeurs.length > q.bords.length ? 'Cliquer, dans la vue de dessus, la position du décrochement (seule la coordonnée le long du plan compte).' : `Cliquer un point du plan n°${q.valeurs.length + 1}` + (q.valeurs.length >= 2 ? ' ou « Terminer ».' : '.'); }
      if (o === 'pr') return n ? 'Ø / R : cliquer la zone HORS pièce où placer la cote.' : 'Ø / R : cliquer le trait d’un cercle (Ø) ou d’un arc (R).';
      return ['Cliquer le 1er point (ou un trait entier).', 'Cliquer le 2e point.', 'Cliquer la zone HORS pièce où placer la cote.'][n] ?? '';
    }
    if (o === 'auto') return ['Cotation auto : cliquer la RÉFÉRENCE (origine des cotes).', E.autoOpt.tout ? '' : 'Cotation auto : cliquer un coin de la zone à coter.', 'Cotation auto : cliquer le coin opposé de la zone.'][n] ?? '';
    if (o === 'rad') return 'Ø / R : cliquer un cercle ou un arc de cercle.' + (Math.abs(E.ech - 1) > 1e-9 ? ` Échelle ${nomEch(E.ech)} appliquée.` : '');
    if (o === 'ang') return ['Angle : cliquer le sommet.', 'Angle : cliquer un point du 1er côté.', 'Angle : cliquer un point du 2e côté.'][n] ?? '';
    const lib = o === 'dxy' ? 'ΔX / ΔY' : o === 'cal' ? 'Calibrage' : 'Distance';
    return `${lib} : ${n ? 'cliquer le 2e point.' : 'cliquer le 1er point.'} ${Math.abs(E.ech - 1) > 1e-9 ? `Échelle ${nomEch(E.ech)} : valeurs ramenées au réel (indicatif).` : 'Échelle 1:1 (papier = réel) — choisir l\'échelle de la vue si le plan est à l\'échelle.'}`;
  }
  // Cotation auto : proposition (cotes bleues) à valider ou ignorer ; chaque catégorie se coche/décoche.
  function proposer() {
    const ctxA = E.autoCtx; if (!ctxA) return;
    E.cotes = E.cotes.filter(c => !(c.auto && !c.valide));
    const r = proposerCotes(E.d, { origine: ctxA.o, zone: ctxA.zone, categories: { centres: E.autoOpt.centres, coins: E.autoOpt.coins, inter: E.autoOpt.inter }, visible });
    for (const g of r.dias) E.cotes.push({ t: 'rad', c: { x: g.c[0], y: g.c[1] }, r: g.r, n: g.n, arc: g.kind === 'arc', ech: E.ech, auto: true, valide: false });
    for (const e of r.xs) E.cotes.push({ t: 'ordx', o: ctxA.o, zone: ctxA.zone, x: e.x, py: e.py, ech: E.ech, auto: true, valide: false, cat: e.cat });
    for (const e of r.ys) E.cotes.push({ t: 'ordy', o: ctxA.o, zone: ctxA.zone, y: e.y, px: e.px, ech: E.ech, auto: true, valide: false, cat: e.cat });
    E.cotesVis = true; if (bCotes) bCotes.textContent = 'Masquer cotes';
    E.autoInfo = `${r.dias.length} Ø/R · ${r.xs.length} ordonnées X · ${r.ys.length} ordonnées Y (${r.nbForts} traits forts)` + (r.tronque.x + r.tronque.y ? ` — ${r.tronque.x + r.tronque.y} ordonnées non proposées (limite 60 par axe) : réduire la zone` : '');
    majPanneauAuto();
  }
  function majPanneauAuto() {
    const props = E.cotes.filter(c => c.auto && !c.valide).length;
    panAuto.hidden = !(E.outil === 'auto' || props);
    if (panAuto.hidden) return;
    panAuto.textContent = '';
    const cb = (cle, txt) => { const i = el('input', { type: 'checkbox' }); i.checked = E.autoOpt[cle]; i.onchange = () => { E.autoOpt[cle] = i.checked; if (cle === 'tout') return; proposer(); dessiner(); }; return el('label', { class: 'mi' }, i, txt); };
    panAuto.append(el('strong', {}, 'Cotation automatique'), cb('tout', 'Zone = tout le plan'), cb('centres', 'Centres de perçages (Ø et positions)'), cb('coins', 'Coins des traits forts'), cb('inter', 'Intersections'),
      el('small', {}, E.autoInfo ?? 'Traits forts : contours épais (PDF) ou traits pleins visibles. Les calques masqués sont ignorés.'),
      el('small', {}, props ? `${props} cotes PROPOSÉES (bleues), à vérifier. Double-clic sur une cote : la supprimer.` : ''),
      el('div', { class: 'dxf-auto-btn' },
        el('button', { class: 'btn primary', onclick: () => { for (const c of E.cotes) if (c.auto) c.valide = true; majPanneauAuto(); dessiner(); E.toast('Cotes validées par vous : elles restent indicatives.'); } }, 'Valider les cotes'),
        el('button', { class: 'btn', onclick: () => { E.cotes = E.cotes.filter(c => !(c.auto && !c.valide)); E.autoCtx = null; E.autoInfo = null; majPanneauAuto(); dessiner(); } }, 'Ignorer')));
  }

  // ——— Mise en plan : cotes à clics, placement hors pièce, coupes ———
  // Ø automatique : deux points opposés d'un même cercle, ou deux points symétriques par rapport à l'axe d'une coupe de révolution.
  function estDiametre(t, a, b) {
    const ia = a.item != null ? E.d.items[a.item] : null, ib = b.item != null ? E.d.items[b.item] : null;
    if (ia && ib && ia === ib && ia.kind === 'circle' && Math.abs(distance(a, b) - 2 * ia.r) < 0.05 + 0.002 * ia.r) return true;
    const ax = E.mp.axeAt(a.x, a.y);
    if (!ax || !E.mp.axeAt(b.x, b.y)) return false;
    if (t === 'ph' && ax.dir === 'V') return Math.abs((a.x + b.x) / 2 - ax.pos) < 0.1 && Math.abs(a.x - b.x) > 1e-6;
    if (t === 'pv' && ax.dir === 'H') return Math.abs((a.y + b.y) / 2 - ax.pos) < 0.1 && Math.abs(a.y - b.y) > 1e-6;
    return false;
  }
  function coteEnCours(p) {   // cote en cours de construction : pend + point de placement p
    const o = E.outil;
    if (o === 'pr' && E.pend.length === 1) { const q = E.pend[0].o; return { t: q.kind === 'arc' ? 'prad' : 'pdia', c: { x: q.c[0], y: q.c[1] }, r: q.r, p: { x: p.x, y: p.y }, ech: 1 }; }
    if ((o === 'ph' || o === 'pv' || o === 'pa') && E.pend.length === 2) { const [a, b] = E.pend; return { t: o, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, p: { x: p.x, y: p.y }, dia: estDiametre(o, a, b), ech: 1 }; }
    return null;
  }
  function rafraichirPlan() {
    E.d = E.mp.dessin(); E.survol = null; remplirCalques(); majPanneauCoupe(); infos.textContent = texteInfos();
  }
  function creerCoupe(ev) {
    const q = viser(ev);
    if (!q || q.t === 'libre') return E.toast('Cliquer un point précis : centre de cercle, intersection ou milieu de droite.');
    const w = E.mp.vueDe(q.x, q.y, 0.5);
    if (!w) return E.toast('Ce point n’est pas sur une des trois vues de la pièce.');
    const plan = E.plan.coupe, cle = plan === 'XZ' ? 'Y' : 'X';
    if (w[cle] === undefined) return E.toast(plan === 'XZ' ? 'Plan XZ : cliquer dans la vue de DESSUS ou de GAUCHE (elles donnent Y).' : 'Plan YZ : cliquer dans la vue de DESSUS ou de FACE (elles donnent X).');
    try { const S = E.mp.ajouterCoupe(plan, w[cle]); rafraichirPlan(); cadrer(); E.toast(`${S.nom} créée : plan ${plan}, ${cle} = ${f2(w[cle])} mm (indicatif).`, 5000); }
    catch (e) { E.toast(e.message); }
  }
  function retirerCoupe() {
    if (!E.mp.sections.length) return E.toast('Aucune coupe à retirer.');
    const S = E.mp.retirerCoupe(); rafraichirPlan(); dessiner(); E.toast(`${S.nom} retirée.`);
  }
  function retirerAux() {
    if (!E.mp.auxiliaires.length) return E.toast('Aucune vue auxiliaire à retirer.');
    const S = E.mp.retirerAuxiliaire(); rafraichirPlan(); dessiner(); E.toast(`${S.nom} retirée.`);
  }
  function creerAux(ev) {
    const q = viser(ev), s0 = sous(ev); let pts = null;
    if (q && q.t !== 'libre') E.pend.push({ x: q.x, y: q.y });
    else if (!E.pend.length) { const l = entiteProche(E.d, s0.x, s0.y, s0.rayon, filtre); if (l && l.kind === 'line') E.pend = [{ x: l.pts[0][0], y: l.pts[0][1] }, { x: l.pts.at(-1)[0], y: l.pts.at(-1)[1] }]; else return E.toast('Cliquer un point (extrémité, milieu, centre, intersection) ou une droite.'); }
    else return E.toast('Cliquer le 2e point (extrémité, milieu, centre, intersection).');
    if (E.pend.length < 2) { dessiner(); return; }
    pts = E.pend; E.pend = [];
    const A = E.mp.vueDe(pts[0].x, pts[0].y, 0.5), B = E.mp.vueDe(pts[1].x, pts[1].y, 0.5);
    if (!A || !B || A.vue !== B.vue) { dessiner(); return E.toast('Les deux points doivent être dans la même vue (face, dessus ou gauche).'); }
    try { const S = E.mp.ajouterAuxiliaire(A.vue, [A.u, A.v], [B.u, B.v], { inverse: E.plan.inverse }); rafraichirPlan(); cadrer(); E.toast(`${S.nom} créée : regard perpendiculaire à la droite choisie (sens proposé, à vérifier).`, 5000); }
    catch (e) { E.toast(e.message); dessiner(); }
  }
  // Coupe décalée : alternance point d'un plan / position d'un décrochement, dans la vue de dessus.
  function creerDec(ev) {
    const q = viser(ev), s0 = sous(ev), D = E.dec, attendu = D.valeurs.length > D.bords.length ? 'bord' : 'plan';
    const w = E.mp.vueDe(q ? q.x : s0.x, q ? q.y : s0.y, 0.5);
    if (!w || w.vue !== 'dessus') return E.toast('Cliquer dans la vue de DESSUS (elle donne X et Y).');
    const XZ = E.plan.coupe === 'XZ';
    if (attendu === 'plan') {
      if (!q || q.t === 'libre') return E.toast('Cliquer un point précis : centre de cercle, intersection ou milieu de droite.');
      D.valeurs.push(XZ ? w.Y : w.X);
    } else {
      const b = XZ ? w.X : w.Y;
      const B = D.bords;
      if (B.length) { const sens = B.length > 1 ? Math.sign(B.at(-1) - B.at(-2)) : 0, d = b - B.at(-1); if (Math.abs(d) < 0.01 || (sens && Math.sign(d) !== sens)) return E.toast('Les décrochements doivent se suivre dans un seul sens.'); }
      D.bords.push(b);
    }
    majPanneauCoupe(); dessiner();
  }
  function terminerDec() {
    const D = E.dec;
    if (D.valeurs.length < 2 || D.valeurs.length !== D.bords.length + 1) return E.toast('Une coupe décalée comporte au moins 2 plans : cliquer un point par plan et la position de chaque décrochement.');
    try { const S = E.mp.ajouterCoupeDecalee(E.plan.coupe, D.valeurs, D.bords); E.dec = { valeurs: [], bords: [] }; rafraichirPlan(); cadrer(); E.toast(`${S.nom} créée : plans ${S.plan} décalés (indicatif).`, 5000); }
    catch (e) { E.toast(e.message); }
  }
  function dessinerTraceDecale() {
    const D = E.dec, dv = E.mp.vues.dessus; if (!D.valeurs.length) return;
    const XZ = E.plan.coupe === 'XZ', o = dv.off, lo = (XZ ? dv.emprise[0] + o[0] : dv.emprise[1] + o[1]) - 10, hi = (XZ ? dv.emprise[2] + o[0] : dv.emprise[3] + o[1]) + 10;
    const pos = (c, i) => (XZ ? [c + 0, D.valeurs[i] + o[1]] : [D.valeurs[i] + o[0], c + 0]), bd = D.bords.map(b => b + (XZ ? o[0] : o[1]));
    const ch = [pos(lo, 0)];
    bd.forEach((b, i) => { ch.push(pos(b, i)); if (D.valeurs[i + 1] !== undefined) ch.push(pos(b, i + 1)); });
    if (D.bords.length < D.valeurs.length) ch.push(pos(hi, D.valeurs.length - 1));
    ctx.save(); ctx.strokeStyle = '#e8730c'; ctx.lineWidth = 2; ctx.setLineDash([8, 4]); ctx.beginPath();
    ch.forEach((p, i) => { const [X, Y] = px(p[0], p[1]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.stroke(); ctx.restore();
  }
  function majPanneauCoupe() {
    const o = E.outil; panCoupe.hidden = !(PLAN && (o === 'coupe' || o === 'aux' || o === 'coupd')); if (panCoupe.hidden) return;
    panCoupe.textContent = '';
    const bp = (plan, txt) => el('button', { class: 'btn' + (E.plan.coupe === plan ? ' primary' : ''), onclick: () => { if (E.plan.coupe !== plan) E.dec = { valeurs: [], bords: [] }; E.plan.coupe = plan; majPanneauCoupe(); dessiner(); } }, txt);
    if (o === 'aux') {
      const b = el('button', { class: 'btn' + (E.plan.inverse ? ' primary' : ''), title: 'Regarder la pièce depuis l’autre côté de la droite', onclick: () => { E.plan.inverse = !E.plan.inverse; majPanneauCoupe(); } }, E.plan.inverse ? 'Regard : côté opposé' : 'Regard : côté extérieur (proposé)');
      panCoupe.append(el('strong', {}, 'Vue auxiliaire'), el('div', { class: 'dxf-auto-btn' }, b),
        el('small', {}, 'Cliquer deux points (ou la droite entière) d’une arête inclinée dans la vue de face, de dessus ou de gauche : la pièce est projetée perpendiculairement à cette droite, qui devient l’horizontale de la nouvelle vue. Le sens du regard est proposé : l’inverser avant de créer si besoin.'),
        el('small', {}, E.mp.auxiliaires.length ? 'Vues : ' + E.mp.auxiliaires.map(q => q.nom).join(' · ') : 'Aucune vue auxiliaire pour l’instant.'));
      return;
    }
    if (o === 'coupd') {
      const D = E.dec, XZ = E.plan.coupe === 'XZ', c = XZ ? 'Y' : 'X';
      panCoupe.append(el('strong', {}, 'Coupe décalée'), el('div', { class: 'dxf-auto-btn' }, bp('XZ', 'Plans XZ (Y fixe)'), bp('YZ', 'Plans YZ (X fixe)')),
        el('small', {}, `Dans la vue de dessus : cliquer un point du plan 1 (${c} = sa valeur), puis la position du décrochement, puis un point du plan 2, etc. (2 à 5 plans), puis « Terminer ».`),
        el('small', {}, D.valeurs.length ? `Plans : ${D.valeurs.map(v => `${c} = ${f2(v)}`).join(' | ')}${D.bords.length ? ' · décrochements : ' + D.bords.map(f2).join(' | ') : ''}` : 'Aucun plan saisi.'),
        el('div', { class: 'dxf-auto-btn' }, el('button', { class: 'btn primary', onclick: terminerDec }, 'Terminer'), el('button', { class: 'btn', onclick: () => { E.dec = { valeurs: [], bords: [] }; majPanneauCoupe(); dessiner(); } }, 'Annuler le tracé')));
      return;
    }
    panCoupe.append(el('strong', {}, 'Coupe'), el('div', { class: 'dxf-auto-btn' }, bp('XZ', 'Plan XZ (Y fixe)'), bp('YZ', 'Plan YZ (X fixe)')),
      el('small', {}, E.plan.coupe === 'XZ' ? 'Cliquer, dans la vue de dessus ou de gauche, le centre d’un cercle, une intersection ou le milieu d’une droite : la coupe passe par ce point (regard vers +Y).' : 'Cliquer, dans la vue de dessus ou de face, le centre d’un cercle, une intersection ou le milieu d’une droite : la coupe passe par ce point (regard vers +X).'),
      el('small', {}, E.mp.sections.length ? 'Coupes : ' + E.mp.sections.map(q => q.decalee ? `${q.nom} (plans ${q.plan} décalés)` : `${q.nom} (${q.plan}, ${q.plan === 'XZ' ? 'Y' : 'X'} = ${f2(q.valeur)}${q.auto ? ', axe' : ''})`).join(' · ') : 'Aucune coupe pour l’instant.'));
  }
  function validerPlan(ev) {
    E.cotesVis = true; if (bCotes) bCotes.textContent = 'Masquer cotes';
    const o = E.outil, s = sous(ev);
    if (o === 'coupe') return creerCoupe(ev);
    if (o === 'aux') return creerAux(ev);
    if (o === 'coupd') return creerDec(ev);
    if (E.pend.length === (o === 'pr' ? 1 : 2)) {        // étape de placement : clic HORS pièce
      if (E.mp.dansPiece(s.x, s.y)) return E.toast('Placer la cote HORS de la pièce : cliquer dans une zone vide, à côté d’une vue.');
      const c = coteEnCours({ x: s.x, y: s.y }); if (c) E.cotes.push(c);
      E.pend = []; E.apercu = null; dessiner(); return;
    }
    if (o === 'pr') {
      const q = viser(ev); if (!q || !q.o) return E.toast('Cliquer sur le trait d’un cercle (Ø) ou d’un arc (R).');
      E.pend = [q]; E.apercu = { x: s.x, y: s.y }; dessiner(); return;
    }
    const q = viser(ev);
    if (q && q.t !== 'libre') E.pend.push({ x: q.x, y: q.y, item: q.item });
    else if (!E.pend.length) {                           // un trait entier : ses deux extrémités
      const l = entiteProche(E.d, s.x, s.y, s.rayon, filtre);
      if (l && l.kind === 'line') E.pend = [{ x: l.pts[0][0], y: l.pts[0][1] }, { x: l.pts.at(-1)[0], y: l.pts.at(-1)[1] }];
      else return E.toast('Cliquer un point (extrémité, milieu, centre, intersection) ou un trait.');
    } else return E.toast('Cliquer le 2e point (extrémité, milieu, centre, intersection).');
    if (E.pend.length === 2) E.apercu = { x: s.x, y: s.y };
    dessiner();
  }

  function choisir(k) {
    E.outil = k; E.pend = []; E.dec = { valeurs: [], bords: [] };
    for (const [id, b] of Object.entries(bOut)) b.classList.toggle('on', id === k);
    E.apercu = null; majPanneauAuto(); majPanneauCoupe(); dessiner();
  }

  function sous(ev) {
    const r = canvas.getBoundingClientRect(), X = ev.clientX - r.left, Y = ev.clientY - r.top, [x, y] = mond(X, Y);
    return { X, Y, x, y, rayon: (ev.pointerType === 'touch' ? 22 : 12) / E.vue.s };
  }
  function viser(ev) {
    const s = sous(ev);
    if (PLAN && E.pend.length === (E.outil === 'pr' ? 1 : 2) && E.outil !== 'coupe' && E.outil !== 'aux' && E.outil !== 'coupd') return { x: s.x, y: s.y, t: 'libre' };   // étape de placement : point libre
    if (E.outil === 'rad' || E.outil === 'pr') { const o = entiteProche(E.d, s.x, s.y, s.rayon, q => filtre(q) && q.r != null);  return o && o.r != null ? { x: o.c[0], y: o.c[1], t: (o.kind === 'arc' ? 'R ' + f2(o.r) : 'Ø ' + f2(2 * o.r)), item: o.id, o } : null; }
    return accroche(E.d, s.x, s.y, s.rayon, filtre) ?? { x: s.x, y: s.y, t: 'libre' };
  }
  function valider(ev) {
    if (PLAN) return validerPlan(ev);
    E.cotesVis = true; if (bCotes) bCotes.textContent = 'Masquer cotes';
    if (E.outil === 'auto') {
      const pa = viser(ev); E.pend.push({ x: pa.x, y: pa.y });
      if (E.pend.length === 1 && E.autoOpt.tout) { E.autoCtx = { o: E.pend[0], zone: { ...E.d.cadre } }; E.pend = []; proposer(); } else if (E.pend.length === 3) {
        const [o, a, b] = E.pend; E.autoCtx = { o, zone: { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) } }; E.pend = []; proposer();
      }
      dessiner(); return;
    }
    const p = viser(ev); if (!p) { E.toast('Aucun cercle ou arc de cercle ici (ellipses et splines : mesurer par points).'); return; }
    if (E.outil === 'rad') { E.cotes.push({ t: 'rad', c: { x: p.o.c[0], y: p.o.c[1] }, r: p.o.r, ech: E.ech }); E.snap = null; dessiner(); return; }
    E.pend.push({ x: p.x, y: p.y });
    const need = E.outil === 'ang' ? 3 : 2;  // « cal » : 2 points
    if (E.pend.length >= need) {
      const [a, b, c] = E.pend;
      if (E.outil === 'cal') {
        const papier = distance(a, b), t = prompt(`Longueur RÉELLE entre ces deux points (${u}) ? Mesure sur le dessin : ${f2(papier)} ${u}.`);
        const reel = t ? parseFloat(t.replace(',', '.')) : NaN;
        if (reel > 0) { E.ech = papier / reel; remplirEch(); E.toast(`Échelle déduite : ${nomEch(E.ech)} (calibrée sur votre longueur).`, 5000); }
        E.pend = []; dessiner(); return;
      }
      E.cotes.push(E.outil === 'ang' ? { t: 'ang', s: a, a: b, b: c, ech: E.ech } : { t: E.outil, a, b, ech: E.ech });
      E.pend = [];
    }
    dessiner();
  }

  // Pointeurs : 1 doigt/souris = panoramique (un simple clic sans déplacement = point), 2 doigts = zoom.
  let depart = null, pincement = null;
  const etiquetteSous = ev => { if (!E.cotesVis) return null; const r = canvas.getBoundingClientRect(), X = ev.clientX - r.left, Y = ev.clientY - r.top; for (let i = E.etiq.length - 1; i >= 0; i--) { const q = E.etiq[i]; if (X >= q.x - 4 && X <= q.x + q.w + 4 && Y >= q.y - 4 && Y <= q.y + q.h + 4) return q; } return null; };
  canvas.addEventListener('pointerdown', ev => {
    canvas.setPointerCapture(ev.pointerId); E.pointeurs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const q = E.pointeurs.size === 1 ? etiquetteSous(ev) : null;
    if (q) { const o = q.c.off?.[q.cle] ?? [0, 0]; E.glisse = { c: q.c, cle: q.cle, x: ev.clientX, y: ev.clientY, o0: [o[0], o[1]] }; depart = null; return; }
    if (E.pointeurs.size === 1) depart = { x: ev.clientX, y: ev.clientY, ox: E.vue.ox, oy: E.vue.oy, bouge: false };
    else { depart = null; const [a, b] = [...E.pointeurs.values()]; pincement = { d: Math.hypot(a.x - b.x, a.y - b.y), s: E.vue.s }; }
  });
  canvas.addEventListener('pointermove', ev => {
    if (E.pointeurs.has(ev.pointerId)) E.pointeurs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (E.glisse) {
      const g = E.glisse; (g.c.off ??= {})[g.cle] = [g.o0[0] + (ev.clientX - g.x) / E.vue.s, g.o0[1] - (ev.clientY - g.y) / E.vue.s]; planifier(); return;
    }
    if (pincement && E.pointeurs.size >= 2) {
      const [a, b] = [...E.pointeurs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = canvas.getBoundingClientRect();
      zoomer(d / pincement.d * pincement.s / E.vue.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pincement.d = d; pincement.s = E.vue.s; return;
    }
    if (depart) {
      const dx = ev.clientX - depart.x, dy = ev.clientY - depart.y;
      if (!depart.bouge && Math.hypot(dx, dy) > 6) depart.bouge = true;
      if (depart.bouge) { E.vue.ox = depart.ox + dx; E.vue.oy = depart.oy + dy; planifier(); return; }
    }
    if (ev.pointerType !== 'touch') {
      canvas.style.cursor = etiquetteSous(ev) ? 'move' : 'crosshair';
      const s = sous(ev); E.survol = entiteProche(E.d, s.x, s.y, 8 / E.vue.s, filtre);
      E.snap = viser(ev); if (E.snap && E.snap.t === 'libre') E.snap = null;
      if (PLAN && E.outil !== 'coupe' && E.outil !== 'aux' && E.outil !== 'coupd' && E.pend.length === (E.outil === 'pr' ? 1 : 2)) E.apercu = { x: s.x, y: s.y };   // aperçu de la cote sous le curseur
      planifier();
    }
  });
  const fin = ev => {
    if (E.glisse) { E.glisse = null; E.pointeurs.delete(ev.pointerId); if (!E.pointeurs.size) depart = null; return; }
    const d = depart; E.pointeurs.delete(ev.pointerId); if (E.pointeurs.size < 2) pincement = null;
    if (d && !d.bouge && ev.type === 'pointerup') valider(ev);
    if (!E.pointeurs.size) depart = null;
  };
  canvas.addEventListener('dblclick', ev => { const q = etiquetteSous(ev); if (!q) return; E.cotes = E.cotes.filter(c => c !== q.c); E.pend = []; majPanneauAuto(); dessiner(); });
  canvas.addEventListener('pointerup', fin); canvas.addEventListener('pointercancel', fin);
  function zoomer(k, X, Y) {
    const s = Math.min(1e5, Math.max(1e-3, E.vue.s * k)), kk = s / E.vue.s;
    E.vue.ox = X - (X - E.vue.ox) * kk; E.vue.oy = Y - (Y - E.vue.oy) * kk; E.vue.s = s; planifier();
  }
  canvas.addEventListener('wheel', ev => { ev.preventDefault(); const r = canvas.getBoundingClientRect(); zoomer(ev.deltaY < 0 ? 1.18 : 1 / 1.18, ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
  canvas.style.touchAction = 'none';

  const onKey = ev => {
    if (!racine) return;
    if (ev.key === 'Enter' && PLAN && E.outil === 'coupd') { terminerDec(); return; }
    if (ev.key === 'Escape') { if (E.pend.length || E.dec.valeurs.length) { E.pend = []; E.dec = { valeurs: [], bords: [] }; E.apercu = null; majPanneauCoupe(); dessiner(); } else fermerDxf(); }
  };
  addEventListener('keydown', onKey); E.onKey = onKey;
  const onResize = () => { redim(); dessiner(); }; addEventListener('resize', onResize); E.onResize = onResize;

  function exporter() {
    if (!E.cotes.length) return E.toast('Aucune cote à exporter.');
    const L = ['N°;Type;Valeur (réelle, indicative);Unité;Détail papier;Échelle;Statut'];
    E.cotes.forEach((c, i) => {
      const st = c.auto && !c.valide ? 'proposée (à vérifier)' : c.auto ? 'proposée, validée par l\'utilisateur' : 'mesurée';
      const dd = (a, b) => `${f2(a.x)} ; ${f2(a.y)} → ${f2(b.x)} ; ${f2(b.y)}`, ec = nomEch(c.ech);
      if (c.t === 'dist') L.push(`${i + 1};Distance;${f2(distance(c.a, c.b) / c.ech)};${u};${dd(c.a, c.b)};${ec};${st}`);
      if (c.t === 'dxy') L.push(`${i + 1};ΔX;${f2(Math.abs(c.b.x - c.a.x) / c.ech)};${u};${dd(c.a, c.b)};${ec};${st}`, `${i + 1};ΔY;${f2(Math.abs(c.b.y - c.a.y) / c.ech)};${u};${dd(c.a, c.b)};${ec};${st}`);
      if (c.t === 'rad') L.push(`${i + 1};Diamètre;${f2(2 * c.r / c.ech)};${u};centre ${f2(c.c.x)} ; ${f2(c.c.y)};${ec};${st}${c.n > 1 ? ` ×${c.n}` : ''}`, `${i + 1};Rayon;${f2(c.r / c.ech)};${u};;${ec};${st}`);
      if (c.t === 'ordx') L.push(`${i + 1};Ordonnée X;${f2((c.x - c.o.x) / c.ech)};${u};depuis la référence ${f2(c.o.x)} ; ${f2(c.o.y)};${ec};${st}`);
      if (c.t === 'ordy') L.push(`${i + 1};Ordonnée Y;${f2((c.y - c.o.y) / c.ech)};${u};depuis la référence ${f2(c.o.x)} ; ${f2(c.o.y)};${ec};${st}`);
      if (c.t === 'ph' || c.t === 'pv' || c.t === 'pa') L.push(`${i + 1};${c.t === 'ph' ? 'Cote horizontale' : c.t === 'pv' ? 'Cote verticale' : 'Cote alignée'}${c.dia ? ' (Ø)' : ''};${f2(valeurPlan(c))};${u};${dd(c.a, c.b)};1:1;indicative (maillage d'affichage)`);
      if (c.t === 'pdia') L.push(`${i + 1};Diamètre;${f2(2 * c.r)};${u};centre ${f2(c.c.x)} ; ${f2(c.c.y)};1:1;indicative (maillage d'affichage)`);
      if (c.t === 'prad') L.push(`${i + 1};Rayon;${f2(c.r)};${u};centre ${f2(c.c.x)} ; ${f2(c.c.y)};1:1;indicative (maillage d'affichage)`);
      if (c.t === 'ang') L.push(`${i + 1};Angle;${f2(angleEntre(c.s, c.a, c.b))};°;sommet ${f2(c.s.x)} ; ${f2(c.s.y)};;${st}`);
    });
    const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' })), download: nom.replace(/\.(dxf|pdf)$/i, '') + (PLAN ? '_mise_en_plan_cotes.csv' : '_cotes.csv') });
    document.body.append(a); a.click(); a.remove();
  }

  // Export du plan (vues + cotes posées) : DXF R12 ou PDF vectoriel, tous deux à l'échelle 1:1, valeurs marquées indicatives.
  function exporterPlan(fmt) {
    if (!PLAN) return;
    const date = new Date().toISOString().slice(0, 10), base = nom.replace(/\.(dxf|pdf|step|stp)$/i, '') || 'piece', cotes = E.cotes.filter(c => c.t && c.t[0] === 'p');
    const annotations = E.annotsVis ? itemsAnnotations(E.annots) : [];
    let octets, mime, info;
    try {
      if (fmt === 'dxf') { octets = exporterDxf(E.mp.dessin(), cotes, { nom: base, date, annotations }); mime = 'application/dxf'; info = 'DXF R12 (ANSI 1252), mm, 1:1'; }
      else { const r = exporterPdf(E.mp.dessin(), cotes, { nom: base, date, annotations }); octets = r.octets; mime = 'application/pdf'; info = `PDF vectoriel 1:1, page ${r.format}${r.normalise ? '' : ' (plan plus grand que l’A0)'} ${r.largeur} × ${r.hauteur} mm`; }
    } catch (e) { return E.toast('Export impossible : ' + e.message); }
    const a = el('a', { href: URL.createObjectURL(new Blob([octets], { type: mime })), download: `${base}_mise_en_plan.${fmt}` });
    document.body.append(a); a.click(); a.remove();
    E.dernierExport = { fmt, octets: octets.length, cotes: cotes.length, annotations: E.annotsVis ? E.annots.length : 0 };
    E.toast(`${info} — ${cotes.length} cote${cotes.length > 1 ? 's' : ''}${E.annotsVis && E.annots.length ? `, ${E.annots.length} annotation${E.annots.length > 1 ? 's' : ''} (calque ANNOTATIONS)` : ''}. Valeurs indicatives (maillage d’affichage), à vérifier avant fabrication.`, 6000);
  }
  E.exporterPlan = exporterPlan;

  remplirEch(); redim(); choisir(E.outil); cadrer();
  window.__SDC_DXF__ = E; // utilisé par l'essai navigateur
  return E;
}

export function fermerDxf() {
  if (!racine) return;
  if (etat?.onKey) removeEventListener('keydown', etat.onKey);
  if (etat?.onResize) removeEventListener('resize', etat.onResize);
  racine.remove(); racine = null; etat = null;
}
export const etatDxf = () => etat;
