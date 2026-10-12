// Vue 2D d'un plan DXF avec prise de cotes. Lecture seule : le fichier n'est jamais modifié.
// Le code géométrique (lecture, accroches, mesures) est dans geom/dxf.js ; ici seulement l'interface.
import { accroche, entiteProche, distance, angleEntre } from './geom/dxf.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); }
  for (const k of kids) e.append(k);
  return e;
};
const f2 = v => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ACI = { 1: '#d32f2f', 2: '#b58900', 3: '#2e9e44', 4: '#00838f', 5: '#1f5f8b', 6: '#9c27b0', 7: '#15202b', 8: '#7a8896', 9: '#a0a8b0' };

let racine = null, etat = null;

export function dxfOuvert() { return !!racine; }

export function ouvrirDxf(dessin, nom, { toast = () => {} } = {}) {
  fermerDxf();
  const u = dessin.unite || 'mm';
  const E = etat = {
    d: dessin, nom, u, outil: 'dist', pend: [], cotes: [], masque: new Set(), snap: null,
    vue: { s: 1, ox: 0, oy: 0 }, w: 0, h: 0, pointeurs: new Map(), toast,
  };
  const canvas = el('canvas', { class: 'dxf-canvas' });
  const infos = el('div', { class: 'dxf-info' });
  const aide = el('div', { class: 'dxf-aide' });
  const menuCalques = el('div', { class: 'dxf-calques', hidden: '' });
  const outils = [
    ['dist', 'Distance', 'Cliquer deux points : distance directe'],
    ['dxy', 'ΔX / ΔY', 'Cliquer deux points : écarts horizontal et vertical'],
    ['rad', 'Ø / R', 'Cliquer un cercle ou un arc : diamètre et rayon'],
    ['ang', 'Angle', 'Cliquer trois points : sommet, puis les deux côtés'],
  ];
  const bOut = {};
  const barre = el('div', { class: 'dxf-bar' },
    el('strong', {}, 'Plan 2D · ' + nom),
    ...outils.map(([k, t, h]) => (bOut[k] = el('button', { class: 'btn dxf-outil', title: h, onclick: () => choisir(k) }, t))),
    el('button', { class: 'btn', title: 'Cadrer tout le dessin', onclick: () => cadrer() }, 'Ajuster'),
    el('button', { class: 'btn', title: 'Afficher / masquer des calques', onclick: () => { menuCalques.hidden = !menuCalques.hidden; } }, 'Calques'),
    el('button', { class: 'btn', title: 'Annuler la dernière cote', onclick: () => { E.pend = []; E.cotes.pop(); dessiner(); } }, 'Annuler'),
    el('button', { class: 'btn', title: 'Effacer toutes les cotes', onclick: () => { E.pend = []; E.cotes = []; dessiner(); } }, 'Effacer'),
    el('button', { class: 'btn', title: 'Exporter les cotes en CSV', onclick: () => exporter() }, 'Cotes CSV'),
    el('button', { class: 'btn primary', title: 'Revenir à la vue 3D', onclick: () => fermerDxf() }, 'Fermer'),
  );
  racine = el('div', { id: 'dxf-view', class: 'dxf-view' }, barre, el('div', { class: 'dxf-zone' }, canvas, menuCalques, aide, infos));
  document.body.append(racine);

  for (const c of E.d.calques) {
    const cb = el('input', { type: 'checkbox' }); cb.checked = !c.gele;
    if (c.gele) E.masque.add(c.nom);
    cb.onchange = () => { if (cb.checked) E.masque.delete(c.nom); else E.masque.add(c.nom); dessiner(); };
    menuCalques.append(el('label', { class: 'mi' }, cb, `${c.nom} (${c.nb})`));
  }
  const ig = Object.entries(E.d.ignores);
  infos.textContent = `${E.d.items.length} entités · unité : ${E.d.unite_inconnue ? 'mm (supposée, non indiquée dans le fichier)' : u}` + (ig.length ? ` · ignoré : ${ig.map(([k, n]) => `${k} ×${n}`).join(', ')}` : '');

  const ctx = canvas.getContext('2d');
  const px = (x, y) => [x * E.vue.s + E.vue.ox, -y * E.vue.s + E.vue.oy];       // monde → écran
  const mond = (X, Y) => [(X - E.vue.ox) / E.vue.s, -(Y - E.vue.oy) / E.vue.s];  // écran → monde
  const visible = o => !E.masque.has(o.layer);

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

  function etiquette(txt, X, Y, couleur = '#12324b') {
    ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(txt).width + 10;
    ctx.fillStyle = 'rgba(255,255,255,.93)'; ctx.fillRect(X - w / 2, Y - 11, w, 22);
    ctx.strokeStyle = couleur; ctx.lineWidth = 1; ctx.strokeRect(X - w / 2, Y - 11, w, 22);
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

  function dessinerCote(c) {
    const col = '#e8730c';
    if (c.t === 'dist') {
      const A = px(c.a.x, c.a.y), B = px(c.b.x, c.b.y); fleche(A, B, col);
      etiquette(`${f2(distance(c.a, c.b))} ${u}`, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, col);
    } else if (c.t === 'dxy') {
      const C = { x: c.b.x, y: c.a.y }, A = px(c.a.x, c.a.y), B = px(c.b.x, c.b.y), K = px(C.x, C.y);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#9aa7b4'; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.setLineDash([]);
      if (Math.abs(c.b.x - c.a.x) > 1e-9) { fleche(A, K, col); etiquette(`ΔX ${f2(Math.abs(c.b.x - c.a.x))} ${u}`, (A[0] + K[0]) / 2, (A[1] + K[1]) / 2 + (B[1] > A[1] ? -16 : 16), col); }
      if (Math.abs(c.b.y - c.a.y) > 1e-9) { fleche(K, B, col); etiquette(`ΔY ${f2(Math.abs(c.b.y - c.a.y))} ${u}`, K[0] + (B[0] > A[0] ? 34 : -34), (K[1] + B[1]) / 2, col); }
    } else if (c.t === 'rad') {
      const C = px(c.c.x, c.c.y), r = c.r * E.vue.s;
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(C[0] - r * Math.cos(0.7), C[1] + r * Math.sin(0.7)); ctx.lineTo(C[0] + r * Math.cos(0.7), C[1] - r * Math.sin(0.7)); ctx.stroke();
      etiquette(`Ø ${f2(2 * c.r)} · R ${f2(c.r)} ${u}`, C[0], C[1], col);
    } else if (c.t === 'ang') {
      const S = px(c.s.x, c.s.y), A = px(c.a.x, c.a.y), B = px(c.b.x, c.b.y);
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(S[0], S[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
      const a0 = Math.atan2(A[1] - S[1], A[0] - S[0]), a1 = Math.atan2(B[1] - S[1], B[0] - S[0]); let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      ctx.beginPath(); ctx.arc(S[0], S[1], 30, a0, a0 + d, d < 0); ctx.stroke();
      const mid = a0 + d / 2; etiquette(`${f2(angleEntre(c.s, c.a, c.b))} °`, S[0] + 52 * Math.cos(mid), S[1] + 52 * Math.sin(mid), col);
    }
    for (const k of ['a', 'b', 's']) if (c[k]) point(c[k], col, 3.5);
  }

  function dessiner() {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, E.w, E.h);
    const cal = new Map(E.d.calques.map(c => [c.nom, c]));
    for (const o of E.d.items) {
      if (!visible(o)) continue;
      const cl = cal.get(o.layer), col = ACI[cl?.couleur] ?? ACI[7];
      ctx.strokeStyle = o.pointille ? '#6b7b8c' : col; ctx.lineWidth = o.pointille ? 1 : 1.5;
      ctx.setLineDash(o.pointille ? [7, 4] : []);
      if (o.kind === 'text') { const [X, Y] = px(o.pts[0][0], o.pts[0][1]); ctx.setLineDash([]); ctx.fillStyle = col; ctx.font = `${Math.max(9, o.h * E.vue.s)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(o.texte, X, Y); continue; }
      ctx.beginPath();
      o.pts.forEach((p, i) => { const [X, Y] = px(p[0], p[1]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const c of E.cotes) dessinerCote(c);
    for (const p of E.pend) point(p, '#e8730c', 5);
    if (E.snap) {
      const [X, Y] = px(E.snap.x, E.snap.y); ctx.strokeStyle = '#1d8a4b'; ctx.lineWidth = 2; ctx.strokeRect(X - 7, Y - 7, 14, 14);
      etiquette(E.snap.t, X + 10, Y - 20, '#1d8a4b'); ctx.textAlign = 'left';
    }
    aide.textContent = texteAide();
  }

  function texteAide() {
    const o = E.outil, n = E.pend.length;
    if (o === 'rad') return 'Ø / R : cliquer un cercle ou un arc de cercle.';
    if (o === 'ang') return ['Angle : cliquer le sommet.', 'Angle : cliquer un point du 1er côté.', 'Angle : cliquer un point du 2e côté.'][n] ?? '';
    return `${o === 'dxy' ? 'ΔX / ΔY' : 'Distance'} : ${n ? 'cliquer le 2e point.' : 'cliquer le 1er point.'} Valeurs indicatives (dessin 2D, non contractuelles).`;
  }
  function choisir(k) {
    E.outil = k; E.pend = [];
    for (const [id, b] of Object.entries(bOut)) b.classList.toggle('on', id === k);
    dessiner();
  }

  function sous(ev) {
    const r = canvas.getBoundingClientRect(), X = ev.clientX - r.left, Y = ev.clientY - r.top, [x, y] = mond(X, Y);
    return { X, Y, x, y, rayon: (ev.pointerType === 'touch' ? 22 : 12) / E.vue.s };
  }
  function viser(ev) {
    const s = sous(ev);
    if (E.outil === 'rad') { const o = entiteProche(E.d, s.x, s.y, s.rayon, visible); return o && o.r != null ? { x: o.c[0], y: o.c[1], t: 'Ø ' + f2(2 * o.r), item: o.id, o } : null; }
    return accroche(E.d, s.x, s.y, s.rayon, visible) ?? { x: s.x, y: s.y, t: 'libre' };
  }
  function valider(ev) {
    const p = viser(ev); if (!p) { E.toast('Aucun cercle ou arc de cercle ici (ellipses et splines : mesurer par points).'); return; }
    if (E.outil === 'rad') { E.cotes.push({ t: 'rad', c: { x: p.o.c[0], y: p.o.c[1] }, r: p.o.r }); E.snap = null; dessiner(); return; }
    E.pend.push({ x: p.x, y: p.y });
    const need = E.outil === 'ang' ? 3 : 2;
    if (E.pend.length >= need) {
      const [a, b, c] = E.pend;
      E.cotes.push(E.outil === 'ang' ? { t: 'ang', s: a, a: b, b: c } : { t: E.outil, a, b });
      E.pend = [];
    }
    dessiner();
  }

  // Pointeurs : 1 doigt/souris = panoramique (un simple clic sans déplacement = point), 2 doigts = zoom.
  let depart = null, pincement = null;
  canvas.addEventListener('pointerdown', ev => {
    canvas.setPointerCapture(ev.pointerId); E.pointeurs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (E.pointeurs.size === 1) depart = { x: ev.clientX, y: ev.clientY, ox: E.vue.ox, oy: E.vue.oy, bouge: false };
    else { depart = null; const [a, b] = [...E.pointeurs.values()]; pincement = { d: Math.hypot(a.x - b.x, a.y - b.y), s: E.vue.s }; }
  });
  canvas.addEventListener('pointermove', ev => {
    if (E.pointeurs.has(ev.pointerId)) E.pointeurs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pincement && E.pointeurs.size >= 2) {
      const [a, b] = [...E.pointeurs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = canvas.getBoundingClientRect();
      zoomer(d / pincement.d * pincement.s / E.vue.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pincement.d = d; pincement.s = E.vue.s; return;
    }
    if (depart) {
      const dx = ev.clientX - depart.x, dy = ev.clientY - depart.y;
      if (!depart.bouge && Math.hypot(dx, dy) > 6) depart.bouge = true;
      if (depart.bouge) { E.vue.ox = depart.ox + dx; E.vue.oy = depart.oy + dy; dessiner(); return; }
    }
    if (ev.pointerType !== 'touch') { E.snap = viser(ev); if (E.snap && E.snap.t === 'libre') E.snap = null; dessiner(); }
  });
  const fin = ev => {
    const d = depart; E.pointeurs.delete(ev.pointerId); if (E.pointeurs.size < 2) pincement = null;
    if (d && !d.bouge && ev.type === 'pointerup') valider(ev);
    if (!E.pointeurs.size) depart = null;
  };
  canvas.addEventListener('pointerup', fin); canvas.addEventListener('pointercancel', fin);
  function zoomer(k, X, Y) {
    const s = Math.min(1e5, Math.max(1e-3, E.vue.s * k)), kk = s / E.vue.s;
    E.vue.ox = X - (X - E.vue.ox) * kk; E.vue.oy = Y - (Y - E.vue.oy) * kk; E.vue.s = s; dessiner();
  }
  canvas.addEventListener('wheel', ev => { ev.preventDefault(); const r = canvas.getBoundingClientRect(); zoomer(ev.deltaY < 0 ? 1.18 : 1 / 1.18, ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
  canvas.style.touchAction = 'none';

  const onKey = ev => {
    if (!racine) return;
    if (ev.key === 'Escape') { if (E.pend.length) { E.pend = []; dessiner(); } else fermerDxf(); }
  };
  addEventListener('keydown', onKey); E.onKey = onKey;
  const onResize = () => { redim(); dessiner(); }; addEventListener('resize', onResize); E.onResize = onResize;

  function exporter() {
    if (!E.cotes.length) return E.toast('Aucune cote à exporter.');
    const L = ['N°;Type;Valeur;Unité;Détail (indicatif)'];
    E.cotes.forEach((c, i) => {
      const dd = (a, b) => `${f2(a.x)} ; ${f2(a.y)} → ${f2(b.x)} ; ${f2(b.y)}`;
      if (c.t === 'dist') L.push(`${i + 1};Distance;${f2(distance(c.a, c.b))};${u};${dd(c.a, c.b)}`);
      if (c.t === 'dxy') L.push(`${i + 1};ΔX;${f2(Math.abs(c.b.x - c.a.x))};${u};${dd(c.a, c.b)}`, `${i + 1};ΔY;${f2(Math.abs(c.b.y - c.a.y))};${u};${dd(c.a, c.b)}`);
      if (c.t === 'rad') L.push(`${i + 1};Diamètre;${f2(2 * c.r)};${u};centre ${f2(c.c.x)} ; ${f2(c.c.y)}`, `${i + 1};Rayon;${f2(c.r)};${u};`);
      if (c.t === 'ang') L.push(`${i + 1};Angle;${f2(angleEntre(c.s, c.a, c.b))};°;sommet ${f2(c.s.x)} ; ${f2(c.s.y)}`);
    });
    const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' })), download: nom.replace(/\.dxf$/i, '') + '_cotes.csv' });
    document.body.append(a); a.click(); a.remove();
  }

  redim(); choisir('dist'); cadrer();
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
