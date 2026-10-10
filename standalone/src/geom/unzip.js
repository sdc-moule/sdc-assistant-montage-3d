// Extraction d'un fichier d'une archive ZIP (méthodes « stocké » et « deflate »), sans dépendance.
// Utilise DecompressionStream('deflate-raw') (Chrome/Edge ≥ 103, Node ≥ 21).

const CAD = /\.(step|stp|iges|igs|brep)$/i;

/** Liste les entrées du répertoire central. */
export function zipEntries(buf) {
  const u = new Uint8Array(buf), v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let eocd = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('archive ZIP illisible.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  if (p === 0xffffffff) throw new Error('archive ZIP64 non prise en charge : compresser en ZIP standard (< 4 Go).');
  const out = [], dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('répertoire ZIP corrompu.');
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nlen));
    out.push({ name, method, csize, size, local, encrypted: !!(flags & 1) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** Renvoie { name, bytes } du premier fichier CAO trouvé dans l'archive. */
export async function extractCadFromZip(buf) {
  const entries = zipEntries(buf).filter(e => CAD.test(e.name) && !e.name.startsWith('__MACOSX/'));
  if (!entries.length) throw new Error('aucun fichier STEP / STP / IGES dans l\'archive.');
  const e = entries.sort((a, b) => b.size - a.size)[0]; // le plus gros si plusieurs
  if (e.encrypted) throw new Error('archive protégée par mot de passe : non prise en charge.');
  const u = new Uint8Array(buf), v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (v.getUint32(e.local, true) !== 0x04034b50) throw new Error('entrée ZIP corrompue.');
  const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
  const data = u.slice(start, start + e.csize);
  let bytes;
  if (e.method === 0) bytes = data;
  else if (e.method === 8) bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  else throw new Error(`méthode de compression ${e.method} non prise en charge (utiliser ZIP « deflate » standard).`);
  if (bytes.length !== e.size) throw new Error('décompression incomplète.');
  return { name: e.name.split('/').pop(), bytes: bytes.buffer, others: entries.length - 1 };
}
