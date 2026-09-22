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
import { auth, authEvents } from './auth.js';
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
import { initInstall, install } from './install.js';

export const app = {
  sync: null, photoUrl: '', els: {}, prevView: null,

  // ---------------- boot ----------------
  async boot() {
    initInstall();
    setLang(detectLang(), { silent: true });
    this.renderSplash();
    // auth redirect must be handled before anything else
    let justSignedIn = null; let authError = null;
    if (auth.isConfigured()) { try { justSignedIn = await auth.handleRedirect(); } catch (e) { authError = e; } }
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
    await this.setupSync(justSignedIn);
    if (authError) toast(t('auth.failed', { msg: authError.message }), { type: 'error', duration: 8000 });
    if (storeLaunch && !wasLicensed) toast(t('license.activated'), { type: 'success', duration: 6000 });
    // resume background indexing for anything not yet indexed
    const pending = Array.from(store.files.values()).filter(f => !f.deletedAt && f.hasBlob && (!f.indexed || !f.thumb)).map(f => f.id);
    if (pending.length) indexer.add(pending);
    this.handleLaunchQueue();
    this.handleUrlParams();
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
    els.syncBtn = h('button', { class: 'icon-btn sync-btn', title: t('action.sync'), onclick: (e) => this.syncMenu(e.currentTarget) }, icon('cloud'));
    els.accountBtn = h('button', { class: 'icon-btn', title: t('settings.account'), onclick: () => this.openSettings('account') }, h('span', { class: 'avatar', style: { width: '28px', height: '28px', fontSize: '12px' } }, icon('user', { size: 16 })));
    const top = h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', title: t('nav.folders'), 'aria-label': t('nav.folders'), onclick: () => this.toggleSidebar() }, icon('menu')),
      h('div', { class: 'brand' }, h('span', { class: 'logo', html: LOGO_SVG }), h('span', { text: t('app.name') })),
      h('div', { class: 'searchbox' }, icon('search', { size: 18 }), els.search, els.searchClear),
      h('div', { class: 'topbar-actions' },
        h('button', { class: 'btn primary', onclick: () => actions.import([]) }, icon('plus', { size: 18 }), h('span', { text: t('action.import') })),
        els.syncBtn,
        h('button', { class: 'icon-btn', title: t('action.details') + ' (Ctrl+D)', onclick: () => this.setDetails() }, icon('panel-right')),
        h('button', { class: 'icon-btn', title: t('settings.title'), onclick: () => this.openSettings() }, icon('settings')),
        els.accountBtn));
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
    this.updateSyncBadge();
    this.updateAccountBtn();
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
    window.addEventListener('online', () => { toast(t('toast.online'), { type: 'success', duration: 2000 }); this.updateSyncBadge(); if (this.sync && store.settings.autoSync !== false) this.sync.sync({ reason: 'online' }); });
    window.addEventListener('offline', () => { toast(t('toast.offline'), { duration: 4000 }); this.updateSyncBadge(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    window.addEventListener('resize', debounce(() => { if (window.innerWidth > 760) this.els.scrim.hidden = true; }, 100));
    i18nEvents.on('change', () => { document.title = t('app.name'); });
    document.title = t('app.name');
    importEvents.on('progress', () => this.updateSyncBadge());
    store.on('queue', () => { this.updateSyncBadge(); this.scheduleAutoSync(); });
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

  // ---------------- sync / account ----------------
  async setupSync(justSignedIn) {
    if (!auth.isConfigured()) { this.updateSyncBadge(); return; }
    const { GraphClient } = await import('./graph.js');
    const { SyncEngine } = await import('./sync.js');
    this.sync = new SyncEngine(store, new GraphClient(), { auth, indexer });
    this.sync.on('status', () => this.updateSyncBadge());
    authEvents.on('expired', () => { toast(t('auth.expired'), { type: 'error', duration: 8000 }); this.updateAccountBtn(); this.updateSyncBadge(); });
    if (justSignedIn) {
      const prev = store.settings.account;
      if (prev && prev.id && prev.id !== justSignedIn.id) await this.sync.resetRemoteState();
      await store.setSetting('account', justSignedIn);
      toast(t('toast.signedIn', { name: justSignedIn.name || justSignedIn.username }), { type: 'success' });
    }
    this.updateAccountBtn();
    this.loadPhoto();
    if (auth.isSignedIn()) {
      if (store.settings.autoSync !== false) this.sync.sync({ reason: 'startup' });
      // periodic pull while the app is open
      setInterval(() => { if (document.visibilityState === 'visible' && store.settings.autoSync !== false) this.sync.sync({ reason: 'periodic' }); }, 5 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && store.settings.autoSync !== false && Date.now() - (store.settings.lastSync || 0) > 60000) this.sync.sync({ reason: 'visible' }); });
    }
    this.updateSyncBadge();
  },
  scheduleAutoSync: debounce(function () { if (app.sync && auth.isSignedIn() && store.settings.autoSync !== false && isOnline()) app.sync.sync({ reason: 'change' }); }, 2500),
  async loadPhoto() {
    if (!this.sync || !auth.isSignedIn()) return;
    try { const b = await this.sync.graph.photo(); if (b) { this.photoUrl = URL.createObjectURL(b); this.updateAccountBtn(); } } catch { /* ignore */ }
  },
  async signIn() {
    if (!auth.isConfigured()) return toast(t('settings.notConfigured'), { type: 'error' });
    toast(t('auth.redirecting'));
    try { await auth.signIn(); } catch (e) { toast(t('auth.failed', { msg: e.message }), { type: 'error' }); }
  },
  async signOut() {
    auth.signOut();
    this.photoUrl = '';
    this.updateAccountBtn(); this.updateSyncBadge();
    toast(t('toast.signedOut'));
  },
  async syncNow() {
    if (!this.sync) return toast(t('settings.notConfigured'), { type: 'error' });
    if (!auth.isSignedIn()) return this.signIn();
    if (!isOnline()) return toast(t('toast.needOnline'), { type: 'error' });
    const ok = await this.sync.sync({ reason: 'manual' });
    if (ok) toast(t('toast.syncDone'), { type: 'success' });
    else if (this.sync.status.state === 'error') toast(t('toast.syncError', { msg: this.sync.status.message }), { type: 'error', duration: 8000 });
  },
  syncMenu(anchor) {
    {
      const st = this.sync?.status || { state: 'notConfigured' };
      const signed = auth.isSignedIn();
      const label = !auth.isConfigured() ? t('sync.notConfigured') : !signed ? t('sync.signedOut') : !isOnline() ? t('sync.offline') : st.state === 'syncing' ? t('sync.syncing') : st.state === 'error' ? `${t('sync.error')}: ${st.message}` : store.pendingCount ? t('sync.pending', { n: store.pendingCount }) : t('sync.idle');
      const items = [{ header: label }];
      if (auth.isConfigured()) {
        if (signed) { items.push({ label: t('action.sync'), icon: 'refresh', onClick: () => this.syncNow() }); items.push({ label: t('settings.account'), icon: 'user', onClick: () => this.openSettings('account') }); }
        else items.push({ label: t('action.signIn'), icon: 'log-in', onClick: () => this.signIn() });
      } else items.push({ label: t('settings.account'), icon: 'info', onClick: () => this.openSettings('account') });
      items.push({ label: t('action.export'), icon: 'archive', onClick: () => this.openSettings('backup') });
      showMenu(items, { anchor, align: 'end' });
    }
  },
  updateSyncBadge() {
    const b = this.els.syncBtn; if (!b) return;
    clear(b);
    const st = this.sync?.status || { state: 'idle' };
    let ic = 'cloud', badge = '';
    if (!auth.isConfigured() || !auth.isSignedIn()) { ic = 'cloud-off'; }
    else if (!isOnline()) { ic = 'cloud-off'; badge = 'warn'; }
    else if (st.state === 'syncing') { ic = 'cloud-upload'; badge = 'busy'; }
    else if (st.state === 'error' || st.state === 'signedOut') { ic = 'cloud'; badge = ''; b.title = st.message || t('sync.error'); badge = 'err'; }
    else if (store.pendingCount) { ic = 'cloud-upload'; badge = 'warn'; }
    else { ic = 'cloud-check'; }
    b.appendChild(icon(ic));
    if (badge) b.appendChild(h('span', { class: `badge ${badge === 'err' ? '' : badge}` }));
    b.title = st.state === 'syncing' ? t('sync.syncing') : (st.state === 'error' ? `${t('sync.error')}: ${st.message}` : (auth.isSignedIn() ? (store.pendingCount ? t('sync.pending', { n: store.pendingCount }) : t('sync.idle')) : t('sync.signedOut')));
  },
  updateAccountBtn() {
    const b = this.els.accountBtn; if (!b) return;
    const acc = auth.account();
    clear(b);
    const av = h('span', { class: 'avatar', style: { width: '28px', height: '28px', fontSize: '12px' } });
    if (acc && this.photoUrl) av.appendChild(h('img', { src: this.photoUrl, alt: '' }));
    else if (acc) av.textContent = (acc.name || acc.username || '?').trim()[0]?.toUpperCase() || '?';
    else av.appendChild(icon('user', { size: 16 }));
    b.appendChild(av);
    b.title = acc ? `${acc.name} · ${acc.username}` : t('settings.account');
  },

  async wipe() {
    if (this.sync) { this.sync.rootId = ''; this.sync.trashId = ''; }
    for (const u of store.thumbUrls.values()) URL.revokeObjectURL(u);
    await db.wipe();
    localStorage.removeItem('rfoof.auth');
    location.reload();
  },
};

window.rfoof = app; app.store = store; app.license = license; app.install = install;
app.boot().catch(e => { console.error(e); document.body.innerHTML = `<div class="empty-state" style="height:100%;justify-content:center"><h3>Rfoof could not start</h3><p>${(e && e.message) || e}</p></div>`; });
