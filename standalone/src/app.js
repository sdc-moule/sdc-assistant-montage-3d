// SDC Montage 3D — application autonome de consultation d'assemblages pour l'atelier.
// Lecture STEP locale (OpenCascade WASM), aucune modification du fichier source.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { readCad, sha256 } from './step-loader.js';
import { partsFromOcct } from './geom/from-occt.js';
import { meshStats, buildBom, toCsv, signature } from './geom/bom.js';
import { extractCylinders } from './geom/holes.js';
import { buildNetworks } from './geom/circuits.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const APP_VERSION = '1.0.0';
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e[k] = v; else if (v !== undefined && v !== null) e.setAttribute(k, v); } for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k))); return e; };
const fmt = (x, d = 1) => (Number.isFinite(x) ? (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

// ---------------------------------------------------------------- familles de pièces (mode BCR)
const CATEGORIES = [
  { id: 'plaque', label: 'Plaques', color: '#7d93a8', re: /plaque|plate|platen|semelle|entretoise|porte|d[ée]v[êe]t|talon|cale|bridage/i },
  { id: 'empreinte', label: 'Empreintes / inserts', color: '#9a8fc0', re: /empreinte|insert|noyau|core|cavit|poin[çc]on|matrice|tiroir/i },
  { id: 'obturateur', label: 'Obturateurs', color: '#e8730c', re: /obtur|bouch|plug/i },
  { id: 'collecteur', label: 'Collecteurs', color: '#c0584a', re: /collect|manifold|r[ée]partit/i },
  { id: 'busette', label: 'Busettes / buses', color: '#d39b3b', re: /busett|nozzle|buse|sprue|carott/i },
  { id: 'resistance', label: 'Résistances / chauffe', color: '#d24b8a', re: /r[ée]sist|heater|chauff|thermocoupl|cartouche|collier/i },
  { id: 'refroidissement', label: 'Refroidissement / raccords', color: '#3a8fd1', re: /raccord|fitting|refroid|cool|coupl|nipple|eau/i },
  { id: 'visserie', label: 'Visserie / goupilles', color: '#5a5f66', re: /\bvis\b|vis_|screw|chc|bolt|[ée]crou|nut|rondelle|washer|goujon|pion|dowel|goupille|iso.?4762|din.?912/i },
  { id: 'guidage', label: 'Guidage', color: '#58a07a', re: /colonne|bague|guide|pillar|bush|centr/i },
  { id: 'autre', label: 'Non classé', color: '#a3adb7', re: null },
];
const NET_CLASSES = ['non classé', 'refroidissement', 'distribution matière', 'fixation', 'hydraulique / air', 'éjection', 'autre'];
const NET_COLORS = { refroidissement: ['#1f77d0', '#00a3c4', '#4b5fd6', '#0d8f9a'], 'distribution matière': ['#d7301f', '#f0711d', '#c2185b'], fixation: ['#6b7480'], 'hydraulique / air': ['#7b3fbf'], 'éjection': ['#2e8b57'], autre: ['#8d6e63'], 'non classé': ['#e0a400', '#8e44ad', '#16a085', '#d35400', '#2c3e50'] };
const PALETTE = ['#7196af', '#c7a573', '#8bada1', '#ae95b5', '#8d9aab', '#b98b82', '#9fb37a', '#7fa3c9', '#c49a6c', '#8f8fb8'];

// ---------------------------------------------------------------- scène
const viewport = $('viewport'), overlay = $('overlay'), octx = overlay.getContext('2d');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1e6); camera.up.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.localClippingEnabled = true;
viewport.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.15; controls.screenSpacePanning = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x6d7d8c, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.0); scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.7); scene.add(fill);
const modelRoot = new THREE.Group(), skelRoot = new THREE.Group(), helperRoot = new THREE.Group();
scene.add(modelRoot, skelRoot, helperRoot);

// ---------------------------------------------------------------- état
const S = {
  loaded: false, fileName: '', hash: '', parts: [], byId: new Map(), stats: new Map(), bom: [], rowOf: new Map(),
  objs: new Map(), items: {}, sel: new Set(), mode: 'explorer', multi: false,
  ghost: false, edges: false, bubbles: false, bubbleScope: 'all', colorMode: 'step',
  catOf: {}, catOverride: {}, catOff: new Set(),
  ex: { amount: 0, dir: 'z', scope: 'all', ids: null }, exVec: new Map(), moves: [], open: 0,
  cuts: { x: { on: false, pos: 0, flip: false }, y: { on: false, pos: 0, flip: false }, z: { on: false, pos: 0, flip: false } }, caps: true, planeVis: true,
  drill: null, netClass: {}, skelOnly: false, skelShow: false, selNet: null, selFeature: null, filters: { circuit: true, alignement: false, 'isolé': false, 'alésage': false, dmin: 0, dmax: 999 }, maxDrill: 32, cyl: null,
  comments: [], views: [], rowNotes: {}, bubbleOff: {},
  bounds: new THREE.Box3(), measure: { on: false, pts: [] }, skelItems: [], skelGroups: new Map(),
  undo: [], redo: [],
};

// ---------------------------------------------------------------- utilitaires interface
let toastTimer;
function toast(msg, ms = 3500) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }
function busy(text) { $('busy').hidden = !text; if (text) $('busy-text').textContent = text; }
function download(name, data, type) { const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })); const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
const baseName = () => (S.fileName || 'assemblage').replace(/\.[^.]+$/, '');

function resize() {
  const r = viewport.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false); renderer.domElement.style.width = r.width + 'px'; renderer.domElement.style.height = r.height + 'px';
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
  const dpr = Math.min(devicePixelRatio, 2); overlay.width = r.width * dpr; overlay.height = r.height * dpr; overlay.style.width = r.width + 'px'; overlay.style.height = r.height + 'px';
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(viewport);

// ---------------------------------------------------------------- chargement
async function openFile(file) {
  if (!file) return;
  if (!/\.(step|stp|iges|igs|brep)$/i.test(file.name)) { toast('Choisir un fichier STEP / STP (ou IGES).'); return; }
  const bytes = await file.arrayBuffer();
  await loadBytes(bytes, file.name);
}

async function loadBytes(bytes, name) {
  busy('Calcul de l\'empreinte du fichier…');
  try {
    const hash = await sha256(bytes);
    const res = await readCad(bytes, name, $('quality').value, t => busy(t));
    busy('Construction de la vue 3D…');
    await new Promise(r => setTimeout(r, 20));
    install(res, name, hash);
    busy('Recherche des perçages et circuits…');
    await new Promise(r => setTimeout(r, 20));
    analyseDrilling();
    restoreLocal();
    refreshAll();
    setView('iso');
    toast(`${S.parts.length} occurrences, ${S.bom.length} repères. Identifications à vérifier.`, 5000);
  } catch (err) {
    console.error(err);
    toast('Ouverture impossible : ' + err.message, 8000);
  } finally { busy(''); }
}

function disposeModel() {
  for (const o of S.objs.values()) { o.mesh.geometry.disposeBoundsTree?.(); o.mesh.geometry.dispose(); o.mesh.material.dispose(); o.back.material.dispose(); o.edges?.geometry.dispose(); }
  modelRoot.clear(); clearSkeleton(); helperRoot.clear(); S.objs.clear();
}

function install(res, name, hash) {
  disposeModel();
  const { parts } = partsFromOcct(res);
  const kept = parts.filter(p => p.index.length >= 3);
  if (!kept.length) throw new Error('aucun solide trouvé dans le fichier.');
  Object.assign(S, { loaded: true, fileName: name, hash, parts: kept, byId: new Map(kept.map(p => [p.id, p])), items: {}, sel: new Set(), moves: [], open: 0, comments: [], views: [], rowNotes: {}, bubbleOff: {}, netClass: {}, catOverride: {}, catOff: new Set(), undo: [], redo: [], selNet: null, selFeature: null });
  S.ex = { amount: 0, dir: 'z', scope: 'all', ids: null };
  S.stats = new Map(kept.map(p => [p.id, meshStats(p.positions, p.index)]));
  S.bom = buildBom(kept, S.stats);
  S.rowOf = new Map(); for (const r of S.bom) for (const id of r.ids) S.rowOf.set(id, r);
  S.bounds = new THREE.Box3();
  for (const p of kept) {
    const st = S.stats.get(p.id);
    S.bounds.expandByPoint(new THREE.Vector3(...st.min)); S.bounds.expandByPoint(new THREE.Vector3(...st.max));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    if (p.normals && p.normals.length === p.positions.length) g.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3)); else g.computeVertexNormals();
    g.setIndex(new THREE.BufferAttribute(p.index.slice(), 1)); // copie : la BVH réordonne les triangles
    g.computeBoundingBox(); g.computeBoundingSphere(); g.computeBoundsTree();
    const mat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.15, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const mesh = new THREE.Mesh(g, mat); mesh.userData.id = p.id;
    const back = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x555555, side: THREE.BackSide }));
    back.raycast = () => {};
    const grp = new THREE.Group(); grp.add(mesh, back); modelRoot.add(grp);
    // point d'ancrage des bulles : sommet le plus proche du centre de la boîte
    const c = [(st.min[0] + st.max[0]) / 2, (st.min[1] + st.max[1]) / 2, (st.min[2] + st.max[2]) / 2];
    let best = 0, bd = Infinity; const P = p.positions;
    for (let i = 0; i < P.length; i += 3) { const d = (P[i] - c[0]) ** 2 + (P[i + 1] - c[1]) ** 2 + (P[i + 2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } }
    S.objs.set(p.id, { grp, mesh, back, edges: null, part: p, anchor: new THREE.Vector3(P[best], P[best + 1], P[best + 2]), center: new THREE.Vector3(...c), stepColor: p.color ? new THREE.Color(...p.color) : null });
    S.items[p.id] = { visible: true, opacity: 1 };
    S.catOf[p.id] = (CATEGORIES.find(k => k.re && k.re.test(p.name)) ?? CATEGORIES.at(-1)).id;
  }
  for (const k of ['x', 'y', 'z']) S.cuts[k] = { on: false, pos: (S.bounds.min[k] + S.bounds.max[k]) / 2, flip: false };
  const size = S.bounds.getSize(new THREE.Vector3()).length();
  sun.position.copy(S.bounds.getCenter(new THREE.Vector3())).add(new THREE.Vector3(0.6, -0.8, 1).multiplyScalar(size));
  fill.position.copy(S.bounds.getCenter(new THREE.Vector3())).add(new THREE.Vector3(-1, 0.6, -0.3).multiplyScalar(size));
  $('file-label').textContent = `${name} · ${S.parts.length} occurrences · empreinte ${hash.slice(0, 10)}…`;
  $('welcome').hidden = true;
  computeExplodeVectors();
}

// ---------------------------------------------------------------- perçages & circuits
function analyseDrilling() {
  const cyl = new Map();
  for (const p of S.parts) { try { cyl.set(p.id, extractCylinders(p)); } catch (e) { console.warn('analyse', p.name, e); cyl.set(p.id, { holes: [], bosses: [] }); } }
  S.cyl = cyl;
  rebuildNetworks();
}
function rebuildNetworks() {
  S.drill = buildNetworks(S.parts, S.cyl, { maxDrillDiameter: S.maxDrill });
  S.drill.featureById = new Map(S.drill.features.map(f => [f.id, f]));
  S.drill.netOfFeature = new Map(); for (const n of S.drill.networks) for (const f of n.features) S.drill.netOfFeature.set(f, n);
  buildSkeleton();
}
const netLabel = n => S.netClass[n.id] ?? n.suggestion.replace(/ \?$/, '');
const netValidated = n => S.netClass[n.id] !== undefined;
const netClassOf = n => (NET_COLORS[netLabel(n)] ? netLabel(n) : 'non classé');
function netColor(n) {
  const cls = netClassOf(n), list = NET_COLORS[cls];
  const same = S.drill.networks.filter(m => netClassOf(m) === cls);
  return list[Math.max(0, same.indexOf(n)) % list.length];
}
function netVisible(n) {
  const f = S.filters;
  if (!f[n.kind]) return false;
  return n.diameters.some(d => d >= f.dmin && d <= f.dmax);
}
function clearSkeleton() { skelRoot.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); skelRoot.clear(); S.skelGroups = new Map(); S.skelItems = []; }
function buildSkeleton() {
  clearSkeleton();
  const Y = new THREE.Vector3(0, 1, 0);
  const groupFor = pid => { if (!S.skelGroups.has(pid)) { const g = new THREE.Group(); skelRoot.add(g); S.skelGroups.set(pid, g); } return S.skelGroups.get(pid); };
  for (const n of S.drill.networks) {
    for (const fid of n.features) {
      const f = S.drill.featureById.get(fid), g = groupFor(f.partId);
      for (const seg of f.segments) {
        const a = new THREE.Vector3(...seg.start), b = new THREE.Vector3(...seg.end), L = a.distanceTo(b);
        const q = new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize());
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(seg.diameter / 2, seg.diameter / 2, L, 24, 1, true), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, roughness: 0.4 }));
        tube.position.copy(a).add(b).multiplyScalar(0.5); tube.quaternion.copy(q); tube.renderOrder = 5;
        const core = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, L, 8), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }));
        core.position.copy(tube.position); core.quaternion.copy(q); core.renderOrder = 6;
        core.userData.radius = Math.max(0.3, seg.diameter * 0.07);
        core.scale.set(core.userData.radius, 1, core.userData.radius);
        g.add(tube, core);
        S.skelItems.push({ net: n, feature: f, tube, core });
      }
    }
    for (const l of n.links) if (l.type === 'sécant') {
      const f = S.drill.featureById.get(l.a);
      const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.8, f.diameter * 0.45), 16, 12), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }));
      s.position.set(...l.point); s.renderOrder = 7; groupFor(f.partId).add(s); S.skelItems.push({ net: n, feature: null, joint: s });
    }
    for (const p of n.ports) {
      const f = S.drill.featureById.get(p.featureId);
      const dir = new THREE.Vector3(...f.axis).multiplyScalar(p.side === 'start' ? -1 : 1);
      // Marqueurs de taille constante à l'écran (mis à l'échelle à chaque image), indépendants du Ø.
      let m;
      if (p.state === 'libre') m = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 16), new THREE.MeshBasicMaterial({ color: 0x1f8a4c, depthTest: false, transparent: true }));
      else m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 20), new THREE.MeshBasicMaterial({ color: 0xe8730c, depthTest: false, transparent: true }));
      m.quaternion.setFromUnitVectors(Y, dir);
      m.userData.marker = { point: new THREE.Vector3(...p.point), dir, cone: p.state === 'libre', min: Math.min(p.diameter, 4) };
      m.renderOrder = 8; groupFor(f.partId).add(m); S.skelItems.push({ net: n, feature: f, port: m });
    }
  }
}
function styleSkeleton() {
  const show = S.skelShow && S.drill;
  skelRoot.visible = !!show;
  if (!show) return;
  for (const it of S.skelItems) {
    const vis = netVisible(it.net) && (!it.feature || S.items[it.feature.partId]?.visible !== false);
    const objs = [it.tube, it.core, it.joint, it.port].filter(Boolean);
    const col = new THREE.Color(netColor(it.net));
    const focus = S.selNet ? S.selNet === it.net.id : true;
    const featFocus = S.selFeature && it.feature?.id === S.selFeature;
    for (const o of objs) {
      o.visible = vis;
      if (o === it.tube) { o.material.color.copy(featFocus ? new THREE.Color('#ffd400') : col); o.material.opacity = focus ? (featFocus ? 0.8 : 0.5) : 0.1; }
      else if (o === it.core) { o.material.color.copy(featFocus ? new THREE.Color('#ffd400') : col).multiplyScalar(0.75); o.material.opacity = focus ? 1 : 0.15; }
      else if (o === it.joint) { o.material.color.copy(col).multiplyScalar(0.6); o.material.opacity = focus ? 1 : 0.15; }
      else o.material.opacity = focus ? 1 : 0.15;
    }
  }
}

// ---------------------------------------------------------------- éclaté / ouverture / coupes
function computeExplodeVectors() {
  S.exVec = new Map();
  const ids = S.ex.scope === 'selection' && S.ex.ids?.length ? S.ex.ids : [...S.objs.keys()];
  const box = new THREE.Box3(); for (const id of ids) box.expandByPoint(S.objs.get(id).center);
  const C = box.getCenter(new THREE.Vector3());
  const span = S.bounds.getSize(new THREE.Vector3());
  for (const id of ids) {
    const d = S.objs.get(id).center.clone().sub(C);
    let v;
    if (S.ex.dir === 'radial') v = d.multiplyScalar(1.3);
    else { const k = S.ex.dir; v = new THREE.Vector3(); v[k] = d[k] * 1.8; if (Math.abs(d[k]) < 1e-6 && S.ex.scope === 'selection') v[k] = span[k] * 0.6; }
    S.exVec.set(id, v);
  }
}
function partOffset(id) {
  const v = new THREE.Vector3();
  const e = S.exVec.get(id); if (e) v.addScaledVector(e, S.ex.amount / 100);
  for (const m of S.moves) if (m.ids.includes(id)) v.addScaledVector(AX[m.axis], m.sign * m.course * S.open);
  return v;
}
function cutPlanes() {
  const planes = [];
  for (const k of ['x', 'y', 'z']) { const c = S.cuts[k]; if (!c.on) continue; const n = AX[k].clone().multiplyScalar(c.flip ? 1 : -1); planes.push(new THREE.Plane(n, c.flip ? -c.pos : c.pos)); }
  return planes;
}
function currentBounds() {
  const b = new THREE.Box3();
  for (const [id, o] of S.objs) { const st = S.stats.get(id), off = partOffset(id); b.expandByPoint(new THREE.Vector3(...st.min).add(off)); b.expandByPoint(new THREE.Vector3(...st.max).add(off)); }
  return b;
}

// ---------------------------------------------------------------- application de l'état d'affichage
function baseColor(id) {
  const o = S.objs.get(id), row = S.rowOf.get(id);
  if (S.colorMode === 'repere') return new THREE.Color(PALETTE[(row.repere - 1) % PALETTE.length]);
  if (S.colorMode === 'categorie') return new THREE.Color(CATEGORIES.find(c => c.id === catOf(id)).color);
  return o.stepColor ? o.stepColor.clone() : new THREE.Color(PALETTE[(row.repere - 1) % PALETTE.length]);
}
const catOf = id => S.catOverride[id] ?? S.catOf[id];
function applyDisplay() {
  if (!S.loaded) return;
  const planes = cutPlanes();
  for (const [id, o] of S.objs) {
    const it = S.items[id];
    const visible = it.visible && !S.catOff.has(catOf(id));
    let op = it.opacity;
    const selected = S.sel.has(id);
    if (S.skelOnly && S.skelShow) op = Math.min(op, 0.07);
    else if (S.ghost && S.sel.size && !selected) op = Math.min(op, 0.12);
    o.grp.visible = visible && op > 0.001;
    o.grp.position.copy(partOffset(id));
    const m = o.mesh.material;
    m.color.copy(baseColor(id));
    m.emissive.set(selected ? 0xd85a00 : 0x000000); m.emissiveIntensity = selected ? 0.55 : 0;
    m.opacity = op; m.depthWrite = op >= 1;
    const key = `${planes.length}|${op < 1}`;
    m.transparent = op < 1; m.clippingPlanes = planes;
    if (o.matKey !== key) { m.needsUpdate = true; o.back.material.needsUpdate = true; if (o.edges) o.edges.material.needsUpdate = true; o.matKey = key; }
    o.back.visible = op >= 1 && S.caps;
    o.back.material.color.copy(m.color).multiplyScalar(0.55); if (selected) o.back.material.color.lerp(new THREE.Color(0xd85a00), 0.5);
    o.back.material.clippingPlanes = planes;
    if (S.edges) {
      if (!o.edges) { o.edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.mesh.geometry, 28), new THREE.LineBasicMaterial({ color: 0x1b2a38, transparent: true, opacity: 0.55 })); o.edges.raycast = () => {}; o.grp.add(o.edges); }
      o.edges.visible = true; o.edges.material.clippingPlanes = planes; o.edges.material.opacity = 0.55 * Math.max(op, 0.2);
    } else if (o.edges) o.edges.visible = false;
  }
  for (const [pid, g] of S.skelGroups ?? []) g.position.copy(partOffset(pid));
  styleSkeleton();
  drawPlaneHelpers(planes);
}
function drawPlaneHelpers() {
  helperRoot.children.filter(c => c.userData.plane).forEach(c => { c.geometry.dispose(); c.material.dispose(); helperRoot.remove(c); });
  if (!S.planeVis) return;
  const b = currentBounds(), size = b.getSize(new THREE.Vector3()).multiplyScalar(1.08), c = b.getCenter(new THREE.Vector3());
  for (const k of ['x', 'y', 'z']) {
    if (!S.cuts[k].on) continue;
    const dims = { x: [size.y, size.z], y: [size.x, size.z], z: [size.x, size.y] }[k];
    const g = new THREE.PlaneGeometry(dims[0], dims[1]);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe8730c, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    if (k === 'x') m.rotation.set(0, Math.PI / 2, 0); if (k === 'y') m.rotation.set(Math.PI / 2, 0, 0);
    m.position.copy(c); m.position[k] = S.cuts[k].pos; m.userData.plane = true; m.raycast = () => {};
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0xe8730c }));
    edge.raycast = () => {}; m.add(edge); helperRoot.add(m);
  }
}

// ---------------------------------------------------------------- caméra
function fitBox(box, dirVec) {
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
  const dir = (dirVec ?? camera.position.clone().sub(controls.target)).normalize();
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.aspect < 1 ? 1.25 / camera.aspect : 1.05);
  camera.position.copy(c).addScaledVector(dir, dist); controls.target.copy(c);
  camera.near = Math.max(dist / 1000, 0.05); camera.far = dist * 50; camera.updateProjectionMatrix(); controls.update();
}
function setView(v) {
  const d = { iso: [1, -1.2, 0.9], top: [0, -0.0001, 1], front: [0, -1, 0.0001], right: [1, 0, 0.0001] }[v];
  fitBox(currentBounds(), new THREE.Vector3(...d));
}
function fitSelection() {
  if (!S.sel.size) return fitBox(currentBounds());
  const b = new THREE.Box3(); for (const id of S.sel) { const st = S.stats.get(id), off = partOffset(id); b.expandByPoint(new THREE.Vector3(...st.min).add(off)); b.expandByPoint(new THREE.Vector3(...st.max).add(off)); }
  fitBox(b);
}

// ---------------------------------------------------------------- historique (masquages / transparences)
function snapshot() { return JSON.stringify({ items: S.items, catOff: [...S.catOff] }); }
function pushHistory() { S.undo.push(snapshot()); if (S.undo.length > 80) S.undo.shift(); S.redo = []; }
function restoreSnap(s) { const o = JSON.parse(s); S.items = o.items; S.catOff = new Set(o.catOff); refreshAll(); }
function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restoreSnap(S.undo.pop()); }
function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restoreSnap(S.redo.pop()); }

// ---------------------------------------------------------------- sélection
function select(ids, additive = false) {
  if (!additive) S.sel.clear();
  for (const id of ids) { if (additive && S.sel.has(id) && ids.length === 1) S.sel.delete(id); else S.sel.add(id); }
  refreshAll();
}
function clearSel() { S.sel.clear(); S.selFeature = null; refreshAll(); }
function hideSel() { if (!S.sel.size) return; pushHistory(); for (const id of S.sel) S.items[id].visible = false; S.sel.clear(); refreshAll(); }
function isolateSel() { if (!S.sel.size) return; pushHistory(); for (const id of S.objs.keys()) S.items[id].visible = S.sel.has(id); refreshAll(); fitSelection(); }
function showAll() { pushHistory(); for (const it of Object.values(S.items)) { it.visible = true; it.opacity = 1; } S.catOff.clear(); refreshAll(); }

// ---------------------------------------------------------------- pointeur 3D
const ray = new THREE.Raycaster(); ray.firstHitOnly = false;
let down = null, dragBubble = null;
function ndc(ev) { const r = renderer.domElement.getBoundingClientRect(); return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); }
function pick(ev) {
  ray.setFromCamera(ndc(ev), camera);
  const meshes = [...S.objs.values()].filter(o => o.grp.visible && o.mesh.material.opacity > 0.15).map(o => o.mesh);
  const planes = cutPlanes();
  for (const h of ray.intersectObjects(meshes, false)) if (planes.every(p => p.distanceToPoint(h.point) >= -1e-6)) return h;
  return null;
}
renderer.domElement.addEventListener('pointerdown', ev => {
  down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  const b = bubbleAt(ev); if (b) { dragBubble = { b, x: ev.clientX, y: ev.clientY, moved: false }; controls.enabled = false; }
});
renderer.domElement.addEventListener('pointermove', ev => {
  if (!dragBubble) return;
  const dx = ev.clientX - dragBubble.x, dy = ev.clientY - dragBubble.y;
  if (Math.hypot(dx, dy) > 4) dragBubble.moved = true;
  if (dragBubble.moved) { const o = S.bubbleOff[dragBubble.b.repere] ?? [0, 0]; S.bubbleOff[dragBubble.b.repere] = [o[0] + dx, o[1] + dy]; dragBubble.x = ev.clientX; dragBubble.y = ev.clientY; }
});
renderer.domElement.addEventListener('pointerup', ev => {
  controls.enabled = true;
  if (dragBubble) { const d = dragBubble; dragBubble = null; if (!d.moved) select(S.bom.find(r => r.repere === d.b.repere).ids, ev.ctrlKey || ev.shiftKey || S.multi); else saveLocal(); return; }
  if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6 || !S.loaded) return;
  const h = pick(ev);
  if (S.measure.on) { if (h) { S.measure.pts.push(h.point.clone()); if (S.measure.pts.length > 2) S.measure.pts = [h.point.clone()]; drawMeasure(); } return; }
  if (S.mode === 'percages' && S.skelShow) { const f = pickFeature(ev); if (f) { selectFeature(f.id, true); return; } }
  if (h) select([h.object.userData.id], ev.ctrlKey || ev.metaKey || ev.shiftKey || S.multi);
  else if (!S.multi) clearSel();
});
renderer.domElement.addEventListener('dblclick', () => fitSelection());
function pickFeature(ev) {
  ray.setFromCamera(ndc(ev), camera);
  const tubes = S.skelItems.filter(i => i.tube?.visible).map(i => i.tube);
  const h = ray.intersectObjects(tubes, false)[0];
  return h ? S.skelItems.find(i => i.tube === h.object).feature : null;
}

// ---------------------------------------------------------------- mesure
function drawMeasure() {
  helperRoot.children.filter(c => c.userData.measure).forEach(c => { c.geometry?.dispose(); helperRoot.remove(c); });
  const size = S.bounds.getSize(new THREE.Vector3()).length();
  for (const p of S.measure.pts) { const s = new THREE.Mesh(new THREE.SphereGeometry(size * 0.004, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd7301f, depthTest: false })); s.position.copy(p); s.renderOrder = 10; s.userData.measure = true; helperRoot.add(s); }
  if (S.measure.pts.length === 2) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(S.measure.pts), new THREE.LineBasicMaterial({ color: 0xd7301f, depthTest: false })); l.renderOrder = 10; l.userData.measure = true; helperRoot.add(l); }
}

// ---------------------------------------------------------------- calque 2D : bulles, étiquettes, mesure
let bubbleCache = [];
function project(v) { const p = v.clone().project(camera); const r = overlay.getBoundingClientRect(); return { x: (p.x + 1) / 2 * r.width, y: (1 - p.y) / 2 * r.height, z: p.z }; }
function bubbleAt(ev) { if (!S.bubbles) return null; const r = overlay.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top; return bubbleCache.find(b => Math.hypot(b.bx - x, b.by - y) <= b.rad + 2) ?? null; }
function drawOverlay() {
  const r = overlay.getBoundingClientRect();
  octx.clearRect(0, 0, r.width, r.height);
  bubbleCache = [];
  if (!S.loaded) return;
  if (S.bubbles) drawBubbles(r);
  if (S.skelShow && S.drill) drawNetLabels();
  if (S.measure.on && S.measure.pts.length === 2) {
    const [a, b] = S.measure.pts, d = a.distanceTo(b), m = project(a.clone().add(b).multiplyScalar(0.5));
    label(m.x, m.y - 14, `${fmt(d, 2)} mm  (ΔX ${fmt(Math.abs(b.x - a.x), 1)} · ΔY ${fmt(Math.abs(b.y - a.y), 1)} · ΔZ ${fmt(Math.abs(b.z - a.z), 1)})  indicatif`, '#d7301f');
  }
}
function label(x, y, text, color = '#18232e', bg = 'rgba(255,255,255,.92)') {
  octx.font = '600 13px Bahnschrift, Segoe UI, sans-serif';
  const w = octx.measureText(text).width + 12;
  octx.fillStyle = bg; octx.strokeStyle = color; octx.lineWidth = 1.5;
  octx.beginPath(); octx.roundRect(x - w / 2, y - 11, w, 22, 6); octx.fill(); octx.stroke();
  octx.fillStyle = color; octx.textAlign = 'center'; octx.textBaseline = 'middle'; octx.fillText(text, x, y + 0.5);
}
function drawBubbles(r) {
  const rows = S.bubbleScope === 'selection' ? S.bom.filter(row => row.ids.some(id => S.sel.has(id))) : S.bom;
  const cx = r.width / 2, cy = r.height / 2;
  const list = [];
  for (const row of rows) {
    const id = row.ids.find(i => S.objs.get(i).grp.visible && S.objs.get(i).mesh.material.opacity > 0.15);
    if (!id) continue;
    const o = S.objs.get(id), a = project(o.anchor.clone().add(partOffset(id)));
    if (a.z > 1 || a.x < -50 || a.y < -50 || a.x > r.width + 50 || a.y > r.height + 50) continue;
    const dir = new THREE.Vector2(a.x - cx, a.y - cy); if (dir.length() < 1) dir.set(1, -1); dir.normalize();
    const off = S.bubbleOff[row.repere] ?? [0, 0];
    list.push({ repere: row.repere, ax: a.x, ay: a.y, bx: a.x + dir.x * 70 + off[0], by: a.y + dir.y * 70 + off[1], rad: 14 + (row.repere > 99 ? 4 : 0), fixed: !!S.bubbleOff[row.repere], sel: row.ids.some(i => S.sel.has(i)) });
  }
  for (let it = 0; it < 12; it++) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], dx = b.bx - a.bx, dy = b.by - a.by, d = Math.hypot(dx, dy) || 0.01, min = a.rad + b.rad + 4;
    if (d < min) { const push = (min - d) / 2, ux = dx / d, uy = dy / d; if (!a.fixed) { a.bx -= ux * push; a.by -= uy * push; } if (!b.fixed) { b.bx += ux * push; b.by += uy * push; } }
  }
  for (const b of list) {
    const col = b.sel ? '#d85a00' : '#1f4462';
    octx.strokeStyle = col; octx.fillStyle = col; octx.lineWidth = 1.5;
    const ang = Math.atan2(b.ay - b.by, b.ax - b.bx), sx = b.bx + Math.cos(ang) * b.rad, sy = b.by + Math.sin(ang) * b.rad;
    octx.beginPath(); octx.moveTo(sx, sy); octx.lineTo(b.ax, b.ay); octx.stroke();
    octx.beginPath(); octx.moveTo(b.ax, b.ay); octx.lineTo(b.ax - 9 * Math.cos(ang - 0.35), b.ay - 9 * Math.sin(ang - 0.35)); octx.lineTo(b.ax - 9 * Math.cos(ang + 0.35), b.ay - 9 * Math.sin(ang + 0.35)); octx.closePath(); octx.fill();
    octx.beginPath(); octx.arc(b.bx, b.by, b.rad, 0, Math.PI * 2); octx.fillStyle = '#fff'; octx.fill(); octx.stroke();
    octx.fillStyle = col; octx.font = '700 13px Bahnschrift, Segoe UI, sans-serif'; octx.textAlign = 'center'; octx.textBaseline = 'middle'; octx.fillText(String(b.repere), b.bx, b.by + 0.5);
  }
  bubbleCache = list;
}
function drawNetLabels() {
  for (const n of S.drill.networks) {
    if (!netVisible(n) || n.kind === 'isolé' && !S.selNet) continue;
    if (S.selNet && S.selNet !== n.id) continue;
    const fs = n.features.map(id => S.drill.featureById.get(id));
    if (S.selNet) {
      for (const f of fs) {
        if (S.items[f.partId]?.visible === false) continue;
        const m = new THREE.Vector3(...f.start).add(new THREE.Vector3(...f.end)).multiplyScalar(0.5).add(partOffset(f.partId)), p = project(m);
        if (p.z < 1) label(p.x, p.y, `${f.id} Ø${fmt(f.diameter, 1)}`, f.id === S.selFeature ? '#b38600' : netColor(n));
      }
    } else {
      const longest = fs.reduce((a, b) => (b.length > a.length ? b : a));
      const m = new THREE.Vector3(...longest.start).add(new THREE.Vector3(...longest.end)).multiplyScalar(0.5).add(partOffset(longest.partId)), p = project(m);
      if (p.z < 1) label(p.x, p.y, `${n.id} · ${netLabel(n)}`, netColor(n));
    }
  }
}

// ---------------------------------------------------------------- rendu
function loop() {
  requestAnimationFrame(loop);
  controls.update();
  // épaisseur constante à l'écran des axes de circuits
  if (skelRoot.visible) { const k = camera.position.distanceTo(controls.target) / 900; for (const it of S.skelItems) {
    if (it.core) { const rr = Math.max(it.core.userData.radius, k); it.core.scale.set(rr, 1, rr); }
    const mk = it.port?.userData.marker;
    if (mk) { const sz = Math.max(mk.min, k * 14); it.port.scale.setScalar(sz); it.port.position.copy(mk.point).addScaledVector(mk.dir, mk.cone ? sz / 2 : 0); }
  } }
  renderer.render(scene, camera);
  drawOverlay();
}

// ---------------------------------------------------------------- panneaux
function refreshAll() { applyDisplay(); renderTree(); renderBom(); renderCard(); renderSelbar(); renderCategories(); if (S.mode === 'percages') renderNets(); if (S.mode === 'notes') { renderComments(); renderViews(); } if (S.mode === 'eclate') renderMoves(); if (S.mode === 'coupe') renderPlanes(); saveLocal(); }

function matches(id, term) {
  if (!term) return true;
  const p = S.byId.get(id), row = S.rowOf.get(id), st = S.stats.get(id);
  if (/^\d+$/.test(term) && row.repere === +term) return true;
  const hay = `${row.repere} ${p.name} ${p.path.join(' ')} ${row.reference ?? ''} ${S.rowNotes[row.repere]?.reference ?? ''} ${st.size.map(x => x.toFixed(1)).join(' ')} ${CATEGORIES.find(c => c.id === catOf(id)).label}`.toLocaleLowerCase('fr');
  if (hay.includes(term)) return true;
  const dm = term.match(/^[øo⌀d]?\s*(\d+(?:[.,]\d+)?)$/i);
  if (dm && S.drill) { const d = parseFloat(dm[1].replace(',', '.')); return S.drill.features.some(f => f.partId === id && f.segments.some(s => Math.abs(s.diameter - d) < 0.11)); }
  return false;
}
const eyeSvg = on => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = on ? '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' : '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.2 6.2C3.6 8 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 4.2-.9"/>'; return s; };
function partRow(id) {
  const p = S.byId.get(id), row = S.rowOf.get(id), it = S.items[id];
  const eye = el('button', { class: 'eye', title: it.visible ? 'Masquer' : 'Afficher', onclick: e => { e.stopPropagation(); pushHistory(); it.visible = !it.visible; refreshAll(); } }, eyeSvg(it.visible));
  const cat = CATEGORIES.find(c => c.id === catOf(id));
  return el('div', { class: `row${S.sel.has(id) ? ' sel' : ''}${it.visible ? '' : ' hidden-part'}`, onclick: e => select([id], e.ctrlKey || e.metaKey || e.shiftKey || S.multi) },
    eye, el('span', { class: 'badge' }, row.repere), el('span', { class: 'name', title: p.name }, p.name), el('span', { class: 'tag', style: `border-left:4px solid ${cat.color}` }, cat.label.split(' ')[0]));
}
function renderTree() {
  const box = $('tab-tree'); box.replaceChildren();
  if (!S.loaded) return;
  const term = $('search').value.trim().toLocaleLowerCase('fr');
  const groups = new Map();
  for (const p of S.parts) { if (!matches(p.id, term)) continue; const k = p.path.join(' / ') || 'Assemblage'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p.id); }
  for (const [name, ids] of groups) {
    const allVis = ids.every(id => S.items[id].visible);
    const head = el('div', { class: 'row', onclick: e => select(ids, e.ctrlKey || S.multi) },
      el('button', { class: 'eye', title: 'Masquer / afficher le sous-ensemble', onclick: e => { e.stopPropagation(); pushHistory(); for (const id of ids) S.items[id].visible = !allVis; refreshAll(); } }, eyeSvg(allVis)),
      el('span', { class: 'name' }, `▦ ${name}`), el('span', { class: 'tag' }, ids.length),
      el('button', { class: 'eye', title: 'Isoler ce sous-ensemble', onclick: e => { e.stopPropagation(); S.sel = new Set(ids); isolateSel(); } }, '◎'));
    box.append(el('div', { class: 'group' }, head, el('div', { class: 'children' }, ids.map(partRow))));
  }
  if (!groups.size) box.append(el('p', { class: 'hint' }, 'Aucun résultat.'));
}
function renderBom() {
  const body = $('bom-body'); body.replaceChildren();
  const term = $('search').value.trim().toLocaleLowerCase('fr');
  for (const row of S.bom) {
    if (!row.ids.some(id => matches(id, term))) continue;
    const note = S.rowNotes[row.repere] ?? {};
    const st = note.statut ?? row.statut;
    const tagCls = st === 'validé' ? 'ok' : /regroup/.test(st) ? 'warn' : '';
    body.append(el('tr', { class: row.ids.some(id => S.sel.has(id)) ? 'sel' : '', onclick: e => select(row.ids, e.ctrlKey || S.multi) },
      el('td', {}, el('span', { class: 'badge' }, row.repere)), el('td', {}, row.designation, note.reference ? el('div', { class: 'hint' }, 'Réf. ' + note.reference) : null, row.notes.length ? el('div', { class: 'hint' }, row.notes.join(' · ')) : null),
      el('td', {}, row.quantite), el('td', { class: 'dims' }, row.dims.map(x => fmt(x, 1)).join('×')), el('td', {}, el('span', { class: `tag ${tagCls}` }, st))));
  }
}
function renderSelbar() {
  $('selbar').hidden = !S.sel.size;
  $('sel-count').textContent = S.sel.size === 1 ? `Repère ${S.rowOf.get([...S.sel][0]).repere}` : `${S.sel.size} pièces`;
  if (S.sel.size) $('s-opacity').value = Math.round(S.items[[...S.sel][0]].opacity * 100);
}
function renderCard() {
  const card = $('part-card');
  if (!S.sel.size) { card.hidden = true; return; }
  card.hidden = false; card.replaceChildren();
  const ids = [...S.sel], rows = [...new Set(ids.map(id => S.rowOf.get(id)))];
  if (rows.length > 1) { card.append(el('h4', {}, `${ids.length} pièces sélectionnées`), el('p', { class: 'hint' }, 'Repères : ' + rows.map(r => r.repere).sort((a, b) => a - b).join(', '))); return; }
  const row = rows[0], id = ids[0], p = S.byId.get(id), st = S.stats.get(id), note = S.rowNotes[row.repere] ?? {};
  const holes = S.drill ? S.drill.features.filter(f => f.partId === id) : [];
  const byD = new Map(); for (const f of holes) { const k = f.segments.map(s => 'Ø' + fmt(s.diameter, 1)).join('/'); byD.set(k, (byD.get(k) ?? 0) + 1); }
  const refInput = el('input', { value: note.reference ?? '', placeholder: 'Référence (saisie atelier / BE)' });
  card.append(...[
    el('h4', {}, el('span', { class: 'badge' }, row.repere), p.name),
    el('dl', {},
      el('dt', {}, 'Sous-ensemble'), el('dd', {}, p.path.join(' / ') || '—'),
      el('dt', {}, 'Quantité'), el('dd', {}, `${row.quantite} occurrence(s)`),
      el('dt', {}, 'Encombrement'), el('dd', {}, `${st.size.map(x => fmt(x, 2)).join(' × ')} mm`),
      el('dt', {}, ''), el('dd', { class: 'hint' }, 'boîte dans le repère assemblage — pas une cote fonctionnelle'),
      el('dt', {}, 'Volume'), el('dd', {}, `${fmt(st.volume / 1000, 1)} cm³ (maillage)`),
      el('dt', {}, 'Famille'), el('dd', {}, CATEGORIES.find(c => c.id === catOf(id)).label + (S.catOverride[id] ? ' ✔' : ' (proposé)')),
      el('dt', {}, 'Perçages'), el('dd', {}, holes.length ? [...byD].map(([k, n]) => `${n}× ${k}`).join(', ') : 'aucun détecté'),
      el('dt', {}, 'Statut'), el('dd', {}, note.statut ?? row.statut)),
    row.notes.length ? el('p', { class: 'hint' }, row.notes.join(' · ')) : null,
    refInput,
    el('div', { class: 'grid2' },
      el('button', { class: 'btn', onclick: () => { S.rowNotes[row.repere] = { ...note, reference: refInput.value.trim() || undefined }; refreshAll(); toast('Référence enregistrée.'); } }, 'Enregistrer la réf.'),
      el('button', { class: 'btn', onclick: () => { S.rowNotes[row.repere] = { ...note, statut: note.statut === 'validé' ? undefined : 'validé' }; refreshAll(); } }, note.statut === 'validé' ? 'Annuler validation' : 'Valider le repère')),
    holes.length ? el('button', { class: 'btn wide', onclick: () => { setMode('percages'); const n = S.drill.netOfFeature.get(holes[0].id); S.filters[n.kind] = true; $('f-' + ({ circuit: 'circuit', alignement: 'align', 'isolé': 'iso', 'alésage': 'bore' }[n.kind])).checked = true; selectNet(n.id); } }, 'Voir les perçages de la pièce') : null,
  ].filter(Boolean));
}
function renderCategories() {
  const box = $('categories'); box.replaceChildren();
  if (!S.loaded) return;
  for (const c of CATEGORIES) {
    const n = S.parts.filter(p => catOf(p.id) === c.id).length; if (!n) continue;
    box.append(el('span', { class: `chip${S.catOff.has(c.id) ? ' off' : ''}`, title: 'Afficher / masquer la famille ; double-clic : sélectionner', onclick: () => { pushHistory(); S.catOff.has(c.id) ? S.catOff.delete(c.id) : S.catOff.add(c.id); refreshAll(); }, ondblclick: () => select(S.parts.filter(p => catOf(p.id) === c.id).map(p => p.id)) }, el('i', { style: `background:${c.color}` }), `${c.label} (${n})`));
  }
}

// ---------------------------------------------------------------- panneau éclaté / ouverture
function renderMoves() {
  const box = $('op-list'); box.replaceChildren();
  for (const m of S.moves) box.append(el('div', { class: 'row' }, el('span', { class: 'name' }, `${m.name} · ${m.ids.length} pièce(s) · ${m.sign > 0 ? '+' : '−'}${m.axis.toUpperCase()} ${m.course} mm`),
    el('button', { class: 'eye', title: 'Sélectionner', onclick: () => select(m.ids) }, '◎'),
    el('button', { class: 'eye', title: 'Supprimer', onclick: () => { S.moves = S.moves.filter(x => x !== m); refreshAll(); } }, '✕')));
  if (!S.moves.length) box.append(el('p', { class: 'hint' }, 'Aucun groupe mobile défini.'));
}

// ---------------------------------------------------------------- panneau coupes
function renderPlanes() {
  const box = $('planes'); box.replaceChildren();
  if (!S.loaded) return;
  const b = currentBounds();
  const names = { x: 'Plan YZ (selon X)', y: 'Plan XZ (selon Y)', z: 'Plan XY (selon Z)' };
  for (const k of ['y', 'x', 'z']) {
    const c = S.cuts[k], min = Math.floor(b.min[k] - 1), max = Math.ceil(b.max[k] + 1);
    const out = el('span', { class: 'mm' }, `${fmt(c.pos, 1)} mm`);
    const slider = el('input', { type: 'range', min, max, step: 0.1, value: c.pos, disabled: c.on ? null : '' });
    slider.oninput = () => { c.pos = +slider.value; out.textContent = `${fmt(c.pos, 1)} mm`; applyDisplay(); };
    slider.onchange = () => saveLocal();
    box.append(el('div', { class: 'plane' },
      el('header', {}, el('b', {}, names[k]), out,
        el('button', { class: `btn toggle${c.on ? ' on' : ''}`, onclick: () => { c.on = !c.on; if (c.on && (c.pos < min || c.pos > max)) c.pos = (min + max) / 2; refreshAll(); } }, c.on ? 'Active' : 'Activer'),
        el('button', { class: 'btn', title: 'Inverser le côté visible', onclick: () => { c.flip = !c.flip; refreshAll(); } }, '⇄')), slider));
  }
}

// ---------------------------------------------------------------- panneau perçages & circuits
function selectNet(id) { S.selNet = S.selNet === id ? null : id; S.selFeature = null; S.skelShow = true; $('skel-show').classList.add('on'); refreshAll(); if (S.selNet) fitNet(S.drill.networks.find(n => n.id === id)); }
function fitNet(n) { const b = new THREE.Box3(); for (const fid of n.features) { const f = S.drill.featureById.get(fid), o = partOffset(f.partId); b.expandByPoint(new THREE.Vector3(...f.start).add(o)); b.expandByPoint(new THREE.Vector3(...f.end).add(o)); } b.expandByScalar(10); fitBox(b); }
function selectFeature(fid, fromClick = false) {
  const n = S.drill.netOfFeature.get(fid);
  if (S.selNet !== n.id) { S.selNet = n.id; }
  S.selFeature = S.selFeature === fid && fromClick ? null : fid;
  refreshAll();
}
function renderNets() {
  const box = $('net-list'), det = $('net-detail'); box.replaceChildren(); det.replaceChildren();
  if (!S.drill) return;
  const shown = S.drill.networks.filter(netVisible);
  const counts = { circuit: 0, alignement: 0, 'isolé': 0, 'alésage': 0 }; for (const n of S.drill.networks) counts[n.kind]++;
  box.append(el('p', { class: 'hint' }, `${S.drill.features.length - counts['alésage']} perçages · ${counts.circuit} circuit(s) · ${counts.alignement} passage(s) aligné(s) · ${counts['isolé']} isolé(s) · ${counts['alésage']} alésage(s)/logement(s) au-delà de Ø${S.maxDrill}`));
  for (const n of shown) {
    const kindTxt = { circuit: 'circuit', alignement: 'passage aligné', 'isolé': 'perçage isolé', 'alésage': 'alésage / logement' }[n.kind];
    box.append(el('div', { class: `row net${S.selNet === n.id ? ' sel' : ''}`, style: `--c:${netColor(n)}`, onclick: () => selectNet(n.id) },
      el('div', { class: 'name' }, el('b', {}, `${n.id} · ${netLabel(n)}`), netValidated(n) ? ' ✔' : el('span', { class: 'tag warn' }, 'proposé'),
        el('div', { class: 'meta' }, `${kindTxt} · ${n.features.length} perçage(s) · Ø ${n.diameters.map(d => fmt(d, 1)).join(' / ')} · ${fmt(n.totalLength, 0)} mm · ${n.ports.filter(p => p.state === 'libre').length} ouverture(s), ${n.ports.filter(p => p.state === 'logé').length} obturée(s)/logée(s)`))));
  }
  if (!shown.length) box.append(el('p', { class: 'hint' }, 'Aucun réseau avec ces filtres.'));
  const n = S.selNet && S.drill.networks.find(x => x.id === S.selNet);
  if (!n) return;
  const sel = el('select', { onchange: () => { if (sel.value) S.netClass[n.id] = sel.value; else delete S.netClass[n.id]; refreshAll(); } }, el('option', { value: '' }, `— proposé : ${n.suggestion}`), NET_CLASSES.map(c => el('option', { value: c, selected: S.netClass[n.id] === c ? '' : null }, c)));
  const t = el('table', {}, el('tr', {}, ['Perç.', 'Rep.', 'Ø mm', 'L mm', 'Axe', 'Débouche', 'Logé'].map(h => el('th', {}, h))));
  for (const fid of n.features) {
    const f = S.drill.featureById.get(fid), row = S.rowOf.get(f.partId);
    t.append(el('tr', { class: S.selFeature === fid ? 'sel' : '', onclick: () => { selectFeature(fid, true); } },
      el('td', {}, f.id), el('td', {}, row.repere), el('td', {}, f.segments.map(s => fmt(s.diameter, 1)).join(' / ')), el('td', {}, fmt(f.length, 1)), el('td', {}, f.direction),
      el('td', {}, f.open.start && f.open.end ? '2 côtés' : f.open.start || f.open.end ? '1 côté' : 'borgne'), el('td', { class: 'occ', title: f.occupants.map(o => o.name).join(', ') }, f.occupants.map(o => o.name).join(', ') || '—')));
  }
  const ports = n.ports.map(p => el('li', {}, `${p.state === 'libre' ? '🟢 ouverture libre' : '🟠 ' + (p.occupant ?? 'logé')} · ${p.featureId} Ø${fmt(p.diameter, 1)} en (${p.point.map(v => fmt(v, 1)).join(' ; ')})`));
  let fdet = null;
  if (S.selFeature && n.features.includes(S.selFeature)) {
    const f = S.drill.featureById.get(S.selFeature), st = S.stats.get(f.partId);
    const rel = v => v.map((x, i) => fmt(x - st.min[i], 2)).join(' ; ');
    fdet = el('div', { class: 'net-detail' }, el('b', {}, `${f.id} — ${S.byId.get(f.partId).name} (repère ${S.rowOf.get(f.partId).repere})`),
      el('div', {}, `Type : ${f.kind === 'étagé' ? 'perçage étagé ' + f.segments.map(s => `Ø${fmt(s.diameter, 1)}×${fmt(s.length, 1)}`).join(' + ') : `Ø${fmt(f.diameter, 2)} × ${fmt(f.length, 1)} mm`} · axe ${f.direction}`),
      el('div', {}, `Extrémité A (${f.open.start ? 'débouchante' : 'fond / jonction'}) : ${rel(f.start)}`),
      el('div', {}, `Extrémité B (${f.open.end ? 'débouchante' : 'fond / jonction'}) : ${rel(f.end)}`),
      el('div', { class: 'hint' }, 'Coordonnées en mm depuis le coin mini (X,Y,Z) de la boîte de la pièce, repère assemblage. Valeurs indicatives (maillage) ; taraudages non détectés.'),
      el('button', { class: 'btn wide', onclick: () => { const o = partOffset(f.partId); const b = new THREE.Box3().setFromPoints([new THREE.Vector3(...f.start).add(o), new THREE.Vector3(...f.end).add(o)]).expandByScalar(f.diameter * 3); fitBox(b); } }, 'Cadrer ce perçage'));
  }
  det.append(el('div', { class: 'net-detail' },
    el('div', { class: 'grid2' }, el('b', {}, `${n.id} · ${n.features.length} perçage(s)`), sel),
    el('div', { class: 'grid2' }, el('button', { class: 'btn', onclick: () => select([...new Set(n.partIds)]) }, 'Sélectionner les pièces'), el('button', { class: 'btn', onclick: () => fitNet(n) }, 'Cadrer le réseau')),
    t, el('ul', {}, ports), el('p', { class: 'hint' }, 'Liaisons : sécantes (forages qui se croisent) et coaxiales entre pièces. Vérifier sur plan avant usinage.')));
  if (fdet) det.append(fdet);
}

// ---------------------------------------------------------------- notes, vues
function renderComments() {
  const box = $('c-list'); box.replaceChildren();
  for (const c of [...S.comments].reverse()) {
    box.append(el('div', { class: 'row', onclick: () => { const ids = c.ids.filter(id => S.objs.has(id)); if (ids.length) { select(ids); fitSelection(); } } },
      el('div', { class: 'name', style: 'white-space:normal' }, el('b', {}, `Rep. ${c.reperes.join(', ')} · ${c.type}`), ` — ${c.text}`, el('div', { class: 'hint' }, `${c.author || 'anonyme'} · ${new Date(c.date).toLocaleString('fr-FR')} · ${c.status}`)),
      el('button', { class: 'eye', title: 'Basculer ouvert / traité', onclick: e => { e.stopPropagation(); c.status = c.status === 'ouvert' ? 'traité' : 'ouvert'; refreshAll(); } }, '✓'),
      el('button', { class: 'eye', title: 'Supprimer', onclick: e => { e.stopPropagation(); if (confirm('Supprimer ce commentaire ?')) { S.comments = S.comments.filter(x => x !== c); refreshAll(); } } }, '✕')));
  }
  if (!S.comments.length) box.append(el('p', { class: 'hint' }, 'Aucun commentaire.'));
}
function viewState() {
  return { camera: { position: camera.position.toArray(), target: controls.target.toArray() }, items: JSON.parse(JSON.stringify(S.items)), catOff: [...S.catOff], cuts: JSON.parse(JSON.stringify(S.cuts)), ex: { ...S.ex }, open: S.open, ghost: S.ghost, bubbles: S.bubbles, skelShow: S.skelShow, skelOnly: S.skelOnly, selNet: S.selNet, sel: [...S.sel] };
}
function applyViewState(v) {
  pushHistory();
  Object.assign(S.items, v.items); S.catOff = new Set(v.catOff ?? []); S.cuts = v.cuts; S.ex = v.ex; S.open = v.open ?? 0; S.ghost = !!v.ghost; S.bubbles = !!v.bubbles; S.skelShow = !!v.skelShow; S.skelOnly = !!v.skelOnly; S.selNet = v.selNet ?? null; S.sel = new Set((v.sel ?? []).filter(id => S.objs.has(id)));
  computeExplodeVectors(); syncToggles();
  camera.position.fromArray(v.camera.position); controls.target.fromArray(v.camera.target); controls.update();
  refreshAll();
}
function renderViews() {
  const box = $('v-list'); box.replaceChildren();
  for (const v of S.views) box.append(el('div', { class: 'row', onclick: () => applyViewState(v.state) }, el('span', { class: 'name' }, `👁 ${v.name}`), el('span', { class: 'hint' }, new Date(v.date).toLocaleDateString('fr-FR')),
    el('button', { class: 'eye', title: 'Supprimer', onclick: e => { e.stopPropagation(); S.views = S.views.filter(x => x !== v); refreshAll(); } }, '✕')));
  if (!S.views.length) box.append(el('p', { class: 'hint' }, 'Aucune vue mémorisée.'));
}
function syncToggles() {
  $('ghost-toggle').classList.toggle('on', S.ghost); $('bubbles-toggle').classList.toggle('on', S.bubbles); $('edges-toggle').classList.toggle('on', S.edges);
  $('skel-show').classList.toggle('on', S.skelShow); $('skel-only').classList.toggle('on', S.skelOnly);
  $('ex-amount').value = S.ex.amount; $('ex-val').textContent = `${Math.round(S.ex.amount)} %`; $('ex-dir').value = S.ex.dir; $('ex-scope').value = S.ex.scope;
  $('op-amount').value = Math.round(S.open * 100); $('op-val').textContent = `${Math.round(S.open * 100)} %`;
  $('caps-toggle').classList.toggle('on', S.caps); $('planevis-toggle').classList.toggle('on', S.planeVis);
}

// ---------------------------------------------------------------- persistance locale et projet
const LS = () => `sdc-montage3d:${S.hash}`;
let saveTimer;
function projectData() {
  return { application: 'SDC Montage 3D', version: APP_VERSION, schema: 'sdc-montage3d-projet/2', fichier: S.fileName, empreinte_sha256: S.hash, date: new Date().toISOString(),
    occurrences: S.parts.map(p => ({ id: p.id, nom: p.name, signature: signature(p, S.stats.get(p.id)), repere: S.rowOf.get(p.id).repere })),
    maxDrill: S.maxDrill, comments: S.comments, views: S.views, netClass: S.netClass, moves: S.moves, rowNotes: S.rowNotes, catOverride: S.catOverride, bubbleOff: S.bubbleOff, display: viewState() };
}
function saveLocal() { if (!S.loaded) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(LS(), JSON.stringify(projectData())); } catch { /* stockage indisponible : le fichier projet reste possible */ } }, 400); }
function restoreLocal() { try { const raw = localStorage.getItem(LS()); if (raw) { applyProject(JSON.parse(raw), true); toast('Annotations et vues de ce fichier restaurées.'); } } catch { /* rien */ } }
function applyProject(pr, silent = false) {
  let map = id => id;
  if (pr.empreinte_sha256 !== S.hash) {
    // Fichier différent : correspondance par nom + signature géométrique, sans fusion en cas de doute.
    const bySig = new Map(); for (const p of S.parts) { const k = p.name + '|' + signature(p, S.stats.get(p.id)); if (!bySig.has(k)) bySig.set(k, []); bySig.get(k).push(p.id); }
    const m = new Map(); let unsure = 0;
    for (const o of pr.occurrences ?? []) { const cand = bySig.get(o.nom + '|' + o.signature) ?? []; const free = cand.find(id => ![...m.values()].includes(id)); if (free) m.set(o.id, free); else unsure++; }
    map = id => m.get(id);
    if (!confirm(`Ce projet a été créé sur un autre fichier (${pr.fichier}). ${m.size} occurrence(s) retrouvée(s), ${unsure} sans correspondance. Les numéros de repère et réseaux peuvent différer. Continuer ?`)) return;
  }
  if (Number.isFinite(pr.maxDrill) && pr.maxDrill !== S.maxDrill && S.cyl) { S.maxDrill = pr.maxDrill; $('f-maxdrill').value = pr.maxDrill; rebuildNetworks(); }
  S.comments = (pr.comments ?? []).map(c => ({ ...c, ids: c.ids.map(map).filter(Boolean) }));
  S.views = pr.empreinte_sha256 === S.hash ? (pr.views ?? []) : [];
  S.netClass = pr.empreinte_sha256 === S.hash ? (pr.netClass ?? {}) : {};
  S.moves = (pr.moves ?? []).map(m => ({ ...m, ids: m.ids.map(map).filter(Boolean) }));
  S.rowNotes = pr.empreinte_sha256 === S.hash ? (pr.rowNotes ?? {}) : {};
  S.catOverride = Object.fromEntries(Object.entries(pr.catOverride ?? {}).map(([k, v]) => [map(k), v]).filter(([k]) => k));
  S.bubbleOff = pr.empreinte_sha256 === S.hash ? (pr.bubbleOff ?? {}) : {};
  if (!silent) toast('Projet chargé.');
}

// ---------------------------------------------------------------- exports
function exportBom() {
  const header = ['repere', 'designation', 'reference', 'quantite', 'sous_ensemble', 'X_mm', 'Y_mm', 'Z_mm', 'volume_cm3', 'famille', 'commentaire', 'origine_information', 'statut_validation'];
  const rows = S.bom.map(r => { const n = S.rowNotes[r.repere] ?? {}; const com = S.comments.filter(c => c.reperes.includes(r.repere)).map(c => `[${c.type}] ${c.text}`).join(' | ');
    return [r.repere, r.designation, n.reference ?? '', r.quantite, r.sousEnsemble, ...r.dims.map(x => x.toFixed(2).replace('.', ',')), (r.volume / 1000).toFixed(2).replace('.', ','), CATEGORIES.find(c => c.id === catOf(r.ids[0])).label, [com, ...r.notes].filter(Boolean).join(' | '), r.origine, n.statut ?? r.statut]; });
  download(`${baseName()}_nomenclature.csv`, toCsv(header, rows), 'text/csv;charset=utf-8');
}
function exportDrill() {
  if (!S.drill) return;
  const header = ['reseau', 'classement', 'statut_classement', 'type_reseau', 'percage', 'repere', 'piece', 'diametres_mm', 'longueur_mm', 'axe', 'A_X', 'A_Y', 'A_Z', 'B_X', 'B_Y', 'B_Z', 'A_debouchant', 'B_debouchant', 'element_loge', 'origine_coordonnees'];
  const rows = [];
  for (const n of S.drill.networks) for (const fid of n.features) {
    const f = S.drill.featureById.get(fid), st = S.stats.get(f.partId), c = v => v.map((x, i) => (Math.abs(x - st.min[i]) < 0.005 ? 0 : x - st.min[i]).toFixed(2).replace('.', ','));
    rows.push([n.id, netLabel(n), netValidated(n) ? 'validé' : 'proposé', n.kind, f.id, S.rowOf.get(f.partId).repere, S.byId.get(f.partId).name, f.segments.map(s => s.diameter.toFixed(2).replace('.', ',')).join(' / '), f.length.toFixed(2).replace('.', ','), f.direction, ...c(f.start), ...c(f.end), f.open.start ? 'oui' : 'non', f.open.end ? 'oui' : 'non', f.occupants.map(o => o.name).join(', '), 'coin mini boîte pièce, repère assemblage, indicatif']);
  }
  download(`${baseName()}_percages.csv`, toCsv(header, rows), 'text/csv;charset=utf-8');
}
function snapshotPng() {
  renderer.render(scene, camera); drawOverlay();
  const w = renderer.domElement.width, h = renderer.domElement.height, c = el('canvas'); c.width = w; c.height = h + 60;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(renderer.domElement, 0, 0); g.drawImage(overlay, 0, 0, w, h);
  g.fillStyle = '#1f4462'; g.fillRect(0, h, w, 60); g.fillStyle = '#fff'; g.font = `${Math.max(12, Math.round(w / 95))}px Bahnschrift, Segoe UI, sans-serif`; g.textBaseline = 'middle';
  g.fillText(`SDC Montage 3D · ${S.fileName} · ${new Date().toLocaleString('fr-FR')} · vue de consultation, non contractuelle`, 16, h + 30);
  return c.toDataURL('image/png');
}
function exportPng() { fetch(snapshotPng()).then(r => r.blob()).then(b => download(`${baseName()}_capture.png`, b)); }
function printReport() {
  const img = snapshotPng(), rep = $('print-report'); rep.replaceChildren();
  rep.append(el('h1', {}, `Rapport de consultation — ${S.fileName}`), el('div', {}, `Édité le ${new Date().toLocaleString('fr-FR')} · empreinte SHA-256 ${S.hash} · SDC Montage 3D ${APP_VERSION}`),
    el('p', {}, 'Document de consultation : dimensions d\'encombrement et perçages issus du maillage d\'affichage, valeurs indicatives. Aucune vérification de collision, jeu, tolérance ou serrage.'),
    el('img', { src: img }), el('h2', {}, 'Nomenclature'));
  const t = el('table', {}, el('tr', {}, ['Rep.', 'Désignation', 'Réf.', 'Qté', 'X × Y × Z (mm)', 'Statut'].map(h => el('th', {}, h))));
  for (const r of S.bom) { const n = S.rowNotes[r.repere] ?? {}; t.append(el('tr', {}, el('td', {}, r.repere), el('td', {}, r.designation), el('td', {}, n.reference ?? ''), el('td', {}, r.quantite), el('td', {}, r.dims.map(x => fmt(x, 1)).join(' × ')), el('td', {}, n.statut ?? r.statut))); }
  rep.append(t);
  if (S.drill) {
    rep.append(el('h2', {}, 'Circuits et réseaux de perçages'));
    const t2 = el('table', {}, el('tr', {}, ['Réseau', 'Classement', 'Perçages', 'Ø (mm)', 'Longueur cumulée', 'Ouvertures / obturés'].map(h => el('th', {}, h))));
    for (const n of S.drill.networks.filter(n => n.kind !== 'isolé')) t2.append(el('tr', {}, el('td', {}, n.id), el('td', {}, `${netLabel(n)} (${netValidated(n) ? 'validé' : 'proposé'})`), el('td', {}, n.features.join(', ')), el('td', {}, n.diameters.map(d => fmt(d, 1)).join(' / ')), el('td', {}, fmt(n.totalLength, 0) + ' mm'), el('td', {}, `${n.ports.filter(p => p.state === 'libre').length} / ${n.ports.filter(p => p.state === 'logé').length}`)));
    rep.append(t2);
  }
  if (S.comments.length) { rep.append(el('h2', {}, 'Commentaires')); const t3 = el('table', {}, el('tr', {}, ['Repères', 'Type', 'Commentaire', 'Auteur', 'Date', 'Statut'].map(h => el('th', {}, h)))); for (const c of S.comments) t3.append(el('tr', {}, el('td', {}, c.reperes.join(', ')), el('td', {}, c.type), el('td', {}, c.text), el('td', {}, c.author), el('td', {}, new Date(c.date).toLocaleString('fr-FR')), el('td', {}, c.status))); rep.append(t3); }
  setTimeout(() => window.print(), 100);
}

// ---------------------------------------------------------------- modes
function setMode(m) {
  S.mode = m;
  for (const b of document.querySelectorAll('#rail button')) b.classList.toggle('on', b.dataset.mode === m);
  for (const s of document.querySelectorAll('#panel-left section')) s.hidden = s.dataset.panel !== m;
  if (m === 'percages' && !S.skelShowTouched) { S.skelShow = true; }
  if (m !== 'percages' && S.skelOnly) { S.skelOnly = false; }
  syncToggles(); refreshAll();
}

// ---------------------------------------------------------------- liaisons interface
function wire() {
  for (const b of document.querySelectorAll('#rail button')) b.onclick = () => setMode(b.dataset.mode);
  for (const id of ['file', 'file2']) $(id).onchange = e => { openFile(e.target.files[0]); e.target.value = ''; };
  const demo = () => { const b64 = window.__SDC_DEMO_STEP_GZ_B64__; if (!b64) return toast('Démonstration absente de cette version.'); busy('Préparation de la démonstration…'); gunzip(b64).then(bytes => loadBytes(bytes.buffer, 'demo_BCR_synthetique.step')).catch(err => { busy(''); toast('Démonstration impossible : ' + err.message); }); };
  $('demo').onclick = demo; $('demo2').onclick = demo;
  const stage = document.querySelector('.stage');
  stage.addEventListener('dragover', e => { e.preventDefault(); $('drop').hidden = false; });
  stage.addEventListener('dragleave', e => { if (e.target === stage || e.target.id === 'drop') $('drop').hidden = true; });
  stage.addEventListener('drop', e => { e.preventDefault(); $('drop').hidden = true; openFile(e.dataTransfer.files[0]); });
  for (const t of document.querySelectorAll('.tabs button')) t.onclick = () => { for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === t); $('tab-tree').hidden = t.dataset.tab !== 'tree'; $('tab-bom').hidden = t.dataset.tab !== 'bom'; };
  $('search').oninput = () => { renderTree(); renderBom(); };
  $('search').onkeydown = e => { if (e.key === 'Enter') { const term = $('search').value.trim().toLocaleLowerCase('fr'); const ids = S.parts.filter(p => matches(p.id, term)).map(p => p.id); if (ids.length) { select(ids); fitSelection(); } } };
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  $('fit-all').onclick = () => fitBox(currentBounds());
  $('multi').onclick = () => { S.multi = !S.multi; $('multi').classList.toggle('on', S.multi); };
  $('measure').onclick = () => { S.measure.on = !S.measure.on; S.measure.pts = []; drawMeasure(); $('measure').classList.toggle('on', S.measure.on); if (S.measure.on) toast('Mesure : toucher deux points sur les pièces. Valeur indicative.'); };
  $('undo').onclick = undo; $('redo').onclick = redo;
  $('s-fit').onclick = fitSelection; $('s-hide').onclick = hideSel; $('s-isolate').onclick = isolateSel; $('s-clear').onclick = clearSel;
  $('s-opacity').onpointerdown = () => pushHistory();
  $('s-opacity').oninput = () => { for (const id of S.sel) S.items[id].opacity = +$('s-opacity').value / 100; applyDisplay(); };
  $('s-opacity').onchange = () => saveLocal();
  $('show-all').onclick = showAll;
  $('ghost-toggle').onclick = () => { S.ghost = !S.ghost; syncToggles(); applyDisplay(); };
  $('edges-toggle').onclick = () => { S.edges = !S.edges; syncToggles(); busy(S.edges ? 'Calcul des arêtes…' : ''); setTimeout(() => { applyDisplay(); busy(''); }, 20); };
  $('bubbles-toggle').onclick = () => { S.bubbles = !S.bubbles; syncToggles(); };
  $('color-mode').onchange = () => { S.colorMode = $('color-mode').value; applyDisplay(); };
  $('bubble-scope').onchange = () => { S.bubbleScope = $('bubble-scope').value; };
  $('classify').append(...CATEGORIES.map(c => el('option', { value: c.id }, c.label)));
  $('classify').onchange = () => { if (!S.sel.size || !$('classify').value) { toast('Sélectionner d\'abord des pièces.'); $('classify').value = ''; return; } for (const id of S.sel) S.catOverride[id] = $('classify').value; $('classify').value = ''; refreshAll(); };
  // éclaté
  const exChanged = () => { S.ex.dir = $('ex-dir').value; S.ex.scope = $('ex-scope').value; if (S.ex.scope === 'selection') S.ex.ids = [...S.sel]; computeExplodeVectors(); applyDisplay(); };
  $('ex-dir').onchange = exChanged; $('ex-scope').onchange = () => { if ($('ex-scope').value === 'selection' && !S.sel.size) { toast('Sélectionner les pièces à écarter.'); $('ex-scope').value = 'all'; } exChanged(); };
  $('ex-amount').oninput = () => { if (S.ex.scope === 'selection' && !S.ex.ids?.length) exChanged(); S.ex.amount = +$('ex-amount').value; $('ex-val').textContent = `${S.ex.amount} %`; applyDisplay(); };
  let anim = null;
  const animateTo = target => { cancelAnimationFrame(anim); const from = S.ex.amount, t0 = performance.now(); const step = t => { const k = Math.min(1, (t - t0) / 1200), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; S.ex.amount = from + (target - from) * e; syncToggles(); applyDisplay(); if (k < 1) anim = requestAnimationFrame(step); }; anim = requestAnimationFrame(step); };
  $('ex-close').onclick = () => animateTo(0); $('ex-open').onclick = () => animateTo(100); $('ex-play').onclick = () => animateTo(S.ex.amount > 50 ? 0 : 100);
  $('op-add').onclick = () => { if (!S.sel.size) return toast('Sélectionner d\'abord les pièces mobiles.'); S.moves.push({ name: `Groupe ${S.moves.length + 1}`, ids: [...S.sel], axis: $('op-axis').value, sign: +$('op-sign').value, course: Math.abs(+$('op-course').value || 0) }); refreshAll(); toast('Groupe mobile créé. Utiliser le curseur fermé → ouvert.'); };
  $('op-amount').oninput = () => { S.open = +$('op-amount').value / 100; $('op-val').textContent = `${$('op-amount').value} %`; applyDisplay(); };
  // coupes
  $('caps-toggle').onclick = () => { S.caps = !S.caps; syncToggles(); applyDisplay(); };
  $('planevis-toggle').onclick = () => { S.planeVis = !S.planeVis; syncToggles(); applyDisplay(); };
  $('cut-reset').onclick = () => { for (const k of ['x', 'y', 'z']) S.cuts[k].on = false; refreshAll(); };
  // perçages
  $('skel-show').onclick = () => { S.skelShow = !S.skelShow; S.skelShowTouched = true; if (!S.skelShow) S.skelOnly = false; syncToggles(); applyDisplay(); };
  $('skel-only').onclick = () => { S.skelOnly = !S.skelOnly; if (S.skelOnly) S.skelShow = true; syncToggles(); applyDisplay(); };
  $('f-maxdrill').onchange = () => { S.maxDrill = Math.max(1, +$('f-maxdrill').value || 32); S.selNet = null; S.selFeature = null; S.netClass = {}; rebuildNetworks(); refreshAll(); toast('Réseaux recalculés : les classements validés ont été remis à « proposé ».'); };
  for (const [id, k] of [['f-circuit', 'circuit'], ['f-align', 'alignement'], ['f-iso', 'isolé'], ['f-bore', 'alésage']]) $(id).onchange = () => { S.filters[k] = $(id).checked; refreshAll(); };
  $('f-dmin').oninput = () => { S.filters.dmin = +$('f-dmin').value || 0; refreshAll(); };
  $('f-dmax').oninput = () => { S.filters.dmax = +$('f-dmax').value || 999; refreshAll(); };
  // notes et vues
  try { $('c-author').value = localStorage.getItem('sdc-montage3d:auteur') ?? ''; } catch { /* rien */ }
  $('c-add').onclick = () => {
    const text = $('c-text').value.trim(); if (!S.sel.size) return toast('Sélectionner la ou les pièces concernées.'); if (!text) return toast('Écrire le commentaire.');
    const ids = [...S.sel]; S.comments.push({ ids, reperes: [...new Set(ids.map(id => S.rowOf.get(id).repere))].sort((a, b) => a - b), type: $('c-type').value, status: $('c-status').value, author: $('c-author').value.trim(), text, date: new Date().toISOString() });
    try { localStorage.setItem('sdc-montage3d:auteur', $('c-author').value.trim()); } catch { /* rien */ }
    $('c-text').value = ''; refreshAll(); toast('Commentaire ajouté.');
  };
  $('v-save').onclick = () => { if (!S.loaded) return; S.views.push({ name: $('v-name').value.trim() || `Vue ${S.views.length + 1}`, date: new Date().toISOString(), state: viewState() }); $('v-name').value = ''; refreshAll(); toast('Vue mémorisée.'); };
  // projet / export
  $('save-project').onclick = () => { if (!S.loaded) return toast('Ouvrir d\'abord un assemblage.'); download(`${baseName()}_projet-sdc.json`, JSON.stringify(projectData(), null, 1), 'application/json'); };
  $('load-project').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (!S.loaded) return toast('Ouvrir d\'abord l\'assemblage STEP correspondant.'); try { applyProject(JSON.parse(await f.text())); refreshAll(); } catch (err) { toast('Projet illisible : ' + err.message); } };
  $('export-btn').onclick = e => { e.stopPropagation(); $('export-menu').hidden = !$('export-menu').hidden; };
  document.addEventListener('click', () => { $('export-menu').hidden = true; });
  for (const b of document.querySelectorAll('[data-export]')) b.onclick = () => { if (!S.loaded) return toast('Ouvrir d\'abord un assemblage.'); ({ bom: exportBom, drill: exportDrill, png: exportPng, print: printReport })[b.dataset.export](); };
  $('help-btn').onclick = () => { $('help').hidden = false; }; $('help-close').onclick = () => { $('help').hidden = true; };
  $('version-info').textContent = `SDC Montage 3D ${APP_VERSION} · lecture CAO : OpenCascade (occt-import-js, LGPL) · affichage : Three.js (MIT).`;
  window.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'h') hideSel(); else if (k === 'i') isolateSel(); else if (k === 'a' && !e.ctrlKey) showAll(); else if (k === 'f') fitSelection(); else if (k === 'escape') { clearSel(); S.selNet = null; refreshAll(); }
  });
}
async function gunzip(b64) { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); return new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }

// ---------------------------------------------------------------- démarrage
wire(); resize(); loop();
window.__SDC__ = { S, loadBytes, setMode, select, selectNet, extractCylinders, buildNetworks }; // accès pour essais automatisés
