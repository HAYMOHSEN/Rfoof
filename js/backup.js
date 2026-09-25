// ============================================================
//  Rfoof – backup
//  The whole library can be copied into a folder of the user's choice
//  (a local disk, a USB stick, or the sync folder of any cloud service:
//  Google Drive, Dropbox, OneDrive, iCloud …) or into a ZIP file, and
//  restored from either. Both use the same layout:
//     rfoof-index.json                    library metadata (folders, titles, tags, notes …)
//     Library/<Folder>/<Sub>/<Title>.<ext> the files, mirrored as real folders
//     Trash/<Title>.<ext>                  files waiting in the app's trash
//     README.txt
//  Folder backups use the File System Access API (Edge / Chrome). The chosen
//  folder is remembered so the next backup is one click; only new files are
//  copied again (file bytes never change after import, so same name + same
//  size means the copy is already up to date).
// ============================================================
import { store } from './store.js';
import { zipLib } from './office.js';
import { sanitizeFileName, ymd, downloadBlob, uid } from './utils.js';
import { indexer } from './import.js';
import { license } from './license.js';

export const INDEX_NAME = 'rfoof-index.json';
const README = 'Rfoof backup.\n\nYour files are inside the "Library" folder, organized exactly like your Rfoof folders; "Trash" holds files that were in the app\'s trash.\nrfoof-index.json keeps the titles, tags, colors and notes.\n\nTo restore: open Rfoof → Settings → Backup → "Restore from folder" (or from the ZIP).\n';

/** Error with a machine-readable code so the UI can translate it. */
export class BackupError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

/** Direct folder backups need the File System Access API (Chromium browsers, https or localhost). */
export function folderBackupSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
}

function folderZipPath(folderId) {
  const parts = store.folderPath(folderId).map(f => sanitizeFileName(f.name));
  return parts.length ? 'Library/' + parts.join('/') + '/' : 'Library/';
}

const FILE_FIELDS = ['id', 'folderId', 'title', 'originalName', 'ext', 'kind', 'mime', 'size', 'tags', 'notes', 'color', 'starred', 'createdAt', 'updatedAt', 'addedAt', 'deletedAt', 'hash'];
const FOLDER_FIELDS = ['id', 'parentId', 'name', 'color', 'icon', 'order', 'createdAt', 'updatedAt', 'deletedAt'];
const pick = (o, fields) => Object.fromEntries(fields.map(k => [k, o[k]]));

/** Snapshot of the library: metadata plus the backup path of every file (deterministic, case-insensitive unique). */
function buildIndex() {
  const files = Array.from(store.files.values()).filter(f => !f.purged)
    .sort((a, b) => (a.addedAt || a.createdAt || 0) - (b.addedAt || b.createdAt || 0) || (a.id < b.id ? -1 : 1));
  const folders = Array.from(store.folders.values()).filter(f => !f.purged);
  const index = { version: 1, app: 'rfoof', exportedAt: Date.now(), folders: folders.map(fo => pick(fo, FOLDER_FIELDS)), files: [] };
  const used = new Set();
  for (const f of files) {
    let path = '';
    if (f.hasBlob) {
      const dir = f.deletedAt ? 'Trash/' : folderZipPath(f.folderId);
      const base = sanitizeFileName(f.title), ext = f.ext ? '.' + f.ext : '';
      let name = base + ext, k = 1;
      while (used.has((dir + name).toLowerCase())) name = `${base} (${k++})${ext}`;
      used.add((dir + name).toLowerCase()); path = dir + name;
    }
    index.files.push({ ...pick(f, FILE_FIELDS), path });
  }
  return { index, folders };
}

// ---------------------------------------------------------------- ZIP
export async function exportBackup(onProgress) {
  const JSZip = await zipLib();
  const zip = new JSZip();
  const { index, folders } = buildIndex();
  let n = 0, written = 0;
  for (const rec of index.files) {
    n++;
    if (rec.path) {
      const blob = await store.getBlob(rec.id);
      if (blob) { zip.file(rec.path, blob, { date: new Date(rec.createdAt || Date.now()) }); written++; }
      else rec.path = '';
    }
    onProgress?.(n, index.files.length);
  }
  zip.file(INDEX_NAME, JSON.stringify(index, null, 1));
  zip.file('README.txt', README);
  const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } }, (m) => onProgress?.(index.files.length, index.files.length, m.percent));
  downloadBlob(out, `rfoof-backup-${ymd()}.zip`);
  return { files: written, folders: folders.length };
}

export async function restoreBackup(file, onProgress) {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(file);
  const idxFile = zip.file(INDEX_NAME);
  if (!idxFile) throw new BackupError('notBackup', 'Not a Rfoof backup (rfoof-index.json missing)');
  const index = JSON.parse(await idxFile.async('string'));
  return restoreFromIndex(index, async (rec) => {
    const entry = rec.path && zip.file(rec.path);
    return entry ? new Blob([await entry.async('uint8array')], { type: rec.mime || 'application/octet-stream' }) : null;
  }, onProgress);
}

// ---------------------------------------------------------------- folder (File System Access API)
/** Let the user pick a folder. Returns the handle, or null when the dialog was cancelled. */
export async function pickBackupFolder() {
  if (!folderBackupSupported()) throw new BackupError('unsupported');
  try { return await window.showDirectoryPicker({ id: 'rfoof-backup', mode: 'readwrite', startIn: 'documents' }); }
  catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
}

/** The folder remembered from the last backup (a FileSystemDirectoryHandle stored in IndexedDB), if any. */
export function rememberedFolder() {
  const h = store.settings.backupDir;
  return h && typeof h.getDirectoryHandle === 'function' ? h : null;
}

export async function forgetFolder() {
  await store.setSetting('backupDir', null);
  await store.setSetting('lastBackup', 0);
}

/** Re-check (and if needed re-request) permission on a remembered handle. Needs a user gesture to prompt. */
export async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle) return false;
  try {
    if (await handle.queryPermission({ mode }) === 'granted') return true;
    return (await handle.requestPermission({ mode })) === 'granted';
  } catch { return false; }
}

async function dirAt(root, segments, create) {
  let d = root;
  for (const s of segments) d = await d.getDirectoryHandle(s, { create });
  return d;
}

async function writeText(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

/**
 * Copy the library into `handle` (a FileSystemDirectoryHandle). Files already present with the same
 * name and size are skipped, so repeated backups into the same folder only copy what is new.
 * Nothing is ever deleted from the folder.
 */
export async function exportToFolder(handle, onProgress) {
  if (!(await ensurePermission(handle, 'readwrite'))) throw new BackupError('permission');
  const { index, folders } = buildIndex();
  const dirs = new Map();
  const getDir = async (dirPath) => {
    if (dirs.has(dirPath)) return dirs.get(dirPath);
    const d = await dirAt(handle, dirPath.split('/').filter(Boolean), true);
    dirs.set(dirPath, d);
    return d;
  };
  let n = 0, written = 0, skipped = 0;
  for (const rec of index.files) {
    n++;
    if (rec.path) {
      const i = rec.path.lastIndexOf('/');
      const dir = await getDir(rec.path.slice(0, i + 1));
      const name = rec.path.slice(i + 1);
      let existing = null;
      try { existing = await (await dir.getFileHandle(name)).getFile(); } catch { /* not there yet */ }
      if (existing && rec.size && existing.size === rec.size) skipped++;
      else {
        const blob = await store.getBlob(rec.id);
        if (!blob) rec.path = '';
        else {
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
          written++;
        }
      }
    }
    onProgress?.(n, index.files.length);
  }
  await writeText(handle, INDEX_NAME, JSON.stringify(index, null, 1));
  await writeText(handle, 'README.txt', README);
  try { await store.setSetting('backupDir', handle); } catch { /* handle not storable in this browser */ }
  await store.setSetting('lastBackup', Date.now());
  return { files: written + skipped, written, skipped, folders: folders.length, name: handle.name };
}

/** Restore from a folder that contains rfoof-index.json (a previous folder backup or an unzipped ZIP backup). */
export async function restoreFromFolder(handle, onProgress) {
  if (!(await ensurePermission(handle, 'read'))) throw new BackupError('permission');
  let index;
  try { index = JSON.parse(await (await (await handle.getFileHandle(INDEX_NAME)).getFile()).text()); }
  catch { throw new BackupError('notBackup', 'Not a Rfoof backup (rfoof-index.json missing)'); }
  return restoreFromIndex(index, async (rec) => {
    if (!rec.path) return null;
    try {
      const segments = rec.path.split('/').filter(Boolean);
      const dir = await dirAt(handle, segments.slice(0, -1), false);
      const file = await (await dir.getFileHandle(segments[segments.length - 1])).getFile();
      return new Blob([file], { type: rec.mime || file.type || 'application/octet-stream' });
    } catch { return null; }
  }, onProgress);
}

// ---------------------------------------------------------------- shared restore
async function restoreFromIndex(index, readBlob, onProgress) {
  if (!index || index.app !== 'rfoof' || !Array.isArray(index.files)) throw new BackupError('notBackup', 'Not a Rfoof backup');
  let folders = 0, files = 0, skipped = 0;
  // folders (parents first). A folder that already exists here with the same name under the same
  // parent is reused instead of duplicated (e.g. the starter folders created on every new device).
  const idMap = new Map(); // backup folder id -> local folder id
  const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
  const remaining = (index.folders || []).slice();
  let guard = 0;
  while (remaining.length && guard++ < 100) {
    for (let i = remaining.length - 1; i >= 0; i--) {
      const fo = remaining[i];
      if (fo.parentId && !idMap.has(fo.parentId) && !store.folder(fo.parentId) && remaining.some(x => x.id === fo.parentId)) continue;
      remaining.splice(i, 1);
      if (store.folder(fo.id)) { idMap.set(fo.id, fo.id); continue; }
      const parentId = idMap.get(fo.parentId) ?? (store.folder(fo.parentId) ? fo.parentId : '');
      const twin = !fo.deletedAt && store.liveFolders().find(x => (x.parentId || '') === parentId && sameName(x.name, fo.name));
      if (twin) { idMap.set(fo.id, twin.id); continue; }
      await store.adoptFolder({ ...fo, parentId, remoteId: '', syncState: 'local' });
      idMap.set(fo.id, fo.id);
      folders++;
    }
  }
  const hashes = new Set(Array.from(store.files.values()).filter(f => !f.deletedAt && f.hash).map(f => f.hash));
  const list = index.files;
  // free version: a restore adds files like an import does, so it shares the same limit
  // (otherwise any hand-made ZIP in the backup layout would bypass it)
  const allowance = license.remaining();
  let n = 0, blocked = 0;
  for (const rec of list) {
    n++; onProgress?.(n, list.length);
    if (store.file(rec.id) || (rec.hash && hashes.has(rec.hash))) { skipped++; continue; }
    if (!rec.path) { skipped++; continue; }
    if (files >= allowance) { blocked++; continue; }
    const blob = await readBlob(rec);
    if (!blob) { skipped++; continue; }
    const folderId = idMap.get(rec.folderId) ?? (store.folder(rec.folderId) ? rec.folderId : '');
    await store.createFile({ ...rec, id: rec.id || uid(), folderId, remoteId: '', syncState: 'local' }, blob);
    if (rec.deletedAt) await store.updateFile(rec.id, { deletedAt: rec.deletedAt }, { sync: false, emit: false });
    files++;
  }
  await license.countImports(files);
  indexer.add(list.map(r => r.id).filter(id => store.file(id)));
  store.emit('folders'); store.emit('files');
  return { files, folders, skipped, blocked };
}
