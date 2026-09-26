import { h, clear, formatBytes } from '../utils.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { t, locale, setLang, getLang, fmtDateTime } from '../i18n.js';
import { openDialog, confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import { db } from '../db.js';
import { APP } from '../config.js';
import { app } from '../app.js';
import * as bk from '../backup.js';
import { license, licenseEvents } from '../license.js';
import { install, installEvents } from '../install.js';

const ACCENTS = { blue: '#2f6fdb', teal: '#0f8f86', violet: '#7a5af5', green: '#2e8b57', orange: '#d9730d', rose: '#d6336c', graphite: '#4b5563' };

function switchRow(title, desc, value, onChange) {
  const sw = h('span', { class: `switch ${value ? 'on' : ''}`, role: 'switch', 'aria-checked': String(!!value) });
  const row = h('div', { class: 'switch-row', onclick: () => { value = !value; sw.classList.toggle('on', value); sw.setAttribute('aria-checked', String(value)); onChange(value); } },
    h('div', {}, h('div', { class: 't', text: title }), desc ? h('div', { class: 'd', text: desc }) : null), sw);
  return row;
}

export function openSettings(initialTab = 'general') {
  let tab = initialTab;
  const nav = h('div', { class: 'settings-nav' });
  const pane = h('div', { class: 'settings-pane' });
  const tabs = [
    ['general', 'settings', t('settings.general')],
    ['naming', 'pencil', t('settings.naming')],
    ['backup', 'archive', t('settings.backup')],
    ['storage', 'database', t('settings.storage')],
    ['license', 'key', t('license.title')],
    ['about', 'info', t('settings.about')],
  ];
  const renderNav = () => { clear(nav); for (const [id, ic, label] of tabs) nav.appendChild(h('button', { class: id === tab ? 'on' : '', onclick: () => { tab = id; renderNav(); renderPane(); } }, icon(ic, { size: 18 }), label)); };
  let paneCleanup = null; // unsubscribe function of the pane currently shown
  const renderPane = () => { paneCleanup?.(); paneCleanup = null; clear(pane); ({ general, naming, backup, storage, license: licensePane, about })[tab](pane); };

  const general = (p) => {
    p.appendChild(h('h3', { text: t('settings.general') }));
    const lang = getLang();
    p.appendChild(h('div', { class: 'field' }, h('label', { text: t('settings.language') }),
      h('div', { class: 'seg' },
        h('button', { class: lang === 'en' ? 'on' : '', onclick: () => { app.setLanguage('en'); dlg.close(); openSettings('general'); } }, 'English'),
        h('button', { class: lang === 'ar' ? 'on' : '', onclick: () => { app.setLanguage('ar'); dlg.close(); openSettings('general'); } }, 'العربية'))));
    const theme = store.settings.theme || 'system';
    const themeSeg = h('div', { class: 'seg' });
    for (const [v, ic, label] of [['light', 'sun', t('settings.theme.light')], ['dark', 'moon', t('settings.theme.dark')], ['system', 'laptop', t('settings.theme.system')]]) {
      themeSeg.appendChild(h('button', { class: theme === v ? 'on' : '', onclick: () => { store.setSetting('theme', v); app.applyTheme(); renderPane(); } }, icon(ic, { size: 16 }), label));
    }
    p.appendChild(h('div', { class: 'field' }, h('label', { text: t('settings.theme') }), themeSeg));
    const accentRow = h('div', { class: 'accent-row' });
    for (const [k, c] of Object.entries(ACCENTS)) accentRow.appendChild(h('button', { class: `accent-dot ${store.settings.accent === k ? 'on' : ''}`, style: { background: c }, title: k, onclick: () => { store.setSetting('accent', k); app.applyTheme(); renderPane(); } }));
    p.appendChild(h('div', { class: 'field' }, h('label', { text: t('settings.accent') }), accentRow));
    const dens = store.settings.density || 'medium';
    const densSeg = h('div', { class: 'seg' });
    for (const v of ['small', 'medium', 'large']) densSeg.appendChild(h('button', { class: dens === v ? 'on' : '', onclick: () => { store.setSetting('density', v); app.applyTheme(); renderPane(); } }, t('settings.density.' + v)));
    p.appendChild(h('div', { class: 'field' }, h('label', { text: t('settings.density') }), densSeg));

    // ---- install as an app ----
    p.appendChild(h('h4', { text: t('install.title') }));
    const box = h('div', { class: 'card-box' });
    const renderInstall = () => {
      clear(box);
      if (install.isStandalone() || install.isInstalled()) {
        box.appendChild(h('div', { class: 'row' }, icon('check-circle', { size: 20 }), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 }, text: t('install.installed') }), h('div', { class: 'muted small', text: t('install.installedHint') }))));
      } else if (install.canPrompt()) {
        box.appendChild(h('p', { class: 'muted small', style: { margin: '0 0 10px' }, text: t('install.desc') }));
        const btn = h('button', { class: 'btn primary', onclick: async () => {
          btn.disabled = true;
          const r = await install.prompt();
          if (r === 'accepted') toast(t('install.done'), { type: 'success', duration: 6000 });
          renderInstall();
        } }, icon('download', { size: 16 }), t('install.button'));
        box.appendChild(btn);
      } else if (install.isSupported()) {
        box.appendChild(h('p', { class: 'muted small', style: { margin: '0 0 8px' }, text: t('install.desc') }));
        box.appendChild(h('div', { class: 'row small' }, icon('info', { size: 16 }), h('span', { class: 'muted', text: t(install.isEdge() ? 'install.manualEdge' : 'install.manualChrome') })));
      } else {
        box.appendChild(h('div', { class: 'row small' }, icon('alert', { size: 16 }), h('span', { class: 'muted', text: t('install.unsupported') })));
      }
    };
    renderInstall();
    paneCleanup = installEvents.on('change', renderInstall);
    p.appendChild(box);
  };

  const naming = (p) => {
    p.appendChild(h('h3', { text: t('settings.naming') }));
    const inp = h('input', { class: 'input', value: store.settings.template || '{name}', onchange: (e) => store.setSetting('template', e.target.value.trim() || '{name}') });
    p.appendChild(h('div', { class: 'field' }, h('label', { text: t('settings.defaultTemplate') }), inp, h('div', { class: 'hint', text: t('import.templateHelp') })));
    p.appendChild(switchRow(t('settings.askOnImport'), '', store.settings.askOnImport !== false, (v) => store.setSetting('askOnImport', v)));
  };

  const backup = (p) => {
    p.appendChild(h('h3', { text: t('settings.backup') }));
    p.appendChild(h('p', { class: 'muted small', text: t('settings.backupDesc') }));
    const prog = h('div', { class: 'progress', style: { display: 'none', margin: '10px 0' } }, h('div'));
    p.appendChild(prog);
    const setProg = (n, total, pct) => { prog.firstChild.style.width = (pct != null ? pct : Math.round(n / Math.max(1, total) * 100)) + '%'; };
    const showError = (err) => {
      const known = { notBackup: 'backup.notBackup', permission: 'backup.permission', unsupported: 'backup.unsupported' }[err?.code];
      if (known) return toast(t(known), { type: 'error', duration: 7000 });
      console.error(err); toast(t('toast.error') + (err?.message ? ': ' + err.message : ''), { type: 'error', duration: 7000 });
    };
    // run a backup/restore job with the progress bar shown and the button disabled meanwhile
    const run = async (btn, job) => {
      if (btn) btn.disabled = true; prog.style.display = ''; setProg(0, 1);
      try { await job(); } catch (err) { showError(err); }
      if (btn) btn.disabled = false; prog.style.display = 'none';
    };
    const restoreToast = (r) => {
      toast(t('toast.restoreDone', { files: r.files, folders: r.folders }), { type: 'success', duration: 6000 });
      if (r.blocked) toast(t('license.restoreBlocked', { n: r.blocked, limit: license.limit() }), { type: 'error', duration: 9000, action: { label: t('license.getFullShort'), fn: () => license.openStore() } });
    };
    // pick a folder while the click is still "fresh" (the browser only opens the picker right after a user gesture)
    const pick = async () => { try { return await bk.pickBackupFolder(); } catch (err) { showError(err); return null; } };

    // ---- backup folder (local disk, USB stick or the folder of any cloud drive) ----
    p.appendChild(h('h4', { text: t('backup.folderTitle') }));
    const box = h('div', { class: 'card-box' });
    const backupTo = (btn, handle) => run(btn, async () => {
      const r = await bk.exportToFolder(handle, setProg);
      toast(t('toast.backupFolderDone', { name: r.name, written: r.written, skipped: r.skipped }), { type: 'success', duration: 7000 });
      renderFolder();
    });
    const renderFolder = () => {
      clear(box);
      if (!bk.folderBackupSupported()) {
        box.appendChild(h('div', { class: 'row small', style: { alignItems: 'flex-start' } }, icon('info', { size: 16 }), h('span', { class: 'muted', text: t('backup.unsupported') })));
        return;
      }
      const dir = bk.rememberedFolder();
      if (dir) {
        const last = store.settings.lastBackup ? fmtDateTime(store.settings.lastBackup) : t('settings.never');
        box.appendChild(h('div', { class: 'row' }, icon('folder', { size: 22 }), h('div', { class: 'grow' },
          h('div', { style: { fontWeight: 600 }, text: dir.name }),
          h('div', { class: 'muted small', text: `${t('backup.lastBackup')}: ${last}` }))));
      } else {
        box.appendChild(h('p', { class: 'muted small', style: { margin: '0 0 4px' }, text: t('backup.folderHint') }));
      }
      const row = h('div', { class: 'row wrap', style: { marginTop: '10px' } });
      if (dir) row.appendChild(h('button', { class: 'btn primary', onclick: (e) => backupTo(e.currentTarget, dir) }, icon('archive', { size: 16 }), t('backup.now')));
      row.appendChild(h('button', { class: dir ? 'btn' : 'btn primary', onclick: async (e) => { const btn = e.currentTarget; const handle = await pick(); if (handle) backupTo(btn, handle); } },
        icon('folder-plus', { size: 16 }), dir ? t('backup.change') : t('backup.choose')));
      row.appendChild(h('button', { class: 'btn', onclick: async (e) => {
        const btn = e.currentTarget; const handle = await pick(); if (!handle) return;
        run(btn, async () => restoreToast(await bk.restoreFromFolder(handle, setProg)));
      } }, icon('restore', { size: 16 }), t('backup.restoreFolder')));
      if (dir) row.appendChild(h('button', { class: 'btn sm', title: t('backup.forgetHint'), onclick: async () => { await bk.forgetFolder(); renderFolder(); } }, icon('x', { size: 14 }), t('backup.forget')));
      box.appendChild(row);
    };
    renderFolder();
    p.appendChild(box);

    // ---- ZIP file (works in every browser) ----
    p.appendChild(h('h4', { text: t('backup.zipTitle') }));
    p.appendChild(h('p', { class: 'muted small', text: t('backup.zipDesc') }));
    const fileInput = h('input', { type: 'file', accept: '.zip', style: { display: 'none' }, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      run(null, async () => restoreToast(await bk.restoreBackup(f, setProg)));
    } });
    p.appendChild(h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: (e) => run(e.currentTarget, async () => { await bk.exportBackup(setProg); toast(t('toast.backupDone'), { type: 'success' }); }) }, icon('download', { size: 16 }), t('action.export')),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('upload', { size: 16 }), t('action.importBackup')), fileInput));
  };

  const storage = (p) => {
    p.appendChild(h('h3', { text: t('settings.storage') }));
    const box = h('div', { class: 'card-box' }, h('div', { class: 'muted small', text: '…' }));
    p.appendChild(box);
    Promise.all([db.storageInfo(), db.persisted()]).then(([{ usage, quota, free, capped }, persisted]) => {
      clear(box);
      const pct = quota ? Math.min(100, Math.round(usage / quota * 100)) : 0;
      const freeText = capped ? t('settings.availableMore', { size: formatBytes(free, locale()) }) : formatBytes(free, locale());
      box.appendChild(h('div', { class: 'row between' }, h('span', { text: `${t('settings.used')}: ${formatBytes(usage, locale())}` }), h('span', { class: 'muted', text: quota ? `${t('settings.available')}: ${freeText}` : '' })));
      // with the 10 GB reporting cap a bar would suggest the library fills up at 10 GB, which is not true
      if (capped) box.appendChild(h('p', { class: 'muted small', style: { margin: '8px 0' }, text: t('settings.quotaCapped') }));
      else box.appendChild(h('div', { class: 'progress', style: { margin: '8px 0' } }, h('div', { style: { width: pct + '%' } })));
      box.appendChild(h('div', { class: 'row small' }, icon(persisted ? 'shield' : 'alert', { size: 16 }), h('span', { class: 'muted', text: persisted ? t('settings.persisted') : t('settings.notPersisted') })));
    });
    p.appendChild(h('div', { class: 'row wrap', style: { marginTop: '14px' } },
      h('button', { class: 'btn', onclick: async () => { const { indexer } = await import('../import.js'); await indexer.reindexAll(); toast(t('settings.reindexDone'), { type: 'success' }); } }, icon('refresh', { size: 16 }), t('settings.thumbs'))));
    p.appendChild(h('h4', { text: t('settings.danger') }));
    p.appendChild(h('button', { class: 'btn danger', onclick: async () => {
      if (!await confirmDialog({ message: t('settings.wipeConfirm'), okLabel: t('settings.wipe'), danger: true })) return;
      await app.wipe(); toast(t('settings.wipeDone')); dlg.close();
    } }, icon('trash', { size: 16 }), t('settings.wipe')));
  };

  const licensePane = (p) => {
    p.appendChild(h('h3', { text: t('license.title') }));
    const active = license.isActive();
    const status = h('div', { class: 'card-box' },
      h('div', { class: 'row' }, icon(active ? 'check-circle' : 'info', { size: 20 }), h('div', { class: 'grow' },
        h('div', { style: { fontWeight: 600 }, text: active ? t('license.full') : t('license.trial') }),
        h('div', { class: 'muted small', text: active ? ({ key: t('license.viaKey'), local: t('license.viaLocal'), store: t('license.viaStore') }[license.source()] || t('license.full')) : t('license.remaining', { n: license.remaining(), limit: license.limit() }) }))));
    p.appendChild(status);
    if (license.canRate()) {
      p.appendChild(h('p', { class: 'muted small', text: t('rate.desc') }));
      p.appendChild(h('button', { class: 'btn', onclick: () => license.openReview() }, icon('star', { size: 16 }), t('rate.button')));
    }
    if (!active) {
      p.appendChild(h('p', { class: 'muted small', text: t('license.trialDesc', { limit: license.limit() }) }));
      p.appendChild(h('div', { class: 'progress', style: { margin: '6px 0 14px' } }, h('div', { style: { width: Math.min(100, Math.round(license.used() / Math.max(1, license.limit()) * 100)) + '%' } })));
      p.appendChild(h('button', { class: 'btn primary', onclick: () => { if (!license.openStore()) toast(t('license.storeNotConfigured'), { type: 'error' }); } }, icon('shopping-bag', { size: 16 }), t('license.getFull')));
      p.appendChild(h('p', { class: 'muted small', text: t('license.storeHint') }));
      p.appendChild(h('h4', { text: t('license.enterKey') }));
      const keyInput = h('input', { class: 'input', dir: 'ltr', placeholder: t('license.keyPlaceholder'), autocomplete: 'off', spellcheck: 'false', style: { fontFamily: 'var(--mono)', letterSpacing: '.04em' } });
      const btn = h('button', { class: 'btn', onclick: async () => {
        btn.disabled = true;
        const ok = await license.activateWithKey(keyInput.value);
        btn.disabled = false;
        if (ok) { toast(t('license.activated'), { type: 'success' }); renderPane(); } else { toast(t('license.invalidKey'), { type: 'error' }); keyInput.focus(); }
      } }, icon('key', { size: 16 }), t('license.activate'));
      keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
      p.appendChild(h('div', { class: 'row' }, keyInput, btn));
    }
  };

  const about = (p) => {
    p.appendChild(h('h3', { text: `${t('app.name')} · ${t('settings.version')} ${APP.version}` }));
    p.appendChild(h('p', { class: 'muted', text: t('app.tagline') }));
    p.appendChild(h('div', { class: 'row wrap' },
      h('a', { class: 'btn sm', href: APP.privacyUrl, target: '_blank', rel: 'noopener' }, icon('shield', { size: 16 }), t('settings.privacy')),
      h('a', { class: 'btn sm', href: './licenses.html', target: '_blank', rel: 'noopener' }, icon('book', { size: 16 }), t('settings.licenses')),
      license.canRate() ? h('button', { class: 'btn sm', onclick: () => license.openReview() }, icon('star', { size: 16 }), t('rate.button')) : null));
    p.appendChild(h('h4', { text: t('settings.shortcuts') }));
    const sc = h('div', { class: 'shortcut-list' });
    const rows = [['Ctrl + K', 'shortcut.palette'], ['Ctrl + F', 'shortcut.search'], ['Ctrl + I', 'shortcut.import'], ['Ctrl + Shift + N', 'shortcut.newFolder'], ['Ctrl + A', 'shortcut.selectAll'], ['Enter', 'shortcut.open'], ['F2', 'shortcut.rename'], ['Del', 'shortcut.delete'], ['S', 'shortcut.star'], ['← →', 'shortcut.nav'], ['Ctrl + D', 'shortcut.details'], ['Esc', 'shortcut.escape']];
    for (const [k, l] of rows) sc.append(h('span', { text: t(l) }), h('span', { class: 'kbd', text: k }));
    p.appendChild(sc);
  };

  renderNav(); renderPane();
  const dlg = openDialog({ title: t('settings.title'), icon: 'settings', size: 'lg', body: h('div', { class: 'settings-layout' }, nav, pane), onClose: () => { paneCleanup?.(); paneCleanup = null; } });
  return dlg;
}
