// Lecture STEP/IGES dans le navigateur avec occt-import-js (OpenCascade compilé en WebAssembly).
// Le moteur est embarqué dans le fichier HTML (aucun réseau, aucun FreeCAD requis sur le poste atelier).

let wasmBytesPromise = null;

async function gunzipBase64(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (typeof DecompressionStream === 'undefined') throw new Error('Navigateur trop ancien : utiliser Chrome ou Edge récent.');
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Version « légère » : moteur non embarqué, téléchargé une fois depuis le CDN (Internet requis à l'ouverture d'un STEP).
async function fetchEngine(file, kind) {
  const base = window.__SDC_OCCT_CDN__;
  if (!base) throw new Error('Moteur OpenCascade absent de ce fichier.');
  try { const r = await fetch(base + file); if (!r.ok) throw new Error(r.status); return kind === 'text' ? r.text() : new Uint8Array(await r.arrayBuffer()); }
  catch { throw new Error('Version légère : connexion Internet nécessaire pour charger le moteur STEP (' + base + ').'); }
}
function wasmBytes() {
  wasmBytesPromise ??= (async () => {
    if (!window.__SDC_OCCT_JS__) window.__SDC_OCCT_JS__ = await fetchEngine('occt-import-js.js', 'text');
    return window.__SDC_OCCT_WASM_GZ_B64__ ? gunzipBase64(window.__SDC_OCCT_WASM_GZ_B64__) : fetchEngine('occt-import-js.wasm', 'bin');
  })();
  wasmBytesPromise.catch(() => { wasmBytesPromise = null; });
  return wasmBytesPromise;
}

export const QUALITY = {
  rapide: { linearDeflectionType: 'absolute_value', linearDeflection: 0.3, angularDeflection: 0.5 },
  normale: { linearDeflectionType: 'absolute_value', linearDeflection: 0.1, angularDeflection: 0.3 },
  fine: { linearDeflectionType: 'absolute_value', linearDeflection: 0.03, angularDeflection: 0.15 },
};

const WORKER_SRC = `
self.onmessage = async (e) => {
  const { wasm, bytes, kind, params } = e.data;
  try {
    const occt = await occtimportjs({ wasmBinary: wasm });
    self.postMessage({ progress: 'Lecture de la géométrie…' });
    const fn = kind === 'iges' ? 'ReadIgesFile' : kind === 'brep' ? 'ReadBrepFile' : 'ReadStepFile';
    const r = occt[fn](new Uint8Array(bytes), { linearUnit: 'millimeter', ...params });
    if (!r.success) throw new Error('Fichier illisible par le moteur OpenCascade.');
    const transfer = [];
    for (const m of r.meshes) {
      m.attributes.position.array = Float32Array.from(m.attributes.position.array); transfer.push(m.attributes.position.array.buffer);
      if (m.attributes.normal) { m.attributes.normal.array = Float32Array.from(m.attributes.normal.array); transfer.push(m.attributes.normal.array.buffer); }
      if (m.index) { m.index.array = Uint32Array.from(m.index.array); transfer.push(m.index.array.buffer); }
    }
    self.postMessage({ result: r }, transfer);
  } catch (err) { self.postMessage({ error: String(err && err.message || err) }); }
};`;

function kindOf(name) {
  if (/\.(iges|igs)$/i.test(name)) return 'iges';
  if (/\.brep$/i.test(name)) return 'brep';
  return 'step';
}

/** Convertit un fichier CAO en maillages. onProgress(texte). Renvoie le résultat occt-import-js. */
export async function readCad(bytes, name, quality = 'normale', onProgress = () => {}) {
  onProgress('Préparation du moteur OpenCascade…');
  const wasm = await wasmBytes();
  const params = QUALITY[quality] ?? QUALITY.normale;
  try {
    return await new Promise((resolve, reject) => {
      let worker;
      // Le moteur est concaténé dans la tâche de fond : importScripts(blob:) est refusé sous file://.
      const url = URL.createObjectURL(new Blob([window.__SDC_OCCT_JS__, '\n', WORKER_SRC], { type: 'text/javascript' }));
      try { worker = new Worker(url); }
      catch { reject(new Error('worker-indisponible')); return; }
      worker.onmessage = e => {
        if (e.data.progress) onProgress(e.data.progress);
        else { worker.terminate(); URL.revokeObjectURL(url); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result); }
      };
      worker.onerror = ev => { ev.preventDefault?.(); worker.terminate(); URL.revokeObjectURL(url); reject(new Error('worker-indisponible')); };
      const copy = wasm.slice();
      worker.postMessage({ wasm: copy, bytes, kind: kindOf(name), params }, [copy.buffer]);
    });
  } catch (err) {
    if (err.message !== 'worker-indisponible' && !/importScripts|wasm|WebAssembly|Worker/i.test(err.message)) throw err;
    // Repli : lecture dans la page (interface figée pendant la conversion).
    onProgress('Lecture de la géométrie (sans tâche de fond)…');
    if (!window.occtimportjs) (0, eval)(window.__SDC_OCCT_JS__);
    const occt = await window.occtimportjs({ wasmBinary: wasm });
    const k = kindOf(name);
    const r = occt[k === 'iges' ? 'ReadIgesFile' : k === 'brep' ? 'ReadBrepFile' : 'ReadStepFile'](new Uint8Array(bytes), { linearUnit: 'millimeter', ...params });
    if (!r.success) throw new Error('Fichier illisible par le moteur OpenCascade.');
    return r;
  }
}

export async function sha256(bytes) {
  try {
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 0x811c9dc5; const u = new Uint8Array(bytes);
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return 'fnv1a-' + h.toString(16) + '-' + u.length;
  }
}
