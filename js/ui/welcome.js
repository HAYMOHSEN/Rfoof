import { h } from '../utils.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { t, getLang } from '../i18n.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import * as bk from '../backup.js';
import { app } from '../app.js';
import { LOGO_SVG } from '../logo.js';
import { license } from '../license.js';

const STARTER = [
  ['starter.personal', 'blue', 'home'], ['starter.work', 'indigo', 'briefcase'], ['starter.study', 'purple', 'graduation-cap'],
  ['starter.finance', 'green', 'wallet'], ['starter.health', 'red', 'stethoscope'], ['starter.family', 'pink', 'users'],
  ['starter.travel', 'teal', 'plane'], ['starter.ids', 'amber', 'id-card'],
];

export function openWelcome() {
  return new Promise((resolve) => {
    let starter = true;
    const build = () => {
      const sw = h('span', { class: `switch ${starter ? 'on' : ''}` });
      const body = h('div', { class: 'welcome' },
        h('div', { class: 'logo-big', html: LOGO_SVG }),
        h('div', { class: 'lang-switch seg' },
          h('button', { class: getLang() === 'en' ? 'on' : '', onclick: () => { app.setLanguage('en'); dlg.close(); openWelcome().then(resolve); } }, 'English'),
          h('button', { class: getLang() === 'ar' ? 'on' : '', onclick: () => { app.setLanguage('ar'); dlg.close(); openWelcome().then(resolve); } }, 'العربية')),
        h('h1', { text: t('welcome.title') }),
        h('p', { text: t('welcome.subtitle') }),
        h('div', { class: 'features' },
          h('div', {}, icon('wifi-off'), t('welcome.feature1')), h('div', {}, icon('search'), t('welcome.feature2')),
          h('div', {}, icon('archive'), t('welcome.feature3')), h('div', {}, icon('globe'), t('welcome.feature4'))),
        h('div', { class: 'switch-row', style: { textAlign: 'start' }, onclick: () => { starter = !starter; sw.classList.toggle('on', starter); } },
          h('div', {}, h('div', { class: 't', text: t('welcome.starter') }), h('div', { class: 'd', text: t('welcome.starterHint') })), sw));
      return body;
    };
    const finish = async () => { await store.setSetting('welcomeDone', true); resolve(true); };
    const dlg = openDialog({
      body: build(), size: 'md', closable: false,
      actions: [
        { label: t('welcome.restore'), ghost: true, start: true, icon: 'restore', keepOpen: true, onClick: async () => {
          const done = await openRestoreChooser();
          if (done) { dlg.close(); await finish(); }
        } },
        { label: t('welcome.start'), primary: true, onClick: async () => {
          if (starter && !store.liveFolders().length) for (const [k, color, ic] of STARTER) await store.createFolder({ name: t(k), color, icon: ic });
          await store.setSetting('welcomeDone', true);
          resolve(true);
        } }],
      onClose: () => resolve(false),
    });
    dlg.el.dataset.noEsc = '1';
  });
}

/** "Restore a backup" on the welcome screen: from the backup folder or from a ZIP. Resolves true when a restore ran. */
function openRestoreChooser() {
  return new Promise((resolve) => {
    let busy = false;
    const report = (r) => {
      toast(t('toast.restoreDone', { files: r.files, folders: r.folders }), { type: 'success', duration: 8000 });
      if (r.blocked) toast(t('license.restoreBlocked', { n: r.blocked, limit: license.limit() }), { type: 'error', duration: 9000, action: { label: t('license.getFullShort'), fn: () => license.openStore() } });
    };
    const fail = (err) => {
      const known = { notBackup: 'backup.notBackup', permission: 'backup.permission', unsupported: 'backup.unsupported' }[err?.code];
      toast(known ? t(known) : (err?.message || String(err)), { type: 'error', duration: 8000 });
    };
    const fileInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
    const body = h('div', {},
      h('p', { class: 'muted', style: { margin: '0 0 12px' }, text: t('welcome.restoreHint') }),
      fileInput);
    const actions = [{ label: t('action.cancel'), ghost: true, onClick: () => {} }];
    if (bk.folderBackupSupported()) actions.push({ label: t('welcome.restoreFolder'), primary: true, icon: 'folder-open', keepOpen: true, onClick: async (close) => {
      if (busy) return;
      let handle = null;
      try { handle = await bk.pickBackupFolder(); } catch (err) { fail(err); return; }
      if (!handle) return;
      busy = true;
      try {
        const r = await bk.restoreFromFolder(handle);
        try { await store.setSetting('backupDir', handle); } catch { /* not storable */ }
        await store.setSetting('autoBackup', 'change');
        report(r);
        close('restored');
      } catch (err) { fail(err); busy = false; }
    } });
    actions.push({ label: t('welcome.restoreZip'), icon: 'upload', keepOpen: true, onClick: async (close) => {
      if (busy) return;
      fileInput.onchange = async () => {
        const f = fileInput.files?.[0]; if (!f) return;
        busy = true;
        try { const r = await bk.restoreBackup(f); report(r); close('restored'); }
        catch (err) { fail(err); busy = false; }
      };
      fileInput.click();
    } });
    openDialog({ title: t('welcome.restoreTitle'), icon: 'restore', body, size: 'sm', actions, onClose: (r) => resolve(r === 'restored') });
  });
}
