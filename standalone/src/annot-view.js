// Vue plein écran « Annoter » : annotations vectorielles posées sur une capture, un plan ou une image.
// Le fond n'est jamais modifié ; les annotations sont INDICATIVES (pas des cotes). Calculs dans geom/annotations.js.
import * as A from './geom/annotations.js';
import { reconnaitreTexte } from './geom/manuscrit.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); }
  for (const k of kids) e.append(k);
  return e;
};
let racine = null, nettoyage = null;
export const annotOuvert = () => !!racine;

const OUTILS = [
  ['sel', '↖ Sélection', 'Toucher une annotation : la déplacer, tirer ses poignées, changer sa couleur / son épaisseur. Double-clic sur un texte : le modifier. Suppr : l’effacer'],
  ['fleche', '➚ Flèche', 'Glisser du début vers la pointe'],
  ['ligne', '╱ Droite', 'Glisser d’une extrémité à l’autre (Maj : angle par pas de 45°)'],
  ['rect', '▭ Rectangle', 'Glisser d’un coin au coin opposé'],
  ['cercle', '◯ Cercle', 'Glisser du centre vers un point du cercle'],
  ['poly', '✎ Tracé libre', 'Dessiner à main levée : le tracé est corrigé (droite, cercle, rectangle, flèche) ou simplifié en polyligne avec une poignée à chaque sommet'],
  ['encre', '✍ Écriture', 'Écrire à la main, un caractère après l’autre (chiffres, Ø × ° , . - ±, quelques lettres). Une pause de 1,5 s lance la reconnaissance : le résultat est PROPOSÉ dans une zone modifiable, à vérifier avant Entrée'],
  ['texte', 'T Texte', 'Toucher l’endroit du texte, le saisir au clavier, Entrée pour valider (Maj + Entrée : ligne suivante)'],
];
const TAILLES = [['S', 16], ['M', 24], ['L', 36], ['XL', 52]];
const NOMS_EPAIS = ['Fin', 'Moyen', 'Épais', 'Très épais'];
const TYPE_LIB = { ligne: 'droite', fleche: 'flèche', rect: 'rectangle', cercle: 'cercle', poly: 'polyligne' };

// Dessine une liste d'annotations sur un contexte déjà placé dans le repère du fond.
export function dessinerAnnotations(g, liste, { sens = 1 } = {}) {
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const a of liste) for (const o of A.tracer(a, { sens })) {
    if (o.t === 'poly') { g.strokeStyle = o.couleur; g.lineWidth = o.epais; g.beginPath(); o.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); if (o.ferme) g.closePath(); g.stroke(); }
    else if (o.t === 'cercle') { g.strokeStyle = o.couleur; g.lineWidth = o.epais; g.beginPath(); g.arc(o.c[0], o.c[1], o.r, 0, 2 * Math.PI); g.stroke(); }
    else if (o.t === 'tete') { g.fillStyle = g.strokeStyle = o.couleur; g.lineWidth = 1; g.beginPath(); o.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); g.stroke(); }
    else if (o.t === 'texte') { g.fillStyle = o.couleur; g.font = `${o.taille}px Helvetica, Arial, sans-serif`; g.textBaseline = 'alphabetic'; o.lignes.forEach((t, i) => g.fillText(t, o.p[0], o.p[1] + i * o.pas)); }
  }
}

// opts : { fond (canvas ou image), w, h, nom, fichier, items, onEnregistrer(items, vignette), telecharger(nom, blob), toast, onFermer }
export function ouvrirAnnot(opts) {
  fermerAnnot();
  const { fond, w, h, nom = 'Annotations', fichier = '', telecharger = () => {}, toast = () => {} } = opts;
  const k = Math.max(1, w / 1200), kE = opts.kEpais ?? k, kT = opts.kTexte ?? k;   // échelle des épaisseurs et des textes selon la définition du fond (ou imposée : plan en mm)
  const E = {
    liste: A.nettoyer(opts.items), sel: -1, outil: 'sel', couleur: A.PALETTE[0], epais: EPAISSEURS(kE)[1], taille: TAILLES[1][1] * kT, corriger: true,
    encre: { traits: [], minuteur: 0 }, delaiEncre: opts.delaiEncre ?? 1500, vue: { s: 1, ox: 0, oy: 0 }, W: 0, H: 0, hist: [], futur: [], ptr: new Map(), geste: null, espace: false, modifie: false, editeur: null,
  };
  function EPAISSEURS(m) { return A.EPAISSEURS.map(v => v * m); }

  const canvas = el('canvas', { class: 'annot-canvas' });
  const aide = el('div', { class: 'annot-aide' });
  const zone = el('div', { class: 'annot-zone' }, canvas, aide);
  const bOut = {}, bSw = [];
  const selEp = el('select', { class: 'btn annot-sel', title: 'Épaisseur du trait', onchange: () => { E.epais = EPAISSEURS(kE)[+selEp.value]; changer({ epais: E.epais }); } },
    ...NOMS_EPAIS.map((n, i) => el('option', { value: String(i) }, n)));
  selEp.value = '1';
  const selTx = el('select', { class: 'btn annot-sel', title: 'Taille du texte', onchange: () => { E.taille = TAILLES[+selTx.value][1] * kT; changer({ taille: E.taille }, true); } },
    ...TAILLES.map(([n], i) => el('option', { value: String(i) }, `Texte ${n}`)));
  selTx.value = '1';
  const inCoul = el('input', { type: 'color', class: 'annot-coul', title: 'Autre couleur', value: E.couleur });
  inCoul.oninput = () => { E.couleur = inCoul.value; changer({ couleur: E.couleur }); majSw(); };
  const cbCorr = el('input', { type: 'checkbox' }); cbCorr.checked = true; cbCorr.onchange = () => { E.corriger = cbCorr.checked; };
  const bAnn = el('button', { class: 'btn', title: 'Annuler (Ctrl+Z)', onclick: () => annuler() }, '↶');
  const bRet = el('button', { class: 'btn', title: 'Rétablir (Ctrl+Y)', onclick: () => retablir() }, '↷');
  const bSup = el('button', { class: 'btn', title: 'Supprimer l’annotation sélectionnée (Suppr)', onclick: () => supprimer() }, '🗑 Supprimer');
  const palette = el('span', { class: 'annot-pal' }, ...A.PALETTE.map(c => { const b = el('button', { class: 'annot-sw', title: c, style: `background:${c}`, onclick: () => { E.couleur = c; inCoul.value = c; changer({ couleur: c }); majSw(); } }); bSw.push([c, b]); return b; }), inCoul);
  const barre = el('div', { class: 'annot-bar' },
    el('strong', {}, `Annoter · ${nom}`),
    ...OUTILS.map(([id, t, hlp]) => (bOut[id] = el('button', { class: 'btn annot-outil', title: hlp, onclick: () => choisir(id) }, t))),
    el('span', { class: 'sep' }), palette, selEp, selTx,
    el('label', { class: 'annot-corr', title: 'Tracé libre : redresser en droite, cercle, rectangle ou flèche quand la forme est reconnue' }, cbCorr, 'Corriger le tracé'),
    el('span', { class: 'sep' }), bAnn, bRet, bSup,
    el('button', { class: 'btn', title: 'Cadrer tout le fond', onclick: () => { cadrer(); dessiner(); } }, 'Ajuster'),
    el('span', { class: 'sep' }),
    el('button', { class: 'btn', title: 'Image PNG : fond + annotations', onclick: () => exporterPng() }, 'PNG'),
    el('button', { class: 'btn', title: 'PDF A4 : fond + annotations vectorielles', onclick: () => exporterPdf() }, 'PDF'),
    el('button', { class: 'btn', title: 'Enregistrer dans le projet (liste « Notes & vues »)', onclick: () => enregistrer(true) }, 'Enregistrer'),
    el('button', { class: 'btn primary', title: 'Fermer (les annotations sont enregistrées dans le projet)', onclick: () => fermerAnnot(true) }, 'Fermer'));
  racine = el('div', { id: 'annot-view', class: 'annot-view' }, barre, zone);
  document.body.append(racine);
  const ctx = canvas.getContext('2d');

  // ——— Repère écran ↔ fond ———
  const vers = ev => { const r = canvas.getBoundingClientRect(); return [(ev.clientX - r.left - E.vue.ox) / E.vue.s, (ev.clientY - r.top - E.vue.oy) / E.vue.s]; };
  function cadrer() { E.vue.s = Math.min((E.W - 24) / w, (E.H - 24) / h) || 1; E.vue.ox = (E.W - w * E.vue.s) / 2; E.vue.oy = (E.H - h * E.vue.s) / 2; }
  let premier = true;
  function redim() {
    const r = zone.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    E.W = Math.max(50, Math.round(r.width)); E.H = Math.max(50, Math.round(r.height));
    canvas.width = Math.round(E.W * dpr); canvas.height = Math.round(E.H * dpr); canvas.style.width = E.W + 'px'; canvas.style.height = E.H + 'px';
    E.dpr = dpr; if (premier) { cadrer(); premier = false; }
    dessiner();
  }
  const tolEcran = ev => (ev && ev.pointerType === 'touch' ? 22 : 10);

  // ——— Dessin ———
  const carre = (g, x, y, t) => { g.fillStyle = '#fff'; g.strokeStyle = '#1f5f8b'; g.lineWidth = 1.5; g.beginPath(); g.rect(x - t / 2, y - t / 2, t, t); g.fill(); g.stroke(); };
  function dessiner() {
    const g = ctx, { s, ox, oy } = E.vue;
    g.setTransform(E.dpr, 0, 0, E.dpr, 0, 0); g.fillStyle = '#9aa5b1'; g.fillRect(0, 0, E.W, E.H);
    g.setTransform(E.dpr * s, 0, 0, E.dpr * s, E.dpr * ox, E.dpr * oy);
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(fond, 0, 0, w, h);
    const aff = E.geste?.apercu ? [...E.liste, E.geste.apercu] : E.liste;
    g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip(); dessinerAnnotations(g, aff); g.restore();
    if (E.encre.traits.length || E.geste?.type === 'encre') {
      g.save(); g.setTransform(E.dpr * s, 0, 0, E.dpr * s, E.dpr * ox, E.dpr * oy); g.strokeStyle = E.couleur; g.lineWidth = Math.max(1.5 / s, E.epais * 0.5); g.lineJoin = g.lineCap = 'round';
      for (const t of [...E.encre.traits, ...(E.geste?.type === 'encre' ? [E.geste.pts] : [])]) { g.beginPath(); t.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); if (t.length === 1) g.lineTo(t[0][0] + 0.01, t[0][1]); g.stroke(); }
      g.restore();
    }
    if (E.geste?.type === 'trace') { g.strokeStyle = E.couleur; g.lineWidth = E.epais; g.lineJoin = g.lineCap = 'round'; g.beginPath(); E.geste.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); }
    g.setTransform(E.dpr, 0, 0, E.dpr, 0, 0);
    const a = E.liste[E.sel];
    if (a && !E.geste?.apercu) {
      const [x0, y0, x1, y1] = A.boite(a), m = 6 / s;
      g.setLineDash([5, 4]); g.strokeStyle = '#1f5f8b'; g.lineWidth = 1; g.strokeRect(ox + (x0 - m) * s, oy + (y0 - m) * s, (x1 - x0 + 2 * m) * s, (y1 - y0 + 2 * m) * s); g.setLineDash([]);
      for (const p of A.poignees(a)) carre(g, ox + p[0] * s, oy + p[1] * s, 10);
    }
    bAnn.disabled = !E.hist.length; bRet.disabled = !E.futur.length; bSup.disabled = E.sel < 0;
  }
  const planifier = (() => { let t = 0; return () => { if (!t) t = requestAnimationFrame(() => { t = 0; dessiner(); }); }; })();

  // ——— Historique ———
  const instant = () => JSON.stringify(E.liste);
  function pousser() { E.hist.push(instant()); if (E.hist.length > 100) E.hist.shift(); E.futur = []; E.modifie = true; }
  function annuler() { if (!E.hist.length) return; E.futur.push(instant()); E.liste = JSON.parse(E.hist.pop()); E.sel = -1; E.modifie = true; dessiner(); }
  function retablir() { if (!E.futur.length) return; E.hist.push(instant()); E.liste = JSON.parse(E.futur.pop()); E.sel = -1; E.modifie = true; dessiner(); }
  function supprimer() { if (E.sel < 0) return; pousser(); E.liste.splice(E.sel, 1); E.sel = -1; dessiner(); }
  function ajouter(a) { pousser(); a.id = A.idSuivant(E.liste); E.liste.push(a); E.sel = E.liste.length - 1; return a; }
  // Propriété modifiée sur l'annotation sélectionnée (couleur, épaisseur, taille du texte).
  function changer(prop, texte = false) {
    const a = E.liste[E.sel]; if (!a || E.outil !== 'sel') return;      // hors sélection, la couleur ne concerne que les prochaines annotations
    if ((texte && a.type !== 'texte') || (prop.epais && a.type === 'texte')) return;
    pousser(); Object.assign(a, prop); dessiner();
  }
  function majSw() { for (const [c, b] of bSw) b.classList.toggle('on', c.toLowerCase() === E.couleur.toLowerCase()); }
  function choisir(id) {
    fermerEditeur(true); abandonnerEncre(); E.outil = id; if (id !== 'sel') E.sel = -1;
    for (const [k2, b] of Object.entries(bOut)) b.classList.toggle('on', k2 === id);
    aide.textContent = OUTILS.find(o => o[0] === id)[2]; canvas.style.cursor = id === 'sel' ? 'default' : id === 'texte' ? 'text' : 'crosshair'; dessiner();
  }
  function lierSelection() {   // la sélection reprend la couleur / l'épaisseur affichées dans la barre
    const a = E.liste[E.sel]; if (!a) return;
    E.couleur = a.couleur; inCoul.value = a.couleur; majSw();
    if (a.type === 'texte') { const i = TAILLES.findIndex(t => Math.abs(t[1] * kT - a.taille) < 0.01 * kT); selTx.value = String(Math.max(0, i)); }
    else { const i = EPAISSEURS(kE).findIndex(v => Math.abs(v - a.epais) < 0.01 * kE); if (i >= 0) selEp.value = String(i); }
  }

  // ——— Texte au clavier ———
  // ——— Écriture manuscrite : tracés regroupés puis reconnus après une pause ———
  function abandonnerEncre() { clearTimeout(E.encre.minuteur); E.encre.traits = []; }
  function reconnaitreEncre() {
    clearTimeout(E.encre.minuteur); const traits = E.encre.traits; E.encre.traits = [];
    if (!traits.length) return;
    const r = reconnaitreTexte(traits, {});
    if (!r.texte.trim()) { toast('Écriture non reconnue : réécrire plus grand et plus lentement, ou utiliser l’outil Texte (clavier).', 5000); dessiner(); return; }
    const taille = Math.max(8 * kT, Math.min(r.taille, 300 * kT));
    ouvrirEditeur(r.ancre, -1, { texte: r.texte, taille, propose: true, doutes: r.car.filter(c => c.doute).length });
    dessiner();
  }
  function ouvrirEditeur(p, existant = -1, prop = null) {
    fermerEditeur(true);
    const a0 = existant >= 0 ? E.liste[existant] : null, taille = a0 ? a0.taille : prop?.taille ?? E.taille, couleur = a0 ? a0.couleur : E.couleur, s = E.vue.s;
    const ta = el('textarea', { class: 'annot-texte', rows: '1', spellcheck: 'false' });
    ta.value = a0 ? a0.texte : prop?.texte ?? '';
    if (prop) ta.classList.add('propose');
    Object.assign(ta.style, { left: `${E.vue.ox + p[0] * s}px`, top: `${E.vue.oy + (p[1] - taille * 0.85) * s}px`, fontSize: `${Math.max(12, taille * s)}px`, color: couleur, minWidth: '6em' });
    const mesure = document.createElement('canvas').getContext('2d');
    const ajuster = () => {
      const fs = parseFloat(ta.style.fontSize) || 16, lignes = ta.value.split('\n'); mesure.font = `${fs}px Helvetica, Arial, sans-serif`;
      ta.rows = Math.max(1, lignes.length); ta.style.width = Math.max(...lignes.map(t => mesure.measureText(t).width), fs * 2) + 14 + 'px'; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
    };
    ta.oninput = ajuster;
    ta.onkeydown = ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); fermerEditeur(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); fermerEditeur(false); }
    };
    ta.onblur = () => setTimeout(() => { if (E.editeur?.ta === ta) fermerEditeur(true); }, 0);
    let etiq = null;
    if (prop) { etiq = el('div', { class: 'annot-prop' }, `Écriture reconnue : proposé, à vérifier${prop.doutes ? ` (${prop.doutes} caractère${prop.doutes > 1 ? 's' : ''} douteux)` : ''}. Corriger au clavier, Entrée pour valider, Échap pour annuler.`); Object.assign(etiq.style, { left: ta.style.left, top: `calc(${ta.style.top} - 2.6em)` }); zone.append(etiq); }
    zone.append(ta); E.editeur = { ta, p, existant, taille: prop ? taille : undefined, etiq }; ajuster(); ta.focus(); ta.select();
  }
  function fermerEditeur(valider) {
    const ed = E.editeur; if (!ed) return; E.editeur = null;
    const t = ed.ta.value.replace(/\s+$/, ''); ed.ta.remove(); ed.etiq?.remove();
    if (!valider) return;
    if (ed.existant >= 0) {
      const a = E.liste[ed.existant]; if (!a || t === a.texte) return;
      pousser(); if (t.trim()) a.texte = t; else { E.liste.splice(ed.existant, 1); E.sel = -1; }
    } else if (t.trim()) ajouter(A.creer('texte', [ed.p], { texte: t, taille: ed.taille ?? E.taille, couleur: E.couleur }));
    dessiner();
  }

  // ——— Pointeur ———
  const forme = (outil, p, q, maj) => {
    if (maj && (outil === 'ligne' || outil === 'fleche')) { const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4); q = [p[0] + L * Math.cos(a), p[1] + L * Math.sin(a)]; }
    return A.creer(outil, [p, q], { couleur: E.couleur, epais: E.epais });
  };
  let pinch = null;
  canvas.style.touchAction = 'none';
  canvas.onpointerdown = ev => {
    ev.preventDefault(); canvas.setPointerCapture(ev.pointerId); fermerEditeur(true);
    E.ptr.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (E.ptr.size === 2) {   // deux doigts : zoom et déplacement du fond, le geste en cours est abandonné
      E.geste = null; const [a, b] = [...E.ptr.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: E.vue.s, ox: E.vue.ox, oy: E.vue.oy, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; dessiner(); return;
    }
    const p = vers(ev), tol = tolEcran(ev) / E.vue.s;
    if (ev.button === 1 || ev.button === 2 || E.espace) { E.geste = { type: 'pan', x: ev.clientX, y: ev.clientY, ox: E.vue.ox, oy: E.vue.oy }; canvas.style.cursor = 'grabbing'; return; }
    const sa = E.liste[E.sel];   // une annotation sélectionnée garde ses poignées actives, quel que soit l'outil
    if (sa) { const i = A.trouverPoignee(sa, p, tol * 1.2); if (i >= 0) { E.geste = { type: 'poignee', i, avant: instant(), a0: sa }; return; } }
    if (E.outil === 'sel') {
      const n = A.trouver(E.liste, p, tol);
      E.sel = n; if (n >= 0) { lierSelection(); E.geste = { type: 'deplace', p0: p, avant: instant(), a0: E.liste[n] }; } else E.geste = { type: 'pan', x: ev.clientX, y: ev.clientY, ox: E.vue.ox, oy: E.vue.oy };
      dessiner(); return;
    }
    if (E.outil === 'texte') {
      const n = A.trouver(E.liste.map(a => (a.type === 'texte' ? a : { type: 'x', pts: [[1e12, 1e12]] })), p, tol);
      if (n >= 0 && E.liste[n].type === 'texte') { E.sel = n; ouvrirEditeur(E.liste[n].pts[0], n); } else ouvrirEditeur(p);
      return;
    }
    E.sel = -1;
    if (E.outil === 'encre') { clearTimeout(E.encre.minuteur); E.geste = { type: 'encre', pts: [p] }; dessiner(); return; }
    if (E.outil === 'poly') E.geste = { type: 'trace', pts: [p] };
    else E.geste = { type: 'forme', p0: p, apercu: null };
    dessiner();
  };
  canvas.onpointermove = ev => {
    if (E.ptr.has(ev.pointerId)) E.ptr.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pinch && E.ptr.size >= 2) {
      const [a, b] = [...E.ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r = canvas.getBoundingClientRect();
      const s = Math.max(0.05, Math.min(30, pinch.s * d / pinch.d)), cx = pinch.m[0] - r.left, cy = pinch.m[1] - r.top;
      E.vue.s = s; E.vue.ox = (m[0] - r.left) - (cx - pinch.ox) * s / pinch.s; E.vue.oy = (m[1] - r.top) - (cy - pinch.oy) * s / pinch.s; planifier(); return;
    }
    const g = E.geste; if (!g) return;
    const p = vers(ev);
    if (g.type === 'pan') { E.vue.ox = g.ox + ev.clientX - g.x; E.vue.oy = g.oy + ev.clientY - g.y; }
    else if (g.type === 'trace' || g.type === 'encre') { const q = g.pts.at(-1); if (Math.hypot(p[0] - q[0], p[1] - q[1]) * E.vue.s >= 2) g.pts.push(p); }
    else if (g.type === 'forme') g.apercu = forme(E.outil, g.p0, p, ev.shiftKey);
    else if (g.type === 'deplace') { const i = E.sel, nv = A.deplacer(g.a0, p[0] - g.p0[0], p[1] - g.p0[1]); if (!g.bouge && Math.hypot(p[0] - g.p0[0], p[1] - g.p0[1]) * E.vue.s < 3) return; g.bouge = true; E.liste[i] = nv; }
    else if (g.type === 'poignee') { E.liste[E.sel] = A.deplacerPoignee(g.a0, g.i, p); g.bouge = true; }
    planifier();
  };
  const fin = ev => {
    E.ptr.delete(ev.pointerId); if (E.ptr.size < 2) pinch = null;
    const g = E.geste; if (!g) return; E.geste = null;
    canvas.style.cursor = E.outil === 'sel' ? 'default' : E.outil === 'texte' ? 'text' : 'crosshair';
    if (ev.type === 'pointercancel') { if (g.avant) E.liste = JSON.parse(g.avant); dessiner(); return; }
    if (g.type === 'encre') { E.encre.traits.push(g.pts); E.encre.minuteur = setTimeout(reconnaitreEncre, E.delaiEncre); }
    else if (g.type === 'trace') {
      const r = A.reconnaitre(g.pts, { corriger: E.corriger });
      if (r) {
        const a = ajouter(A.creer(r.type, r.pts, { couleur: E.couleur, epais: E.epais, ferme: r.ferme }));
        if (E.corriger && r.type !== 'poly') toast(`Tracé redressé en ${TYPE_LIB[r.type]}. Poignées pour ajuster ; décocher « Corriger le tracé » pour garder le geste.`, 3500);
        else if (a.type === 'poly') toast(`Polyligne à ${a.pts.length} points : tirer une poignée pour la modifier.`, 3000);
      }
    } else if (g.type === 'forme' && g.apercu) {
      const a = g.apercu, L = Math.hypot(a.pts[1][0] - a.pts[0][0], a.pts[1][1] - a.pts[0][1]);
      if (L * E.vue.s >= 4) ajouter(a);
    } else if ((g.type === 'deplace' || g.type === 'poignee') && g.bouge) { E.hist.push(g.avant); E.futur = []; E.modifie = true; if (E.hist.length > 100) E.hist.shift(); }
    dessiner();
  };
  canvas.onpointerup = fin; canvas.onpointercancel = fin;
  canvas.ondblclick = ev => { if (E.outil !== 'sel') return; const p = vers(ev), n = A.trouver(E.liste, p, tolEcran(ev) / E.vue.s); if (n >= 0 && E.liste[n].type === 'texte') { E.sel = n; ouvrirEditeur(E.liste[n].pts[0], n); } };
  canvas.oncontextmenu = ev => ev.preventDefault();
  canvas.onwheel = ev => {
    ev.preventDefault(); const r = canvas.getBoundingClientRect(), cx = ev.clientX - r.left, cy = ev.clientY - r.top, f = Math.exp(-ev.deltaY * 0.0015), s = Math.max(0.05, Math.min(30, E.vue.s * f));
    E.vue.ox = cx - (cx - E.vue.ox) * s / E.vue.s; E.vue.oy = cy - (cy - E.vue.oy) * s / E.vue.s; E.vue.s = s; planifier();
  };
  const touche = ev => {
    if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'INPUT' && ev.target.type !== 'checkbox' || ev.target.tagName === 'SELECT') return;
    if (ev.type === 'keyup') { if (ev.key === ' ') { E.espace = false; } return; }
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ev.key === ' ') { E.espace = true; ev.preventDefault(); }
    else if (ctrl && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); annuler(); }
    else if (ctrl && (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) { ev.preventDefault(); retablir(); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); supprimer(); }
    else if (ev.key === 'Enter' && E.encre.traits.length) { ev.preventDefault(); reconnaitreEncre(); }
    else if (ev.key === 'Escape') { if (E.sel >= 0) { E.sel = -1; dessiner(); } else fermerAnnot(true); }
  };
  addEventListener('keydown', touche, true); addEventListener('keyup', touche, true);
  const ro = new ResizeObserver(redim); ro.observe(zone);
  nettoyage = () => { removeEventListener('keydown', touche, true); removeEventListener('keyup', touche, true); ro.disconnect(); };

  // ——— Sorties ———
  function rendre(echelle = 1) {
    const c = el('canvas'); c.width = Math.round(w * echelle); c.height = Math.round(h * echelle);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.scale(echelle, echelle); g.drawImage(fond, 0, 0, w, h); dessinerAnnotations(g, E.liste);
    return c;
  }
  const blob = (c, type, q) => new Promise(res => c.toBlob(res, type, q));
  const base = () => (fichier || nom).replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_');
  async function exporterPng() { telecharger(`${base()}_annote.png`, await blob(rendre(), 'image/png')); }
  async function exporterPdf() {
    const jpeg = new Uint8Array(await (await blob(rendre(), 'image/jpeg', 0.92)).arrayBuffer());
    const r = A.ecrirePdfImage(jpeg, w, h, E.liste, { fichier: fichier || nom, date: new Date().toLocaleDateString('fr-FR') });
    telecharger(`${base()}_annote.pdf`, new Blob([r.octets], { type: 'application/pdf' }));
  }
  function enregistrer(msg) {
    if (!opts.onEnregistrer) return;
    const e = Math.min(1, 320 / w), c = rendre(e);
    opts.onEnregistrer(JSON.parse(instant()), c.toDataURL('image/jpeg', 0.8)); E.modifie = false;
    if (msg) toast('Annotations enregistrées dans le projet (onglet Notes & vues).');
  }
  E.enregistrer = enregistrer; E.fermerEditeur = fermerEditeur; E.reconnaitreEncre = reconnaitreEncre; E.opts = opts;
  E.api = { liste: () => JSON.parse(instant()), etat: () => ({ outil: E.outil, sel: E.sel, vue: { ...E.vue }, nb: E.liste.length }), choisir, exporterPng, exporterPdf };
  racine._annot = E;

  choisir('sel'); majSw(); redim();
  toast('Annoter : choisir un outil, glisser sur l’image. Molette : zoom, clic droit / Espace + glisser : déplacer le fond.', 5000);
  return E.api;
}

export function fermerAnnot(enregistrer = false) {
  if (!racine) return;
  const E = racine._annot;
  if (E?.editeur) { E.editeur.ta.onblur = null; E.fermerEditeur(true); }
  if (enregistrer && E?.modifie) E.enregistrer(false);
  nettoyage?.(); nettoyage = null; racine.remove(); racine = null;
  E?.opts.onFermer?.();
}
