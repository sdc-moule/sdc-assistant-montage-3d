// Produit un fichier HTML autonome (JS, CSS et démonstration intégrés), utilisable par double-clic (file://).
// Le moteur STEP local n'est pas disponible dans ce mode : ouverture GLB + JSON et démonstration seulement.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const dist = 'dist', out = 'standalone';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const demo = readFileSync('public/examples/demo/assembly.json');
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${readFileSync(join(dist, href.replace(/^\//, '')), 'utf8')}</style>`);
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  let js = readFileSync(join(dist, src.replace(/^\//, '')), 'utf8');
  js = js.replaceAll('/examples/demo/assembly.json', `data:application/json;base64,${demo.toString('base64')}`).replaceAll('</script', '<\\/script');
  return `<script type="module">${js}</script>`;
});
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'SDC-Assistant-Montage-3D.html'), html);
console.log(`${out}/SDC-Assistant-Montage-3D.html : ${(html.length / 1024).toFixed(0)} Ko`);
