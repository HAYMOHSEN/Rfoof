// ============================================================
//  Rfoof – OneDrive sync engine
//  Layout inside the user's OneDrive (Apps/Rfoof):
//     rfoof-index.json        library metadata (folders, titles, tags, notes…)
//     <Folder>/<Sub>/<Title>.<ext>   the files, mirrored as real folders
//     .Trash/                 files waiting in the app's trash
// ============================================================
import { Emitter, sanitizeFileName, now, isOnline, kindOf, extOf, baseName, mimeOf, uid } from './utils.js';

export const INDEX_NAME = 'rfoof-index.json';
export const TRASH_NAME = '.Trash';
const FOLDER_FIELDS = ['name', 'color', 'icon', 'parentId', 'order', 'deletedAt', 'purged', 'createdAt', 'updatedAt'];
const FILE_FIELDS = ['folderId', 'title', 'originalName', 'ext', 'kind', 'mime', 'size', 'tags', 'notes', 'color', 'starred', 'createdAt', 'updatedAt', 'addedAt', 'deletedAt', 'purged', 'hash'];
const REMOTE_FIELDS = ['remoteId', 'remoteName', 'remoteParentId', 'remoteEtag', 'remoteWanted'];
// content tag: changes only when the file bytes change (falls back to eTag)
const ctag = (it) => (it && (it.cTag || it.eTag)) || '';

export class SyncEngine extends Emitter {
  /**
   * @param {object} store   application store (see store.js)
   * @param {object} graph   GraphClient
   * @param {object} opts    {auth, indexer, log}
   */
  constructor(store, graph, opts = {}) {
    super();
    this.store = store; this.graph = graph; this.auth = opts.auth; this.indexer = opts.indexer;
    this.running = false; this.again = false; this.rootId = ''; this.trashId = '';
    this.status = { state: 'idle', message: '', progress: null };
    this.downloads = new Map();
    this.log = opts.log || (() => {});
  }

  setStatus(state, message = '', progress = null) {
    this.status = { state, message, progress };
    this.emit('status', this.status);
  }

  canSync() { return !!(this.auth ? this.auth.isSignedIn() : true) && isOnline(); }

  // ---------- helpers ----------
  fileRemoteName(f) {
    const base = sanitizeFileName(f.title || baseName(f.originalName) || 'untitled');
    if (!f.ext) return base;
    return base.toLowerCase().endsWith('.' + f.ext) ? base : `${base}.${f.ext}`;
  }
  folderRemoteName(fo) { return sanitizeFileName(fo.name || 'Folder'); }

  async ensureRoot() {
    if (this.rootId) return this.rootId;
    const root = await this.graph.approot();
    this.rootId = root.id;
    if (this.store.settings.remoteRootId !== root.id) await this.store.setSetting('remoteRootId', root.id);
    return this.rootId;
  }
  async ensureTrash() {
    if (this.trashId) return this.trashId;
    const t = await this.graph.ensureFolder(await this.ensureRoot(), TRASH_NAME);
    this.trashId = t.id;
    return this.trashId;
  }

  // Ensure the remote folder for a local folder exists; returns remote id. Creates parents recursively.
  async ensureFolderRemote(folderId, depth = 0) {
    if (!folderId) return this.ensureRoot();
    const fo = this.store.folder(folderId);
    if (!fo || depth > 40) return this.ensureRoot();
    if (fo.deletedAt) return this.ensureTrash();
    const parentRemote = await this.ensureFolderRemote(fo.parentId, depth + 1);
    const wanted = this.folderRemoteName(fo);
    if (fo.remoteId) {
      if (fo.remoteParentId !== parentRemote || fo.remoteWanted !== wanted) {
        try {
          const it = await this.graph.move(fo.remoteId, parentRemote, wanted);
          await this.store.updateFolder(fo.id, { remoteParentId: parentRemote, remoteName: it.name, remoteWanted: wanted, syncState: 'synced' }, { sync: false });
        } catch (e) {
          if (e.status === 404) { await this.store.updateFolder(fo.id, { remoteId: '' }, { sync: false }); return this.ensureFolderRemote(folderId, depth); }
          throw e;
        }
      }
      return fo.remoteId;
    }
    const it = await this.graph.ensureFolder(parentRemote, wanted);
    await this.store.updateFolder(fo.id, { remoteId: it.id, remoteParentId: parentRemote, remoteName: it.name, remoteWanted: wanted, syncState: 'synced' }, { sync: false });
    return it.id;
  }

  // ---------- push ----------
  async pushFolder(id) {
    const fo = this.store.folder(id); if (!fo) return;
    if (fo.purged || fo.deletedAt) {
      if (fo.remoteId) {
        // files inside were already moved to .Trash by their own ops; delete the (now empty) remote folder
        await this.graph.delete(fo.remoteId);
        await this.store.updateFolder(id, { remoteId: '', remoteParentId: '', remoteName: '', remoteWanted: '', syncState: fo.purged ? 'synced' : 'synced' }, { sync: false });
      }
      return;
    }
    await this.ensureFolderRemote(id);
    await this.store.updateFolder(id, { syncState: 'synced' }, { sync: false });
  }

  async pushFile(id) {
    const f = this.store.file(id); if (!f) return;
    if (f.purged) {
      if (f.remoteId) { await this.graph.delete(f.remoteId); await this.store.updateFile(id, { remoteId: '', remoteEtag: '', remoteName: '', remoteParentId: '', remoteWanted: '' }, { sync: false, emit: false }); }
      return;
    }
    const parentRemote = f.deletedAt ? await this.ensureTrash() : await this.ensureFolderRemote(f.folderId);
    const wanted = this.fileRemoteName(f);
    if (!f.remoteId) {
      const blob = await this.store.getBlob(id);
      if (!blob) { await this.store.updateFile(id, { syncState: 'synced' }, { sync: false }); return; } // nothing to upload (cloud-only record)
      this.setStatus('syncing', 'uploading:' + f.title);
      const it = await this.graph.upload(parentRemote, wanted, blob, (done, total) => this.setStatus('syncing', 'uploading:' + f.title, { done, total }));
      await this.store.updateFile(id, { remoteId: it.id, remoteEtag: ctag(it), remoteName: it.name, remoteParentId: parentRemote, remoteWanted: wanted, syncState: 'synced' }, { sync: false });
      return;
    }
    if (f.remoteParentId !== parentRemote || f.remoteWanted !== wanted) {
      try {
        const it = await this.graph.move(f.remoteId, parentRemote, wanted);
        await this.store.updateFile(id, { remoteName: it.name, remoteParentId: parentRemote, remoteWanted: wanted, remoteEtag: ctag(it) || f.remoteEtag, syncState: 'synced' }, { sync: false });
      } catch (e) {
        if (e.status === 404) { await this.store.updateFile(id, { remoteId: '' }, { sync: false, emit: false }); return this.pushFile(id); }
        throw e;
      }
      return;
    }
    await this.store.updateFile(id, { syncState: 'synced' }, { sync: false });
  }

  async push() {
    const queue = await this.store.getQueue();
    if (!queue.length) return 0;
    // de-duplicate by id keeping the last op, order: folders (parents first) → files → folder deletes
    const byId = new Map();
    for (const q of queue) byId.set(q.id, q);
    const ops = Array.from(byId.values());
    const depth = (fid) => { let d = 0, cur = this.store.folder(fid); while (cur && cur.parentId && d < 50) { d++; cur = this.store.folder(cur.parentId); } return d; };
    const folderOps = ops.filter(o => o.op === 'folder').sort((a, b) => depth(a.id) - depth(b.id));
    const fileOps = ops.filter(o => o.op === 'file' || o.op === 'fileDelete');
    const folderDeletes = ops.filter(o => o.op === 'folderDelete').sort((a, b) => depth(b.id) - depth(a.id));
    let n = 0; const total = ops.length;
    const run = async (op, fn) => {
      this.setStatus('syncing', '', { done: n, total });
      await fn();
      n++;
      // remove every queue entry for this id that existed when the push started
      await this.store.dequeue(queue.filter(q => q.id === op.id).map(q => q.seq));
    };
    for (const op of folderOps) await run(op, () => this.pushFolder(op.id));
    for (const op of fileOps) await run(op, () => this.pushFile(op.id));
    for (const op of folderDeletes) await run(op, () => this.pushFolder(op.id));
    return n;
  }

  // ---------- index ----------
  buildIndex() {
    const pick = (o, fields) => { const r = { id: o.id }; for (const k of fields) if (o[k] !== undefined) r[k] = o[k]; return r; };
    return {
      version: 1, app: 'rfoof', updatedAt: now(), device: this.store.settings.deviceId || '',
      folders: Array.from(this.store.folders.values()).map(fo => pick(fo, [...FOLDER_FIELDS, ...REMOTE_FIELDS])),
      files: Array.from(this.store.files.values()).map(f => pick(f, [...FILE_FIELDS, ...REMOTE_FIELDS])),
    };
  }

  async mergeIndex(remote) {
    if (!remote || !Array.isArray(remote.folders)) return { changed: false };
    let changed = false;
    const pendingIds = new Set((await this.store.getQueue()).map(q => q.id));
    for (const r of remote.folders) {
      const l = this.store.folder(r.id);
      if (!l) {
        if (r.purged) continue;
        const rec = { ...r, id: r.id, syncState: 'synced' };
        await this.store.adoptFolder(rec);
        changed = true;
      } else if ((r.updatedAt || 0) > (l.updatedAt || 0)) {
        const patch = {};
        for (const k of [...FOLDER_FIELDS, ...REMOTE_FIELDS]) if (r[k] !== undefined) patch[k] = r[k];
        if (!pendingIds.has(l.id)) patch.syncState = 'synced';
        await this.store.updateFolder(l.id, patch, { sync: false });
        changed = true;
      } else if (!l.remoteId && r.remoteId && !pendingIds.has(l.id)) {
        await this.store.updateFolder(l.id, { remoteId: r.remoteId, remoteName: r.remoteName, remoteParentId: r.remoteParentId, remoteWanted: r.remoteWanted }, { sync: false });
      }
    }
    for (const r of remote.files || []) {
      const l = this.store.file(r.id);
      if (!l) {
        if (r.purged) continue;
        await this.store.adoptFile({ ...r, hasBlob: false, thumb: false, indexed: false, syncState: 'synced' });
        changed = true;
      } else if ((r.updatedAt || 0) > (l.updatedAt || 0)) {
        if (r.purged && !l.purged) { await this.store.hardDelete(l.id); changed = true; continue; }
        const patch = {};
        for (const k of [...FILE_FIELDS, ...REMOTE_FIELDS]) if (r[k] !== undefined) patch[k] = r[k];
        if (!pendingIds.has(l.id)) patch.syncState = 'synced';
        await this.store.updateFile(l.id, patch, { sync: false, emit: false });
        changed = true;
      } else if (!l.remoteId && r.remoteId && !pendingIds.has(l.id)) {
        await this.store.updateFile(l.id, { remoteId: r.remoteId, remoteName: r.remoteName, remoteParentId: r.remoteParentId, remoteWanted: r.remoteWanted, remoteEtag: r.remoteEtag }, { sync: false, emit: false });
      }
    }
    return { changed };
  }

  // ---------- delta (changes made directly in OneDrive or by other devices) ----------
  async pullDelta() {
    const rootId = await this.ensureRoot();
    let items, deltaLink;
    try {
      ({ items, deltaLink } = await this.graph.delta(rootId, this.store.settings.deltaLink || ''));
    } catch (e) {
      if (e.status === 410 || e.code === 'resyncRequired') { // delta token expired → start over
        ({ items, deltaLink } = await this.graph.delta(rootId, ''));
      } else if (e.status === 400 || e.status === 404 || e.status === 501 || e.status === 405) {
        // delta not supported here → full listing (no deletion tracking)
        items = await this.graph.walk(rootId); deltaLink = '';
      } else throw e;
    }
    const byRemote = new Map();
    for (const fo of this.store.folders.values()) if (fo.remoteId) byRemote.set(fo.remoteId, { kind: 'folder', rec: fo });
    for (const f of this.store.files.values()) if (f.remoteId) byRemote.set(f.remoteId, { kind: 'file', rec: f });
    const pendingIds = new Set((await this.store.getQueue()).map(q => q.id));
    // folders first so parents resolve
    const folders = items.filter(i => i.folder && !i.deleted);
    const files = items.filter(i => i.file && !i.deleted);
    const deleted = items.filter(i => i.deleted);
    let changed = false;
    const localFolderIdFor = (parentRemoteId) => {
      if (!parentRemoteId || parentRemoteId === rootId) return '';
      const m = byRemote.get(parentRemoteId);
      return m && m.kind === 'folder' ? m.rec.id : null; // null = unknown parent (e.g. inside .Trash)
    };
    for (const it of folders) {
      if (it.id === rootId) continue;
      if (it.name === TRASH_NAME && it.parentReference?.id === rootId) { this.trashId = it.id; continue; }
      const m = byRemote.get(it.id);
      const parentLocal = localFolderIdFor(it.parentReference?.id);
      if (parentLocal === null) continue;
      if (m && m.kind === 'folder') {
        if (pendingIds.has(m.rec.id) || m.rec.purged) continue;
        const patch = {};
        if (it.name !== m.rec.remoteName) { patch.name = it.name; patch.remoteName = it.name; patch.remoteWanted = it.name; }
        if ((it.parentReference?.id || rootId) !== m.rec.remoteParentId) { patch.parentId = parentLocal; patch.remoteParentId = it.parentReference?.id || rootId; }
        if (m.rec.deletedAt) { patch.deletedAt = 0; }
        if (Object.keys(patch).length) { patch.updatedAt = now(); await this.store.updateFolder(m.rec.id, patch, { sync: false }); changed = true; }
      } else if (!m) {
        changed = true;
        const rec = { id: uid(), name: it.name, color: 'gray', icon: 'folder', parentId: parentLocal, order: 0, createdAt: now(), updatedAt: now(), deletedAt: 0, remoteId: it.id, remoteParentId: it.parentReference?.id || rootId, remoteName: it.name, remoteWanted: it.name, syncState: 'synced' };
        await this.store.adoptFolder(rec);
        byRemote.set(it.id, { kind: 'folder', rec: this.store.folder(rec.id) });
      }
    }
    for (const it of files) {
      if (it.name === INDEX_NAME && it.parentReference?.id === rootId) continue;
      const m = byRemote.get(it.id);
      const inTrash = this.trashId && it.parentReference?.id === this.trashId;
      const parentLocal = inTrash ? '' : localFolderIdFor(it.parentReference?.id);
      if (parentLocal === null) continue;
      if (m && m.kind === 'file') {
        const f = m.rec;
        if (pendingIds.has(f.id) || f.purged) continue;
        const patch = {};
        const tag = ctag(it);
        if (tag && f.remoteEtag && tag !== f.remoteEtag) {
          // content changed in the cloud → drop stale local copy, re-download on demand
          patch.remoteEtag = tag; patch.size = it.size || f.size; patch.indexed = false; patch.thumb = false;
          if (f.hasBlob) { await this.store.removeBlob(f.id); patch.hasBlob = false; }
          this.log('cloud content changed', f.title);
        } else if (!f.remoteEtag && tag) patch.remoteEtag = tag;
        if (it.name !== f.remoteName) {
          patch.remoteName = it.name; patch.remoteWanted = it.name;
          const ext = extOf(it.name); if (ext) { patch.ext = ext; patch.kind = kindOf(ext, it.file?.mimeType || ''); }
          patch.title = baseName(it.name);
        }
        const rp = it.parentReference?.id || rootId;
        if (rp !== f.remoteParentId) {
          patch.remoteParentId = rp;
          if (inTrash) { if (!f.deletedAt) patch.deletedAt = now(); }
          else { patch.folderId = parentLocal; if (f.deletedAt) patch.deletedAt = 0; }
        }
        if (Object.keys(patch).length) { patch.updatedAt = now(); await this.store.updateFile(f.id, patch, { sync: false, emit: false }); changed = true; }
      } else if (!m) {
        if (inTrash) continue;
        changed = true;
        // unknown file: perhaps added directly in OneDrive → adopt as cloud-only record
        const ext = extOf(it.name);
        const rec = {
          id: uid(), folderId: parentLocal, title: baseName(it.name) || it.name, originalName: it.name, ext, kind: kindOf(ext, it.file?.mimeType || ''),
          mime: it.file?.mimeType || mimeOf(ext), size: it.size || 0, tags: [], notes: '', color: '', starred: false,
          createdAt: Date.parse(it.lastModifiedDateTime || '') || now(), updatedAt: now(), addedAt: now(), deletedAt: 0,
          hasBlob: false, thumb: false, indexed: false, remoteId: it.id, remoteEtag: ctag(it), remoteName: it.name, remoteWanted: it.name,
          remoteParentId: it.parentReference?.id || rootId, syncState: 'synced',
        };
        await this.store.adoptFile(rec);
        byRemote.set(it.id, { kind: 'file', rec: this.store.file(rec.id) });
      }
    }
    for (const it of deleted) {
      const m = byRemote.get(it.id); if (!m) continue;
      if (pendingIds.has(m.rec.id)) continue;
      changed = true;
      if (m.kind === 'file') {
        if (!m.rec.purged) {
          // removed in OneDrive: keep a local copy in the trash if we still have the bytes, otherwise drop it
          if (m.rec.hasBlob) await this.store.updateFile(m.rec.id, { remoteId: '', remoteEtag: '', remoteName: '', remoteParentId: '', remoteWanted: '', deletedAt: m.rec.deletedAt || now(), updatedAt: now(), syncState: 'local' }, { sync: false, emit: false });
          else await this.store.hardDelete(m.rec.id);
        }
      } else if (!m.rec.purged) {
        await this.store.updateFolder(m.rec.id, { remoteId: '', remoteParentId: '', remoteName: '', remoteWanted: '', deletedAt: m.rec.deletedAt || now(), updatedAt: now() }, { sync: false });
      }
    }
    if (deltaLink) await this.store.setSetting('deltaLink', deltaLink);
    if (changed) this.store.dirtyIndex = true;
    return items.length;
  }

  // ---------- full cycle ----------
  async sync({ reason = 'manual' } = {}) {
    if (!this.canSync()) { this.setStatus(isOnline() ? 'signedOut' : 'offline'); return false; }
    if (this.running) { this.again = true; return false; }
    this.running = true;
    try {
      this.setStatus('syncing');
      const rootId = await this.ensureRoot();
      // 1. merge remote index (metadata from other devices)
      const remoteIndex = await this.graph.getJson(rootId, INDEX_NAME);
      await this.mergeIndex(remoteIndex);
      // 2. changes made directly in OneDrive
      await this.pullDelta();
      // 3. push local changes
      const pushed = await this.push();
      // 4. write index if anything changed locally or remote index is missing
      if (pushed || !remoteIndex || this.store.dirtyIndex) {
        await this.graph.putJson(rootId, INDEX_NAME, this.buildIndex());
        this.store.dirtyIndex = false;
      }
      await this.store.setSetting('lastSync', now());
      this.store.emit('files'); this.store.emit('folders');
      this.setStatus('idle');
      if (this.store.settings.keepOffline) this.downloadAll().catch(() => {});
      return true;
    } catch (e) {
      console.error('sync failed', e);
      this.setStatus(e.code === 'expired' || e.code === 'signed_out' ? 'signedOut' : (e.code === 'network' || !isOnline() ? 'offline' : 'error'), e.message || String(e));
      return false;
    } finally {
      this.running = false;
      if (this.again) { this.again = false; setTimeout(() => this.sync({ reason: 'again' }), 500); }
    }
  }

  // ---------- downloads ----------
  async ensureBlob(id, onProgress) {
    const f = this.store.file(id); if (!f) throw new Error('missing');
    const existing = await this.store.getBlob(id);
    if (existing) return existing;
    if (!f.remoteId) throw new Error('nocloud');
    if (this.downloads.has(id)) return this.downloads.get(id);
    const p = (async () => {
      try {
        const { blob, item } = await this.graph.download(f.remoteId, onProgress);
        await this.store.putBlob(id, blob);
        await this.store.updateFile(id, { remoteEtag: ctag(item) || f.remoteEtag, size: blob.size, indexed: false, thumb: false }, { sync: false });
        this.indexer?.add([id]);
        return blob;
      } finally { this.downloads.delete(id); }
    })();
    this.downloads.set(id, p);
    return p;
  }
  async downloadAll(onProgress) {
    const ids = [];
    for (const f of this.store.files.values()) if (!f.deletedAt && !f.hasBlob && f.remoteId) ids.push(f.id);
    let n = 0;
    for (const id of ids) {
      if (!this.canSync()) break;
      try { await this.ensureBlob(id); } catch (e) { console.warn('download failed', e); }
      n++; onProgress?.(n, ids.length);
      this.setStatus('syncing', 'downloading', { done: n, total: ids.length });
    }
    this.setStatus('idle');
    return n;
  }

  // Forget every remote reference (used when signing in with a different account)
  async resetRemoteState() {
    for (const fo of this.store.folders.values()) if (!fo.purged) { await this.store.updateFolder(fo.id, { remoteId: '', remoteParentId: '', remoteName: '', remoteWanted: '', syncState: 'pending' }, { sync: false }); await this.store.enqueue({ op: fo.deletedAt ? 'folderDelete' : 'folder', id: fo.id }); }
    for (const f of this.store.files.values()) if (!f.purged) { await this.store.updateFile(f.id, { remoteId: '', remoteParentId: '', remoteName: '', remoteWanted: '', remoteEtag: '', syncState: 'pending' }, { sync: false, emit: false }); await this.store.enqueue({ op: 'file', id: f.id }); }
    await this.store.setSetting('deltaLink', '');
    this.rootId = ''; this.trashId = '';
    this.store.dirtyIndex = true;
  }
}
