import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateAssembly, buildBom, csv, makeProject, validateProject } from './project.js';
import { responseJson, importStep } from './step-import.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { segmentMesh, roundOf, FEATURE_VERSION } from './features.js';
import { toWorldPlane, toWorldAxis, toWorldRound, measurePair, measureRound, defaultRoundMode, drawable } from './dimensions.js';
import { createSectionView, meshData } from './section-view.js';
import { scaleOf } from './vec.js';
import { initLayout } from './layout.js';
import './style.css';

const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e0e8ef');
const camera = new THREE.PerspectiveCamera(40, 1, .1, 100000);
camera.up.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, stencil: true });
renderer.localClippingEnabled = true;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('viewport').append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x718398, 3));
const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(200, -300, 500); scene.add(light);
let assembly, root, selected, meshes = new Map(), bounds, display;
let environment;
const sectionView = createSectionView(scene);
let sectionState = { plane: null, planes: [] }, sectionQueued = false;
const loader = new GLTFLoader();
function message(text) { $('status').textContent = text; }
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function protect(fn) { return async (...args) => { try { await fn(...args); } catch (error) { message(error.message); } }; }
function fit() {
  if (!bounds) return;
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3()).length() || 100;
  camera.position.copy(center).add(new THREE.Vector3(size, -size, size).multiplyScalar(1 / Math.min(camera.aspect, 1)));
  camera.near = Math.max(size / 10000, .01); camera.far = size * 100; camera.updateProjectionMatrix();
  controls.target.copy(center); controls.update();
}
function install(data, model) {
  validateAssembly(data);
  const next = new Map();
  model.traverse(obj => { if (obj.isMesh) {
    if (next.has(obj.name)) throw new Error('Noms de maillages dupliqués.');
    next.set(obj.name, obj);
  } });
  if (data.occurrences.some(item => !next.has(item.id)) || next.size !== data.occurrences.length) throw new Error('Les identifiants GLB ne correspondent pas aux métadonnées.');
  clearDims(); clearHighlight('hover'); clearHighlight('first'); setTool(null); sectionView.clear();
  if (root) { scene.remove(root); root.traverse(obj => { obj.geometry?.dispose(); if (obj.material) for (const mat of [obj.material].flat()) mat.dispose(); }); }
  assembly = data; root = model; meshes = next; selected = null; scene.add(root); root.updateMatrixWorld(true);
  display = { explode: 0, section: '', sectionPosition: 50, inverse: false, hatch: 25, items: {} };
  let colorIndex = 0;
  for (const [id, mesh] of meshes) {
    mesh.userData.initial = mesh.position.clone();
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
    const palette = ['#7196af', '#c7a573', '#8bada1', '#ae95b5', '#8d9aab'];
    mesh.material = new THREE.MeshStandardMaterial({ color: data.source_sha256 === 'demo-sans-step' ? mesh.material.color : palette[colorIndex++ % palette.length], metalness: .25, roughness: .65, side: THREE.DoubleSide });
    display.items[id] = { visible: true, opacity: 1, comment: '' };
  }
  bounds = new THREE.Box3().setFromObject(root);
  for (const mesh of meshes.values()) {
    // Un vecteur défini dans le repère du parent, même pour un GLB transformé.
    const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    const origin = bounds.getCenter(new THREE.Vector3());
    mesh.parent.worldToLocal(center); mesh.parent.worldToLocal(origin);
    mesh.userData.explode = center.sub(origin).multiplyScalar(.8);
  }
  syncControls(); renderLists(); applyDisplay(); fit();
  message(data.warning ?? 'Assemblage chargé · identifications à vérifier.');
}
function renderLists() {
  if (!assembly) return;
  const term = $('search').value.toLocaleLowerCase('fr');
  $('tree').replaceChildren(); $('bom').replaceChildren();
  const rows = buildBom(assembly.occurrences);
  if (!term) for (const group of (assembly.tree ?? []).filter(node => node.type === 'group')) {
    const button = document.createElement('button'); button.textContent = `▦ ${group.name} · isoler le sous-ensemble`;
    button.onclick = () => { for (const item of assembly.occurrences) display.items[item.id].visible = item.group === group.id || item.group?.startsWith(group.id + '/'); applyDisplay(); renderLists(); };
    $('tree').append(button);
  }
  for (const item of assembly.occurrences) {
    const row = rows.find(r => r.ids.includes(item.id));
    if (!`${row.repere} ${item.name} ${item.reference ?? ''} ${item.dimensions_mm.join(' ')} ${item.group ?? ''}`.toLocaleLowerCase('fr').includes(term)) continue;
    const button = document.createElement('button'); button.textContent = `${row.repere} · ${item.name}${display.items[item.id].visible ? '' : ' (masqué)'}`;
    button.classList.toggle('selected', selected === item.id); button.onclick = () => select(item.id); $('tree').append(button);
  }
  for (const row of rows) {
    if (!`${row.repere} ${row.name} ${row.reference ?? ''} ${row.dimensions_mm.join(' ')} ${row.group ?? ''}`.toLocaleLowerCase('fr').includes(term)) continue;
    const tr = document.createElement('tr');
    for (const value of [row.repere, row.name, row.reference ?? 'Non renseignée', row.quantity, row.dimensions_mm.map(x => x.toFixed(2)).join(' × '), row.status ?? 'A_VERIFIER']) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    tr.classList.toggle('selected', row.ids.includes(selected)); tr.onclick = () => select(row.ids[0]); $('bom').append(tr);
  }
}
function select(id) {
  selected = id;
  const item = assembly.occurrences.find(x => x.id === id), state = display.items[id];
  $('details').textContent = `${item.name} · ${id}\nEncombrement : ${item.dimensions_mm.join(' × ')} mm · repère ${item.dimension_frame ?? 'non renseigné'}\nVolume : ${item.volume_mm3 ?? 'non renseigné'} mm³ · ${item.status ?? 'A_VERIFIER'}\n${state.comment}`;
  $('opacity').value = state.opacity * 100; $('comment').value = state.comment;
  for (const [key, mesh] of meshes) mesh.material.emissive.set(key === id ? '#244963' : '#000000');
  renderLists();
}
function applyDisplay() {
  if (!assembly) return;
  const axis = { XZ: 'y', YZ: 'x', XY: 'z' }[display.section];
  const planes = [];
  if (axis) {
    // Étendue recalculée après éclaté, y compris les objets masqués.
    for (const mesh of meshes.values()) mesh.position.copy(mesh.userData.initial).addScaledVector(mesh.userData.explode, display.explode / 100);
    root.updateMatrixWorld(true);
    const extent = new THREE.Box3().setFromObject(root);
    const position = THREE.MathUtils.lerp(extent.min[axis], extent.max[axis], display.sectionPosition / 100);
    const normal = new THREE.Vector3(); normal[axis] = display.inverse ? -1 : 1;
    planes.push(new THREE.Plane(normal, -position * normal[axis]));
  }
  for (const [id, mesh] of meshes) {
    mesh.position.copy(mesh.userData.initial).addScaledVector(mesh.userData.explode, display.explode / 100);
    mesh.visible = display.items[id].visible;
    mesh.material.opacity = display.items[id].opacity; mesh.material.transparent = mesh.material.opacity < 1;
    mesh.material.depthWrite = mesh.material.opacity === 1; mesh.material.clippingPlanes = planes; mesh.material.needsUpdate = true;
  }
  for (const material of [hoverMaterial, firstMaterial]) material.clippingPlanes = planes;
  sectionState = { plane: planes[0] ?? null, planes };
  scheduleSection(); refreshDims();
}
// Remplissage, hachures et contours : recalculés au plus une fois par image.
function scheduleSection() {
  if (sectionQueued) return;
  sectionQueued = true;
  requestAnimationFrame(() => {
    sectionQueued = false;
    if (assembly) sectionView.update({ ...sectionState, meshes, bounds, hatch: display.hatch ?? 25 });
  });
}
function syncControls() {
  $('explode').value = display.explode; $('section').value = display.section; $('section-position').value = display.sectionPosition; $('inverse').checked = display.inverse; $('hatch').value = display.hatch ?? 25;
}
$('demo').onclick = protect(async () => {
  const data = validateAssembly(await (await fetch('/examples/demo/assembly.json')).json());
  const group = new THREE.Group();
  for (const item of data.occurrences) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...item.dimensions_mm), new THREE.MeshStandardMaterial({ color: item.color })); mesh.name = item.id; mesh.position.fromArray(item.position_mm); group.add(mesh); }
  install(data, group);
});
$('import').onclick = protect(async () => {
  const glb = $('glb').files[0], metadata = $('metadata').files[0];
  if (!glb || !metadata) throw new Error('Sélectionner les deux fichiers GLB et JSON.');
  const data = validateAssembly(JSON.parse(await metadata.text()));
  // Le convertisseur produit des GLB autonomes, sans ressources externes.
  const bytes = await glb.arrayBuffer();
  const header = new DataView(bytes);
  if (bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67) throw new Error('Fichier GLB invalide.');
  const length = header.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  if ([...(gltf.buffers ?? []), ...(gltf.images ?? [])].some(x => x.uri)) throw new Error('Utiliser un GLB autonome sans ressources externes.');
  const result = await loader.parseAsync(bytes, ''); install(data, result.scene);
});
$('search').oninput = renderLists;
$('fit').onclick = fit;
$('hide').onclick = () => { if (selected) { display.items[selected].visible = false; applyDisplay(); renderLists(); } };
$('isolate').onclick = () => { if (selected) { for (const id of meshes.keys()) display.items[id].visible = id === selected; applyDisplay(); renderLists(); } };
$('show').onclick = () => { if (assembly) { for (const item of Object.values(display.items)) item.visible = true; applyDisplay(); renderLists(); } };
$('opacity').oninput = () => { if (selected) { display.items[selected].opacity = +$('opacity').value / 100; applyDisplay(); } };
$('explode').oninput = () => { if (display) { display.explode = +$('explode').value; applyDisplay(); } };
$('hatch').oninput = () => { if (display) { display.hatch = +$('hatch').value; scheduleSection(); } };
for (const id of ['section', 'section-position', 'inverse']) $(id).oninput = () => { if (display) { display.section = $('section').value; display.sectionPosition = +$('section-position').value; display.inverse = $('inverse').checked; applyDisplay(); } };
$('annotate').onclick = () => { if (selected) { display.items[selected].comment = $('comment').value; select(selected); } };
$('save').onclick = () => { if (assembly) download('projet-sdc.json', JSON.stringify(makeProject(assembly, display, { position: camera.position.toArray(), target: controls.target.toArray() }, dimensionState()), null, 2), 'application/json'); };
$('project').onchange = protect(async () => {
  if (!assembly) throw new Error('Charger un assemblage avant de restaurer le projet.');
  const file = $('project').files[0]; if (!file) return;
  const project = validateProject(JSON.parse(await file.text()), assembly);
  for (const id of meshes.keys()) if (!project.display.items?.[id]) throw new Error('État de consultation incomplet.');
  display = project.display; display.hatch ??= 25; camera.position.fromArray(project.camera.position); controls.target.fromArray(project.camera.target); controls.update();
  syncControls(); applyDisplay(); renderLists(); if (selected) select(selected);
  const skipped = restoreDims(project.dimensions);
  message(skipped ? `Projet restauré · ${skipped} cote(s) ignorée(s) : faces introuvables, à recréer.` : 'Projet restauré.');
});
$('csv').onclick = () => { if (assembly) download('nomenclature-sdc.csv', csv(buildBom(assembly.occurrences.map(x => ({ ...x, comment: display.items[x.id].comment })))), 'text/csv;charset=utf-8'); };
$('print').onclick = () => window.print();
const ray = new THREE.Raycaster();
let start;
// Premier maillage visible, non coupé, sous le curseur.
function firstHit(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  return ray.intersectObjects([...meshes.values()], false).find(h => h.object.visible && h.object.material.opacity > 0 && h.object.material.clippingPlanes.every(p => p.distanceToPoint(h.point) >= 0));
}
renderer.domElement.addEventListener('pointerdown', event => { start = [event.clientX, event.clientY]; });
renderer.domElement.addEventListener('pointerup', event => {
  if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 5) return;
  if (tool) { dimensionClick(event); return; }
  const hit = firstHit(event);
  if (hit) select(hit.object.name);
});
new ResizeObserver(() => {
  const { width, height } = $('viewport').getBoundingClientRect();
  renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
  sectionView.setResolution(width, height); dimMaterial.resolution.set(width, height);
}).observe($('viewport'));
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); updateLabels(); });
// ───── Cotation : sélection de faces/cylindres sur le maillage, cotes conservées et masquables ─────
const dimMaterial = new LineMaterial({ color: 0xd9480f, linewidth: 2.2, depthTest: false, transparent: true });
const hoverMaterial = new THREE.MeshBasicMaterial({ color: '#ff8a00', transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const firstMaterial = new THREE.MeshBasicMaterial({ color: '#1c7ed6', transparent: true, opacity: .6, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const dimLayer = new THREE.Group(); scene.add(dimLayer);
const segCache = new WeakMap(), dimView = new Map(), highlights = { hover: null, first: null };
let dims = [], dimsHidden = false, tool = null, pending = null, dimCounter = 0, hoverKey = '', hintTimer, listKey = '';
const labelPoint = new THREE.Vector3();

function segOf(mesh) {
  let seg = segCache.get(mesh.geometry);
  if (!seg) { const { pos, idx } = meshData(mesh); seg = segmentMesh(pos, idx); segCache.set(mesh.geometry, seg); }
  return seg;
}
const meshOf = ref => { const mesh = meshes.get(ref.m); if (!mesh || !segOf(mesh).faces[ref.f]) throw new Error('Face introuvable : cote à recréer.'); return mesh; };
function pairElement(ref) {
  const mesh = meshOf(ref), seg = segOf(mesh), face = seg.faces[ref.f], m = mesh.matrixWorld.elements;
  if (face.kind === 'plane') return toWorldPlane(face, m);
  const round = face.kind === 'cylinder' && roundOf(meshData(mesh).pos, seg, ref.f);
  if (round) return toWorldAxis(round, m);
  throw new Error('Face non cotable : choisir une face plane ou un cylindre.');
}
function roundElement(ref) {
  const mesh = meshOf(ref), round = roundOf(meshData(mesh).pos, segOf(mesh), ref.f);
  if (!round) throw new Error('Cylindre, rayon ou sphère attendu.');
  return toWorldRound(round, mesh.matrixWorld.elements);
}
const computeDim = dim => dim.kind === 'round' ? measureRound(roundElement(dim.refs[0]), dim.mode) : measurePair(pairElement(dim.refs[0]), pairElement(dim.refs[1]));

function describe(hit) {
  const mesh = hit.object, seg = segOf(mesh), f = seg.triFace[hit.faceIndex], face = seg.faces[f], k = scaleOf(mesh.matrixWorld.elements);
  if (face.kind === 'plane') return { mesh, f, kind: 'plane', label: 'Face plane' };
  const round = (face.kind === 'cylinder' || face.kind === 'sphere') ? roundOf(meshData(mesh).pos, seg, f) : null;
  if (round) {
    const mode = defaultRoundMode(round), value = (mode === 'diameter' ? 2 : 1) * round.r * k;
    return { mesh, f, kind: round.kind, label: `${round.kind === 'sphere' ? 'Sphère' : mode === 'diameter' ? 'Cylindre' : 'Arc'} ${mode === 'diameter' ? 'Ø' : 'R'} ${value.toFixed(2)} mm` };
  }
  return { mesh, f, kind: 'other', label: 'Surface non cotable (ni plan, ni cylindre, ni sphère)' };
}

function showHighlight(slot, mesh, f) {
  clearHighlight(slot);
  const seg = segOf(mesh), { pos, idx } = meshData(mesh);
  const ids = seg.faces[f].kind === 'cylinder' ? (roundOf(pos, seg, f)?.faces ?? [f]) : [f];
  const array = new Float32Array(ids.reduce((n, id) => n + seg.faces[id].tris.length, 0) * 9);
  let o = 0;
  for (const id of ids) for (const t of seg.faces[id].tris) for (let k = 0; k < 3; k++) {
    const v = idx ? idx[3 * t + k] : 3 * t + k;
    array[o++] = pos[3 * v]; array[o++] = pos[3 * v + 1]; array[o++] = pos[3 * v + 2];
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(array, 3));
  const overlay = new THREE.Mesh(geometry, slot === 'hover' ? hoverMaterial : firstMaterial);
  overlay.renderOrder = 900; overlay.raycast = () => {}; overlay.frustumCulled = false;
  mesh.add(overlay); highlights[slot] = overlay;
}
function clearHighlight(slot) {
  const overlay = highlights[slot];
  if (overlay) { overlay.parent?.remove(overlay); overlay.geometry.dispose(); highlights[slot] = null; }
  if (slot === 'hover') hoverKey = '';
}

function baseHint() {
  if (!tool) return '';
  if (tool === 'round') return 'Ø / R : cliquer un cylindre, un arc ou une sphère. Échap : quitter.';
  return pending ? 'Distance / angle : cliquer le second élément (face ou cylindre). Échap : annuler.' : 'Distance / angle : cliquer le premier élément (face ou cylindre). Échap : quitter.';
}
function hint(text, transient) {
  clearTimeout(hintTimer);
  $('dim-hint').textContent = text ?? ''; $('dim-hint').hidden = !text;
  if (transient) hintTimer = setTimeout(() => hint(baseHint()), 5000);
}
function setTool(next) {
  tool = next && tool !== next ? next : null;
  pending = null; clearHighlight('first'); clearHighlight('hover');
  for (const [name, ids] of [['pair', ['dim-pair', 'tool-pair']], ['round', ['dim-round', 'tool-round']]]) for (const id of ids) $(id).setAttribute('aria-pressed', String(tool === name));
  $('viewport').classList.toggle('measuring', Boolean(tool));
  hint(baseHint());
}

function dimensionClick(event) {
  try {
    const hit = firstHit(event);
    if (!hit) { hint('Aucune face sous le curseur.', true); return; }
    const picked = describe(hit), ref = { m: picked.mesh.name, f: picked.f };
    if (tool === 'round') {
      if (!['cylinder', 'sphere'].includes(picked.kind)) throw new Error(`${picked.label} : choisir un cylindre, un arc ou une sphère.`);
      addDim({ kind: 'round', refs: [ref], mode: defaultRoundMode(roundOf(meshData(picked.mesh).pos, segOf(picked.mesh), picked.f)) });
    } else if (!pending) {
      pairElement(ref);
      pending = ref; showHighlight('first', picked.mesh, picked.f); hint(`${picked.label} sélectionné · ${baseHint()}`);
    } else {
      if (pending.m === ref.m && pending.f === ref.f) throw new Error('Choisir un second élément différent du premier.');
      const refs = [pending, ref];
      pending = null; clearHighlight('first');
      addDim({ kind: 'pair', refs });
    }
  } catch (error) { hint(error.message, true); }
}
function addDim(dim) {
  const same = d => d.kind === dim.kind && (dim.kind === 'round' ? d.refs[0].m === dim.refs[0].m && d.refs[0].f === dim.refs[0].f
    : dim.refs.every(r => d.refs.some(x => x.m === r.m && x.f === r.f)));
  if (dims.some(same)) throw new Error('Cette cote existe déjà.');
  root.updateMatrixWorld(true);
  const result = computeDim(dim);
  dims.push({ id: `c${++dimCounter}`, hidden: false, ...dim });
  dimsHidden = false; refreshDims(); hint(`${result.text} · cote ajoutée, restera affichée jusqu'à son masquage.`, true);
}
function removeDim(id) {
  const view = dimView.get(id);
  if (view) { dimLayer.remove(view.line); view.line.geometry.dispose(); view.label.remove(); dimView.delete(id); }
  dims = dims.filter(d => d.id !== id); refreshDims();
}
function clearDims() { for (const d of [...dims]) removeDim(d.id); dimsHidden = false; dims = []; }
function dimensionState() {
  return { feature_version: FEATURE_VERSION, hidden: dimsHidden, items: dims.map(({ id, kind, refs, mode, hidden }) => ({ id, kind, refs, ...(mode ? { mode } : {}), hidden })) };
}
function restoreDims(saved) {
  clearDims();
  if (!saved?.items?.length) { refreshDims(); return 0; }
  let skipped = 0;
  root.updateMatrixWorld(true);
  for (const item of saved.items) {
    try {
      if (saved.feature_version !== FEATURE_VERSION) throw new Error('version');
      computeDim(item);
      dims.push({ id: `c${++dimCounter}`, kind: item.kind, refs: item.refs, mode: item.mode, hidden: item.hidden });
    } catch { skipped++; }
  }
  dimsHidden = Boolean(saved.hidden); refreshDims();
  return skipped;
}

// Géométrie monde des cotes, recalculée à chaque changement d'affichage (éclaté, masquage, coupe).
function refreshDims() {
  if (!assembly) return;
  root.updateMatrixWorld(true);
  const arrow = (bounds.getSize(new THREE.Vector3()).length() || 100) * .012;
  for (const dim of dims) {
    let view = dimView.get(dim.id);
    if (!view) {
      const line = new LineSegments2(new LineSegmentsGeometry(), dimMaterial);
      line.renderOrder = 2000; line.frustumCulled = false; line.visible = false; dimLayer.add(line);
      const label = document.createElement('div'); label.className = 'dim-label'; label.hidden = true; label.title = 'Double-clic : masquer cette cote';
      label.ondblclick = () => { dim.hidden = true; refreshDims(); };
      $('labels').append(label);
      view = { line, label, pos: new THREE.Vector3(), result: null }; dimView.set(dim.id, view);
    }
    try {
      view.result = computeDim(dim); dim.error = null;
      view.line.geometry.dispose(); view.line.geometry = new LineSegmentsGeometry().setPositions(drawable(view.result, arrow).flat());
      view.label.textContent = view.result.text; view.pos.fromArray(view.result.label);
    } catch (error) { view.result = null; dim.error = error.message; }
    // Entre deux occurrences, la valeur lue sur une vue éclatée ne représente pas l'assemblage : cote masquée tant que l'éclaté est actif.
    dim.suspended = dim.kind === 'pair' && dim.refs[0].m !== dim.refs[1].m && display.explode > 0;
    const shown = Boolean(view.result) && !dimsHidden && !dim.hidden && !dim.suspended && dim.refs.every(r => meshes.get(r.m)?.visible);
    view.line.visible = shown; view.label.hidden = !shown;
  }
  renderDims();
}
function updateLabels() {
  if (!dimView.size) return;
  const width = renderer.domElement.clientWidth, height = renderer.domElement.clientHeight;
  for (const view of dimView.values()) {
    if (view.label.hidden) continue;
    labelPoint.copy(view.pos).project(camera);
    const behind = labelPoint.z > 1 || labelPoint.z < -1;
    view.label.style.visibility = behind ? 'hidden' : 'visible';
    if (!behind) view.label.style.transform = `translate(${(labelPoint.x * .5 + .5) * width}px,${(-labelPoint.y * .5 + .5) * height}px) translate(-50%,-50%) translate(0,-14px)`;
  }
}

function renderDims() {
  const names = dim => [...new Set(dim.refs.map(r => assembly.occurrences.find(o => o.id === r.m)?.name ?? '?'))].join(' ↔ ');
  const key = JSON.stringify([dimsHidden, dims.map(d => [d.id, d.hidden, d.mode, d.suspended, dimView.get(d.id)?.result?.text, d.error])]);
  $('dim-toggle-all').textContent = dimsHidden ? 'Afficher les cotes' : 'Masquer les cotes';
  $('tool-hide').textContent = dimsHidden ? 'Cotes masquées' : 'Cotes visibles';
  $('tool-hide').classList.toggle('off', dimsHidden);
  $('tool-hide').setAttribute('aria-pressed', 'false');
  if (key === listKey) return;
  listKey = key;
  const list = $('dim-list'); list.replaceChildren();
  if (!dims.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Aucune cote. Choisir un outil, puis cliquer dans la vue 3D.'; list.append(p); return; }
  for (const dim of dims) {
    const row = document.createElement('div'); row.className = 'dim-row'; row.classList.toggle('is-hidden', dim.hidden || dimsHidden || dim.suspended);
    const text = document.createElement('span'); text.className = 'dim-text';
    text.textContent = `${dim.suspended ? 'Masquée en vue éclatée' : dimView.get(dim.id)?.result?.text ?? 'Cote invalide'} · ${names(dim)}${dim.error ? ` (${dim.error})` : ''}`;
    row.append(text);
    const button = (label, title, action) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.onclick = action; row.append(b); };
    button(dim.hidden ? '○' : '◉', dim.hidden ? 'Afficher cette cote' : 'Masquer cette cote', () => { dim.hidden = !dim.hidden; if (!dim.hidden) dimsHidden = false; refreshDims(); });
    if (dim.kind === 'round') button('Ø⇄R', 'Basculer diamètre / rayon', () => { dim.mode = dim.mode === 'diameter' ? 'radius' : 'diameter'; refreshDims(); });
    button('✕', 'Supprimer cette cote', () => removeDim(dim.id));
    list.append(row);
  }
}

for (const id of ['dim-pair', 'tool-pair']) $(id).onclick = () => setTool('pair');
for (const id of ['dim-round', 'tool-round']) $(id).onclick = () => setTool('round');
for (const id of ['dim-toggle-all', 'tool-hide']) $(id).onclick = () => { dimsHidden = !dimsHidden; refreshDims(); };
$('dim-clear').onclick = () => { if (dims.length && confirm(`Effacer les ${dims.length} cote(s) ?`)) { clearDims(); renderDims(); } };
addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !tool) return;
  if (pending) { pending = null; clearHighlight('first'); hint(baseHint()); } else setTool(null);
});
let hoverQueued = false, lastMove;
renderer.domElement.addEventListener('pointermove', event => {
  if (!tool || event.buttons) return;
  lastMove = event;
  if (hoverQueued) return;
  hoverQueued = true;
  setTimeout(() => {
    hoverQueued = false;
    if (!tool || !assembly) return;
    const hit = firstHit(lastMove);
    if (!hit) { clearHighlight('hover'); hint(baseHint()); return; }
    const picked = describe(hit), key = `${picked.mesh.name}:${picked.f}`;
    const usable = tool === 'round' ? ['cylinder', 'sphere'].includes(picked.kind) : ['plane', 'cylinder'].includes(picked.kind);
    if (key !== hoverKey) { if (usable) showHighlight('hover', picked.mesh, picked.f); else clearHighlight('hover'); hoverKey = key; }
    hint(`${picked.label} · ${baseHint()}`);
  }, 50);
});
initLayout(); renderDims();

async function refreshRecent() {
  const data = await responseJson(await fetch('/api/projects'));
  $('recent').replaceChildren(new Option('Choisir un assemblage', ''));
  for (const job of data.projects) $('recent').append(new Option(`${job.source_name} · ${job.occurrence_count} composants`, job.id));
}
async function loadConverted(job) {
  message('Chargement des composants dans la vue 3D…');
  const data = validateAssembly(await responseJson(await fetch(job.metadata_url)));
  const response = await fetch(job.glb_url);
  if (!response.ok) throw new Error('Le maillage converti est absent. Réimporter le STEP.');
  const result = await loader.parseAsync(await response.arrayBuffer(), ''); install(data, result.scene);
}
$('open-step').onclick = protect(async () => {
  if (!environment?.step_import) throw new Error('Démarrer SDC avec Demarrer_SDC.bat pour utiliser le moteur STEP.');
  $('open-step').disabled = true; $('import-progress').hidden = false;
  try {
    const job = await importStep($('step').files[0], environment.token, message);
    await loadConverted(job); await refreshRecent(); $('recent').value = job.id;
  } finally { $('open-step').disabled = false; $('import-progress').hidden = true; }
});
$('open-recent').onclick = protect(async () => {
  const id = $('recent').value;
  if (!id) throw new Error('Choisir un assemblage récemment importé.');
  await loadConverted({metadata_url:`/api/projects/${id}/assembly.json`,glb_url:`/api/projects/${id}/assembly.glb`});
});
async function initialize() {
  try {
    environment = await responseJson(await fetch('/api/environment'));
    $('environment').textContent = 'Moteur STEP local disponible. Choisir un fichier pour commencer.';
    await refreshRecent();
  } catch {
    $('environment').textContent = 'Pour ouvrir un STEP, lancer Demarrer_SDC.bat. Le mode GLB reste disponible.';
  }
}
initialize();
