// Shared user actions (used by grid, sidebar, details, palette, menus)
import { store, COLORS } from '../store.js';
import { t } from '../i18n.js';
import { toast } from './toast.js';
import { confirmDialog, promptDialog } from './dialog.js';
import { pickFolderDialog, colorPicker } from './pickers.js';
import { folderDialog } from './folderDialog.js';
import { importDialog } from './importDialog.js';
import { downloadBlob, h } from '../utils.js';
import { showMenu } from './menu.js';
import { app } from '../app.js';

export const actions = {
  async openFile(id, list) {
    const { openViewer } = await import('../viewers/viewer.js');
    openViewer(id, list);
  },
  openFolder(id) { store.navigate({ type: 'folder', id }); },

  async trash(ids) {
    ids = Array.from(ids).filter(id => store.file(id));
    if (!ids.length) return;
    await store.trashFiles(ids);
    toast(t('toast.trashed', { n: ids.length }), { action: { label: t('action.undo'), fn: () => store.restoreFiles(ids) } });
  },
  async restore(ids) { await store.restoreFiles(Array.from(ids)); toast(t('toast.restored'), { type: 'success' }); },
  async purge(ids) {
    ids = Array.from(ids);
    if (!await confirmDialog({ message: t('trash.deleteConfirm', { n: ids.length }), okLabel: t('action.deleteForever'), danger: true })) return;
    await store.purgeFiles(ids);
    toast(t('toast.deleted'));
  },
  async emptyTrash() {
    if (!await confirmDialog({ message: t('trash.emptyConfirm'), okLabel: t('action.emptyTrash'), danger: true })) return;
    await store.emptyTrash();
    toast(t('toast.trashEmptied'));
  },
  async star(ids, value) {
    ids = Array.from(ids);
    const v = value ?? !ids.every(id => store.file(id)?.starred);
    await store.bulkUpdate(ids, { starred: v });
    toast(t(v ? 'toast.starred' : 'toast.unstarred'), { type: 'success', duration: 1500 });
  },
  async move(ids, folderId) {
    ids = Array.from(ids);
    if (folderId === undefined) {
      const current = ids.length === 1 ? store.file(ids[0])?.folderId : undefined;
      folderId = await pickFolderDialog({ selected: current || '' });
      if (folderId === null) return;
    }
    await store.moveFiles(ids, folderId);
    toast(t('toast.moved', { folder: store.folder(folderId)?.name || t('label.root') }), { type: 'success' });
  },
  async rename(id) {
    const f = store.file(id); if (!f) return;
    const v = await promptDialog({ title: t('action.rename'), label: t('label.title'), value: f.title });
    if (v && v !== f.title) { await store.updateFile(id, { title: v }); toast(t('toast.saved'), { type: 'success', duration: 1500 }); }
  },
  async setColor(ids, color) { await store.bulkUpdate(Array.from(ids), { color }); },
  async addTags(ids, tags) {
    await store.bulkUpdate(Array.from(ids), (f) => ({ tags: Array.from(new Set([...(f.tags || []), ...tags])) }));
  },
  async download(id) {
    const f = store.file(id); if (!f) return;
    let blob = await store.getBlob(id);
    if (!blob) {
      if (!app.sync) return toast(t('toast.needSignIn'), { type: 'error' });
      try { blob = await app.sync.ensureBlob(id); } catch { return toast(t('toast.needOnline'), { type: 'error' }); }
    }
    downloadBlob(blob, f.title.toLowerCase().endsWith('.' + f.ext) || !f.ext ? f.title : `${f.title}.${f.ext}`);
  },
  async makeOffline(ids) {
    if (!app.sync) return toast(t('toast.needSignIn'), { type: 'error' });
    let n = 0;
    for (const id of ids) { try { await app.sync.ensureBlob(id); n++; } catch (e) { console.warn(e); } }
    if (n) toast(t('toast.downloaded'), { type: 'success' });
  },
  async freeSpace(ids) {
    for (const id of ids) { const f = store.file(id); if (f && f.remoteId && f.syncState === 'synced') await store.removeBlob(id); }
  },
  // ---- folders ----
  async newFolder(parentId = '') { return folderDialog({ parentId }); },
  async editFolder(id) { const fo = store.folder(id); if (fo) return folderDialog({ folder: fo }); },
  async deleteFolder(id) {
    const fo = store.folder(id); if (!fo) return;
    if (!await confirmDialog({ message: t('folder.deleteConfirm', { name: fo.name }), okLabel: t('action.delete'), danger: true })) return;
    await store.trashFolder(id);
    toast(t('toast.folderDeleted'), { action: { label: t('action.undo'), fn: async () => { await store.restoreFolder(id); const ids = Array.from(store.files.values()).filter(f => f.deletedAt && store.descendantFolderIds(id).has(f.folderId)).map(f => f.id); if (ids.length) await store.restoreFiles(ids); } } });
  },
  async restoreFolder(id) { await store.restoreFolder(id); const ids = Array.from(store.files.values()).filter(f => f.deletedAt && !f.purged && store.descendantFolderIds(id).has(f.folderId)).map(f => f.id); if (ids.length) await store.restoreFiles(ids); toast(t('toast.restored'), { type: 'success' }); },
  async moveFolder(id, parentId) {
    const fo = store.folder(id); if (!fo) return;
    if (parentId === undefined) { parentId = await pickFolderDialog({ selected: fo.parentId, exclude: store.descendantFolderIds(id) }); if (parentId === null) return; }
    if (parentId === id || store.isDescendant(parentId, id)) return;
    await store.updateFolder(id, { parentId });
    toast(t('toast.moved', { folder: store.folder(parentId)?.name || t('label.root') }), { type: 'success' });
  },
  async import(files, folderId) {
    return importDialog({ files, folderId: folderId ?? (store.view.type === 'folder' ? store.view.id : '') });
  },

  // ---- context menus ----
  fileMenu(ids, pos) {
    ids = Array.from(ids);
    const single = ids.length === 1 ? store.file(ids[0]) : null;
    const anyTrashed = ids.some(id => store.file(id)?.deletedAt);
    const allStarred = ids.every(id => store.file(id)?.starred);
    const cloudOnly = ids.some(id => store.file(id) && !store.file(id).hasBlob);
    const items = [];
    if (anyTrashed) {
      items.push({ label: t('action.restore'), icon: 'restore', onClick: () => actions.restore(ids) });
      items.push({ label: t('action.deleteForever'), icon: 'trash', danger: true, onClick: () => actions.purge(ids) });
      return showMenu(items, pos);
    }
    if (single) items.push({ label: t('action.open'), icon: 'eye', onClick: () => actions.openFile(single.id), kbd: 'Enter' });
    items.push({ label: allStarred ? t('action.unstar') : t('action.star'), icon: 'star', onClick: () => actions.star(ids, !allStarred) });
    if (single) items.push({ label: t('action.rename'), icon: 'pencil', onClick: () => actions.rename(single.id), kbd: 'F2' });
    items.push({ label: t('action.move'), icon: 'folder-input', onClick: () => actions.move(ids) });
    const cp = colorPicker(single?.color || '', (c) => { actions.setColor(ids, c); });
    items.push({ header: t('action.color') });
    items.push({ custom: cp });
    items.push({ separator: true });
    if (single) items.push({ label: t('action.download'), icon: 'download', onClick: () => actions.download(single.id) });
    if (cloudOnly && app.sync) items.push({ label: t('action.downloadOffline'), icon: 'cloud-download', onClick: () => actions.makeOffline(ids) });
    if (single && single.hasBlob && single.remoteId && single.syncState === 'synced') items.push({ label: t('action.removeLocal'), icon: 'cloud', onClick: () => actions.freeSpace(ids) });
    items.push({ label: t('action.details'), icon: 'info', onClick: () => { store.select(ids); app.setDetails(true); } });
    items.push({ separator: true });
    items.push({ label: t('action.delete'), icon: 'trash', danger: true, onClick: () => actions.trash(ids), kbd: 'Del' });
    return showMenu(items, pos);
  },
  folderMenu(id, pos) {
    const fo = store.folder(id); if (!fo) return;
    if (fo.deletedAt) {
      return showMenu([
        { label: t('action.restore'), icon: 'restore', onClick: () => actions.restoreFolder(id) },
        { label: t('action.deleteForever'), icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog({ message: t('trash.deleteConfirm', { n: 1 }), okLabel: t('action.deleteForever'), danger: true })) { const ids = Array.from(store.files.values()).filter(f => f.deletedAt && !f.purged && store.descendantFolderIds(id).has(f.folderId)).map(f => f.id); await store.purgeFiles(ids); for (const fid of store.descendantFolderIds(id)) await store.purgeFolder(fid); } } },
      ], pos);
    }
    return showMenu([
      { label: t('action.open'), icon: 'folder-open', onClick: () => actions.openFolder(id) },
      { label: t('action.import'), icon: 'upload', onClick: () => actions.import([], id) },
      { label: t('action.newFolder'), icon: 'folder-plus', onClick: () => actions.newFolder(id) },
      { separator: true },
      { label: t('action.editFolder'), icon: 'pencil', onClick: () => actions.editFolder(id) },
      { label: t('action.move'), icon: 'folder-input', onClick: () => actions.moveFolder(id) },
      { separator: true },
      { label: t('action.delete'), icon: 'trash', danger: true, onClick: () => actions.deleteFolder(id) },
    ], pos);
  },
};
