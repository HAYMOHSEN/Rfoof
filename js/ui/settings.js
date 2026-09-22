import { h, clear, formatBytes } from '../utils.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { t, locale, setLang, getLang, fmtDateTime } from '../i18n.js';
import { openDialog, confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import { db } from '../db.js';
import { APP } from '../config.js';
import { app } from '../app.js';
import { auth } from '../auth.js';
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
    ['account', 'cloud', t('settings.account')],
    ['backup', 'archive', t('settings.backup')],
    ['storage', 'database', t('settings.storage')],
    ['license', 'key', t('license.title')],
    ['about', 'info', t('settings.about')],
  ];
  const renderNav = () => { clear(nav); for (const [id, ic, label] of tabs) nav.appendChild(h('button', { class: id === tab ? 'on' : '', onclick: () => { tab = id; renderNav(); renderPane(); } }, icon(ic, { size: 18 }), label)); };
  let paneCleanup = null; // unsubscribe function of the pane currently shown
  const renderPane = () => { paneCleanup?.(); paneCleanup = null; clear(pane); ({ general, naming, account, backup, storage, license: licensePane, about })[tab](pane); };

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

  const account = (p) => {
    p.appendChild(h('h3', { text: t('settings.account') }));
    if (!auth.isConfigured()) {
      p.appendChild(h('div', { class: 'card-box' }, h('div', { class: 'row' }, icon('alert', { size: 18 }), h('span', { text: t('settings.notConfigured') }))));
      p.appendChild(h('p', { class: 'muted small', text: t('settings.syncDesc') }));
      return;
    }
    const acc = auth.account();
    if (acc) {
      const av = h('span', { class: 'avatar lg', text: (acc.name || acc.username || '?').trim()[0]?.toUpperCase() || '?' });
      if (app.photoUrl) { clear(av); av.appendChild(h('img', { src: app.photoUrl, alt: '' })); }
      p.appendChild(h('div', { class: 'card-box account-card' }, av,
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 }, text: acc.name || acc.username }), h('div', { class: 'muted small', text: acc.username })),
        h('button', { class: 'btn sm', onclick: async () => { await app.signOut(); renderPane(); } }, icon('log-out', { size: 16 }), t('action.signOut'))));
      p.appendChild(h('p', { class: 'muted small', text: t('settings.cloudFolder', { name: APP.cloudFolderName }) }));
      p.appendChild(switchRow(t('settings.autoSync'), '', store.settings.autoSync !== false, (v) => store.setSetting('autoSync', v)));
      p.appendChild(switchRow(t('settings.keepOffline'), '', !!store.settings.keepOffline, (v) => { store.setSetting('keepOffline', v); if (v) app.sync?.downloadAll(); }));
      const last = store.settings.lastSync ? fmtDateTime(store.settings.lastSync) : t('settings.never');
      p.appendChild(h('div', { class: 'row', style: { marginTop: '14px' } },
        h('button', { class: 'btn primary', onclick: () => app.syncNow() }, icon('refresh', { size: 16 }), t('action.sync')),
        h('span', { class: 'muted small', text: `${t('settings.lastSync')}: ${last}` })));
    } else {
      p.appendChild(h('div', { class: 'card-box' },
        h('div', { style: { fontWeight: 600, marginBottom: '6px' }, text: t('auth.title') }),
        h('p', { class: 'muted small', style: { margin: '0 0 12px' }, text: t('settings.syncDesc') }),
        h('button', { class: 'btn primary', onclick: () => app.signIn() }, icon('microsoft', { size: 16 }), t('action.signIn'))));
    }
  };

  const backup = (p) => {
    p.appendChild(h('h3', { text: t('settings.backup') }));
    p.appendChild(h('p', { class: 'muted small', text: t('settings.backupDesc') }));
    const prog = h('div', { class: 'progress', style: { display: 'none', margin: '10px 0' } }, h('div'));
    const fileInput = h('input', { type: 'file', accept: '.zip', style: { display: 'none' }, onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      prog.style.display = ''; prog.firstChild.style.width = '0%';
      try {
        const { restoreBackup } = await import('../backup.js');
        const r = await restoreBackup(f, (n, total) => { prog.firstChild.style.width = Math.round(n / total * 100) + '%'; });
        toast(t('toast.restoreDone', { files: r.files, folders: r.folders }), { type: 'success' });
      } catch (err) { console.error(err); toast(t('toast.error') + ': ' + err.message, { type: 'error' }); }
      prog.style.display = 'none'; e.target.value = '';
    } });
    p.appendChild(h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; prog.style.display = ''; prog.firstChild.style.width = '0%';
        try { const { exportBackup } = await import('../backup.js'); await exportBackup((n, total, pct) => { prog.firstChild.style.width = (pct != null ? pct : Math.round(n / Math.max(1, total) * 100)) + '%'; }); toast(t('toast.backupDone'), { type: 'success' }); }
        catch (err) { console.error(err); toast(t('toast.error'), { type: 'error' }); }
        b.disabled = false; prog.style.display = 'none';
      } }, icon('download', { size: 16 }), t('action.export')),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('upload', { size: 16 }), t('action.importBackup')), fileInput));
    p.appendChild(prog);
  };

  const storage = (p) => {
    p.appendChild(h('h3', { text: t('settings.storage') }));
    const box = h('div', { class: 'card-box' }, h('div', { class: 'muted small', text: '…' }));
    p.appendChild(box);
    Promise.all([db.estimate(), db.persisted()]).then(([{ usage = 0, quota = 0 }, persisted]) => {
      clear(box);
      const pct = quota ? Math.min(100, Math.round(usage / quota * 100)) : 0;
      box.appendChild(h('div', { class: 'row between' }, h('span', { text: `${t('settings.used')}: ${formatBytes(usage, locale())}` }), h('span', { class: 'muted', text: quota ? `${t('settings.available')}: ${formatBytes(quota - usage, locale())}` : '' })));
      box.appendChild(h('div', { class: 'progress', style: { margin: '8px 0' } }, h('div', { style: { width: pct + '%' } })));
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
      h('a', { class: 'btn sm', href: './licenses.html', target: '_blank', rel: 'noopener' }, icon('book', { size: 16 }), t('settings.licenses'))));
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
