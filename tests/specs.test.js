// Garde-fous du cahier des charges : archives intactes, version courante cohérente (JSON ↔ Markdown).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root));
const actuel = JSON.parse(read('specs/ACTUEL.json'));
const integ = JSON.parse(read('specs/INTEGRITE.json'));

test('versions archivées strictement inchangées', () => {
  for (const [v, files] of Object.entries(integ.versions)) for (const [name, sha] of Object.entries(files)) {
    const p = `specs/v${v}/${name}`;
    assert.ok(fs.existsSync(new URL(p, root)), `${p} supprimé : les archives ne doivent jamais être supprimées`);
    assert.equal(crypto.createHash('sha256').update(read(p)).digest('hex'), sha, `${p} modifié : créer une nouvelle version au lieu de modifier une archive`);
  }
});

test('version courante : ids uniques, statuts connus, preuves pour « fait », tableau Markdown aligné', () => {
  const spec = JSON.parse(read(actuel.json));
  const md = read(actuel.md).toString();
  assert.equal(spec.version, actuel.version_courante);
  const ids = new Set();
  for (const e of spec.exigences) {
    assert.match(e.id, /^[A-Z]{3}-\d{2}$/);
    assert.ok(!ids.has(e.id), `id en double : ${e.id}`); ids.add(e.id);
    assert.ok([...spec.statuts_possibles, 'abandonné'].includes(e.statut), `${e.id} : statut inconnu ${e.statut}`);
    const row = md.split('\n').find(l => l.startsWith(`| ${e.id} |`));
    assert.ok(row, `${e.id} absent du tableau du cahier des charges .md`);
    assert.ok(row.includes(`| ${e.statut} |`), `${e.id} : statut différent entre .json et .md`);
  }
  for (const e of spec.exigences.filter(x => x.statut === 'fait' && x.preuve)) assert.ok(e.preuve.length > 0);
});

test('les exigences des versions précédentes ne disparaissent pas (ids conservés)', () => {
  const versions = Object.keys(integ.versions).filter(v => {
    try { return Array.isArray(JSON.parse(read(`specs/v${v}/SDC_Assistant_Montage_3D_v${v.replace('.', '_')}_FR.json`)).exigences); } catch { return false; }
  });
  const cur = new Set(JSON.parse(read(actuel.json)).exigences.map(e => e.id));
  for (const v of versions) for (const e of JSON.parse(read(`specs/v${v}/SDC_Assistant_Montage_3D_v${v.replace('.', '_')}_FR.json`)).exigences) assert.ok(cur.has(e.id), `${e.id} (v${v}) a disparu : passer son statut à « abandonné » au lieu de l'effacer`);
});
