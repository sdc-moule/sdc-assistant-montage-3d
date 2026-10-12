// Construit l'application atelier en UN SEUL fichier HTML autonome (hors ligne, sans installation).
// node standalone/build.mjs  →  dist-standalone/SDC_Montage_3D.html
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'dist-standalone');
const occtDir = path.join(root, 'node_modules/occt-import-js/dist');

const js = (await build({ entryPoints: [path.join(here, 'src/app.js')], bundle: true, format: 'iife', minify: true, write: false, target: 'chrome100', legalComments: 'none' })).outputFiles[0].text;
const css = fs.readFileSync(path.join(here, 'src/style.css'), 'utf8');
const occtJs = fs.readFileSync(path.join(occtDir, 'occt-import-js.js'), 'utf8');
const gz64 = f => zlib.gzipSync(fs.readFileSync(f), { level: 9 }).toString('base64');
const wasm = gz64(path.join(occtDir, 'occt-import-js.wasm'));
// pdf.js (Apache-2.0) : chargé à la demande pour lire les plans PDF vectoriels, jamais depuis Internet.
const pdfDir = path.join(root, 'node_modules/pdfjs-dist/legacy/build');
const pdfLib = gz64(path.join(pdfDir, 'pdf.min.mjs')), pdfWorker = gz64(path.join(pdfDir, 'pdf.worker.min.mjs'));
const dataPdf = `window.__SDC_PDFJS_GZ_B64__="${pdfLib}";window.__SDC_PDFJS_WORKER_GZ_B64__="${pdfWorker}";`;
const demoPath = path.join(root, 'tests/fixtures/bcr_synthetique.step');
const demo = fs.existsSync(demoPath) ? gz64(demoPath) : '';
const safe = s => s.replaceAll('</', '<\\/');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const CDN = 'https://cdn.jsdelivr.net/npm/occt-import-js@' + JSON.parse(fs.readFileSync(path.join(root, 'node_modules/occt-import-js/package.json'), 'utf8')).version + '/dist/';
const appGz = zlib.gzipSync(Buffer.from(js), { level: 9 }).toString('base64');
// L'application est compressée (gzip + base64) et décompressée au démarrage : fichier ~3× plus petit.
const boot = `(async()=>{const b=Uint8Array.from(atob(window.__SDC_APP_GZ_B64__),c=>c.charCodeAt(0));const t=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();(0,eval)(t);})().catch(e=>{document.body.insertAdjacentHTML('afterbegin','<p style="padding:20px;font:16px sans-serif;color:#b00">Navigateur non compatible : utiliser Chrome ou Edge récent. ('+e.message+')</p>');});`;
const dataFull = `<script>${dataPdf}window.__SDC_OCCT_JS__=${safe(JSON.stringify(occtJs))};window.__SDC_OCCT_WASM_GZ_B64__="${wasm}";window.__SDC_DEMO_STEP_GZ_B64__="${demo}";window.__SDC_APP_GZ_B64__="${appGz}";</script>`;
const dataLite = `<script>${dataPdf}window.__SDC_OCCT_JS__="";window.__SDC_OCCT_WASM_GZ_B64__="";window.__SDC_OCCT_CDN__="${CDN}";window.__SDC_DEMO_STEP_GZ_B64__="${demo}";window.__SDC_APP_GZ_B64__="${appGz}";</script>`;
const notice = `<!-- SDC Montage 3D — construit le ${new Date().toISOString()} (paquet ${pkg.version}).
Composants tiers embarqués : Three.js (MIT), three-mesh-bvh (MIT), pdf.js (Apache-2.0), occt-import-js (LGPL-2.1) et Open CASCADE Technology (LGPL-2.1 avec exception).
Les licences complètes sont dans node_modules/occt-import-js/dist/ et dans le dépôt. -->\n`;
const template = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
fs.mkdirSync(out, { recursive: true });
for (const [name, data, note] of [['SDC_Montage_3D.html', dataFull, 'complète, hors ligne'], ['SDC_Montage_3D_leger.html', dataLite, 'légère, moteur STEP chargé depuis Internet']]) {
  const html = template.split('/*__CSS__*/').join(css).split('<!--__DATA__-->').join(data).split('/*__JS__*/').join(boot);
  const file = path.join(out, name);
  fs.writeFileSync(file, notice.replace('-->', `Version ${note}. -->`) + html);
  console.log(`${file} — ${(fs.statSync(file).size / 1e6).toFixed(2)} Mo (${note})`);
}
