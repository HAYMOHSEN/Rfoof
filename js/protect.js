// ============================================================
//  Rfoof – library protection
//  The library lives in the browser's site storage, which is deleted together
//  with browsing data (a "clear browsing data" setting, a cleaning tool, a
//  reset). Rfoof cannot bring the files back on its own, so this module
//    • asks once, prominently, for a backup folder as soon as the library
//      has files (and again after an update for libraries that never had one),
//    • switches automatic backup to "after every change" for that folder,
//    • restores the library from the folder when the app starts empty.
// ============================================================
import { store } from './store.js';
import * as bk from './backup.js';
import { t, fmtDateTime } from './i18n.js';
import { h } from './utils.js';
import { icon } from './icons.js';
import { toast } from './ui/toast.js';
import { openDialog, topDialog } from './ui/dialog.js';
import { license } from './license.js';

const ASK_AGAIN_AFTER = 7 * 24 * 3600000;   // after "Not now"
let asked = false;                           // at most once per session
let pending = null;

/** True when a backup folder is remembered and automatic backup is not switched off. */
export function isProtected() {
  return !!bk.rememberedFolder() && (store.settings.autoBackup || 'off') !== 'off';
}

/** One line for Settings ▸ Backup describing the current protection. */
export function statusText() {
  const dir = bk.rememberedFolder();
  if (!dir) return t('protect.statusOff');
  const mode = store.settings.autoBackup || 'off';
  const time = store.settings.lastBackup ? fmtDateTime(store.settings.lastBackup) : t('settings.never');
  if (mode === 'off') return t('protect.statusPaused', { name: dir.name });
  if (mode === 'change') return t('protect.statusOn', { name: dir.name, time });
  return t('protect.statusInterval', { name: dir.name, interval: t('autobackup.' + mode).toLowerCase(), time });
}

function errorMessage(err) {
  const known = { notBackup: 'backup.notBackup', permission: 'backup.permission', unsupported: 'backup.unsupported' }[err?.code];
  return known ? t(known) : (err?.message || String(err));
}

// ---------------------------------------------------------------- the "Protect your library" step
export function startProtection() {
  const consider = () => { if (shouldAsk()) schedule(); };
  store.on('files', consider);
  setTimeout(consider, 8000);   // libraries that existed before this version
}

function shouldAsk() {
  if (asked || !bk.folderBackupSupported() || bk.rememberedFolder()) return false;
  if (!store.liveFiles().length) return false;
  return Date.now() - (store.settings.protectDismissed || 0) > ASK_AGAIN_AFTER;
}

function schedule(delay = 2500) {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    if (!shouldAsk()) return;
    if (topDialog()) return schedule(15000);   // wait until the import dialog or another dialog is closed
    askToProtect();
  }, delay);
}

/** Opens the protection dialog. Returns a promise that resolves when it is closed. */
export function askToProtect() {
  asked = true;
  return new Promise((resolve) => {
    const body = h('div', { class: 'protect' },
      h('p', { text: t('protect.body1') }),
      h('p', { text: t('protect.body2') }),
      h('div', { class: 'row small muted', style: { gap: '8px', alignItems: 'flex-start' } }, icon('info', { size: 16 }), h('span', { text: t('autobackup.permHint') })));
    openDialog({
      title: t('protect.title'), icon: 'shield', body, size: 'sm', closable: true,
      actions: [
        { label: t('protect.later'), ghost: true, onClick: async () => { await store.setSetting('protectDismissed', Date.now()); } },
        { label: t('protect.choose'), primary: true, icon: 'folder-plus', keepOpen: true, onClick: async (close) => {
          // the folder picker must open while the click is still fresh
          let handle = null;
          try { handle = await bk.pickBackupFolder(); } catch (err) { toast(errorMessage(err), { type: 'error', duration: 7000 }); return; }
          if (!handle) return;   // cancelled: the dialog stays open
          close('chosen');
          await enableFolder(handle);
        } },
      ],
      onClose: (r) => resolve(r === 'chosen'),
    });
  });
}

/** Make `handle` the backup folder, switch to "after every change" and copy the library now. */
export async function enableFolder(handle) {
  try { await store.setSetting('backupDir', handle); } catch { /* handle not storable in this browser */ }
  if ((store.settings.autoBackup || 'off') === 'off') await store.setSetting('autoBackup', 'change');
  const busy = toast(t('protect.backingUp', { name: handle.name }), { duration: 120000 });
  try {
    const r = await bk.exportToFolder(handle);
    busy.remove();
    toast(t('protect.done', { n: r.files, name: r.name }), { type: 'success', duration: 8000 });
  } catch (err) {
    busy.remove();
    toast(t('autobackup.failed', { msg: errorMessage(err) }), { type: 'error', duration: 9000 });
  }
}

// ---------------------------------------------------------------- restore at start
/** If the library is empty but a backup folder is remembered, bring the library back from it. */
export async function restoreIfEmpty() {
  const dir = bk.rememberedFolder();
  if (!dir || store.liveFiles().length) return false;
  let state = 'prompt';
  try { state = await dir.queryPermission({ mode: 'read' }); } catch { return false; }   // handle no longer valid
  if (state === 'granted') return runRestore(dir);
  toast(t('protect.restoreOffer', { name: dir.name }), { duration: 60000, action: { label: t('protect.restoreButton'), fn: () => runRestore(dir) } });
  return false;
}

async function runRestore(dir) {
  const busy = toast(t('protect.restoring', { name: dir.name }), { duration: 120000 });
  try {
    const r = await bk.restoreFromFolder(dir);
    busy.remove();
    toast(t('toast.restoreDone', { files: r.files, folders: r.folders }), { type: 'success', duration: 8000 });
    if (r.blocked) toast(t('license.restoreBlocked', { n: r.blocked, limit: license.limit() }), { type: 'error', duration: 9000, action: { label: t('license.getFullShort'), fn: () => license.openStore() } });
    if ((store.settings.autoBackup || 'off') === 'off') await store.setSetting('autoBackup', 'change');
    return true;
  } catch (err) {
    busy.remove();
    if (err?.code === 'permission') toast(t('protect.restoreOffer', { name: dir.name }), { duration: 60000, action: { label: t('protect.restoreButton'), fn: () => runRestore(dir) } });
    else toast(t('autobackup.failed', { msg: errorMessage(err) }), { type: 'error', duration: 9000 });
    return false;
  }
}
