// Rendu d'une coupe graphique : remplissage des pièces coupées (stencil), hachures atténuées et contour renforcé.
// Ce n'est pas une section BRep : le remplissage suppose des maillages fermés.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { planeSegments } from './section.js';

const cache = new WeakMap();
// Positions Float32 et indices du maillage, sans copie lorsque le format le permet.
export function meshData(mesh) {
  let data = cache.get(mesh.geometry);
  if (!data) {
    const geometry = mesh.geometry, attr = geometry.getAttribute('position');
    let pos = attr.array;
    if (attr.isInterleavedBufferAttribute || !(pos instanceof Float32Array) || attr.itemSize !== 3) {
      pos = new Float32Array(attr.count * 3);
      for (let i = 0; i < attr.count; i++) { pos[3 * i] = attr.getX(i); pos[3 * i + 1] = attr.getY(i); pos[3 * i + 2] = attr.getZ(i); }
    }
    data = { pos, idx: geometry.index ? geometry.index.array : null };
    cache.set(geometry, data);
  }
  return data;
}

const vertexShader = `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const fragmentShader = `
uniform vec3 uFill; uniform vec3 uHatch; uniform vec3 uU; uniform vec3 uV;
uniform float uStrength; uniform float uSign; uniform float uSpacing;
varying vec3 vWorld;
void main() {
  float h = (dot(vWorld, uU) + uSign * dot(vWorld, uV)) / (uSpacing * 1.41421356);
  float f = fract(h), d = min(f, 1.0 - f);
  float line = 1.0 - smoothstep(0.04, 0.04 + fwidth(h) * 1.2, d);
  gl_FragColor = vec4(mix(uFill, uHatch, line * uStrength), 1.0);
  #include <colorspace_fragment>
}`;

export function createSectionView(scene) {
  const group = new THREE.Group(); group.name = 'coupe'; scene.add(group);
  const capGeometry = new THREE.PlaneGeometry(1, 1);
  const contourMaterial = new LineMaterial({ color: 0x0b1f33, linewidth: 2.6, worldUnits: false });
  const pieces = new Map();
  const white = new THREE.Color(1, 1, 1), invert = new THREE.Matrix4(), local = new THREE.Plane(), box = new THREE.Box3();
  const zAxis = new THREE.Vector3(0, 0, 1), quaternion = new THREE.Quaternion(), middle = new THREE.Vector3();

  function stencilMesh(mesh, side, op, order) {
    const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side });
    material.stencilWrite = true; material.stencilFunc = THREE.AlwaysStencilFunc;
    material.stencilFail = material.stencilZFail = material.stencilZPass = op;
    const stencil = new THREE.Mesh(mesh.geometry, material);
    stencil.renderOrder = order; stencil.matrixAutoUpdate = true;
    mesh.add(stencil);
    return stencil;
  }
  function piece(mesh, index) {
    let item = pieces.get(mesh);
    if (item) return item;
    const capMaterial = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      uniforms: { uFill: { value: new THREE.Color() }, uHatch: { value: new THREE.Color() }, uU: { value: new THREE.Vector3() }, uV: { value: new THREE.Vector3() },
        uStrength: { value: .2 }, uSign: { value: index % 2 ? -1 : 1 }, uSpacing: { value: 5 } }
    });
    capMaterial.stencilWrite = true; capMaterial.stencilRef = 0; capMaterial.stencilFunc = THREE.NotEqualStencilFunc;
    capMaterial.stencilFail = capMaterial.stencilZFail = capMaterial.stencilZPass = THREE.ReplaceStencilOp;
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.renderOrder = 3 * index + 2; cap.frustumCulled = false;
    cap.onAfterRender = renderer => renderer.clearStencil();
    group.add(cap);
    const line = new LineSegments2(new LineSegmentsGeometry(), contourMaterial);
    line.renderOrder = 1000 + index; line.frustumCulled = false; line.visible = false;
    mesh.add(line);
    item = {
      cap, capMaterial, line, hasLine: false,
      stencils: [stencilMesh(mesh, THREE.BackSide, THREE.IncrementWrapStencilOp, 3 * index + 1), stencilMesh(mesh, THREE.FrontSide, THREE.DecrementWrapStencilOp, 3 * index + 1)]
    };
    pieces.set(mesh, item);
    return item;
  }
  function hide(item) { item.cap.visible = false; item.line.visible = false; for (const s of item.stencils) s.visible = false; }

  return {
    // plane : THREE.Plane monde (conservé : côté positif) ; null pour désactiver.
    update({ plane, planes, meshes, bounds, hatch }) {
      let index = 0;
      const size = bounds.getSize(new THREE.Vector3()).length() || 100;
      for (const mesh of meshes.values()) {
        const item = piece(mesh, index++);
        if (!plane) { hide(item); continue; }
        mesh.updateMatrixWorld(true);
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
        const on = mesh.visible && mesh.material.opacity > 0 && plane.intersectsBox(box);
        if (!on) { hide(item); continue; }
        for (const s of item.stencils) { s.visible = true; s.material.clippingPlanes = planes; }
        item.cap.visible = true;
        const u = item.capMaterial.uniforms, color = mesh.material.color;
        u.uFill.value.copy(color).lerp(white, .5); u.uHatch.value.copy(color).multiplyScalar(.4);
        u.uStrength.value = Math.max(0, Math.min(100, hatch)) / 100 * .8; u.uSpacing.value = Math.max(size / 70, .5);
        quaternion.setFromUnitVectors(zAxis, plane.normal);
        plane.projectPoint(bounds.getCenter(middle), item.cap.position);
        item.cap.quaternion.copy(quaternion); item.cap.scale.setScalar(size * 3); item.cap.updateMatrixWorld(true);
        u.uU.value.set(1, 0, 0).applyQuaternion(quaternion); u.uV.value.set(0, 1, 0).applyQuaternion(quaternion);
        // Contour : intersection exacte des triangles avec le plan, dans le repère local du maillage.
        invert.copy(mesh.matrixWorld).invert();
        local.copy(plane).applyMatrix4(invert);
        const { pos, idx } = meshData(mesh);
        const segments = planeSegments(pos, idx, local.normal.toArray(), local.constant, size * 1e-7);
        item.line.geometry.dispose();
        item.line.geometry = new LineSegmentsGeometry();
        item.line.visible = segments.length > 0;
        if (segments.length) item.line.geometry.setPositions(segments);
      }
    },
    setResolution(width, height) { contourMaterial.resolution.set(width, height); },
    clear() {
      for (const [mesh, item] of pieces) {
        for (const s of item.stencils) { mesh.remove(s); s.material.dispose(); }
        mesh.remove(item.line); item.line.geometry.dispose();
        group.remove(item.cap); item.capMaterial.dispose();
      }
      pieces.clear();
    }
  };
}
