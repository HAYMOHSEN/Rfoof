// ============================================================
//  Rfoof – IndexedDB storage layer (no dependencies)
// ============================================================
const DB_NAME = 'rfoof';
const DB_VERSION = 1;

/*
  Stores:
   folders  {id, parentId, name, color, icon, order, createdAt, updatedAt, deletedAt, remoteId}
   files    {id, folderId, title, originalName, ext, kind, mime, size, tags[], notes, color, starred,
             createdAt, updatedAt, deletedAt, addedAt, hasBlob, thumb, indexed, remoteId, remoteEtag,
             remoteName, remoteParentId, syncState}
   blobs    {id, blob}
   thumbs   {id, blob}
   previews {id, blob, etag}        cloud-converted PDF previews
   texts    {id, text}              extracted text (for preview & fallback search)
   words    {id, w[]}               inverted index (multiEntry)
   settings {key, value}
   queue    {seq, op, id, ts, ...}  pending sync operations
*/

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const has = n => db.objectStoreNames.contains(n);
      if (!has('folders')) {
        const s = db.createObjectStore('folders', { keyPath: 'id' });
        s.createIndex('parentId', 'parentId');
        s.createIndex('remoteId', 'remoteId');
      }
      if (!has('files')) {
        const s = db.createObjectStore('files', { keyPath: 'id' });
        s.createIndex('folderId', 'folderId');
        s.createIndex('updatedAt', 'updatedAt');
        s.createIndex('remoteId', 'remoteId');
      }
      if (!has('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!has('thumbs')) db.createObjectStore('thumbs', { keyPath: 'id' });
      if (!has('previews')) db.createObjectStore('previews', { keyPath: 'id' });
      if (!has('texts')) db.createObjectStore('texts', { keyPath: 'id' });
      if (!has('words')) {
        const s = db.createObjectStore('words', { keyPath: 'id' });
        s.createIndex('w', 'w', { multiEntry: true });
      }
      if (!has('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!has('queue')) {
        const s = db.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true });
        s.createIndex('id', 'id');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('IndexedDB open blocked');
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

async function tx(stores, mode, fn) {
  const db = await openDB();
  const t = db.transaction(stores, mode);
  const result = await fn(t);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); });
  return result;
}

export const db = {
  tx,
  get: (store, key) => tx([store], 'readonly', t => reqToPromise(t.objectStore(store).get(key))),
  getAll: (store, query, count) => tx([store], 'readonly', t => reqToPromise(t.objectStore(store).getAll(query, count))),
  getAllKeys: (store) => tx([store], 'readonly', t => reqToPromise(t.objectStore(store).getAllKeys())),
  put: (store, value) => tx([store], 'readwrite', t => reqToPromise(t.objectStore(store).put(value))),
  bulkPut: (store, values) => tx([store], 'readwrite', t => { const s = t.objectStore(store); for (const v of values) s.put(v); return Promise.resolve(); }),
  delete: (store, key) => tx([store], 'readwrite', t => reqToPromise(t.objectStore(store).delete(key))),
  bulkDelete: (store, keys) => tx([store], 'readwrite', t => { const s = t.objectStore(store); for (const k of keys) s.delete(k); return Promise.resolve(); }),
  clear: (store) => tx([store], 'readwrite', t => reqToPromise(t.objectStore(store).clear())),
  count: (store) => tx([store], 'readonly', t => reqToPromise(t.objectStore(store).count())),
  byIndex: (store, index, value) => tx([store], 'readonly', t => reqToPromise(t.objectStore(store).index(index).getAll(value))),

  // settings helpers
  async getSetting(key, def) { const r = await this.get('settings', key); return r ? r.value : def; },
  setSetting(key, value) { return this.put('settings', { key, value }); },

  // inverted index prefix query -> Set of ids
  async wordPrefix(prefix, limit = 5000) {
    const dbi = await openDB();
    return new Promise((res, rej) => {
      const ids = new Set();
      const t = dbi.transaction(['words'], 'readonly');
      const idx = t.objectStore('words').index('w');
      const range = IDBKeyRange.bound(prefix, prefix + '￿');
      const req = idx.openKeyCursor(range);
      req.onsuccess = () => {
        const c = req.result;
        if (c && ids.size < limit) { ids.add(c.primaryKey); c.continue(); } else res(ids);
      };
      req.onerror = () => rej(req.error);
    });
  },

  async wipe() {
    const dbi = await openDB();
    const names = Array.from(dbi.objectStoreNames);
    await tx(names, 'readwrite', t => { for (const n of names) t.objectStore(n).clear(); return Promise.resolve(); });
  },

  /**
   * Usage and free space as far as they can be known.
   * Since Chrome / Edge 144 the browser reports quota = usage + min(10 GiB, free disk space) so that
   * sites can't detect private browsing; the real limit (about 60% of the disk, within the free
   * space) did not change. When the reported headroom is exactly that 10 GiB cap, all we know is
   * "at least 10 GiB" → capped: true.
   */
  async storageInfo() {
    const { usage = 0, quota = 0 } = await this.estimate();
    const free = Math.max(0, quota - usage);
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    const chromium = /(Chrome|Chromium|Edg)\//.test(ua) && !/Firefox\//.test(ua);
    const cap = 10 * 1024 ** 3;
    return { usage, quota, free, capped: chromium && Math.abs(free - cap) <= 16 * 1024 ** 2 };
  },
  async estimate() {
    try { return await navigator.storage.estimate(); } catch { return { usage: 0, quota: 0 }; }
  },
  async persist() {
    try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
    return false;
  },
  async persisted() {
    try { return await navigator.storage.persisted(); } catch { return false; }
  },
};
