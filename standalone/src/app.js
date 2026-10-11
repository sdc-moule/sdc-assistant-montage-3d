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
import { extractCadFromZip } from './geom/unzip.js';
import { pngWithText, pngText } from './geom/png-meta.js';
import { fixStepLatin1 } from './geom/step-text.js';
import { cacheGet, cachePut } from './cache.js';
import { classifyFace, coteCylindre, coteEntre } from './geom/cotation.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { executer, contexteIA, modeEmploiIA, COMMANDES, VERSION_COMMANDES, ErreurCommande } from './geom/commande.js';
import { analyserTypologie, correspond, validerCriteres, resumeCriteres, TYPES } from './geom/typologie.js';
import { creerGroupe, trouverGroupe, ajouterAuGroupe, retirerDuGroupe, renommerGroupe, supprimerGroupe, groupesDe, reprendreGroupes, ErreurGroupe } from './geom/groupes.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const APP_VERSION = '1.2.0';
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
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true, stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.localClippingEnabled = true;
viewport.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.15; controls.screenSpacePanning = true;
// Rendu : éclairage d'atelier (environnement studio embarqué) + tonalité filmique, pour des volumes lisibles.
renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x56636f, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.3); scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.35); scene.add(fill);
const modelRoot = new THREE.Group(), skelRoot = new THREE.Group(), helperRoot = new THREE.Group(), capRoot = new THREE.Group();
scene.add(modelRoot, skelRoot, helperRoot, capRoot);

// ---------------------------------------------------------------- état
const S = {
  loaded: false, fileName: '', hash: '', parts: [], byId: new Map(), stats: new Map(), bom: [], rowOf: new Map(),
  objs: new Map(), items: {}, sel: new Set(), mode: 'explorer', multi: false,
  ghost: false, edges: true, bubbles: false, bubbleScope: 'all', colorMode: 'step',
  catOf: {}, catOverride: {}, catOff: new Set(),
  ex: { amount: 0, dir: 'z', scope: 'all', ids: null }, exVec: new Map(), moves: [], open: 0, opType: 'translation', pickAxis: false, hinge: null, boxMode: false,
  cuts: { x: { on: false, pos: 0, flip: false }, y: { on: false, pos: 0, flip: false }, z: { on: false, pos: 0, flip: false } }, caps: true, planeVis: false, hiddenFaces: {}, faceMode: false, drillLabels: false, fill: { on: true, min: 3, max: 20 },
  drill: null, netClass: {}, skelOnly: false, skelShow: false, selNet: null, selFeature: null, filters: { circuit: true, alignement: false, 'isolé': false, 'alésage': false, dmin: 0, dmax: 999 }, maxDrill: 32, cyl: null,
  comments: [], views: [], rowNotes: {}, bubbleOff: {}, groups: [], typo: new Map(),
  bounds: new THREE.Box3(), measure: { on: false, pts: [] }, cote: { pending: null }, cotes: [], cotesVisible: true, skelItems: [], skelGroups: new Map(),
  undo: [], redo: [],
};

// ---------------------------------------------------------------- utilitaires interface
let toastTimer;
function toast(msg, ms = 3500) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }
function busy(text) { $('busy').hidden = !text; if (text) $('busy-text').textContent = text; }
// Enregistrement : boîte « Enregistrer sous » ouverte sur Téléchargements (Chrome/Edge), sinon téléchargement direct.
async function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (window.showSaveFilePicker) {
    const ext = name.slice(name.lastIndexOf('.'));
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, startIn: 'downloads', types: [{ description: ext.slice(1).toUpperCase(), accept: { [blob.type || 'application/octet-stream']: [ext] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close(); toast(`Enregistré : ${h.name}`); return;
    } catch (err) { if (err.name === 'AbortError') return; /* sinon repli sur le téléchargement */ }
  }
  const url = URL.createObjectURL(blob); const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
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
  if (/\.zip$/i.test(file.name)) {
    busy('Décompression de l\'archive…');
    try {
      const z = await extractCadFromZip(await file.arrayBuffer());
      if (z.others) toast(`${z.others + 1} fichiers CAO dans l'archive : ouverture du plus gros (${z.name}).`, 6000);
      return loadBytes(z.bytes, z.name);
    } catch (err) { busy(''); toast('Archive : ' + err.message, 8000); return; }
  }
  if (!/\.(step|stp|iges|igs|brep)$/i.test(file.name)) { toast('Choisir un fichier STEP / STP (ou IGES), éventuellement zippé.'); return; }
  const bytes = await file.arrayBuffer();
  await loadBytes(bytes, file.name);
}

async function loadBytes(bytes, name) {
  busy('Calcul de l\'empreinte du fichier…');
  try {
    const hash = await sha256(bytes);
    const quality = $('quality').value, key = `${hash}|${quality}`;
    let res = await cacheGet(key);
    if (res) busy('Maillage déjà converti sur ce poste : ouverture rapide…');
    else {
      // Accents ISO-8859-1 bruts → \X\HH dans une copie en mémoire (noms lisibles), source intacte.
      const src = /\.(step|stp)$/i.test(name) ? fixStepLatin1(bytes).bytes : bytes;
      const mo = bytes.byteLength / 1e6, t0 = performance.now();
      let phase = 'Préparation du moteur OpenCascade…';
      const tick = setInterval(() => { const sec = Math.round((performance.now() - t0) / 1000); busy(`${phase}\n${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s — fichier de ${mo.toFixed(0)} Mo${mo > 15 ? ' : compter environ ' + Math.ceil(mo * 4 / 60) + ' min la première fois, puis ouverture rapide' : ''}`); }, 1000);
      try { res = await readCad(src, name, quality, t => { phase = t; }); } finally { clearInterval(tick); }
      busy('Mémorisation du maillage pour la prochaine ouverture…');
      cachePut(key, res); // sans attendre
    }
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
  modelRoot.clear(); clearSkeleton(); helperRoot.clear(); capRoot.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); }); capRoot.clear(); S.objs.clear();
}

function install(res, name, hash) {
  disposeModel();
  const { parts } = partsFromOcct(res);
  const kept = parts.filter(p => p.index.length >= 3);
  if (!kept.length) throw new Error('aucun solide trouvé dans le fichier.');
  Object.assign(S, { loaded: true, fileName: name, hash, parts: kept, byId: new Map(kept.map(p => [p.id, p])), items: {}, sel: new Set(), comments: [], views: [], rowNotes: {}, bubbleOff: {}, groups: [], typo: new Map(), netClass: {}, catOverride: {}, catOff: new Set(), hiddenFaces: {}, moves: [], open: 0, hinge: null, cotes: [], undo: [], redo: [], selNet: null, selFeature: null });
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
    // face B-Rep de chaque sommet (les sommets d'occt-import-js ne sont pas partagés entre faces)
    const vertFace = new Int32Array(p.positions.length / 3).fill(-1);
    p.faces.forEach((f, fi) => { for (let t = f.first; t <= f.last; t++) for (let k = 0; k < 3; k++) vertFace[p.index[3 * t + k]] = fi; });
    g.setAttribute('faceVis', new THREE.BufferAttribute(new Float32Array(p.positions.length / 3).fill(1), 1));
    const mat = withFaceMask(new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.1, roughness: 0.62, envMapIntensity: 0.18, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    const mesh = new THREE.Mesh(g, mat); mesh.userData.id = p.id;
    // Intérieur de matière (coupes, face retirée) : face arrière éclairée, plus sombre.
    const back = new THREE.Mesh(g, withFaceMask(new THREE.MeshStandardMaterial({ color: 0x555555, side: THREE.BackSide, metalness: 0, roughness: 0.9, envMapIntensity: 0.5 })));
    back.raycast = () => {};
    const grp = new THREE.Group(); grp.add(mesh, back); modelRoot.add(grp);
    // point d'ancrage des bulles : sommet le plus proche du centre de la boîte
    const c = [(st.min[0] + st.max[0]) / 2, (st.min[1] + st.max[1]) / 2, (st.min[2] + st.max[2]) / 2];
    let best = 0, bd = Infinity; const P = p.positions;
    for (let i = 0; i < P.length; i += 3) { const d = (P[i] - c[0]) ** 2 + (P[i + 1] - c[1]) ** 2 + (P[i + 2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } }
    S.objs.set(p.id, { grp, mesh, back, edges: null, part: p, vertFace, anchor: new THREE.Vector3(P[best], P[best + 1], P[best + 2]), center: new THREE.Vector3(...c), stepColor: p.color ? new THREE.Color().setRGB(...p.color, THREE.SRGBColorSpace) : null /* couleurs STEP = sRGB, comme en CAO */ });
    S.items[p.id] = { visible: true, opacity: 1 };
    S.catOf[p.id] = (CATEGORIES.find(k => k.re && k.re.test(p.name)) ?? CATEGORIES.at(-1)).id;
  }
  for (const k of ['x', 'y', 'z']) S.cuts[k] = { on: false, pos: (S.bounds.min[k] + S.bounds.max[k]) / 2, flip: false };
  const size = S.bounds.getSize(new THREE.Vector3()).length();
  sun.position.copy(S.bounds.getCenter(new THREE.Vector3())).add(new THREE.Vector3(0.9, -1.1, 0.8).multiplyScalar(size));
  fill.position.copy(S.bounds.getCenter(new THREE.Vector3())).add(new THREE.Vector3(-1, 0.6, -0.3).multiplyScalar(size));
  $('file-label').textContent = `${name} · ${S.parts.length} occurrences · empreinte ${hash.slice(0, 10)}…`;
  $('welcome').hidden = true;
  computeExplodeVectors();
}

// Masquage de faces B-Rep : attribut faceVis (0/1) par sommet, fragments rejetés dans le shader.
function withFaceMask(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float faceVis;\nvarying float vFaceVis;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFaceVis = faceVis;');
    sh.fragmentShader = 'varying float vFaceVis;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFaceVis < 0.5) discard;');
  };
  mat.customProgramCacheKey = () => 'sdc-facemask';
  return mat;
}
function applyHiddenFaces() {
  for (const [id, o] of S.objs) {
    const hidden = new Set(S.hiddenFaces[id] ?? []), a = o.mesh.geometry.getAttribute('faceVis');
    let changed = false;
    for (let i = 0; i < a.count; i++) { const v = hidden.has(o.vertFace[i]) ? 0 : 1; if (a.array[i] !== v) { a.array[i] = v; changed = true; } }
    if (changed) a.needsUpdate = true;
  }
}
const faceOfHit = h => S.objs.get(h.object.userData.id).vertFace[h.face.a];
const faceVisible = h => !(S.hiddenFaces[h.object.userData.id] ?? []).includes(faceOfHit(h));

// ---------------------------------------------------------------- perçages & circuits
function analyseDrilling() {
  const cyl = new Map();
  for (const p of S.parts) { try { cyl.set(p.id, extractCylinders(p)); } catch (e) { console.warn('analyse', p.name, e); cyl.set(p.id, { holes: [], bosses: [] }); } }
  S.cyl = cyl;
  // Typologie tournage / fraisage et brut : déduits du maillage, PROPOSÉS (jamais validés).
  S.typo = new Map();
  for (const p of S.parts) { try { S.typo.set(p.id, analyserTypologie(p, cyl.get(p.id))); } catch (e) { console.warn('typologie', p.name, e); } }
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
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(seg.diameter / 2, seg.diameter / 2, L, 24, 1, false), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.1 }));
        tube.position.copy(a).add(b).multiplyScalar(0.5); tube.quaternion.copy(q); tube.renderOrder = 5;
        const core = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, L, 8), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }));
        core.position.copy(tube.position); core.quaternion.copy(q); core.renderOrder = 6;
        core.userData.radius = Math.max(0.3, seg.diameter * 0.07);
        core.scale.set(core.userData.radius, 1, core.userData.radius);
        g.add(tube, core);
        S.skelItems.push({ net: n, feature: f, tube, core, seg });
      }
    }
    for (const l of n.links) if (l.type === 'sécant') {
      const f = S.drill.featureById.get(l.a);
      const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.8, f.diameter * 0.45), 16, 12), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }));
      s.position.set(...l.point); s.renderOrder = 7; groupFor(f.partId).add(s); S.skelItems.push({ net: n, feature: null, joint: s });
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
      if (o === it.tube) {
        // Forages pleins (Ø de S.fill.min à S.fill.max) : tube opaque, bien plus lisible que le volume translucide.
        const solid = S.fill.on && it.seg.diameter >= S.fill.min - 1e-6 && it.seg.diameter <= S.fill.max + 1e-6 && focus;
        o.material.color.copy(featFocus ? new THREE.Color('#ffd400') : col);
        o.material.opacity = solid ? 1 : focus ? (featFocus ? 0.8 : 0.5) : 0.1;
        if (o.material.transparent === solid) { o.material.transparent = !solid; o.material.depthWrite = solid; o.material.side = solid ? THREE.FrontSide : THREE.DoubleSide; o.material.needsUpdate = true; }
        o.renderOrder = solid ? 0 : 5;
      }
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
    if (S.ex.dir === 'radial') v = d.multiplyScalar(3);
    else { const k = S.ex.dir; v = new THREE.Vector3(); v[k] = d[k] * 4; if (Math.abs(d[k]) < 1e-6 && S.ex.scope === 'selection') v[k] = span[k] * 1.5; }
    S.exVec.set(id, v);
  }
}
// Transformation d'une pièce = éclaté ∘ mouvements d'ouverture (translations, rotations autour d'un axe).
// À « fermé » et éclaté 0, c'est exactement l'identité : la position du STEP est restituée.
function moveMatrix(m, t) {
  if (m.type === 'rotation') {
    const o = new THREE.Vector3(...m.origin), d = new THREE.Vector3(...m.dir).normalize();
    return new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new THREE.Matrix4().makeRotationAxis(d, THREE.MathUtils.degToRad(m.sign * m.angle * t))).multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
  }
  const v = AX[m.axis].clone().multiplyScalar(m.sign * m.course * t);
  return new THREE.Matrix4().makeTranslation(v.x, v.y, v.z);
}
function partMatrix(id) {
  const M = new THREE.Matrix4();
  const e = S.exVec.get(id); if (e && S.ex.amount) M.makeTranslation(e.x * S.ex.amount / 100, e.y * S.ex.amount / 100, e.z * S.ex.amount / 100);
  if (S.open) for (const m of S.moves) if (m.ids.includes(id)) M.multiply(moveMatrix(m, S.open));
  return M;
}
const xf = (id, v) => v.clone().applyMatrix4(partMatrix(id));
function partBox(id) { const st = S.stats.get(id); return new THREE.Box3(new THREE.Vector3(...st.min), new THREE.Vector3(...st.max)).applyMatrix4(partMatrix(id)); }
function placeObject(obj, id) { partMatrix(id).decompose(obj.position, obj.quaternion, obj.scale); }
function cutPlanes() {
  const planes = [];
  for (const k of ['x', 'y', 'z']) { const c = S.cuts[k]; if (!c.on) continue; const n = AX[k].clone().multiplyScalar(c.flip ? 1 : -1); planes.push(new THREE.Plane(n, c.flip ? -c.pos : c.pos)); }
  return planes;
}
function currentBounds() {
  const b = new THREE.Box3();
  for (const id of S.objs.keys()) b.union(partBox(id));
  return b;
}

// ---------------------------------------------------------------- application de l'état d'affichage
function baseColor(id) {
  const o = S.objs.get(id), row = S.rowOf.get(id);
  if (S.colorMode === 'repere') return new THREE.Color(PALETTE[(row.repere - 1) % PALETTE.length]);
  if (S.colorMode === 'categorie') return new THREE.Color(CATEGORIES.find(c => c.id === catOf(id)).color);
  if (S.colorMode === 'groupe') return new THREE.Color(groupesDe(S.groups, id)[0]?.couleur ?? '#c9d0d6'); // pièces hors groupe : gris clair
  return o.stepColor ? o.stepColor.clone() : new THREE.Color(PALETTE[(row.repere - 1) % PALETTE.length]);
}
const catOf = id => S.catOverride[id] ?? S.catOf[id];
function applyDisplay() {
  if (!S.loaded) return;
  applyHiddenFaces();
  const planes = cutPlanes();
  let capIndex = 0;
  for (const [id, o] of S.objs) {
    const it = S.items[id];
    const visible = it.visible && !S.catOff.has(catOf(id));
    let op = it.opacity;
    const selected = S.sel.has(id);
    if (S.skelOnly && S.skelShow) op = Math.min(op, 0.07);
    else if (S.ghost && S.sel.size && !selected) op = Math.min(op, 0.12);
    o.grp.visible = visible && op > 0.001;
    placeObject(o.grp, id);
    const m = o.mesh.material;
    m.color.copy(baseColor(id));
    m.emissive.set(selected ? 0xd85a00 : 0x000000); m.emissiveIntensity = selected ? 0.55 : 0;
    m.opacity = op; m.depthWrite = op >= 1;
    const key = `${planes.length}|${op < 1}`;
    m.transparent = op < 1; m.clippingPlanes = planes;
    if (o.matKey !== key) { m.needsUpdate = true; o.back.material.needsUpdate = true; if (o.edges) o.edges.material.needsUpdate = true; o.matKey = key; }
    o.back.visible = op >= 1;
    o.back.material.color.copy(m.color).multiplyScalar(0.6); if (selected) o.back.material.color.lerp(new THREE.Color(0xd85a00), 0.5);
    o.back.material.clippingPlanes = planes;
    if (S.edges) {
      if (!o.edges) { o.edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.mesh.geometry, 28), new THREE.LineBasicMaterial({ color: 0x14202b, transparent: true, opacity: 0.45 })); o.edges.raycast = () => {}; o.grp.add(o.edges); }
      o.edges.visible = true; o.edges.material.clippingPlanes = planes; o.edges.material.opacity = 0.45 * Math.max(op, 0.2);
    } else if (o.edges) o.edges.visible = false;
    updateCaps(o, capIndex++, S.objs.size, o.grp.visible, op, m.color);
  }
  for (const [pid, g] of S.skelGroups ?? []) placeObject(g, pid);
  drawHinge();
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
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false }));
    if (k === 'x') m.rotation.set(0, Math.PI / 2, 0); if (k === 'y') m.rotation.set(Math.PI / 2, 0, 0);
    m.position.copy(c); m.position[k] = S.cuts[k].pos; m.userData.plane = true; m.raycast = () => {};
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0xe8730c }));
    edge.raycast = () => {}; m.add(edge); helperRoot.add(m);
  }
}

// ---------------------------------------------------------------- axe de charnière (ouverture en rotation)
// Toucher un cylindre (alésage, axe, goupille, bossage) → son axe ; sinon l'arête vive la plus proche → sa droite.
function findHingeAxis(h) {
  const id = h.object.userData.id, p = h.point.clone().applyMatrix4(partMatrix(id).invert()); // repère d'origine STEP
  const cyl = S.cyl?.get(id), cands = cyl ? [...cyl.holes, ...cyl.bosses] : [];
  let best = null;
  for (const c of cands) {
    const a = new THREE.Vector3(...c.start), d = new THREE.Vector3(...c.axis), t = p.clone().sub(a).dot(d);
    if (t < -1 || t > c.length + 1) continue;
    const err = Math.abs(p.clone().sub(a).addScaledVector(d, -t).length() - c.radius);
    if (err < Math.max(0.3, 0.06 * c.radius) && (!best || err < best.err)) best = { err, origin: c.start, dir: c.axis, label: `axe du cylindre Ø${fmt(c.diameter, 1)}` };
  }
  if (!best) {
    const o = S.objs.get(id);
    o.edgeGeo ??= new THREE.EdgesGeometry(o.mesh.geometry, 28);
    const P = o.edgeGeo.getAttribute('position'), A = new THREE.Vector3(), B = new THREE.Vector3(), q = new THREE.Vector3();
    let bd = Infinity;
    for (let i = 0; i < P.count; i += 2) {
      A.fromBufferAttribute(P, i); B.fromBufferAttribute(P, i + 1);
      new THREE.Line3(A, B).closestPointToPoint(p, true, q);
      const d = q.distanceTo(p);
      if (d < bd && A.distanceTo(B) > 1e-3) { bd = d; best = { origin: A.toArray(), dir: B.clone().sub(A).normalize().toArray(), label: `arête (longueur ${fmt(A.distanceTo(B), 1)} mm)` }; }
    }
  }
  if (best) best.part = S.byId.get(id).name;
  return best;
}
function drawHinge() {
  helperRoot.children.filter(c => c.userData.hinge).forEach(c => { c.geometry.dispose(); helperRoot.remove(c); });
  const axes = [];
  if (S.hinge && S.mode === 'eclate') axes.push({ ...S.hinge, color: 0xd7301f });
  if (S.mode === 'eclate') for (const m of S.moves) if (m.type === 'rotation') axes.push({ origin: m.origin, dir: m.dir, color: 0x7b3fbf, ref: m.ids[0] });
  const L = S.bounds.getSize(new THREE.Vector3()).length() * 0.6;
  for (const a of axes) {
    const o = new THREE.Vector3(...a.origin), d = new THREE.Vector3(...a.dir).normalize();
    const g = new THREE.BufferGeometry().setFromPoints([o.clone().addScaledVector(d, -L / 2), o.clone().addScaledVector(d, L / 2)]);
    const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: a.color, dashSize: L / 60, gapSize: L / 90, depthTest: false }));
    line.computeLineDistances(); line.renderOrder = 12; line.userData.hinge = true; helperRoot.add(line);
  }
}

// ---------------------------------------------------------------- remplissage des coupes (stencil)
// Pour chaque plan actif et chaque pièce : faces arrière +1, faces avant −1 dans le stencil, puis un plan coloré
// hachuré là où le stencil ≠ 0 : la matière coupée apparaît PLEINE, quelle que soit la forme intérieure.
const PLANE_KEYS = ['x', 'y', 'z'];
function hatched(mat) {
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (mod(gl_FragCoord.x - gl_FragCoord.y, 14.0) < 1.0) gl_FragColor.rgb *= 0.86;'); };
  mat.customProgramCacheKey = () => 'sdc-hachures';
  return mat;
}
function capSet(o, k) {
  o.capSets ??= {};
  if (o.capSets[k]) return o.capSets[k];
  const st = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc };
  const inc = THREE.IncrementWrapStencilOp, dec = THREE.DecrementWrapStencilOp;
  const back = new THREE.Mesh(o.mesh.geometry, new THREE.MeshBasicMaterial({ ...st, side: THREE.BackSide, stencilFail: inc, stencilZFail: inc, stencilZPass: inc }));
  const front = new THREE.Mesh(o.mesh.geometry, new THREE.MeshBasicMaterial({ ...st, side: THREE.FrontSide, stencilFail: dec, stencilZFail: dec, stencilZPass: dec }));
  const rp = THREE.ReplaceStencilOp;
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hatched(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: rp, stencilZFail: rp, stencilZPass: rp })));
  cap.onAfterRender = r => r.clearStencil();
  for (const m of [back, front, cap]) m.raycast = () => {};
  // contour de la pièce dans le plan de coupe (traits épais), recalculé quand le plan ou la pièce bouge
  const contour = new LineSegments2(new LineSegmentsGeometry(), contourMat.clone());
  contour.raycast = () => {}; contour.renderOrder = 3; contour.userData.key = '';
  o.grp.add(back, front, contour); capRoot.add(cap);
  return (o.capSets[k] = { back, front, cap, contour });
}
const contourMat = new LineMaterial({ color: 0x0d1720, linewidth: 2.4, worldUnits: false });
function sectionSegments(o, k) {
  // plan de coupe exprimé dans le repère d'origine de la pièce (la pièce peut être éclatée ou ouverte)
  const inv = partMatrix(o.part.id).invert(), n = AX[k].clone(), pos = S.cuts[k].pos;
  const plane = new THREE.Plane(n, -pos).applyMatrix4(inv);
  const out = [], tmp = new THREE.Vector3(), d = [0, 0, 0], q = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  o.mesh.geometry.boundsTree.shapecast({
    intersectsBounds: box => plane.intersectsBox(box),
    intersectsTriangle: tri => {
      q[0].copy(tri.a); q[1].copy(tri.b); q[2].copy(tri.c);
      for (let i = 0; i < 3; i++) d[i] = plane.distanceToPoint(q[i]);
      const pts = [];
      for (let i = 0; i < 3; i++) { const j = (i + 1) % 3; if ((d[i] > 0) !== (d[j] > 0)) { tmp.copy(q[i]).lerp(q[j], d[i] / (d[i] - d[j])); pts.push(tmp.x, tmp.y, tmp.z); } }
      if (pts.length === 6) out.push(...pts);
      return false;
    },
  });
  return out;
}
function updateCaps(o, index, total, visible, op, color) {
  const active = PLANE_KEYS.filter(k => S.cuts[k].on);
  const planes = cutPlanes();
  const b = S.bounds, size = b.getSize(new THREE.Vector3()).length() * 3, c = b.getCenter(new THREE.Vector3());
  PLANE_KEYS.forEach((k, j) => {
    const on = S.caps && S.cuts[k].on && visible && op >= 1;
    if (!on && !o.capSets?.[k]) return;
    const cs = capSet(o, k);
    for (const m of [cs.back, cs.front, cs.cap, cs.contour]) m.visible = on;
    if (!on) return;
    const key = `${S.cuts[k].pos}|${partMatrix(o.part.id).elements.join(',')}`;
    if (cs.contour.userData.key !== key) { cs.contour.userData.key = key; const seg = sectionSegments(o, k); cs.contour.geometry.dispose(); cs.contour.geometry = new LineSegmentsGeometry(); if (seg.length) cs.contour.geometry.setPositions(seg); cs.contour.visible = seg.length > 0; }
    cs.contour.material.resolution.set(renderer.domElement.width, renderer.domElement.height);
    cs.contour.material.clippingPlanes = active.filter(x => x !== k).map(x => planes[active.indexOf(x)]);
    const base = 10 + (j * total + index) * 3;
    cs.back.renderOrder = base; cs.front.renderOrder = base + 1; cs.cap.renderOrder = base + 2;
    cs.back.material.clippingPlanes = planes; cs.front.material.clippingPlanes = planes;
    cs.cap.material.clippingPlanes = active.filter(x => x !== k).map(x => planes[active.indexOf(x)]);
    cs.cap.material.color.copy(color).multiplyScalar(0.85);
    cs.cap.scale.set(size, size, 1); cs.cap.position.copy(c); cs.cap.position[k] = S.cuts[k].pos;
    cs.cap.rotation.set(k === 'y' ? Math.PI / 2 : 0, k === 'x' ? Math.PI / 2 : 0, 0);
  });
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
  const b = new THREE.Box3(); for (const id of S.sel) b.union(partBox(id));
  fitBox(b);
}

// ---------------------------------------------------------------- historique (masquages / transparences)
function snapshot() { return JSON.stringify({ items: S.items, catOff: [...S.catOff], hiddenFaces: S.hiddenFaces }); }
function pushHistory() { S.undo.push(snapshot()); if (S.undo.length > 80) S.undo.shift(); S.redo = []; }
function restoreSnap(s) { const o = JSON.parse(s); S.items = o.items; S.catOff = new Set(o.catOff); S.hiddenFaces = o.hiddenFaces ?? {}; refreshAll(); }
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
  for (const h of ray.intersectObjects(meshes, false)) if (planes.every(p => p.distanceToPoint(h.point) >= -1e-6) && faceVisible(h)) return h;
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
  if ((S.boxMode || ev.shiftKey) && !S.pickAxis && !S.faceMode && !S.measure.on) { const h0 = pick(ev); if (h0) select([h0.object.userData.id], true); return; }
  const h = pick(ev);
  if (S.pickAxis) {
    if (!h) return;
    const ax = findHingeAxis(h);
    if (!ax) return toast('Aucun axe trouvé sur cette pièce : toucher un cylindre ou une arête droite.');
    S.hinge = ax; S.pickAxis = false; $('op-pick').classList.remove('on');
    $('op-axis-info').textContent = `Axe : ${ax.label} de ${ax.part} · direction (${ax.dir.map(v => fmt(v, 2)).join(' ; ')})`;
    applyDisplay(); toast('Axe choisi. Sélectionner les pièces qui pivotent puis « Créer un groupe mobile ».');
    return;
  }
  if (S.faceMode) { if (h) { pushHistory(); const id = h.object.userData.id; (S.hiddenFaces[id] ??= []).push(faceOfHit(h)); refreshAll(); } return; }
  if (S.measure.on) { coteClick(h); return; }
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

// ---------------------------------------------------------------- cotation
// Élément touché : plan, axe de cylindre (Ø / R) ou point ; calcul dans le repère STEP (valeur indépendante de l'éclaté).
function entityAt(h) {
  const id = h.object.userData.id, o = S.objs.get(id);
  const hit = h.point.clone().applyMatrix4(partMatrix(id).invert()).toArray();
  const e = classifyFace(o.part, faceOfHit(h));
  return { ...(e ?? { kind: 'point' }), hit, partId: id };
}
let coteSeq = 0;
function addCote(c, a, b) {
  S.cotes.push({ id: `C${Date.now().toString(36)}${coteSeq++}`, ...c, a: a.partId, b: (b ?? a).partId, visible: true, date: new Date().toISOString() });
}
function coteClick(h) {
  if (!h) { S.cote.pending = null; toast('Cotation : sélection remise à zéro.'); return; }
  const e = entityAt(h), prev = S.cote.pending;
  let made = [];
  if (e.kind === 'axe') { const c = coteCylindre(e, e.hit); addCote(c, e); made.push(c.text); }
  if (prev) { const c = coteEntre(prev, e); addCote(c, prev, e); made.push(c.text); S.cote.pending = null; }
  else S.cote.pending = e;
  const what = { plan: 'face plane', axe: 'axe de cylindre', point: 'point' }[e.kind];
  toast(made.length ? `Cote : ${made.join(' · ')} mm${S.cote.pending ? ` — ${what} retenu : toucher un 2ᵉ élément pour une distance` : ''}` : `${what[0].toUpperCase() + what.slice(1)} retenu(e) : toucher un 2ᵉ élément (face, axe, point).`, 5000);
  S.cotesVisible = true; syncToggles(); refreshAll();
}
function drawCotes() {
  if (!S.cotesVisible) return;
  for (const c of S.cotes) {
    if (!c.visible || !S.objs.has(c.a) || !S.objs.has(c.b)) continue;
    const a = project(xf(c.a, new THREE.Vector3(...c.p1))), b = project(xf(c.b, new THREE.Vector3(...c.p2)));
    if (a.z > 1 || b.z > 1) continue;
    const col = c.kind === 'angle' ? '#7b3fbf' : '#c2185b';
    octx.strokeStyle = col; octx.fillStyle = col; octx.lineWidth = 1.6;
    octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const arrow = (x, y, t) => { octx.beginPath(); octx.moveTo(x, y); octx.lineTo(x - 9 * Math.cos(t - 0.32), y - 9 * Math.sin(t - 0.32)); octx.lineTo(x - 9 * Math.cos(t + 0.32), y - 9 * Math.sin(t + 0.32)); octx.closePath(); octx.fill(); };
    if (c.kind !== 'angle') { arrow(b.x, b.y, ang); if (c.kind !== 'rayon') arrow(a.x, a.y, ang + Math.PI); }
    label((a.x + b.x) / 2, (a.y + b.y) / 2 - 12, c.text, col);
  }
}
function renderCotes() {
  const box = $('cote-list'); if (!box) return; box.replaceChildren();
  for (const c of S.cotes) box.append(el('div', { class: `row${c.visible ? '' : ' hidden-part'}` },
    el('button', { class: 'eye', title: c.visible ? 'Masquer' : 'Afficher', onclick: () => { c.visible = !c.visible; refreshAll(); } }, eyeSvg(c.visible)),
    el('span', { class: 'name' }, `${c.text} mm`.replace('° mm', '°').replace(/(°[^m]*) mm$/, '$1'), el('span', { class: 'hint' }, ` · rep. ${[...new Set([S.rowOf.get(c.a)?.repere, S.rowOf.get(c.b)?.repere])].join(' / ')}`)),
    el('button', { class: 'eye', title: 'Supprimer', onclick: () => { S.cotes = S.cotes.filter(x => x !== c); refreshAll(); } }, '✕')));
  if (!S.cotes.length) box.append(el('p', { class: 'hint' }, 'Aucune cote.'));
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
  drawCotes();
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
    const o = S.objs.get(id), a = project(xf(id, o.anchor));
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
        if (!S.drillLabels && f.id !== S.selFeature) continue;
        const m = xf(f.partId, new THREE.Vector3(...f.start).add(new THREE.Vector3(...f.end)).multiplyScalar(0.5)), p = project(m);
        if (p.z < 1) label(p.x, p.y, `${f.id} Ø${fmt(f.diameter, 1)}`, f.id === S.selFeature ? '#b38600' : netColor(n));
      }
    } else if (S.drillLabels) {
      const longest = fs.reduce((a, b) => (b.length > a.length ? b : a));
      const m = xf(longest.partId, new THREE.Vector3(...longest.start).add(new THREE.Vector3(...longest.end)).multiplyScalar(0.5)), p = project(m);
      if (p.z < 1) label(p.x, p.y, `${n.id} · ${netLabel(n)}`, netColor(n));
    }
  }
}

// ---------------------------------------------------------------- rendu
let lastSize = '';
function loop() {
  requestAnimationFrame(loop);
  const sz = `${viewport.clientWidth}x${viewport.clientHeight}`; // panneaux réduits / détachés : suivre la taille réelle
  if (sz !== lastSize) { lastSize = sz; resize(); }
  controls.update();
  // épaisseur constante à l'écran des axes de circuits
  if (skelRoot.visible) { const k = camera.position.distanceTo(controls.target) / 900; for (const it of S.skelItems) {
    if (it.core) { const rr = Math.max(it.core.userData.radius, k); it.core.scale.set(rr, 1, rr); }
  } }
  renderer.render(scene, camera);
  drawOverlay();
}

// ---------------------------------------------------------------- panneaux
function refreshAll() { applyDisplay(); renderTree(); renderBom(); renderCard(); renderSelbar(); renderCategories(); renderGroups(); if (S.mode === 'groupes') renderFiltre(); if (S.mode === 'percages') renderNets(); if (S.mode === 'notes') { renderComments(); renderViews(); renderCotes(); } if (S.mode === 'eclate') renderMoves(); if (S.mode === 'coupe') renderPlanes(); saveLocal(); }

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
      S.typo.get(id) ? [el('dt', {}, 'Usinage'), el('dd', {}, texteTypo(S.typo.get(id)))] : null,
      groupesDe(S.groups, id).length ? [el('dt', {}, 'Groupes'), el('dd', {}, groupesDe(S.groups, id).map(g => g.nom).join(', '))] : null,
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


// ---------------------------------------------------------------- panneau ouverture
function renderMoves() {
  const box = $('op-list'); box.replaceChildren();
  S.moves.forEach((m, i) => box.append(el('div', { class: 'row' },
    el('span', { class: 'badge' }, i + 1),
    el('span', { class: 'name', title: m.axisLabel ?? '' }, m.type === 'rotation' ? `⟳ ${m.sign * m.angle}° autour de ${m.axisLabel}` : `↕ ${m.sign > 0 ? '+' : '−'}${m.axis.toUpperCase()} ${m.course} mm`, el('span', { class: 'hint' }, ` · ${m.ids.length} pièce(s)${m.groupe ? ` · groupe « ${m.groupe} »` : ''}`)),
    el('button', { class: 'eye', title: 'Sélectionner les pièces du groupe', onclick: () => select(m.ids) }, '◎'),
    el('button', { class: 'eye', title: 'Supprimer', onclick: () => { S.moves = S.moves.filter(x => x !== m); refreshAll(); } }, '✕'))));
  if (!S.moves.length) box.append(el('p', { class: 'hint' }, 'Aucun groupe mobile défini.'));
}

// ---------------------------------------------------------------- sélection par fenêtre
// Gauche → droite : pièces entièrement dans le cadre ; droite → gauche : pièces touchées (convention CAO).
function boxSelect(x0, y0, x1, y1, additive) {
  const r = overlay.getBoundingClientRect();
  const L = Math.min(x0, x1) - r.left, R = Math.max(x0, x1) - r.left, T = Math.min(y0, y1) - r.top, B = Math.max(y0, y1) - r.top;
  const crossing = x1 < x0, inRect = q => q.z < 1 && q.x >= L && q.x <= R && q.y >= T && q.y <= B;
  const ids = [];
  for (const [id, o] of S.objs) {
    if (!o.grp.visible || o.mesh.material.opacity <= 0.15) continue;
    const M = partMatrix(id), P = o.part.positions, step = Math.max(3, Math.floor(P.length / 3 / 400) * 3), v = new THREE.Vector3();
    let all = true, any = false;
    for (let i = 0; i < P.length; i += step) {
      const q = project(v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(M));
      if (inRect(q)) any = true; else all = false;
      if (crossing ? any : !all) break;
    }
    if (crossing ? any : all) ids.push(id);
  }
  if (!ids.length && !additive) { clearSel(); return; }
  if (!additive) S.sel.clear();
  for (const id of ids) S.sel.add(id);
  refreshAll(); toast(`${ids.length} pièce(s) ${crossing ? 'touchée(s)' : 'entièrement dans la fenêtre'}.`);
}
let rubber = null;
viewport.addEventListener('pointerdown', ev => {
  if (!S.loaded || ev.button !== 0 || !(S.boxMode || ev.shiftKey)) return;
  rubber = { x: ev.clientX, y: ev.clientY, additive: ev.ctrlKey || ev.metaKey || S.multi };
  controls.enabled = false; // avant OrbitControls (phase de capture)
}, { capture: true });
window.addEventListener('pointermove', ev => {
  if (!rubber) return;
  const r = viewport.getBoundingClientRect(), d = $('selrect');
  d.hidden = false; d.classList.toggle('cross', ev.clientX < rubber.x);
  Object.assign(d.style, { left: Math.min(ev.clientX, rubber.x) - r.left + 'px', top: Math.min(ev.clientY, rubber.y) - r.top + 'px', width: Math.abs(ev.clientX - rubber.x) + 'px', height: Math.abs(ev.clientY - rubber.y) + 'px' });
});
window.addEventListener('pointerup', ev => {
  if (!rubber) return;
  const r0 = rubber; rubber = null; $('selrect').hidden = true; controls.enabled = true;
  if (Math.hypot(ev.clientX - r0.x, ev.clientY - r0.y) > 6) { boxSelect(r0.x, r0.y, ev.clientX, ev.clientY, r0.additive); down = null; }
});

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
function fitNet(n) { const b = new THREE.Box3(); for (const fid of n.features) { const f = S.drill.featureById.get(fid); b.expandByPoint(xf(f.partId, new THREE.Vector3(...f.start))); b.expandByPoint(xf(f.partId, new THREE.Vector3(...f.end))); } b.expandByScalar(10); fitBox(b); }
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
        el('div', { class: 'meta' }, `${kindTxt} · ${n.features.length} perçage(s) · Ø ${n.diameters.map(d => fmt(d, 1)).join(' / ')} · ${fmt(n.totalLength, 0)} mm`))));
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
  let fdet = null;
  if (S.selFeature && n.features.includes(S.selFeature)) {
    const f = S.drill.featureById.get(S.selFeature), st = S.stats.get(f.partId);
    const rel = v => v.map((x, i) => fmt(x - st.min[i], 2)).join(' ; ');
    fdet = el('div', { class: 'net-detail' }, el('b', {}, `${f.id} — ${S.byId.get(f.partId).name} (repère ${S.rowOf.get(f.partId).repere})`),
      el('div', {}, `Type : ${f.kind === 'étagé' ? 'perçage étagé ' + f.segments.map(s => `Ø${fmt(s.diameter, 1)}×${fmt(s.length, 1)}`).join(' + ') : `Ø${fmt(f.diameter, 2)} × ${fmt(f.length, 1)} mm`} · axe ${f.direction}`),
      el('div', {}, `Extrémité A (${f.open.start ? 'débouchante' : 'fond / jonction'}) : ${rel(f.start)}`),
      el('div', {}, `Extrémité B (${f.open.end ? 'débouchante' : 'fond / jonction'}) : ${rel(f.end)}`),
      el('div', { class: 'hint' }, 'Coordonnées en mm depuis le coin mini (X,Y,Z) de la boîte de la pièce, repère assemblage. Valeurs indicatives (maillage) ; taraudages non détectés.'),
      el('button', { class: 'btn wide', onclick: () => { const b = new THREE.Box3().setFromPoints([xf(f.partId, new THREE.Vector3(...f.start)), xf(f.partId, new THREE.Vector3(...f.end))]).expandByScalar(f.diameter * 3); fitBox(b); } }, 'Cadrer ce perçage'));
  }
  det.append(el('div', { class: 'net-detail' },
    el('div', { class: 'grid2' }, el('b', {}, `${n.id} · ${n.features.length} perçage(s)`), sel),
    el('div', { class: 'grid2' }, el('button', { class: 'btn', onclick: () => select([...new Set(n.partIds)]) }, 'Sélectionner les pièces'), el('button', { class: 'btn', onclick: () => fitNet(n) }, 'Cadrer le réseau')),
    t, el('p', { class: 'hint' }, 'Liaisons : sécantes (forages qui se croisent) et coaxiales entre pièces. Vérifier sur plan avant usinage.')));
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
  return { camera: { position: camera.position.toArray(), target: controls.target.toArray() }, items: JSON.parse(JSON.stringify(S.items)), catOff: [...S.catOff], cuts: JSON.parse(JSON.stringify(S.cuts)), ex: { ...S.ex }, hiddenFaces: JSON.parse(JSON.stringify(S.hiddenFaces)), moves: JSON.parse(JSON.stringify(S.moves)), open: S.open, cotes: JSON.parse(JSON.stringify(S.cotes)), cotesVisible: S.cotesVisible, ghost: S.ghost, bubbles: S.bubbles, skelShow: S.skelShow, skelOnly: S.skelOnly, selNet: S.selNet, sel: [...S.sel] };
}
function applyViewState(v) {
  pushHistory();
  Object.assign(S.items, v.items); S.catOff = new Set(v.catOff ?? []); S.cuts = v.cuts; S.ex = v.ex; S.hiddenFaces = v.hiddenFaces ?? {}; if (v.moves) S.moves = v.moves.map(m => ({ ...m, ids: m.ids.filter(id => S.objs.has(id)) })); S.open = v.open ?? 0; if (v.cotes) S.cotes = v.cotes; if (v.cotesVisible !== undefined) S.cotesVisible = v.cotesVisible; S.ghost = !!v.ghost; S.bubbles = !!v.bubbles; S.skelShow = !!v.skelShow; S.skelOnly = !!v.skelOnly; S.selNet = v.selNet ?? null; S.sel = new Set((v.sel ?? []).filter(id => S.objs.has(id)));
  computeExplodeVectors(); syncToggles();
  camera.position.fromArray(v.camera.position); controls.target.fromArray(v.camera.target); controls.update();
  refreshAll();
}
function renderViews() {
  const box = $('v-list'); box.replaceChildren();
  for (const v of S.views) box.append(el('div', { class: 'scene', onclick: () => applyViewState(v.state) },
    v.thumb ? el('img', { src: v.thumb, alt: '' }) : el('div', { class: 'noimg' }, '👁'),
    el('div', { class: 'scene-body' }, el('b', {}, v.name), el('span', { class: 'hint' }, new Date(v.date).toLocaleString('fr-FR')),
      el('div', { class: 'scene-actions' },
        el('button', { class: 'btn', title: 'Enregistrer en image PNG (contient la scène)', onclick: async e => { e.stopPropagation(); applyViewState(v.state); await new Promise(r => setTimeout(r, 60)); download(`${baseName()}_${v.name.replace(/[^\w\-]+/g, '_')}.png`, await scenePngBlob(v)); } }, 'PNG'),
        el('button', { class: 'btn', title: 'Copier l\'image dans le presse-papiers', onclick: e => { e.stopPropagation(); copyScene(v); } }, 'Copier'),
        el('button', { class: 'btn', title: 'Supprimer', onclick: e => { e.stopPropagation(); S.views = S.views.filter(x => x !== v); refreshAll(); } }, '✕')))));
  if (!S.views.length) box.append(el('p', { class: 'hint' }, 'Aucune scène. Bouton « 📷 Scène » en bas de la vue 3D.'));
}
function syncToggles() {
  $('ghost-toggle').classList.toggle('on', S.ghost); $('bubbles-toggle').classList.toggle('on', S.bubbles); $('edges-toggle').classList.toggle('on', S.edges);
  $('skel-show').classList.toggle('on', S.skelShow); $('skel-only').classList.toggle('on', S.skelOnly);
  $('ex-amount').value = S.ex.amount; $('ex-val').textContent = `${Math.round(S.ex.amount)} %`; $('ex-dir').value = S.ex.dir; $('ex-scope').value = S.ex.scope;
  $('op-amount').value = Math.round(S.open * 100); $('op-val').textContent = `${Math.round(S.open * 100)} %`;
  $('op-pick').classList.toggle('on', S.pickAxis); $('cotes-vis').classList.toggle('on', S.cotesVisible); $('measure').classList.toggle('on', S.measure.on); $('boxsel').classList.toggle('on', S.boxMode);
  $('faces-btn').classList.toggle('on', S.faceMode); $('labels-toggle').classList.toggle('on', S.drillLabels); $('fill-toggle').classList.toggle('on', S.fill.on);
  $('caps-toggle').classList.toggle('on', S.caps); $('planevis-toggle').classList.toggle('on', S.planeVis);
}

// ---------------------------------------------------------------- persistance locale et projet
const LS = () => `sdc-montage3d:${S.hash}`;
let saveTimer;
function projectData() {
  return { application: 'SDC Montage 3D', version: APP_VERSION, schema: 'sdc-montage3d-projet/2', fichier: S.fileName, empreinte_sha256: S.hash, date: new Date().toISOString(),
    occurrences: S.parts.map(p => ({ id: p.id, nom: p.name, signature: signature(p, S.stats.get(p.id)), repere: S.rowOf.get(p.id).repere })),
    maxDrill: S.maxDrill, comments: S.comments, views: S.views, netClass: S.netClass, moves: S.moves, cotes: S.cotes, rowNotes: S.rowNotes, catOverride: S.catOverride, bubbleOff: S.bubbleOff, groupes: S.groups, display: viewState() };
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
  S.cotes = pr.empreinte_sha256 === S.hash ? (pr.cotes ?? []) : [];
  S.moves = (pr.moves ?? []).map(m => ({ ...m, ids: m.ids.map(map).filter(Boolean) })).filter(m => m.ids.length);
  S.comments = (pr.comments ?? []).map(c => ({ ...c, ids: c.ids.map(map).filter(Boolean) }));
  S.views = pr.empreinte_sha256 === S.hash ? (pr.views ?? []) : [];
  S.netClass = pr.empreinte_sha256 === S.hash ? (pr.netClass ?? {}) : {};
  S.rowNotes = pr.empreinte_sha256 === S.hash ? (pr.rowNotes ?? {}) : {};
  S.catOverride = Object.fromEntries(Object.entries(pr.catOverride ?? {}).map(([k, v]) => [map(k), v]).filter(([k]) => k));
  S.bubbleOff = pr.empreinte_sha256 === S.hash ? (pr.bubbleOff ?? {}) : {};
  S.groups = reprendreGroupes(pr.groupes, map, new Set(S.objs.keys())).groupes;
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
function snapshotPng(maxW = 0) {
  renderer.render(scene, camera); drawOverlay();
  if (maxW) { const w = renderer.domElement.width, h = renderer.domElement.height, k = Math.min(1, maxW / w), c = el('canvas'); c.width = w * k; c.height = h * k; const g = c.getContext('2d'); g.fillStyle = '#eef2f5'; g.fillRect(0, 0, c.width, c.height); g.drawImage(renderer.domElement, 0, 0, c.width, c.height); g.drawImage(overlay, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.8); }
  const w = renderer.domElement.width, h = renderer.domElement.height, c = el('canvas'); c.width = w; c.height = h + 60;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(renderer.domElement, 0, 0); g.drawImage(overlay, 0, 0, w, h);
  g.fillStyle = '#1f4462'; g.fillRect(0, h, w, 60); g.fillStyle = '#fff'; g.font = `${Math.max(12, Math.round(w / 95))}px Bahnschrift, Segoe UI, sans-serif`; g.textBaseline = 'middle';
  g.fillText(`SDC Montage 3D · ${S.fileName} · ${new Date().toLocaleString('fr-FR')} · vue de consultation, non contractuelle`, 16, h + 30);
  return c.toDataURL('image/png');
}
const SCENE_KEY = 'sdc-montage3d-scene';
async function scenePngBlob(sceneObj) {
  const bytes = new Uint8Array(await (await fetch(snapshotPng())).arrayBuffer());
  return new Blob([pngWithText(bytes, SCENE_KEY, JSON.stringify({ fichier: S.fileName, empreinte_sha256: S.hash, ...sceneObj }))], { type: 'image/png' });
}
// Toute capture PNG contient la scène : « Charger projet / scène » sur ce PNG restaure la vue (même STEP).
async function exportPng() { await download(`${baseName()}_capture.png`, await scenePngBlob({ name: 'Capture', state: viewState() })); }
function saveScene(name) {
  const sc = { name: name || `Scène ${S.views.length + 1}`, date: new Date().toISOString(), state: viewState(), thumb: snapshotPng(320) };
  S.views.push(sc); refreshAll(); toast(`« ${sc.name} » mémorisée (Notes & vues).`); return sc;
}
async function copyScene(sc) {
  if (sc) applyViewState(sc.state);
  await new Promise(r => setTimeout(r, 60));
  const blob = await scenePngBlob(sc ?? { name: 'Copie', state: viewState() });
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Image copiée : coller dans un mail, Word, Teams…'); }
  catch { toast('Copie impossible dans ce navigateur : utiliser « PNG ».'); }
}
async function loadScenePng(file) {
  const txt = pngText(await file.arrayBuffer(), SCENE_KEY);
  if (!txt) throw new Error('ce PNG ne contient pas de scène SDC.');
  const sc = JSON.parse(txt);
  if (sc.empreinte_sha256 !== S.hash && !confirm(`Scène créée sur « ${sc.fichier} », différent du fichier ouvert. Les pièces peuvent ne pas correspondre. Appliquer quand même ?`)) return;
  applyViewState(sc.state); S.views.push({ name: sc.name + ' (importée)', date: new Date().toISOString(), state: sc.state, thumb: snapshotPng(320) }); refreshAll(); toast(`Scène « ${sc.name} » restaurée.`);
}
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
    const t2 = el('table', {}, el('tr', {}, ['Réseau', 'Classement', 'Perçages', 'Ø (mm)', 'Longueur cumulée'].map(h => el('th', {}, h))));
    for (const n of S.drill.networks.filter(n => n.kind !== 'isolé')) t2.append(el('tr', {}, el('td', {}, n.id), el('td', {}, `${netLabel(n)} (${netValidated(n) ? 'validé' : 'proposé'})`), el('td', {}, n.features.join(', ')), el('td', {}, n.diameters.map(d => fmt(d, 1)).join(' / ')), el('td', {}, fmt(n.totalLength, 0) + ' mm')));
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
  $('measure').onclick = () => { S.faceMode = false; S.pickAxis = false; S.measure.on = !S.measure.on; S.cote.pending = null; syncToggles(); $('measure').classList.toggle('on', S.measure.on); if (S.measure.on) toast('Cotation : toucher un cylindre (Ø / R), ou deux éléments — faces, axes, face + axe, points — pour une distance ou un angle. Valeurs indicatives.', 7000); };
  $('cotes-vis').onclick = () => { S.cotesVisible = !S.cotesVisible; syncToggles(); };
  $('cotes-hide-all').onclick = () => { for (const c of S.cotes) c.visible = false; refreshAll(); };
  $('cotes-del-all').onclick = () => { if (S.cotes.length && confirm(`Supprimer les ${S.cotes.length} cotes ?`)) { S.cotes = []; refreshAll(); } };
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
  $('v-save').onclick = () => { if (!S.loaded) return; saveScene($('v-name').value.trim()); $('v-name').value = ''; };
  $('scene-btn').onclick = () => { if (!S.loaded) return; saveScene(); };
  $('copy-btn').onclick = () => { if (S.loaded) copyScene(null); };
  for (const b of document.querySelectorAll('#op-type button')) b.onclick = () => { S.opType = b.dataset.op; for (const x of document.querySelectorAll('#op-type button')) x.classList.toggle('on', x === b); $('op-tr').hidden = S.opType !== 'translation'; $('op-rot').hidden = S.opType !== 'rotation'; if (S.opType !== 'rotation') { S.pickAxis = false; syncToggles(); } };
  $('op-pick').onclick = () => { S.pickAxis = !S.pickAxis; if (S.pickAxis) { S.faceMode = false; S.measure.on = false; $('measure').classList.remove('on'); toast('Toucher un cylindre (axe, goupille, alésage) ou une arête droite qui sert de charnière.', 6000); } syncToggles(); };
  $('op-add').onclick = () => {
    // Pièces mobiles : la sélection actuelle, ou un groupe nommé (copie des pièces au moment de la création).
    const g = $('op-source').value === 'sel' ? null : S.groups.find(x => x.id === $('op-source').value);
    const ids = g ? g.ids.filter(id => S.objs.has(id)) : [...S.sel];
    if (!ids.length) return toast(g ? `Le groupe « ${g.nom} » est vide.` : 'Sélectionner d\'abord les pièces mobiles.');
    const nom = g ? { groupe: g.nom } : {};
    if (S.opType === 'rotation') {
      if (!S.hinge) return toast('Choisir d\'abord l\'axe de rotation (🎯).');
      S.moves.push({ type: 'rotation', ids, ...nom, origin: S.hinge.origin, dir: S.hinge.dir, axisLabel: `${S.hinge.label} (${S.hinge.part})`, angle: Math.abs(+$('op-angle').value || 0), sign: +$('op-rsign').value });
    } else S.moves.push({ type: 'translation', ids, ...nom, axis: $('op-axis').value, sign: +$('op-sign').value, course: Math.abs(+$('op-course').value || 0) });
    if (!S.open) S.open = 1;
    refreshAll(); syncToggles(); toast('Groupe mobile créé ; curseur « Fermé → ouvert » pour le régler.');
  };
  $('op-amount').oninput = () => { S.open = +$('op-amount').value / 100; $('op-val').textContent = `${$('op-amount').value} %`; applyDisplay(); };
  $('op-amount').onchange = () => saveLocal();
  const animOpen = target => { const from = S.open, t0 = performance.now(); const step = t => { const k = Math.min(1, (t - t0) / 1500), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; S.open = from + (target - from) * e; syncToggles(); applyDisplay(); if (k < 1) requestAnimationFrame(step); else saveLocal(); }; requestAnimationFrame(step); };
  $('op-close').onclick = () => animOpen(0); $('op-open').onclick = () => animOpen(1);
  $('boxsel').onclick = () => { S.boxMode = !S.boxMode; syncToggles(); if (S.boxMode) toast('Glisser un rectangle : gauche → droite = pièces entièrement dedans, droite → gauche = pièces touchées. Ctrl pour ajouter.', 6000); };
  $('faces-btn').onclick = () => { S.faceMode = !S.faceMode; if (S.faceMode) { S.measure.on = false; $('measure').classList.remove('on'); toast('Toucher une face pour la retirer (logements, formes et perçages deviennent visibles). « Remettre les faces » pour annuler.', 6000); } syncToggles(); };
  $('faces-reset').onclick = () => { pushHistory(); if (S.sel.size) for (const id of S.sel) delete S.hiddenFaces[id]; else S.hiddenFaces = {}; refreshAll(); };
  $('labels-toggle').onclick = () => { S.drillLabels = !S.drillLabels; syncToggles(); };
  $('fill-toggle').onclick = () => { S.fill.on = !S.fill.on; syncToggles(); applyDisplay(); };
  $('fill-min').oninput = () => { S.fill.min = +$('fill-min').value || 0; applyDisplay(); };
  $('fill-max').oninput = () => { S.fill.max = +$('fill-max').value || 0; applyDisplay(); };
  // projet / export
  $('save-project').onclick = () => { if (!S.loaded) return toast('Ouvrir d\'abord un assemblage.'); download(`${baseName()}_projet-sdc.json`, JSON.stringify(projectData(), null, 1), 'application/json'); };
  $('load-project').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (!S.loaded) return toast('Ouvrir d\'abord l\'assemblage STEP correspondant.'); try { if (/\.png$/i.test(f.name)) await loadScenePng(f); else { applyProject(JSON.parse(await f.text())); refreshAll(); } } catch (err) { toast('Fichier illisible : ' + err.message); } };
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
    else if (k === 'escape' && (S.faceMode || S.pickAxis || S.boxMode)) { S.faceMode = false; S.pickAxis = false; S.boxMode = false; syncToggles(); }
    else if (k === 'h') hideSel(); else if (k === 'i') isolateSel(); else if (k === 'a' && !e.ctrlKey) showAll(); else if (k === 'f') fitSelection(); else if (k === 'escape') { clearSel(); S.selNet = null; refreshAll(); }
  });
}
async function gunzip(b64) { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); return new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }

// ---------------------------------------------------------------- panneaux réductibles, détachables, déplaçables
// Chaque panneau : poignée « ‹ » pour le réduire à une bande, « ⧉ » pour le détacher en fenêtre flottante déplaçable
// (glisser l'en-tête, redimensionner par le coin). La barre d'outils 3D se déplace par sa poignée ⠿ et se replie.
const LAYOUT_KEY = 'sdc-montage3d:disposition';
const layout = (() => { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY)) ?? {}; } catch { return {}; } })();
const saveLayout = () => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* rien */ } };
function dragBy(handle, target, onEnd) {
  handle.addEventListener('pointerdown', ev => {
    if (ev.target.closest('button,input,select,textarea')) return;
    ev.preventDefault();
    const r = target.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    const fixed = getComputedStyle(target).position === 'fixed';
    if (!fixed && getComputedStyle(target).position !== 'absolute') return; // panneau ancré : pas de déplacement
    const base = fixed || !target.offsetParent ? { left: 0, top: 0 } : target.offsetParent.getBoundingClientRect();
    const move = e => { const x = Math.max(0, Math.min(innerWidth - 60, e.clientX - dx)) - base.left, y = Math.max(0, Math.min(innerHeight - 40, e.clientY - dy)) - base.top; Object.assign(target.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto', transform: 'none' }); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); onEnd?.(target.getBoundingClientRect()); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
}
function applyLayout() {
  const app = $('app');
  for (const side of ['left', 'right']) {
    const p = $(`panel-${side}`), st = layout[side] ?? 'docked';
    p.classList.toggle('collapsed', st === 'collapsed'); p.classList.toggle('floating', st === 'floating');
    if (st === 'floating') { const f = layout[`${side}Pos`] ?? { x: side === 'left' ? 100 : innerWidth - 380, y: 80, w: 340, h: Math.round(innerHeight * 0.75) }; Object.assign(p.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' }); }
    else Object.assign(p.style, { left: '', top: '', width: '', height: '' });
    app.style.setProperty(`--${side[0]}w`, st === 'collapsed' ? '30px' : st === 'floating' ? '0px' : side === 'left' ? '350px' : '350px');
    p.querySelector('.pc-fold').textContent = st === 'collapsed' ? (side === 'left' ? '›' : '‹') : (side === 'left' ? '‹' : '›');
    p.querySelector('.pc-float').textContent = st === 'floating' ? '⇲' : '⧉';
    p.querySelector('.pc-float').title = st === 'floating' ? 'Remettre le panneau en place' : 'Détacher le panneau (fenêtre déplaçable)';
  }
  const vb = $('viewbar'); vb.classList.toggle('folded', !!layout.vbFolded); $('vb-fold').textContent = layout.vbFolded ? '▸' : '▾';
  if (layout.vbPos) Object.assign(vb.style, { left: layout.vbPos.x + 'px', top: layout.vbPos.y + 'px', transform: 'none' }); else Object.assign(vb.style, { left: '', top: '', transform: '' });
}
function setupPanels() {
  for (const side of ['left', 'right']) {
    const p = $(`panel-${side}`);
    const title = side === 'left' ? 'Outils' : 'Pièces';
    const head = el('div', { class: 'pchrome' }, el('span', { class: 'pc-title' }, title),
      el('button', { class: 'pc-float', onclick: () => { const st = layout[side]; layout[side] = st === 'floating' ? 'docked' : 'floating'; saveLayout(); applyLayout(); } }, '⧉'),
      el('button', { class: 'pc-fold', title: 'Réduire / agrandir le panneau', onclick: () => { layout[side] = layout[side] === 'collapsed' ? 'docked' : 'collapsed'; saveLayout(); applyLayout(); } }, '‹'));
    p.prepend(head);
    // bande réduite cliquable
    p.append(el('div', { class: 'pc-strip', title: 'Afficher le panneau', onclick: () => { layout[side] = 'docked'; saveLayout(); applyLayout(); } }, el('span', {}, title)));
    dragBy(head, p, r => { if (layout[side] === 'floating') { layout[`${side}Pos`] = { x: r.left, y: r.top, w: r.width, h: r.height }; saveLayout(); } });
    new ResizeObserver(() => { if (layout[side] === 'floating') { const r = p.getBoundingClientRect(); layout[`${side}Pos`] = { x: r.left, y: r.top, w: r.width, h: r.height }; saveLayout(); } }).observe(p);
  }
  const vb = $('viewbar'), grip = vb.querySelector('.vb-grip');
  dragBy(grip, vb, r => { const s = vb.parentElement.getBoundingClientRect(); layout.vbPos = { x: r.left - s.left, y: r.top - s.top }; Object.assign(vb.style, { left: layout.vbPos.x + 'px', top: layout.vbPos.y + 'px' }); saveLayout(); });
  grip.addEventListener('dblclick', () => { delete layout.vbPos; saveLayout(); applyLayout(); });
  $('vb-fold').onclick = () => { layout.vbFolded = !layout.vbFolded; saveLayout(); applyLayout(); };
  applyLayout();
}

// ---------------------------------------------------------------- filtre de pièces (type d'usinage, dimensions) et groupes nommés
// Type, Ø, longueur et brut sont DÉDUITS du maillage (geom/typologie.js) : toujours présentés comme « proposés ».
const dimsCourtes = t => (!t ? '—' : t.type === 'fraisage' ? t.brut_mm.map(v => fmt(v, 0)).join('×') : `Ø${fmt(t.diametre_mm, 1)}×${fmt(t.longueur_mm, 0)}`);
function texteTypo(t) {
  const base = `${t.type} (proposé · ${fmt(t.revolution_pct, 0)} % de révolution)`;
  if (t.type === 'fraisage') return `${base} · brut ${t.brut_mm.map(v => fmt(v, 1)).join(' × ')} mm`;
  return `${base} · Ø ${fmt(t.diametre_mm, 1)} × L ${fmt(t.longueur_mm, 1)} mm${t.type === 'mixte' ? ` · enveloppe ${t.brut_mm.map(v => fmt(v, 1)).join(' × ')} mm` : ''}`;
}
function enregistrementsPieces() {
  return S.parts.map(p => {
    const st = S.stats.get(p.id), it = S.items[p.id], c = CATEGORIES.find(k => k.id === catOf(p.id)), t = S.typo.get(p.id);
    return { id: p.id, repere: S.rowOf.get(p.id).repere, nom: p.name, sous_ensemble: p.path.join(' / '), famille: c.id, famille_label: c.label, visible: it.visible && !S.catOff.has(c.id), opacite_pct: Math.round(it.opacity * 100), selectionnee: S.sel.has(p.id), dims_mm: st.size.map(x => +x.toFixed(2)), volume_cm3: +(st.volume / 1000).toFixed(1),
      type_usinage: t?.type ?? null, revolution_pct: t?.revolution_pct ?? null, diametre_mm: t?.diametre_mm ?? null, longueur_mm: t?.longueur_mm ?? null, dim_max_mm: t?.dim_max_mm ?? null, dim_min_mm: t?.dim_min_mm ?? null, brut_mm: t?.brut_mm ?? null,
      groupes: groupesDe(S.groups, p.id).map(g => g.nom) };
  });
}
const idsPresents = ids => ids.filter(id => S.objs.has(id));
function isolateIds(ids, cadrer = true) {
  if (!ids.length) return;
  pushHistory(); const s = new Set(ids); for (const id of S.objs.keys()) S.items[id].visible = s.has(id); refreshAll();
  if (cadrer) { const b = new THREE.Box3(); for (const id of ids) b.union(partBox(id)); fitBox(b); }
}
function setVisible(ids, visible) { pushHistory(); for (const id of ids) { S.items[id].visible = visible; if (!visible) S.sel.delete(id); } refreshAll(); }

const numFr = v => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : null; };
function criteresFiltre() {
  const c = {}, types = [...document.querySelectorAll('#flt-types input:checked')].map(i => i.value);
  if (types.length && types.length < TYPES.length) c.type = types;
  for (const [cle, a, b] of [['diametre_mm', 'flt-d-min', 'flt-d-max'], ['longueur_mm', 'flt-l-min', 'flt-l-max'], ['plus_grande_dim_mm', 'flt-g-min', 'flt-g-max'], ['plus_petite_dim_mm', 'flt-p-min', 'flt-p-max']]) {
    const lo = numFr($(a).value), hi = numFr($(b).value);
    if (lo !== null || hi !== null) c[cle] = { ...(lo !== null ? { min: lo } : {}), ...(hi !== null ? { max: hi } : {}) };
  }
  if ($('flt-fam').value) c.famille = $('flt-fam').value;
  if ($('flt-novis').checked) c.sauf_famille = 'visserie';
  if ($('flt-nom').value.trim()) c.nom = $('flt-nom').value.trim();
  return c;
}
let fltIds = [];
function renderFiltre() {
  const box = $('flt-list'), info = $('flt-count'); box.replaceChildren(); fltIds = [];
  const verdict = ok => { for (const id of ['flt-sel', 'flt-iso', 'flt-mk']) $(id).disabled = !ok; };
  if (!S.loaded) { info.textContent = 'Ouvrir d\'abord un assemblage.'; info.classList.remove('bad'); verdict(false); return; }
  const c = criteresFiltre(), err = validerCriteres(c);
  info.classList.toggle('bad', !!err);
  if (err) { info.textContent = err; verdict(false); return; }
  const recs = enregistrementsPieces().filter(r => correspond(r, c)), reps = new Map();
  fltIds = recs.map(r => r.id);
  for (const r of recs) { if (!reps.has(r.repere)) reps.set(r.repere, []); reps.get(r.repere).push(r); }
  info.textContent = `${recs.length} pièce(s) sur ${S.parts.length} (${reps.size} repère(s)). Type et dimensions proposés d'après le maillage (±0,05 mm) : à vérifier.`;
  verdict(recs.length > 0);
  for (const [rep, l] of [...reps].sort((a, b) => a[0] - b[0]).slice(0, 200)) {
    const r = l[0];
    box.append(el('div', { class: `row${l.every(x => S.sel.has(x.id)) ? ' sel' : ''}`, title: S.typo.get(r.id) ? texteTypo(S.typo.get(r.id)) : '', onclick: e => select(l.map(x => x.id), e.ctrlKey || e.metaKey || e.shiftKey || S.multi) },
      el('span', { class: 'badge' }, rep), el('span', { class: 'name', title: r.nom }, r.nom + (l.length > 1 ? ` ×${l.length}` : '')),
      el('span', { class: `tag typ-${r.type_usinage}` }, r.type_usinage ?? '—'), el('span', { class: 'dims' }, dimsCourtes(S.typo.get(r.id)))));
  }
  if (reps.size > 200) box.append(el('p', { class: 'hint' }, `… ${reps.size - 200} repères de plus : affiner le filtre.`));
}
function nouveauGroupe(ids, origine) {
  try {
    const g = creerGroupe(S.groups, $('grp-name').value, ids, origine ? { origine } : {});
    $('grp-name').value = ''; refreshAll(); toast(`Groupe « ${g.nom} » créé : ${g.ids.length} pièce(s).`); return g;
  } catch (e) { if (e instanceof ErreurGroupe) { toast('Groupe : ' + e.message, 5000); return null; } throw e; }
}
function renderGroups() {
  const src = $('op-source');
  if (src) { // source des pièces mobiles (onglet Démonter) : sélection actuelle ou groupe nommé
    const garde = src.value;
    src.replaceChildren(el('option', { value: 'sel' }, 'Sélection actuelle'), ...S.groups.map(g => el('option', { value: g.id }, `Groupe : ${g.nom} (${g.ids.length})`)));
    src.value = [...src.options].some(o => o.value === garde) ? garde : 'sel';
  }
  const box = $('grp-list'); if (!box) return;
  box.replaceChildren();
  if (!S.loaded) return;
  if (!S.groups.length) { box.append(el('p', { class: 'hint' }, 'Aucun groupe. Sélectionner des pièces (ou filtrer), écrire un nom, puis « Créer ».')); return; }
  const btn = (txt, fn, title) => el('button', { class: 'btn sm', title, onclick: e => { e.stopPropagation(); fn(); } }, txt);
  for (const g of S.groups) {
    const ids = idsPresents(g.ids), tousVisibles = ids.length > 0 && ids.every(id => S.items[id].visible), selectionne = ids.length > 0 && ids.length === S.sel.size && ids.every(id => S.sel.has(id));
    box.append(el('div', { class: 'grp' },
      el('div', { class: `row${selectionne ? ' sel' : ''}`, title: g.origine ?? '', onclick: e => select(ids, e.ctrlKey || e.metaKey || e.shiftKey || S.multi) },
        el('i', { class: 'gdot', style: `background:${g.couleur}` }), el('span', { class: 'name' }, g.nom), el('span', { class: 'tag' }, ids.length)),
      el('div', { class: 'grid3' },
        btn('Isoler', () => isolateIds(ids), 'N\'afficher que ce groupe'),
        btn(tousVisibles ? 'Masquer' : 'Afficher', () => setVisible(ids, !tousVisibles)),
        btn('Déplacer', () => { setMode('eclate'); $('op-source').value = g.id; toast(`Pièces mobiles : groupe « ${g.nom} ». Choisir le mouvement puis « Créer un groupe mobile ».`, 6000); }, 'Définir un déplacement (axe, course) ou une rotation pour ce groupe'),
        btn('+ Sélection', () => { if (!S.sel.size) return toast('Sélectionner d\'abord des pièces.'); const n = ajouterAuGroupe(g, [...S.sel]); refreshAll(); toast(`${n} pièce(s) ajoutée(s) à « ${g.nom} ».`); }, 'Ajouter la sélection au groupe'),
        btn('− Sélection', () => { if (!S.sel.size) return toast('Sélectionner d\'abord des pièces.'); const n = retirerDuGroupe(g, [...S.sel]); refreshAll(); toast(`${n} pièce(s) retirée(s) de « ${g.nom} ».`); }, 'Retirer la sélection du groupe'),
        btn('Renommer', () => { const n = prompt('Nouveau nom du groupe', g.nom); if (n === null) return; try { renommerGroupe(S.groups, g, n); refreshAll(); } catch (e) { if (e instanceof ErreurGroupe) toast('Groupe : ' + e.message, 5000); else throw e; } })),
      el('button', { class: 'btn sm wide danger', onclick: () => { if (confirm(`Supprimer le groupe « ${g.nom} » ? Les pièces ne sont pas touchées.`)) { supprimerGroupe(S.groups, g); refreshAll(); } } }, 'Supprimer le groupe')));
  }
}
function setupGroupes() {
  $('flt-fam').append(...CATEGORIES.map(c => el('option', { value: c.id }, c.label)));
  for (const i of document.querySelectorAll('.flt')) { i.oninput = renderFiltre; i.onchange = renderFiltre; }
  $('flt-reset').onclick = () => { for (const i of document.querySelectorAll('.flt')) { if (i.type === 'checkbox') i.checked = i.closest('#flt-types') !== null; else i.value = ''; } renderFiltre(); };
  $('flt-sel').onclick = () => { if (!fltIds.length) return; select(fltIds); toast(`${fltIds.length} pièce(s) sélectionnée(s).`); };
  $('flt-iso').onclick = () => { if (!fltIds.length) return; isolateIds(fltIds); toast(`${fltIds.length} pièce(s) isolée(s).`); };
  $('flt-mk').onclick = () => { if (fltIds.length) nouveauGroupe(fltIds, resumeCriteres(criteresFiltre())); };
  $('grp-add').onclick = () => { if (!S.loaded) return; if (!S.sel.size) return toast('Sélectionner d\'abord les pièces du groupe.'); nouveauGroupe([...S.sel], 'Sélection manuelle'); };
  $('grp-name').onkeydown = e => { if (e.key === 'Enter') $('grp-add').click(); };
  renderFiltre(); renderGroups();
}

// ---------------------------------------------------------------- pilotage par commandes JSON (onglet « Commande », window.SDC)
// Le jeu de commandes, la validation et l'exécution sont dans geom/commande.js (pur). Ici : le « ctx » qui agit sur l'état.
const nrm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const KIND_BOX = { circuit: 'f-circuit', alignement: 'f-align', 'isolé': 'f-iso', 'alésage': 'f-bore' };
function apiCtx() {
  let avant = null; // état d'affichage avant la dernière série de commandes (« retour_avant_commande »)
  const fam = id => CATEGORIES.find(c => c.id === catOf(id));
  const reperesDe = ids => [...new Set(ids.map(id => S.rowOf.get(id).repere))].sort((a, b) => a - b);
  const rel = (v, st) => v.map((x, i) => { const d = x - st.min[i]; return +(Math.abs(d) < 0.005 ? 0 : d).toFixed(2); });
  const netById = id => S.drill?.networks.find(n => nrm(n.id) === nrm(id));
  const cadrerIds = ids => { if (!ids) return fitBox(currentBounds()); const b = new THREE.Box3(); for (const id of ids) b.union(partBox(id)); fitBox(b); };
  const kindOn = n => { if (S.filters[n.kind]) return false; S.filters[n.kind] = true; const c = $(KIND_BOX[n.kind]); if (c) c.checked = true; return true; };
  return {
    charge: () => S.loaded,
    pieces: enregistrementsPieces,
    recherche: (id, term) => matches(id, String(term).toLocaleLowerCase('fr')),
    reperesDe,
    nomenclature: () => S.bom.map(r => { const n = S.rowNotes[r.repere] ?? {}; return { repere: r.repere, designation: r.designation, reference: n.reference ?? '', quantite: r.quantite, famille: fam(r.ids[0]).label, sous_ensemble: r.sousEnsemble, dims_mm: r.dims.map(x => +x.toFixed(1)), type_usinage: S.typo.get(r.ids[0])?.type ?? null, diametre_mm: S.typo.get(r.ids[0])?.diametre_mm ?? null, longueur_mm: S.typo.get(r.ids[0])?.longueur_mm ?? null, brut_mm: S.typo.get(r.ids[0])?.brut_mm ?? null, groupes: groupesDe(S.groups, r.ids[0]).map(g => g.nom), statut: n.statut ?? r.statut }; }),
    reseaux: () => (S.drill ? S.drill.networks.map(n => ({ id: n.id, type: n.kind, classement: netLabel(n), valide: netValidated(n), proposition: n.suggestion, nb_percages: n.features.length, diametres_mm: n.diameters.map(d => +d.toFixed(2)), longueur_totale_mm: +n.totalLength.toFixed(1), reperes: reperesDe(n.partIds) })) : []),
    percages(reseauId, ids) {
      if (!S.drill) return [];
      const nets = reseauId ? [netById(reseauId)].filter(Boolean) : S.drill.networks;
      if (reseauId && !nets.length) throw new ErreurCommande(`réseau « ${reseauId} » introuvable. Réseaux : ${S.drill.networks.map(n => n.id).join(', ') || 'aucun'}.`);
      const out = [];
      for (const n of nets) for (const fid of n.features) {
        const f = S.drill.featureById.get(fid); if (ids && !ids.has(f.partId)) continue;
        const st = S.stats.get(f.partId);
        out.push({ reseau: n.id, percage: f.id, repere: S.rowOf.get(f.partId).repere, piece: S.byId.get(f.partId).name, diametres_mm: f.segments.map(s => +s.diameter.toFixed(2)), longueur_mm: +f.length.toFixed(1), axe: f.direction, A_mm: rel(f.start, st), B_mm: rel(f.end, st), A_debouchant: !!f.open.start, B_debouchant: !!f.open.end, element_loge: f.occupants.map(o => o.name).join(', ') });
      }
      return out;
    },
    scenes: () => S.views.map(v => ({ nom: v.name, date: v.date })),
    cotes: () => S.cotes.map(c => ({ id: c.id, texte: c.text, type: c.kind, visible: c.visible, reperes: reperesDe([c.a, c.b].filter(id => S.rowOf.has(id))) })),
    bornes: () => ({ x: [S.bounds.min.x, S.bounds.max.x], y: [S.bounds.min.y, S.bounds.max.y], z: [S.bounds.min.z, S.bounds.max.z] }),
    etat: () => ({ fichier: S.fileName, empreinte_sha256: S.hash.slice(0, 12), occurrences: S.parts.length, reperes: S.bom.length, mode: S.mode,
      selection: { nombre: S.sel.size, reperes: reperesDe([...S.sel]) }, masquees: S.parts.filter(p => !S.items[p.id].visible).length, familles_masquees: [...S.catOff],
      coupes: Object.fromEntries(Object.entries({ XZ: 'y', YZ: 'x', XY: 'z' }).map(([n, k]) => [n, { actif: S.cuts[k].on, position_mm: +S.cuts[k].pos.toFixed(1), inverse: S.cuts[k].flip }])),
      eclate: { pct: Math.round(S.ex.amount), direction: S.ex.dir, portee: S.ex.scope }, ouverture_pct: Math.round(S.open * 100), groupes_mobiles: S.moves.length,
      circuits: { affiches: S.skelShow, seuls: S.skelOnly, reseau_focus: S.selNet, nb_reseaux: S.drill?.networks.length ?? 0 }, scenes: S.views.map(v => v.name), groupes: S.groups.map(g => `${g.nom} (${g.ids.length})`), cotes: S.cotes.length, fantome: S.ghost, bulles: S.bubbles,
      bornes_mm: { X: [S.bounds.min.x, S.bounds.max.x].map(x => +x.toFixed(1)), Y: [S.bounds.min.y, S.bounds.max.y].map(x => +x.toFixed(1)), Z: [S.bounds.min.z, S.bounds.max.z].map(x => +x.toFixed(1)) }, unite: 'mm', avertissement: 'Valeurs du maillage d\'affichage, indicatives.' }),
    cylindres: id => { const c = S.cyl?.get(id); return c ? [...c.holes.map(h => ({ type: 'perçage', diametre: h.diameter, origine: h.start, direction: h.axis, longueur: h.length })), ...c.bosses.map(h => ({ type: 'arbre', diametre: h.diameter, origine: h.start, direction: h.axis, longueur: h.length }))] : []; },
    familles: () => CATEGORIES.map(c => ({ id: c.id, label: c.label })),
    familleId: nom => { const t = nrm(nom); return (CATEGORIES.find(c => nrm(c.id) === t) ?? CATEGORIES.find(c => nrm(c.label).startsWith(t)) ?? CATEGORIES.find(c => t.length > 2 && nrm(c.label).includes(t)))?.id ?? null; },
    groupes: () => S.groups.map(g => ({ id: g.id, nom: g.nom, nb_pieces: idsPresents(g.ids).length, reperes: reperesDe(idsPresents(g.ids)), couleur: g.couleur, origine: g.origine ?? '' })),
    nomsGroupes: () => S.groups.map(g => g.nom),
    idsGroupe: ref => { const g = trouverGroupe(S.groups, ref); return g ? idsPresents(g.ids) : null; },
    // ---- actions
    selectionner: (ids, ajouter) => { if (!ajouter) S.sel.clear(); for (const id of ids) S.sel.add(id); refreshAll(); },
    deselectionner: () => clearSel(),
    masquer: ids => { pushHistory(); for (const id of ids) { S.items[id].visible = false; S.sel.delete(id); } refreshAll(); },
    afficher: ids => { pushHistory(); for (const id of ids) S.items[id].visible = true; refreshAll(); },
    isoler: (ids, cadrer) => { pushHistory(); const s = new Set(ids); for (const id of S.objs.keys()) S.items[id].visible = s.has(id); refreshAll(); if (cadrer) cadrerIds(ids); },
    toutAfficher: () => showAll(),
    opacite: (ids, pct) => { pushHistory(); for (const id of ids) S.items[id].opacity = pct / 100; refreshAll(); },
    fantome: actif => { S.ghost = actif; syncToggles(); applyDisplay(); },
    cadrer: ids => cadrerIds(ids),
    vue: nom => (nom === 'tout' ? fitBox(currentBounds()) : setView({ iso: 'iso', dessus: 'top', face: 'front', droite: 'right' }[nom])),
    famille: (id, afficher) => { pushHistory(); if (afficher) S.catOff.delete(id); else S.catOff.add(id); refreshAll(); },
    classerFamille: (ids, famId) => { for (const id of ids) S.catOverride[id] = famId; refreshAll(); },
    bulles: (actif, portee) => { S.bubbles = actif; if (portee) { S.bubbleScope = portee === 'tous' ? 'all' : 'selection'; $('bubble-scope').value = S.bubbleScope; } syncToggles(); },
    couleurs: mode => { S.colorMode = mode; $('color-mode').value = mode; applyDisplay(); },
    mode: nom => setMode(nom),
    coupe: (k, { on, pos, flip }) => { const c = S.cuts[k]; if (pos !== undefined) c.pos = pos; if (flip !== undefined) c.flip = flip; c.on = on; refreshAll(); return { ...c }; },
    coupesRetirer: ks => { for (const k of ks) S.cuts[k].on = false; refreshAll(); },
    coupeOptions: ({ remplir, contour }) => { if (remplir !== undefined) S.caps = remplir; if (contour !== undefined) S.planeVis = contour; syncToggles(); applyDisplay(); },
    eclater: ({ pct, dir, scope, ids }) => { if (dir) S.ex.dir = dir; if (scope) S.ex.scope = scope; S.ex.ids = S.ex.scope === 'selection' ? (ids ?? S.ex.ids) : null; computeExplodeVectors(); S.ex.amount = pct; syncToggles(); refreshAll(); },
    ouverture: pct => { S.open = pct / 100; syncToggles(); refreshAll(); },
    nbGroupes: () => S.moves.length,
    groupeMobile: m => { S.moves.push(m); if (!S.open) S.open = 1; syncToggles(); refreshAll(); },
    groupesSupprimer: () => { S.moves = []; refreshAll(); },
    circuits(q) {
      if (!S.drill) throw new ErreurCommande('perçages non analysés.');
      const av = [];
      if (q.afficher !== undefined) { S.skelShow = q.afficher; S.skelShowTouched = true; if (!q.afficher) S.skelOnly = false; }
      if (q.seuls !== undefined) { S.skelOnly = q.seuls; if (q.seuls) { S.skelShow = true; S.skelShowTouched = true; } }
      if (q.etiquettes !== undefined) S.drillLabels = q.etiquettes;
      if (q.pleins) { const pl = q.pleins; if (pl.actif !== undefined) S.fill.on = pl.actif; if (pl.d_min !== undefined) { S.fill.min = pl.d_min; $('fill-min').value = pl.d_min; } if (pl.d_max !== undefined) { S.fill.max = pl.d_max; $('fill-max').value = pl.d_max; } }
      if (q.types) for (const [k, id] of Object.entries(KIND_BOX)) { S.filters[k] = q.types.includes(k); $(id).checked = S.filters[k]; }
      if (q.d_min !== undefined) { S.filters.dmin = q.d_min; $('f-dmin').value = q.d_min; }
      if (q.d_max !== undefined) { S.filters.dmax = q.d_max || 999; $('f-dmax').value = q.d_max; }
      if (q.reseau !== undefined) {
        if (['aucun', 'aucune', 'tous'].includes(nrm(q.reseau))) { S.selNet = null; S.selFeature = null; }
        else {
          const n = netById(q.reseau); if (!n) throw new ErreurCommande(`réseau « ${q.reseau} » introuvable. Réseaux : ${S.drill.networks.map(x => x.id).join(', ') || 'aucun'}.`);
          S.selNet = n.id; S.selFeature = null; S.skelShow = true; S.skelShowTouched = true;
          if (kindOn(n)) av.push(`filtre « ${n.kind} » activé pour afficher ce réseau.`);
          if (q.cadrer) fitNet(n);
        }
      }
      if (q.percage) {
        const f = S.drill.features.find(x => nrm(x.id) === nrm(q.percage)); if (!f) throw new ErreurCommande(`perçage « ${q.percage} » introuvable.`);
        const n = S.drill.netOfFeature.get(f.id); S.selNet = n.id; S.selFeature = f.id; S.skelShow = true; S.skelShowTouched = true;
        if (kindOn(n)) av.push(`filtre « ${n.kind} » activé pour afficher ce perçage.`);
      }
      syncToggles(); refreshAll();
      return { message: 'Circuits mis à jour.', donnees: { affiches: S.skelShow, seuls: S.skelOnly, reseau_focus: S.selNet, perçage_focus: S.selFeature }, avertissements: av };
    },
    classerCircuit: (reseau, cls) => { const n = netById(reseau); if (!n) throw new ErreurCommande(`réseau « ${reseau} » introuvable. Réseaux : ${S.drill?.networks.map(x => x.id).join(', ') || 'aucun'}.`); if (cls === null) delete S.netClass[n.id]; else S.netClass[n.id] = cls; refreshAll(); },
    diametreMaxi: mm => { S.maxDrill = Math.max(1, mm); $('f-maxdrill').value = S.maxDrill; S.selNet = null; S.selFeature = null; S.netClass = {}; rebuildNetworks(); refreshAll(); },
    commentaire: ({ ids, texte, type, statut, auteur }) => { S.comments.push({ ids, reperes: reperesDe(ids), type, status: statut, author: auteur ?? ($('c-author').value.trim() || ''), text: texte, date: new Date().toISOString() }); refreshAll(); },
    repereValider: (repere, valide) => { const n = S.rowNotes[repere] ?? {}; S.rowNotes[repere] = { ...n, statut: valide ? 'validé' : undefined }; refreshAll(); },
    repereReference: (repere, reference) => { const n = S.rowNotes[repere] ?? {}; S.rowNotes[repere] = { ...n, reference }; refreshAll(); },
    groupeCreer: (nom, ids) => { try { const g = creerGroupe(S.groups, nom, ids, { origine: 'commande JSON' }); refreshAll(); return g.nom; } catch (e) { throw e instanceof ErreurGroupe ? new ErreurCommande(e.message) : e; } },
    groupeAjouter: (nom, ids) => { const g = trouverGroupe(S.groups, nom); if (!g) throw new ErreurCommande(`groupe « ${nom} » inconnu. Groupes : ${S.groups.map(x => x.nom).join(', ') || 'aucun'}.`); const n = ajouterAuGroupe(g, ids); refreshAll(); return n; },
    groupeRetirer: (nom, ids) => { const g = trouverGroupe(S.groups, nom); if (!g) throw new ErreurCommande(`groupe « ${nom} » inconnu. Groupes : ${S.groups.map(x => x.nom).join(', ') || 'aucun'}.`); const n = retirerDuGroupe(g, ids); refreshAll(); return n; },
    groupeSupprimer: nom => { const g = trouverGroupe(S.groups, nom); if (!g) throw new ErreurCommande(`groupe « ${nom} » inconnu. Groupes : ${S.groups.map(x => x.nom).join(', ') || 'aucun'}.`); supprimerGroupe(S.groups, g); refreshAll(); },
    sceneSauver: nom => saveScene(nom).name,
    sceneCharger: nom => { const v = S.views.find(x => nrm(x.name) === nrm(nom)); if (!v) return false; applyViewState(v.state); return true; },
    exporter: quoi => ({ nomenclature: exportBom, percages: exportDrill, capture: exportPng, rapport: printReport })[quoi](),
    annuler: () => { const ok = S.undo.length > 0; undo(); return ok; },
    retablir: () => { const ok = S.redo.length > 0; redo(); return ok; },
    sauverAvant: () => { avant = JSON.stringify(viewState()); },
    retourAvant: () => { if (!avant) return false; applyViewState(JSON.parse(avant)); return true; },
  };
}

function setupCommande() {
  const ctx = apiCtx();
  let dernier = null;
  const confirmer = liste => confirm(`Écritures demandées par ces commandes :\n\n• ${liste.join('\n• ')}\n\nLes accepter ?`);
  const afficher = r => {
    const log = $('cmd-log'); log.replaceChildren();
    const ent = r.ok ? `✓ ${r.executees}/${r.total} commande(s) exécutée(s)` : `✗ ${r.erreur ?? 'échec'}`;
    log.append(el('div', { class: `cmd-line ${r.ok ? 'ok' : 'ko'}` }, el('b', {}, ent), ...(r.avertissements ?? []).map(a => el('div', { class: 'hint' }, '⚠ ' + a))));
    for (const e of r.erreurs ?? []) log.append(el('div', { class: 'cmd-line ko' }, el('b', {}, `Commande ${e.index}${e.cmd ? ' « ' + e.cmd + ' »' : ''}`), el('div', {}, e.erreur)));
    for (const x of r.resultats ?? []) {
      const body = [el('b', {}, `${x.index}. ${x.cmd}`), el('div', {}, x.ok ? x.message : x.erreur)];
      for (const a of x.avertissements ?? []) body.push(el('div', { class: 'warn' }, '⚠ ' + a));
      if (x.ok && x.donnees !== undefined) body.push(el('details', {}, el('summary', {}, 'Détails'), el('pre', {}, JSON.stringify(x.donnees, null, 1).slice(0, 6000))));
      log.append(el('div', { class: `cmd-line ${x.ok ? 'ok' : 'ko'}` }, ...body));
    }
  };
  const lancer = async entree => { const r = await executer(ctx, entree, { confirmer }); dernier = r; afficher(r); toast(r.ok ? `${r.executees} commande(s) exécutée(s).` : (r.erreur ?? 'Commande en échec : voir le détail.'), 4000); return r; };
  const copier = async (txt, ok) => { try { await navigator.clipboard.writeText(txt); toast(ok); } catch { const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = txt; document.body.append(ta); ta.select(); try { document.execCommand('copy'); toast(ok); } catch { toast('Copie impossible : sélectionner le texte à la main.'); } ta.remove(); } };
  $('cmd-run').onclick = () => { if (!$('cmd-input').value.trim()) return toast('Coller d\'abord les commandes JSON.'); lancer($('cmd-input').value); };
  $('cmd-input').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('cmd-run').click(); } };
  $('cmd-back').onclick = () => lancer({ cmd: 'retour_avant_commande' });
  $('cmd-clear').onclick = () => { $('cmd-input').value = ''; $('cmd-log').replaceChildren(); };
  $('cmd-example').onclick = () => { $('cmd-input').value = '{\n "sdc": 1,\n "commandes": [\n  {"cmd": "etat"},\n  {"cmd": "nomenclature"}\n ]\n}'; };
  $('cmd-copy-ctx').onclick = () => copier(contexteIA(ctx), 'Contexte copié : le coller dans la conversation avec l\'assistant.');
  $('cmd-copy-res').onclick = () => { if (!dernier) return toast('Aucun résultat à copier.'); copier(JSON.stringify(dernier, null, 1), 'Résultat copié : le coller dans la conversation.'); };
  // API publique (console, essais automatiques, futur pont MCP) : window.SDC.executer(json|objet, {confirmer}) et une méthode par commande.
  const SDC = { version: VERSION_COMMANDES, application: APP_VERSION,
    executer: (entree, opts = {}) => executer(ctx, entree, { confirmer: opts.confirmer === 'operateur' ? confirmer : opts.confirmer, arret: opts.arret }),
    modeEmploi: () => modeEmploiIA(), contexte: () => contexteIA(ctx) };
  for (const nom of Object.keys(COMMANDES)) SDC[nom] = async (params = {}, opts) => { const r = await SDC.executer({ cmd: nom, ...params }, opts); return r.resultats[0] ?? r; };
  window.SDC = Object.freeze(SDC);
}

// ---------------------------------------------------------------- démarrage
wire(); setupPanels(); setupGroupes(); setupCommande(); resize(); loop();
window.__SDC__ = { S, loadBytes, setMode, select, selectNet, extractCylinders, buildNetworks, project, xf, partBox: id => { const b = partBox(id); return [...b.min.toArray(), ...b.max.toArray()]; }, fitBox, THREE }; // accès pour essais automatisés
