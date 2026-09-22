// ============================================================
//  Rfoof – application state & repositories
// ============================================================
import { db } from './db.js';
import { Emitter, uid, now, makeComparator } from './utils.js';
import { normalize, searchKey } from './search.js';
import { locale } from './i18n.js';

export const COLORS = {
  red: '#e5484d', orange: '#f76b15', amber: '#f2a93b', green: '#30a46c', teal: '#12a594', blue: '#3b82f6',
  indigo: '#5b5bd6', purple: '#8e4ec6', pink: '#e93d82', brown: '#a1705b', gray: '#8b8d98', slate: '#4b5563',
};
export const COLOR_KEYS = Object.keys(COLORS);

const DEFAULT_SETTINGS = {
  theme: 'system', accent: 'blue', density: 'medium', layout: 'grid',
  sort: { field: 'addedAt', dir: -1 },
  template: '{name}', askOnImport: true, autoSync: true, keepOffline: false,
  welcomeDone: false, lastSync: 0, deltaLink: '', detailsOpen: true, sidebarOpen: true, contentSearch: true,
  expanded: {}, account: null, remoteRootId: '', tombstoneDays: 30,
};

class Store extends Emitter {
  constructor() {
    super();
    this.folders = new Map();
    this.files = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
    this.view = { type: 'all' };
    this.selection = new Set();
    this.ready = false;
    this.thumbUrls = new Map();     // id -> objectURL cache
    this.pendingCount = 0;
  }

  // ---------------- init ----------------
  async init() {
    const [folders, files, settings, queue] = await Promise.all([
      db.getAll('folders'), db.getAll('files'), db.getAll('settings'), db.count('queue'),
    ]);
    for (const s of settings) this.settings[s.key] = s.value;
    for (const f of folders) this.folders.set(f.id, f);
    for (const f of files) { this._decorate(f); this.files.set(f.id, f); }
    this.pendingCount = queue;
    this.ready = true;
    this.emit('ready');
    this._gcTombstones().catch(() => {});
  }

  _decorate(f) {
    f._titleN = normalize(f.title || '');
    f._tagsN = normalize((f.tags || []).join(' '));
    f._key = searchKey(f, this.folderPathString(f.folderId, ' / '));
    return f;
  }
  redecorateAll() { for (const f of this.files.values()) this._decorate(f); }

  async _gcTombstones() {
    const cutoff = now() - (this.settings.tombstoneDays || 30) * 86400000;
    const dead = [];
    for (const f of this.files.values()) if (f.purged && f.deletedAt && f.deletedAt < cutoff && !f.remoteId) dead.push(f.id);
    for (const f of this.folders.values()) if (f.purged && f.deletedAt && f.deletedAt < cutoff && !f.remoteId) dead.push(f.id);
    if (!dead.length) return;
    for (const id of dead) { this.files.delete(id); this.folders.delete(id); }
    await db.bulkDelete('files', dead.filter(id => !this.folders.has(id)));
    await db.bulkDelete('folders', dead);
  }

  // ---------------- settings ----------------
  async setSetting(key, value) {
    this.settings[key] = value;
    await db.setSetting(key, value);
    this.emit('settings', key, value);
  }

  // ---------------- folders ----------------
  folder(id) { return id ? this.folders.get(id) : null; }
  liveFolders() { return Array.from(this.folders.values()).filter(f => !f.deletedAt); }
  childFolders(parentId = '') {
    const coll = new Intl.Collator(locale(), { numeric: true, sensitivity: 'base' });
    return this.liveFolders().filter(f => (f.parentId || '') === (parentId || '')).sort((a, b) => (a.order - b.order) || coll.compare(a.name, b.name));
  }
  folderPath(id) {
    const path = []; let cur = this.folder(id); let guard = 0;
    while (cur && guard++ < 50) { path.unshift(cur); cur = this.folder(cur.parentId); }
    return path;
  }
  folderPathString(id, sep = ' / ') { return this.folderPath(id).map(f => f.name).join(sep); }
  isDescendant(folderId, ancestorId) {
    let cur = this.folder(folderId); let guard = 0;
    while (cur && guard++ < 50) { if (cur.id === ancestorId) return true; cur = this.folder(cur.parentId); }
    return false;
  }
  descendantFolderIds(id) {
    const out = new Set([id]);
    const walk = (pid) => { for (const f of this.folders.values()) if (!f.deletedAt && f.parentId === pid && !out.has(f.id)) { out.add(f.id); walk(f.id); } };
    walk(id);
    return out;
  }
  folderStats(id) {
    let files = 0, size = 0;
    for (const f of this.files.values()) if (!f.deletedAt && f.folderId === id) { files++; size += f.size || 0; }
    const folders = this.childFolders(id).length;
    return { files, folders, size };
  }

  async createFolder({ name, color = 'blue', icon = 'folder', parentId = '' }) {
    const ts = now();
    const rec = { id: uid(), name: name.trim(), color, icon, parentId: parentId || '', order: 0, createdAt: ts, updatedAt: ts, deletedAt: 0, remoteId: '', syncState: 'pending' };
    this.folders.set(rec.id, rec);
    await db.put('folders', rec);
    await this.enqueue({ op: 'folder', id: rec.id });
    this.emit('folders');
    return rec;
  }
  async updateFolder(id, patch, { sync = true } = {}) {
    const f = this.folder(id); if (!f) return null;
    Object.assign(f, patch, { updatedAt: now() });
    if (sync) f.syncState = 'pending';
    await db.put('folders', f);
    if (sync) await this.enqueue({ op: 'folder', id });
    if ('name' in patch || 'parentId' in patch) this.redecorateAll();
    this.emit('folders');
    return f;
  }
  async trashFolder(id) {
    const ids = this.descendantFolderIds(id);
    const ts = now();
    const fileIds = [];
    for (const f of this.files.values()) if (!f.deletedAt && ids.has(f.folderId)) fileIds.push(f.id);
    await this.trashFiles(fileIds, { silent: true });
    for (const fid of ids) {
      const f = this.folder(fid); if (!f) continue;
      f.deletedAt = ts; f.updatedAt = ts; f.syncState = 'pending';
      await db.put('folders', f);
      await this.enqueue({ op: 'folderDelete', id: fid });
    }
    if (this.view.type === 'folder' && ids.has(this.view.id)) this.navigate({ type: 'all' });
    this.emit('folders'); this.emit('files');
    return { folders: ids.size, files: fileIds.length };
  }
  async restoreFolder(id) {
    const f = this.folder(id); if (!f) return;
    const ts = now();
    // restore ancestors if they are deleted
    for (const p of this.folderPath(id)) if (p.deletedAt) { p.deletedAt = 0; p.updatedAt = ts; p.syncState = 'pending'; await db.put('folders', p); await this.enqueue({ op: 'folder', id: p.id }); }
    f.deletedAt = 0; f.updatedAt = ts; f.syncState = 'pending';
    await db.put('folders', f);
    await this.enqueue({ op: 'folder', id });
    this.emit('folders');
  }
  async purgeFolder(id) {
    const f = this.folder(id); if (!f) return;
    f.purged = true; f.deletedAt = f.deletedAt || now(); f.updatedAt = now();
    await db.put('folders', f);
    await this.enqueue({ op: 'folderDelete', id });
    this.emit('folders');
  }

  // ---------------- files ----------------
  file(id) { return this.files.get(id); }
  liveFiles() { return Array.from(this.files.values()).filter(f => !f.deletedAt); }
  trashedItems() {
    const files = Array.from(this.files.values()).filter(f => f.deletedAt && !f.purged);
    const folders = Array.from(this.folders.values()).filter(f => f.deletedAt && !f.purged && !(f.parentId && this.folder(f.parentId)?.deletedAt));
    return { files, folders };
  }
  filesIn(folderId) { return this.liveFiles().filter(f => (f.folderId || '') === (folderId || '')); }

  async createFile(rec, blob, { thumb = null } = {}) {
    const ts = now();
    const file = {
      id: rec.id || uid(), folderId: rec.folderId || '', title: rec.title || 'Untitled', originalName: rec.originalName || '',
      ext: rec.ext || '', kind: rec.kind || 'other', mime: rec.mime || '', size: rec.size || (blob ? blob.size : 0),
      tags: rec.tags || [], notes: rec.notes || '', color: rec.color || '', starred: !!rec.starred,
      createdAt: rec.createdAt || ts, updatedAt: ts, addedAt: ts, deletedAt: 0, hasBlob: !!blob, thumb: !!thumb, indexed: false,
      remoteId: rec.remoteId || '', remoteEtag: rec.remoteEtag || '', remoteName: rec.remoteName || '', remoteParentId: rec.remoteParentId || '',
      syncState: rec.syncState || 'pending', hash: rec.hash || '', lastOpened: 0,
    };
    this._decorate(file);
    this.files.set(file.id, file);
    await db.tx(['files', 'blobs', 'thumbs'], 'readwrite', (t) => {
      t.objectStore('files').put(file);
      if (blob) t.objectStore('blobs').put({ id: file.id, blob });
      if (thumb) t.objectStore('thumbs').put({ id: file.id, blob: thumb });
      return Promise.resolve();
    });
    if (file.syncState === 'pending') await this.enqueue({ op: 'file', id: file.id });
    this.emit('files');
    return file;
  }

  async updateFile(id, patch, { sync = true, emit = true } = {}) {
    const f = this.file(id); if (!f) return null;
    Object.assign(f, patch);
    if (sync) { f.updatedAt = now(); f.syncState = 'pending'; }
    this._decorate(f);
    await db.put('files', this._plain(f));
    if (sync) await this.enqueue({ op: 'file', id });
    if (emit) this.emit('files', [id]);
    return f;
  }
  _plain(f) { const o = { ...f }; for (const k of Object.keys(o)) if (k.startsWith('_')) delete o[k]; return o; }

  async bulkUpdate(ids, patchFn, { sync = true } = {}) {
    const ts = now(); const recs = [];
    for (const id of ids) {
      const f = this.file(id); if (!f) continue;
      const patch = typeof patchFn === 'function' ? patchFn(f) : patchFn;
      Object.assign(f, patch);
      if (sync) { f.updatedAt = ts; f.syncState = 'pending'; }
      this._decorate(f); recs.push(this._plain(f));
    }
    await db.bulkPut('files', recs);
    if (sync) for (const r of recs) await this.enqueue({ op: 'file', id: r.id });
    this.emit('files', ids);
  }

  moveFiles(ids, folderId) { return this.bulkUpdate(ids, { folderId: folderId || '' }); }

  async trashFiles(ids, { silent = false } = {}) {
    const ts = now();
    await this.bulkUpdate(ids, { deletedAt: ts });
    for (const id of ids) this.selection.delete(id);
    if (!silent) this.emit('selection');
    return ids.length;
  }
  async restoreFiles(ids) {
    await this.bulkUpdate(ids, (f) => ({ deletedAt: 0, folderId: this.folder(f.folderId) && !this.folder(f.folderId).deletedAt ? f.folderId : '' }));
  }
  async purgeFiles(ids) {
    const ts = now();
    for (const id of ids) {
      const f = this.file(id); if (!f) continue;
      f.purged = true; f.deletedAt = f.deletedAt || ts; f.updatedAt = ts; f.hasBlob = false; f.thumb = false;
      this.revokeThumb(id);
      await db.tx(['files', 'blobs', 'thumbs', 'texts', 'words', 'previews'], 'readwrite', (t) => {
        t.objectStore('files').put(this._plain(f));
        for (const s of ['blobs', 'thumbs', 'texts', 'words', 'previews']) t.objectStore(s).delete(id);
        return Promise.resolve();
      });
      await this.enqueue({ op: 'fileDelete', id });
      this.selection.delete(id);
    }
    this.emit('files', ids); this.emit('selection');
  }
  async emptyTrash() {
    const { files, folders } = this.trashedItems();
    await this.purgeFiles(files.map(f => f.id));
    // all deleted folders (including nested)
    for (const f of Array.from(this.folders.values())) if (f.deletedAt && !f.purged) await this.purgeFolder(f.id);
    this.emit('folders');
  }

  // insert records coming from the cloud (no sync queue entry)
  async adoptFolder(rec) {
    const fo = { order: 0, color: 'gray', icon: 'folder', parentId: '', deletedAt: 0, ...rec };
    this.folders.set(fo.id, fo);
    await db.put('folders', fo);
    this.redecorateAll();
    this.emit('folders');
    return fo;
  }
  async adoptFile(rec) {
    const f = { tags: [], notes: '', color: '', starred: false, deletedAt: 0, hasBlob: false, thumb: false, indexed: false, lastOpened: 0, ...rec };
    this._decorate(f);
    this.files.set(f.id, f);
    await db.put('files', this._plain(f));
    this.emit('files', [f.id]);
    return f;
  }

  // physically remove a record that no longer exists anywhere (used by sync)
  async hardDelete(id) {
    this.files.delete(id); this.folders.delete(id); this.revokeThumb(id);
    await db.tx(['files', 'folders', 'blobs', 'thumbs', 'texts', 'words', 'previews'], 'readwrite', (t) => {
      for (const s of ['files', 'folders', 'blobs', 'thumbs', 'texts', 'words', 'previews']) t.objectStore(s).delete(id);
      return Promise.resolve();
    });
  }

  // ---------------- blobs / thumbs / text ----------------
  async getBlob(id) { const r = await db.get('blobs', id); return r ? r.blob : null; }
  async putBlob(id, blob) {
    await db.put('blobs', { id, blob });
    const f = this.file(id); if (f) { f.hasBlob = true; f.size = f.size || blob.size; await db.put('files', this._plain(f)); this.emit('files', [id]); }
  }
  async removeBlob(id) {
    await db.delete('blobs', id);
    const f = this.file(id); if (f) { f.hasBlob = false; await db.put('files', this._plain(f)); this.emit('files', [id]); }
  }
  async setThumb(id, blob) {
    await db.put('thumbs', { id, blob });
    this.revokeThumb(id);
    const f = this.file(id); if (f) { f.thumb = true; await db.put('files', this._plain(f)); this.emit('thumb', id); }
  }
  async thumbURL(id) {
    if (this.thumbUrls.has(id)) return this.thumbUrls.get(id);
    const r = await db.get('thumbs', id);
    if (!r) return null;
    const url = URL.createObjectURL(r.blob);
    this.thumbUrls.set(id, url);
    if (this.thumbUrls.size > 600) { const first = this.thumbUrls.keys().next().value; this.revokeThumb(first); }
    return url;
  }
  revokeThumb(id) { const u = this.thumbUrls.get(id); if (u) { URL.revokeObjectURL(u); this.thumbUrls.delete(id); } }
  async getText(id) { const r = await db.get('texts', id); return r ? r.text : ''; }
  async setIndex(id, text, words) {
    await db.tx(['texts', 'words', 'files'], 'readwrite', (t) => {
      if (text) t.objectStore('texts').put({ id, text }); else t.objectStore('texts').delete(id);
      if (words && words.length) t.objectStore('words').put({ id, w: words }); else t.objectStore('words').delete(id);
      return Promise.resolve();
    });
    const f = this.file(id); if (f) { f.indexed = true; await db.put('files', this._plain(f)); }
  }
  async getPreview(id) { return db.get('previews', id); }
  async setPreview(id, blob, etag) { return db.put('previews', { id, blob, etag }); }

  // ---------------- tags ----------------
  tagIndex() {
    const m = new Map();
    for (const f of this.files.values()) if (!f.deletedAt) for (const t of f.tags || []) m.set(t, (m.get(t) || 0) + 1);
    return new Map(Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  }
  kindIndex() {
    const m = new Map();
    for (const f of this.files.values()) if (!f.deletedAt) m.set(f.kind, (m.get(f.kind) || 0) + 1);
    return m;
  }

  // ---------------- sync queue ----------------
  async enqueue(op) {
    await db.put('queue', { ...op, ts: now() });
    this.pendingCount = await db.count('queue');
    this.emit('queue', this.pendingCount);
  }
  getQueue() { return db.getAll('queue'); }
  async dequeue(seqs) {
    await db.bulkDelete('queue', seqs);
    this.pendingCount = await db.count('queue');
    this.emit('queue', this.pendingCount);
  }
  async clearQueue() { await db.clear('queue'); this.pendingCount = 0; this.emit('queue', 0); }

  // ---------------- navigation & selection ----------------
  navigate(view) {
    this.view = view;
    this.selection.clear();
    this.emit('nav', view);
    this.emit('selection');
  }
  select(ids, mode = 'replace') {
    if (mode === 'replace') { this.selection.clear(); for (const id of ids) this.selection.add(id); }
    else if (mode === 'toggle') for (const id of ids) { if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); }
    else if (mode === 'add') for (const id of ids) this.selection.add(id);
    this.emit('selection');
  }
  clearSelection() { if (this.selection.size) { this.selection.clear(); this.emit('selection'); } }

  // Items for the current view: {folders:[], files:[]}
  currentItems() {
    const v = this.view;
    let files = [], folders = [];
    switch (v.type) {
      case 'all': files = this.liveFiles(); folders = this.childFolders(''); break;
      case 'folder': files = this.filesIn(v.id); folders = this.childFolders(v.id); break;
      case 'recent': files = this.liveFiles().sort((a, b) => (Math.max(b.lastOpened, b.addedAt) - Math.max(a.lastOpened, a.addedAt))).slice(0, 200); break;
      case 'starred': files = this.liveFiles().filter(f => f.starred); break;
      case 'tag': files = this.liveFiles().filter(f => (f.tags || []).includes(v.tag)); break;
      case 'kind': files = this.liveFiles().filter(f => f.kind === v.kind); break;
      case 'cloud': files = this.liveFiles().filter(f => !f.hasBlob); break;
      case 'trash': { const t = this.trashedItems(); files = t.files; folders = t.folders; break; }
      case 'search': files = v.results ? v.results.map(r => r.file) : []; break;
    }
    if (v.type !== 'recent' && v.type !== 'search') {
      const s = this.settings.sort || { field: 'addedAt', dir: -1 };
      const cmp = makeComparator(s.field === 'title' ? 'title' : s.field, s.dir, locale());
      files = files.slice().sort(cmp);
    }
    return { folders, files };
  }
}

export const store = new Store();
