// Insertion / lecture d'un texte UTF-8 (chunk iTXt) dans un PNG : une capture PNG transporte la scène complète.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function isPng(u) { return u.length > 8 && SIG.every((b, i) => u[i] === b); }

/** Renvoie un nouveau PNG avec le chunk iTXt « keyword » = text inséré avant IEND. */
export function pngWithText(png, keyword, text) {
  const u = new Uint8Array(png);
  if (!isPng(u)) throw new Error('PNG invalide');
  const enc = new TextEncoder();
  const data = new Uint8Array([...enc.encode(keyword), 0, 0, 0, 0, 0, ...enc.encode(text)]);
  const type = enc.encode('iTXt');
  const chunk = new Uint8Array(12 + data.length), dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length); chunk.set(type, 4); chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(new Uint8Array([...type, ...data])));
  const iend = u.length - 12; // IEND est le dernier chunk (12 octets)
  const out = new Uint8Array(u.length + chunk.length);
  out.set(u.subarray(0, iend)); out.set(chunk, iend); out.set(u.subarray(iend), iend + chunk.length);
  return out;
}

/** Lit le texte du chunk iTXt « keyword », ou null. */
export function pngText(png, keyword) {
  const u = new Uint8Array(png);
  if (!isPng(u)) return null;
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), dec = new TextDecoder();
  for (let p = 8; p + 12 <= u.length;) {
    const len = dv.getUint32(p), type = dec.decode(u.subarray(p + 4, p + 8));
    if (type === 'iTXt') {
      const d = u.subarray(p + 8, p + 8 + len), z = d.indexOf(0);
      if (dec.decode(d.subarray(0, z)) === keyword && d[z + 1] === 0) {
        let q = z + 3; q = d.indexOf(0, q) + 1; q = d.indexOf(0, q) + 1; // langue, mot-clé traduit
        return dec.decode(d.subarray(q));
      }
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return null;
}
