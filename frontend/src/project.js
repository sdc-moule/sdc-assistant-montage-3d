export function validateAssembly(data) {
  if (data?.schema_version !== '1.0' || data.units !== 'mm' || typeof data.assembly_id !== 'string' || !data.assembly_id || typeof data.source_sha256 !== 'string' || !data.source_sha256 || !Array.isArray(data.occurrences) || !data.occurrences.length) throw new Error('Métadonnées invalides : schéma 1.0, millimètres, empreinte et occurrences requis.');
  const ids = new Set();
  for (const item of data.occurrences) {
    if (typeof item.id !== 'string' || !item.id || ['__proto__','constructor','prototype'].includes(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !Array.isArray(item.dimensions_mm) || item.dimensions_mm.length !== 3 || item.dimensions_mm.some(x => !Number.isFinite(x) || x < 0)) throw new Error('Identifiant dupliqué ou dimensions invalides.');
    ids.add(item.id);
  }
  return data;
}

// Une référence ne regroupe des occurrences que si elle a été confirmée.
export function buildBom(occurrences) {
  const rows = new Map();
  for (const item of occurrences) {
    const key = item.reference_confirmed && item.reference ? `ref:${item.reference}` : `id:${item.id}`;
    if (!rows.has(key)) rows.set(key, { ...item, ids: [], quantity: 0, repere: rows.size + 1 });
    const row = rows.get(key); row.quantity++; row.ids.push(item.id);
  }
  return [...rows.values()];
}

export function csv(rows) {
  const cell = x => `"${String(x ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  return '\ufeff' + [['repere','designation','reference','quantite','X_mm','Y_mm','Z_mm','commentaire','statut_validation'], ...rows.map(r => [r.repere,r.name,r.reference,r.quantity,...r.dimensions_mm,r.comment ?? '',r.status ?? 'A_VERIFIER'])].map(row => row.map(cell).join(';')).join('\r\n');
}

export function makeProject(assembly, display, camera, dimensions) {
  return { schema_version: '1.0', assembly_id: assembly.assembly_id, source_sha256: assembly.source_sha256, occurrence_ids: assembly.occurrences.map(x => x.id), display, camera, ...(dimensions ? { dimensions } : {}), status: 'WIP' };
}

// Cotes enregistrées : références (occurrence, indice de face) uniquement ; valeurs recalculées à la restauration.
export function validateDimensions(saved, ids) {
  if (saved === undefined) return;
  const bad = () => { throw new Error('Cotes enregistrées invalides.'); };
  if (!saved || typeof saved !== 'object' || !Number.isInteger(saved.feature_version) || typeof saved.hidden !== 'boolean' || !Array.isArray(saved.items) || saved.items.length > 1000) bad();
  for (const item of saved.items) {
    const count = item?.kind === 'pair' ? 2 : item?.kind === 'round' ? 1 : 0;
    if (!count || typeof item.hidden !== 'boolean' || !Array.isArray(item.refs) || item.refs.length !== count || (item.mode !== undefined && !['diameter', 'radius'].includes(item.mode))) bad();
    for (const ref of item.refs) if (!ids.has(ref?.m) || !Number.isInteger(ref.f) || ref.f < 0) bad();
  }
}

export function validateProject(project, assembly) {
  if (project.schema_version !== '1.0' || project.assembly_id !== assembly.assembly_id || project.source_sha256 !== assembly.source_sha256) throw new Error('Projet incompatible avec cette source : correspondances à vérifier.');
  const ids = new Set(assembly.occurrences.map(x => x.id));
  if (!Array.isArray(project.occurrence_ids) || project.occurrence_ids.length !== ids.size || project.occurrence_ids.some(id => !ids.has(id)) || new Set(project.occurrence_ids).size !== ids.size) throw new Error('Occurrences différentes : restauration refusée.');
  if (!project.display || !Number.isFinite(project.display.explode) || project.display.explode < 0 || project.display.explode > 100 || !['','XZ','YZ','XY'].includes(project.display.section) || !Number.isFinite(project.display.sectionPosition) || project.display.sectionPosition < 0 || project.display.sectionPosition > 100 || typeof project.display.inverse !== 'boolean') throw new Error('État de vue invalide.');
  if (project.display.hatch !== undefined && (!Number.isFinite(project.display.hatch) || project.display.hatch < 0 || project.display.hatch > 100)) throw new Error('État de vue invalide.');
  validateDimensions(project.dimensions, ids);
  for (const item of Object.values(project.display.items ?? {})) if (typeof item.visible !== 'boolean' || !Number.isFinite(item.opacity) || item.opacity < 0 || item.opacity > 1 || typeof item.comment !== 'string') throw new Error('État occurrence invalide.');
  for (const key of ['position','target']) if (!Array.isArray(project.camera?.[key]) || project.camera[key].length !== 3 || project.camera[key].some(x => !Number.isFinite(x))) throw new Error('Caméra invalide.');
  return project;
}
