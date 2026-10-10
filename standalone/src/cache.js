// Cache local (IndexedDB) des maillages convertis : la 2ᵉ ouverture d'un même STEP est quasi immédiate.
// Clé = empreinte SHA-256 + finesse d'affichage. Ne concerne que ce navigateur, sur ce poste.
const DB = 'sdc-montage3d-cache', STORE = 'maillages', MAX = 6; // garder les 6 derniers fichiers
function open() {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx(mode, fn) { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode), st = t.objectStore(STORE); const out = fn(st); t.oncomplete = () => { db.close(); res(out instanceof IDBRequest ? out.result : out); }; t.onerror = () => { db.close(); rej(t.error); }; }); }
export async function cacheGet(key) { try { return await tx('readonly', st => st.get(key)) ?? null; } catch { return null; } }
export async function cachePut(key, value) {
  try {
    const keys = await tx('readonly', st => st.getAllKeys());
    const old = (keys ?? []).filter(k => k !== key).slice(0, Math.max(0, keys.length - MAX + 1));
    await tx('readwrite', st => { for (const k of old) st.delete(k); st.put({ ...value, date: Date.now() }, key); });
    return true;
  } catch { return false; } // quota dépassé ou navigation privée : on continue sans cache
}
export async function cacheClear() { try { await tx('readwrite', st => st.clear()); } catch { /* rien */ } }
