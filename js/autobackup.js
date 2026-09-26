// ============================================================
//  Rfoof – automatic backup at an interval the user picks
//
//  A web app can't run while it is closed, so "automatic" means: while
//  Rfoof is open it checks every few minutes, and when it is opened after
//  the interval has passed it backs up right away.
//  • Backup folder chosen (Edge / Chrome): new files are copied into it on
//    their own. If the browser needs permission again (after a restart it
//    may ask), a toast offers a one-click "Back up now"; choosing "Allow on
//    every visit" in the browser's prompt makes later backups silent.
//  • No folder backups in this browser (Firefox, phones): a reminder to
//    download a ZIP backup.
// ============================================================
import { store } from './store.js';
import * as bk from './backup.js';
import { t } from './i18n.js';
import { toast } from './ui/toast.js';

const HOUR = 3600000, DAY = 24 * HOUR;
/** Choices offered in Settings ▸ Backup (key → interval in ms). */
export const INTERVALS = { off: 0, hourly: HOUR, h6: 6 * HOUR, daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY };
const CHECK_EVERY = 5 * 60000;        // while the app is open
const REMIND_AGAIN_AFTER = 2 * HOUR;  // don't nag: at most one reminder toast per 2 hours

export function interval() { return INTERVALS[store.settings.autoBackup] || 0; }

/** Time of the last backup that counts for the schedule (folder when one is set up, otherwise ZIP). */
export function lastBackupTime() {
  return bk.rememberedFolder() ? (store.settings.lastBackup || 0) : (store.settings.lastZipBackup || 0);
}

/** When the next automatic backup is due (0 = off). A library that was never backed up is due now. */
export function nextDue() {
  const iv = interval();
  if (!iv) return 0;
  const last = lastBackupTime();
  return last ? last + iv : 1;
}
export function isDue(now = Date.now()) { const d = nextDue(); return d > 0 && now >= d; }

let timer = null, running = false, lastReminder = 0;

export function startAutoBackup() {
  if (timer) return;
  setTimeout(check, 15000);   // let the app finish starting first
  timer = setInterval(check, CHECK_EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  store.on('settings', (k) => { if (k === 'autoBackup') { lastReminder = 0; check(); } });
}

export async function check() {
  if (running || !isDue() || !store.liveFiles().length) return;
  const dir = bk.rememberedFolder();
  if (dir) {
    let state = 'denied';
    try { state = await dir.queryPermission({ mode: 'readwrite' }); } catch { /* handle no longer valid */ }
    if (state === 'granted') return run(dir);
    return remind(() => run(dir, true));           // a click is needed before the browser can ask
  }
  if (!bk.folderBackupSupported()) return remind(async () => { await bk.exportBackup(); }, 'autobackup.zipDue', 'action.export');
  // folder backups possible but no folder chosen yet: nothing to do automatically
}

async function run(dir, fromClick = false) {
  if (running) return;
  running = true;
  try {
    const r = await bk.exportToFolder(dir);
    if (r.written) toast(t('autobackup.done', { n: r.written, name: r.name }), { type: 'success', duration: 5000 });
    else if (fromClick) toast(t('autobackup.upToDate', { name: r.name }), { type: 'success' });
  } catch (err) {
    const msg = err?.code === 'permission' ? t('backup.permission') : (err?.message || String(err));
    toast(t('autobackup.failed', { msg }), { type: 'error', duration: 9000 });
  } finally { running = false; }
}

function remind(fn, key = 'autobackup.due', actionKey = 'backup.now') {
  if (Date.now() - lastReminder < REMIND_AGAIN_AFTER) return;
  lastReminder = Date.now();
  toast(t(key), { duration: 20000, action: { label: t(actionKey), fn } });
}
