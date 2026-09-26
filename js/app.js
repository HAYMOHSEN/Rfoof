// ============================================================
//  Rfoof – application bootstrap & shell
// ============================================================
import { APP } from './config.js';
import { h, clear, debounce, uid, isOnline } from './utils.js';
import { t, setLang, detectLang, i18nEvents, getLang } from './i18n.js';
import { store } from './store.js';
import { db } from './db.js';
import { icon } from './icons.js';
import { LOGO_SVG } from './logo.js';
import { search } from './search.js';
import { toast } from './ui/toast.js';
import { closeTopDialog, topDialog } from './ui/dialog.js';
import { isMenuOpen, showMenu } from './ui/menu.js';
import { Sidebar } from './ui/sidebar.js';
import { ContentView } from './ui/content.js';
import { DetailsPanel } from './ui/details.js';
import { actions } from './ui/actions.js';
import { openPalette } from './ui/palette.js';
import { openSettings } from './ui/settings.js';
import { openWelcome } from './ui/welcome.js';
import { indexer, importEvents } from './import.js';
import { license } from './license.js';
import { startAutoBackup } from './autobackup.js';
import { initInstall, install } from './install.js';

export const app = {
  els: {}, prevView: null,

  // ---------------- boot ----------------
  async boot() {
    initInstall();
    setLang(detectLang(), { silent: true });
    this.renderSplash();
    await db.persist();
    await store.init();
    if (!store.settings.deviceId) await store.setSetting('deviceId', uid());
    const wasLicensed = !!store.settings.licensed;
    const storeLaunch = await license.detectStoreLaunch();
    this.applyTheme();
    this.renderShell();
    if (!store.settings.welcomeDone) await openWelcome();
    this.registerSW();
    this.setupGlobal();
    if (storeLaunch && !wasLicensed) toast(t('license.activated'), { type: 'success', duration: 6000 });
    setTimeout(() => this.maybeAskForRating(), 20000);
    startAutoBackup();
    // 2.0.2 reads Arabic PDFs (and Excel cells typed as inline text) correctly: index those files once more
    if ((store.settings.indexVersion || 1) < 2) {
      for (const f of Array.from(store.files.values())) {
        if (!f.deletedAt && f.hasBlob && f.indexed && (f.kind === 'pdf' || ['xlsx', 'xlsm', 'xltx'].includes(f.ext))) await store.updateFile(f.id, { indexed: false }, { sync: false, emit: false });
      }
      await store.setSetting('indexVersion', 2);
    }
    // resume background indexing for anything not yet indexed
    const pending = Array.from(store.files.values()).filter(f => !f.deletedAt && f.hasBlob && (!f.indexed || !f.thumb)).map(f => f.id);
    if (pending.length) indexer.add(pending);
    this.handleLaunchQueue();
    this.handleUrlParams();
  },

  // One polite, one-time reminder to rate Rfoof in the Store (owners only, after a few days of real use).
  maybeAskForRating() {
    const count = Array.from(store.files.values()).filter(f => !f.deletedAt).length;
    if (!license.shouldAskForRating(count)) return;
    store.setSetting('ratePrompted', Date.now());
    toast(t('rate.prompt'), { duration: 15000, action: { label: t('rate.button'), fn: () => license.openReview() } });
  },

  handleUrlParams() {
    const q = new URLSearchParams(location.search);
    if (![...q.keys()].length) return;
    const action = q.get('action'), view = q.get('view');
    history.replaceState(null, '', location.pathname + location.hash);
    if (view === 'starred' || view === 'recent' || view === 'trash') store.navigate({ type: view });
    if (action === 'import') actions.import([]);
  },

  renderSplash() {
    document.body.innerHTML = '';
    document.body.appendChild(h('div', { class: 'empty-state', style: { height: '100%', justifyContent: 'center' } }, h('div', { class: 'logo-big', style: { width: '72px', height: '72px', borderRadius: '18px', overflow: 'hidden' }, html: LOGO_SVG }), h('p', { text: t('misc.loading') })));
  },

  applyTheme() {
    const s = store.settings;
    const dark = s.theme === 'dark' || (s.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.accent = s.accent || 'blue';
    document.documentElement.dataset.density = s.density || 'medium';
    try { localStorage.setItem('rfoof.theme', s.theme || 'system'); } catch { /* ignore */ }
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#1c1c1c' : '#f3f3f3');
  },

  // ---------------- shell ----------------
  renderShell() {
    document.body.innerHTML = '';
    const els = this.els;
    els.app = h('div', { class: `app ${store.settings.sidebarOpen === false ? 'sidebar-collapsed' : ''} ${store.settings.detailsOpen === false ? 'details-collapsed' : ''}` });
    // top bar
    els.search = h('input', { type: 'search', placeholder: t('search.placeholder'), 'aria-label': t('action.search'), autocomplete: 'off' });
    els.searchClear = h('button', { class: 'clear', hidden: true, 'aria-label': t('action.clear'), onclick: () => { els.search.value = ''; this.runSearch(''); els.search.focus(); } }, icon('x', { size: 16 }));
    els.search.addEventListener('input', debounce(() => this.runSearch(els.search.value), 160));
    els.search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { els.search.value = ''; this.runSearch(''); els.search.blur(); } if (e.key === 'Enter') this.runSearch(els.search.value, true); });
    const top = h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', title: t('nav.folders'), 'aria-label': t('nav.folders'), onclick: () => this.toggleSidebar() }, icon('menu')),
      h('div', { class: 'brand' }, h('span', { class: 'logo', html: LOGO_SVG }), h('span', { text: t('app.name') })),
      h('div', { class: 'searchbox' }, icon('search', { size: 18 }), els.search, els.searchClear),
      h('div', { class: 'topbar-actions' },
        h('button', { class: 'btn primary', onclick: () => actions.import([]) }, icon('plus', { size: 18 }), h('span', { text: t('action.import') })),
        h('button', { class: 'icon-btn', title: t('action.details') + ' (Ctrl+D)', onclick: () => this.setDetails() }, icon('panel-right')),
        h('button', { class: 'icon-btn', title: t('settings.title'), onclick: () => this.openSettings() }, icon('settings'))));
    els.sidebar = h('aside', { class: 'sidebar', id: 'sidebar' });
    els.toolbar = h('div', { class: 'toolbar' });
    els.content = h('div', { class: 'content', id: 'content' });
    els.bulk = h('div', { class: 'bulkbar', hidden: true });
    els.main = h('main', { class: 'main' }, els.toolbar, els.content, els.bulk);
    els.details = h('aside', { class: 'details', id: 'details' });
    els.scrim = h('div', { class: 'scrim', hidden: true, onclick: () => this.toggleSidebar(false) });
    els.app.append(top, h('div', { class: 'body' }, els.sidebar, els.scrim, els.main, els.details));
    document.body.appendChild(els.app);
    this.sidebar?.destroy(); this.contentView?.destroy(); this.detailsPanel?.destroy();
    this.sidebar = new Sidebar(els.sidebar);
    this.contentView = new ContentView(els.toolbar, els.content, els.bulk);
    this.detailsPanel = new DetailsPanel(els.details);
    if (window.innerWidth <= 760) { els.app.classList.add('sidebar-collapsed'); els.app.classList.add('details-collapsed'); }
    if (window.innerWidth <= 1100 && window.innerWidth > 760) els.app.classList.add('details-collapsed');
    if (els.dropOverlay) document.body.appendChild(els.dropOverlay);
  },

  toggleSidebar(force) {
    const a = this.els.app; const collapsed = force === undefined ? !a.classList.contains('sidebar-collapsed') : !force;
    a.classList.toggle('sidebar-collapsed', collapsed);
    this.els.scrim.hidden = collapsed || window.innerWidth > 760;
    if (window.innerWidth > 760) store.setSetting('sidebarOpen', !collapsed);
  },
  closeSidebarOnMobile() { if (window.innerWidth <= 760) this.toggleSidebar(false); },
  setDetails(force) {
    const a = this.els.app; const open = force === undefined ? a.classList.contains('details-collapsed') : force;
    a.classList.toggle('details-collapsed', !open);
    store.setSetting('detailsOpen', open);
  },
  showFolderDetails(id) { this.detailsPanel.showFolder(id); },
  openSettings(tab) { openSettings(tab); },

  // ---------------- search ----------------
  async runSearch(q, force = false) {
    q = q.trim();
    this.els.searchClear.hidden = !q;
    if (!q) { if (store.view.type === 'search') store.navigate(this.prevView || { type: 'all' }); return; }
    if (store.view.type !== 'search') this.prevView = store.view;
    const token = this._searchToken = Symbol('s');
    const results = await search(q, store.files.values(), { content: store.settings.contentSearch !== false });
    if (this._searchToken !== token) return;
    store.navigate({ type: 'search', query: q, results });
  },

  // ---------------- language / theme ----------------
  setLanguage(l) {
    setLang(l);
    const v = store.view;
    this.renderShell();
    store.redecorateAll();
    store.navigate(v);
  },

  // ---------------- global keys, online, SW ----------------
  setupGlobal() {
    document.addEventListener('keydown', (e) => {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
      if (mod && e.key.toLowerCase() === 'f' && !document.querySelector('.viewer')) { e.preventDefault(); this.els.search.focus(); this.els.search.select(); return; }
      if (mod && e.key.toLowerCase() === 'i' && !inInput) { e.preventDefault(); actions.import([]); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); actions.newFolder(store.view.type === 'folder' ? store.view.id : ''); return; }
      if (mod && e.key.toLowerCase() === 'd' && !inInput) { e.preventDefault(); this.setDetails(); return; }
      if (mod && e.key === ',') { e.preventDefault(); this.openSettings(); return; }
      if (e.key === 'Escape' && !inInput && !topDialog() && !isMenuOpen() && !document.querySelector('.viewer')) store.clearSelection();
    });
    window.addEventListener('online', () => { toast(t('toast.online'), { type: 'success', duration: 2000 }); });
    window.addEventListener('offline', () => { toast(t('toast.offline'), { duration: 4000 }); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    window.addEventListener('resize', debounce(() => { if (window.innerWidth > 760) this.els.scrim.hidden = true; }, 100));
    i18nEvents.on('change', () => { document.title = t('app.name'); });
    document.title = t('app.name');
    // keep search box in sync with view
    store.on('nav', (v) => { const els = this.els; if (v.type !== 'search' && els.search?.value) { els.search.value = ''; els.searchClear.hidden = true; } });
    // global drop overlay for external files (registered once)
    let dragDepth = 0;
    const overlay = this.els.dropOverlay = h('div', { class: 'drop-overlay', hidden: true }, h('div', { class: 'box' }, icon('upload', { size: 40 }), t('import.drop')));
    document.body.appendChild(overlay);
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; overlay.hidden = false; } });
    window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.hidden = true; });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', () => { dragDepth = 0; overlay.hidden = true; }, true);
    window.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const { filesFromDataTransfer } = await import('./import.js');
      const files = await filesFromDataTransfer(e.dataTransfer);
      if (files.length) actions.import(files);
    });
  },

  registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (!reg) return;
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast(t('toast.update'), { action: { label: t('action.reload'), fn: () => location.reload() }, duration: 15000 });
        });
      });
    }).catch(e => console.warn('SW registration failed', e));
  },

  handleLaunchQueue() {
    if (!('launchQueue' in window)) return;
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files = [];
      for (const handle of params.files) { try { files.push(await handle.getFile()); } catch { /* ignore */ } }
      if (files.length) actions.import(files);
    });
  },


  async wipe() {
    for (const u of store.thumbUrls.values()) URL.revokeObjectURL(u);
    await db.wipe();
    location.reload();
  },
};

window.rfoof = app; app.store = store; app.license = license; app.install = install;
app.boot().catch(e => { console.error(e); document.body.innerHTML = `<div class="empty-state" style="height:100%;justify-content:center"><h3>Rfoof could not start</h3><p>${(e && e.message) || e}</p></div>`; });
