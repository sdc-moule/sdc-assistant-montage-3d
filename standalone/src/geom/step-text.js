// Certains STEP (exports CAO anciens) contiennent des accents en ISO-8859-1 brut, non conformes à ISO 10303-21.
// OpenCascade les lit comme de l'UTF-8 et produit des noms illisibles (« Inf豩eure »).
// On réécrit, dans une COPIE en mémoire, chaque octet ≥ 0x80 qui ne forme pas de l'UTF-8 valide en \X\HH
// (codage STEP officiel ISO-8859-1). Le fichier source n'est jamais modifié.
export function fixStepLatin1(buf) {
  const u = new Uint8Array(buf);
  let bad = 0;
  const seqLen = i => {
    const b = u[i];
    const n = b >= 0xf0 && b <= 0xf4 ? 4 : b >= 0xe0 ? 3 : b >= 0xc2 && b <= 0xdf ? 2 : 0;
    if (!n || i + n > u.length) return 0;
    for (let k = 1; k < n; k++) if ((u[i + k] & 0xc0) !== 0x80) return 0;
    return n;
  };
  for (let i = 0; i < u.length; i++) { if (u[i] < 0x80) continue; const n = seqLen(i); if (n) i += n - 1; else bad++; }
  if (!bad) return { bytes: buf, fixed: 0 };
  const out = new Uint8Array(u.length + bad * 4);
  const hex = '0123456789ABCDEF';
  let o = 0;
  for (let i = 0; i < u.length; i++) {
    const b = u[i];
    if (b < 0x80) { out[o++] = b; continue; }
    const n = seqLen(i);
    if (n) { for (let k = 0; k < n; k++) out[o++] = u[i + k]; i += n - 1; continue; }
    out[o++] = 0x5c; out[o++] = 0x58; out[o++] = 0x5c; out[o++] = hex.charCodeAt(b >> 4); out[o++] = hex.charCodeAt(b & 15); // \X\HH
  }
  return { bytes: out.buffer.slice(0, o), fixed: bad };
}
