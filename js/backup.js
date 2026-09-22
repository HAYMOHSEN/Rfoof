// ============================================================
//  Rfoof – local backup (ZIP export / restore)
// ============================================================
import { store } from './store.js';
import { zipLib } from './office.js';
import { sanitizeFileName, ymd, downloadBlob, uid } from './utils.js';
import { indexer } from './import.js';

function folderZipPath(folderId) {
  const parts = store.folderPath(folderId).map(f => sanitizeFileName(f.name));
  return parts.length ? 'Library/' + parts.join('/') + '/' : 'Library/';
}

export async function exportBackup(onProgress) {
  const JSZip = await zipLib();
  const zip = new JSZip();
  const files = Array.from(store.files.values()).filter(f => !f.purged);
  const folders = Array.from(store.folders.values()).filter(f => !f.purged);
  const index = { version: 1, app: 'rfoof', exportedAt: Date.now(), folders: [], files: [] };
  const used = new Set();
  let n = 0;
  for (const fo of folders) index.folders.push({ id: fo.id, parentId: fo.parentId, name: fo.name, color: fo.color, icon: fo.icon, order: fo.order, createdAt: fo.createdAt, updatedAt: fo.updatedAt, deletedAt: fo.deletedAt });
  for (const f of files) {
    const blob = await store.getBlob(f.id);
    let path = '';
    if (blob) {
      const dir = f.deletedAt ? 'Trash/' : folderZipPath(f.folderId);
      let name = sanitizeFileName(f.title) + (f.ext ? '.' + f.ext : '');
      let k = 1;
      while (used.has(dir + name)) { name = `${sanitizeFileName(f.title)} (${k++})${f.ext ? '.' + f.ext : ''}`; }
      used.add(dir + name); path = dir + name;
      zip.file(path, blob, { date: new Date(f.createdAt || Date.now()) });
    }
    index.files.push({ id: f.id, folderId: f.folderId, title: f.title, originalName: f.originalName, ext: f.ext, kind: f.kind, mime: f.mime, size: f.size, tags: f.tags, notes: f.notes, color: f.color, starred: f.starred, createdAt: f.createdAt, updatedAt: f.updatedAt, addedAt: f.addedAt, deletedAt: f.deletedAt, hash: f.hash, path });
    n++; onProgress?.(n, files.length);
  }
  zip.file('rfoof-index.json', JSON.stringify(index, null, 1));
  zip.file('README.txt', 'Rfoof backup. Restore it from Settings → Backup inside the Rfoof app.\nYour files are inside the Library folder, organized exactly like your Rfoof folders.\n');
  const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } }, (m) => onProgress?.(files.length, files.length, m.percent));
  downloadBlob(out, `rfoof-backup-${ymd()}.zip`);
  return { files: n, folders: folders.length };
}

export async function restoreBackup(file, onProgress) {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(file);
  const idxFile = zip.file('rfoof-index.json');
  if (!idxFile) throw new Error('Not a Rfoof backup (rfoof-index.json missing)');
  const index = JSON.parse(await idxFile.async('string'));
  let folders = 0, files = 0, skipped = 0;
  // folders (parents first)
  const remaining = (index.folders || []).slice();
  let guard = 0;
  while (remaining.length && guard++ < 100) {
    for (let i = remaining.length - 1; i >= 0; i--) {
      const fo = remaining[i];
      if (fo.parentId && !store.folder(fo.parentId) && remaining.some(x => x.id === fo.parentId)) continue;
      remaining.splice(i, 1);
      if (store.folder(fo.id)) continue;
      await store.adoptFolder({ ...fo, parentId: store.folder(fo.parentId) ? fo.parentId : '', remoteId: '', syncState: 'pending' });
      await store.enqueue({ op: 'folder', id: fo.id });
      folders++;
    }
  }
  const hashes = new Set(Array.from(store.files.values()).filter(f => !f.deletedAt && f.hash).map(f => f.hash));
  const list = index.files || [];
  let n = 0;
  for (const rec of list) {
    n++; onProgress?.(n, list.length);
    if (store.file(rec.id) || (rec.hash && hashes.has(rec.hash))) { skipped++; continue; }
    let blob = null;
    if (rec.path && zip.file(rec.path)) blob = new Blob([await zip.file(rec.path).async('uint8array')], { type: rec.mime || 'application/octet-stream' });
    if (!blob) { skipped++; continue; }
    await store.createFile({ ...rec, id: rec.id || uid(), folderId: store.folder(rec.folderId) ? rec.folderId : '', remoteId: '' }, blob);
    if (rec.deletedAt) await store.updateFile(rec.id, { deletedAt: rec.deletedAt }, { sync: true, emit: false });
    files++;
  }
  indexer.add(list.map(r => r.id).filter(id => store.file(id)));
  store.emit('folders'); store.emit('files');
  return { files, folders, skipped };
}
