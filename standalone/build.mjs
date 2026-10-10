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
const demoPath = path.join(root, 'tests/fixtures/bcr_synthetique.step');
const demo = fs.existsSync(demoPath) ? gz64(demoPath) : '';
const safe = s => s.replaceAll('</', '<\\/');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const data = `<script>window.__SDC_OCCT_JS__=${safe(JSON.stringify(occtJs))};window.__SDC_OCCT_WASM_GZ_B64__="${wasm}";window.__SDC_DEMO_STEP_GZ_B64__="${demo}";</script>`;
const notice = `<!-- SDC Montage 3D — construit le ${new Date().toISOString()} (paquet ${pkg.version}).
Composants tiers embarqués : Three.js (MIT), three-mesh-bvh (MIT), occt-import-js (LGPL-2.1) et Open CASCADE Technology (LGPL-2.1 avec exception).
Les licences complètes sont dans node_modules/occt-import-js/dist/ et dans le dépôt. -->\n`;
let html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
html = html.split('/*__CSS__*/').join(css).split('<!--__DATA__-->').join(data).split('/*__JS__*/').join(safe(js));
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, 'SDC_Montage_3D.html');
fs.writeFileSync(file, notice + html);
console.log(`${file} — ${(fs.statSync(file).size / 1e6).toFixed(2)} Mo`);
