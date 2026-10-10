import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateAssembly, buildBom, csv, makeProject, validateProject } from './project.js';
import { responseJson, importStep } from './step-import.js';
import './style.css';

const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e0e8ef');
const camera = new THREE.PerspectiveCamera(40, 1, .1, 100000);
camera.up.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.localClippingEnabled = true;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('viewport').append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x718398, 3));
const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(200, -300, 500); scene.add(light);
let assembly, root, selected, meshes = new Map(), bounds, display;
let environment;
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
  if (root) { scene.remove(root); root.traverse(obj => { obj.geometry?.dispose(); if (obj.material) for (const mat of [obj.material].flat()) mat.dispose(); }); }
  assembly = data; root = model; meshes = next; selected = null; scene.add(root); root.updateMatrixWorld(true);
  display = { explode: 0, section: '', sectionPosition: 50, inverse: false, items: {} };
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
}
function syncControls() {
  $('explode').value = display.explode; $('section').value = display.section; $('section-position').value = display.sectionPosition; $('inverse').checked = display.inverse;
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
for (const id of ['section', 'section-position', 'inverse']) $(id).oninput = () => { if (display) { display.section = $('section').value; display.sectionPosition = +$('section-position').value; display.inverse = $('inverse').checked; applyDisplay(); } };
$('annotate').onclick = () => { if (selected) { display.items[selected].comment = $('comment').value; select(selected); } };
$('save').onclick = () => { if (assembly) download('projet-sdc.json', JSON.stringify(makeProject(assembly, display, { position: camera.position.toArray(), target: controls.target.toArray() }), null, 2), 'application/json'); };
$('project').onchange = protect(async () => {
  if (!assembly) throw new Error('Charger un assemblage avant de restaurer le projet.');
  const file = $('project').files[0]; if (!file) return;
  const project = validateProject(JSON.parse(await file.text()), assembly);
  for (const id of meshes.keys()) if (!project.display.items?.[id]) throw new Error('État de consultation incomplet.');
  display = project.display; camera.position.fromArray(project.camera.position); controls.target.fromArray(project.camera.target); controls.update();
  syncControls(); applyDisplay(); renderLists(); if (selected) select(selected); message('Projet restauré.');
});
$('csv').onclick = () => { if (assembly) download('nomenclature-sdc.csv', csv(buildBom(assembly.occurrences.map(x => ({ ...x, comment: display.items[x.id].comment })))), 'text/csv;charset=utf-8'); };
$('print').onclick = () => window.print();
const ray = new THREE.Raycaster();
let start;
renderer.domElement.addEventListener('pointerdown', event => { start = [event.clientX, event.clientY]; });
renderer.domElement.addEventListener('pointerup', event => {
  if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  const hit = ray.intersectObjects([...meshes.values()], false).find(h => h.object.visible && h.object.material.opacity > 0 && h.object.material.clippingPlanes.every(p => p.distanceToPoint(h.point) >= 0));
  if (hit) select(hit.object.name);
});
new ResizeObserver(() => { const { width, height } = $('viewport').getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); }).observe($('viewport'));
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
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
