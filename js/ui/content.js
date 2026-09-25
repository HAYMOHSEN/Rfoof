import { h, clear, formatBytes, throttle, debounce } from '../utils.js';
import { icon, folderTileSvg, KIND_ICON, KIND_COLOR } from '../icons.js';
import { store, COLORS } from '../store.js';
import { t, locale, fmtDate, fmtNum, isRTL } from '../i18n.js';
import { actions } from './actions.js';
import { makeDropTarget, makeDragSource } from './dnd.js';
import { showMenu } from './menu.js';
import { highlight, snippet } from '../search.js';
import { promptDialog } from './dialog.js';
import { colorPicker } from './pickers.js';
import { app } from '../app.js';

const GAP = 12;

export class ContentView {
  constructor(toolbarEl, contentEl, bulkEl) {
    this.toolbar = toolbarEl; this.content = contentEl; this.bulk = bulkEl;
    this.items = []; this.folders = []; this.anchor = null; this.selectedFolder = null;
    this.snippets = new Map();
    this.content.addEventListener('scroll', throttle(() => this.renderWindow(), 40), { passive: true });
    new ResizeObserver(debounce(() => this.renderWindow(true), 60)).observe(this.content);
    this.unsubs = ['nav', 'files', 'folders', 'ready'].map(ev => store.on(ev, () => this.schedule(true)));
    this.unsubs.push(store.on('selection', () => this.schedule(false)));
    this.unsubs.push(store.on('settings', (k) => { if (['sort', 'layout', 'density'].includes(k)) this.schedule(true); }));
    this.unsubs.push(store.on('thumb', (id) => this.refreshThumb(id)));
    makeDropTarget(this.content, { getFolderId: () => (store.view.type === 'folder' ? store.view.id : (store.view.type === 'all' ? '' : null)), label: true, acceptFolders: true });
    this.content.addEventListener('click', (e) => { if (e.target === this.content || e.target.classList.contains('content-inner') || e.target.classList.contains('files-section')) { store.clearSelection(); this.selectedFolder = null; } });
    this.content.addEventListener('contextmenu', (e) => {
      if (e.target === this.content || e.target.classList.contains('content-inner') || e.target.classList.contains('files-section')) {
        e.preventDefault(); this.backgroundMenu({ x: e.clientX, y: e.clientY });
      }
    });
    this.content.tabIndex = 0;
    this.content.addEventListener('keydown', (e) => this.onKey(e));
    if (store.ready) this.rebuild();
  }
  destroy() { this.unsubs.forEach(u => u()); this.unsubs = []; }
  schedule(full) { this._full = this._full || full; if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = null; const f = this._full; this._full = false; f ? this.rebuild() : this.updateSelectionOnly(); }); }

  // ---------------- toolbar ----------------
  renderToolbar() {
    const v = store.view; const tb = this.toolbar; clear(tb);
    const crumbs = h('div', { class: 'crumbs' });
    const sep = () => h('span', { class: 'crumb-sep' }, icon('chevron-right', { size: 16, cls: 'flip' }));
    const crumb = (label, view, current, dropFolder, ic) => {
      const c = h('button', { class: `crumb ${current ? 'current' : ''}`, onclick: () => { if (!current) store.navigate(view); } }, ic ? icon(ic, { size: 16 }) : null, h('span', { class: 'name', text: label }));
      if (dropFolder !== undefined && !current) makeDropTarget(c, { folderId: dropFolder });
      return c;
    };
    if (v.type === 'folder') {
      const path = store.folderPath(v.id);
      crumbs.appendChild(crumb(t('nav.home'), { type: 'all' }, false, '', 'home'));
      path.forEach((fo, i) => { crumbs.appendChild(sep()); crumbs.appendChild(crumb(fo.name, { type: 'folder', id: fo.id }, i === path.length - 1, fo.id)); });
    } else {
      const labels = { all: t('nav.allFiles'), recent: t('nav.recent'), starred: t('nav.starred'), trash: t('nav.trash'), cloud: t('nav.cloudOnly'), search: t('search.results') };
      const ics = { all: 'layers', recent: 'clock', starred: 'star', trash: 'trash', cloud: 'cloud', search: 'search', tag: 'tag', kind: 'file' };
      let label = labels[v.type] || '';
      if (v.type === 'tag') label = v.tag;
      if (v.type === 'kind') { label = t('kind.' + v.kind); }
      if (v.type === 'search') label = `${t('search.results')}: “${v.query}”`;
      crumbs.appendChild(crumb(label, v, true, undefined, v.type === 'kind' ? KIND_ICON[v.kind] : ics[v.type]));
    }
    tb.appendChild(crumbs);
    const nFiles = this.items.length, nFolders = this.folders.length;
    tb.appendChild(h('span', { class: 'count-label', text: nFolders ? t('folder.count', { files: fmtNum(nFiles), folders: fmtNum(nFolders) }) : `${fmtNum(nFiles)} ${t('label.files')}` }));
    if (v.type === 'trash') {
      tb.appendChild(h('button', { class: 'btn sm danger', onclick: () => actions.emptyTrash(), disabled: !(nFiles || nFolders) || null }, icon('trash', { size: 16 }), t('action.emptyTrash')));
    } else if (v.type === 'folder' || v.type === 'all') {
      tb.appendChild(h('button', { class: 'icon-btn', title: t('action.newFolder'), onclick: () => actions.newFolder(v.type === 'folder' ? v.id : '') }, icon('folder-plus')));
    }
    // sort
    const s = store.settings.sort || { field: 'addedAt', dir: -1 };
    tb.appendChild(h('button', { class: 'icon-btn', title: t('label.sort'), onclick: (e) => this.sortMenu(e.currentTarget) }, icon('sort')));
    // layout
    const layout = store.settings.layout || 'grid';
    tb.appendChild(h('button', { class: 'icon-btn', title: layout === 'grid' ? t('label.list') : t('label.grid'), onclick: () => store.setSetting('layout', layout === 'grid' ? 'list' : 'grid') }, icon(layout === 'grid' ? 'list' : 'grid')));
  }
  sortMenu(anchor) {
    const s = store.settings.sort || { field: 'addedAt', dir: -1 };
    const fields = [['title', t('label.sortName')], ['addedAt', t('label.sortAdded')], ['updatedAt', t('label.sortModified')], ['size', t('label.sortSize')], ['kind', t('label.sortType')]];
    showMenu([
      { header: t('label.sort') },
      ...fields.map(([f, label]) => ({ label, checked: s.field === f, onClick: () => store.setSetting('sort', { field: f, dir: s.field === f ? s.dir : (f === 'title' || f === 'kind' ? 1 : -1) }) })),
      { separator: true },
      { label: t('label.asc'), checked: s.dir === 1, onClick: () => store.setSetting('sort', { ...s, dir: 1 }) },
      { label: t('label.desc'), checked: s.dir === -1, onClick: () => store.setSetting('sort', { ...s, dir: -1 }) },
    ], { anchor, align: 'end' });
  }
  backgroundMenu(pos) {
    const v = store.view;
    if (v.type !== 'folder' && v.type !== 'all') return;
    const fid = v.type === 'folder' ? v.id : '';
    showMenu([
      { label: t('action.import'), icon: 'upload', onClick: () => actions.import([], fid) },
      { label: t('action.newFolder'), icon: 'folder-plus', onClick: () => actions.newFolder(fid) },
      { separator: true },
      { label: t('action.selectAll'), icon: 'check', onClick: () => store.select(this.items.map(f => f.id)) },
      { label: store.settings.layout === 'grid' ? t('label.list') : t('label.grid'), icon: store.settings.layout === 'grid' ? 'list' : 'grid', onClick: () => store.setSetting('layout', store.settings.layout === 'grid' ? 'list' : 'grid') },
    ], pos);
  }

  // ---------------- build ----------------
  rebuild() {
    const { folders, files } = store.currentItems();
    this.folders = folders; this.items = files;
    this.snippets.clear();
    if (store.view.type === 'search' && store.view.results) for (const r of store.view.results) if (r.contentHit) this.snippets.set(r.file.id, true);
    this.renderToolbar();
    const c = this.content; clear(c);
    c.classList.toggle('has-selection', store.selection.size > 0);
    const inner = h('div', { class: 'content-inner' });
    c.appendChild(inner);
    const v = store.view;
    if (v.type === 'search' && v.query) {
      inner.appendChild(h('div', { class: 'row', style: { marginBottom: '12px', gap: '12px' } },
        h('label', { class: 'row small muted', style: { cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: store.settings.contentSearch !== false || null, onchange: (e) => { store.setSetting('contentSearch', e.target.checked); app.runSearch(v.query, true); } }), t('search.inContent')),
        h('span', { class: 'small muted', text: t('search.hint') })));
    }
    if (folders.length) {
      if (files.length || v.type === 'trash') inner.appendChild(h('div', { class: 'section-title', text: t('nav.folders') }));
      const fg = h('div', { class: 'folders-grid' });
      for (const fo of folders) fg.appendChild(this.folderCard(fo));
      inner.appendChild(fg);
    }
    if (files.length) {
      if (folders.length) inner.appendChild(h('div', { class: 'section-title', text: t('label.files') }));
      if (store.settings.layout === 'list') inner.appendChild(this.listHeader());
      this.section = h('div', { class: 'files-section' });
      this.window = h('div', { class: `files-window ${store.settings.layout === 'list' ? 'list' : ''}` });
      this.section.appendChild(this.window);
      inner.appendChild(this.section);
      this.renderWindow(true);
    } else {
      this.section = null; this.window = null;
      if (!folders.length) inner.appendChild(this.emptyState());
    }
    this.renderBulk();
  }
  listHeader() {
    return h('div', { class: 'list-header' }, h('span'), h('span', { text: t('label.name') }), h('span', { class: 'tags', text: t('label.tags') }), h('span', { class: 'type', text: t('label.type') }), h('span', { text: t('label.size') }), h('span', { class: 'date', text: t('label.added') }));
  }
  emptyState() {
    const v = store.view;
    let ic = 'folder-open', title = t('folder.empty'), hint = t('folder.emptyHint');
    if (v.type === 'all') { ic = 'upload'; title = t('empty.all'); hint = t('empty.allHint'); }
    else if (v.type === 'recent') { ic = 'clock'; title = t('empty.recent'); hint = ''; }
    else if (v.type === 'starred') { ic = 'star'; title = t('empty.starred'); hint = t('empty.starredHint'); }
    else if (v.type === 'trash') { ic = 'trash'; title = t('trash.empty'); hint = t('trash.hint'); }
    else if (v.type === 'tag') { ic = 'tag'; title = t('empty.tag'); hint = ''; }
    else if (v.type === 'kind') { ic = KIND_ICON[v.kind]; title = t('empty.kind'); hint = ''; }
    else if (v.type === 'cloud') { ic = 'cloud'; title = t('empty.cloud'); hint = ''; }
    else if (v.type === 'search') { ic = 'search'; title = t('search.noResults'); hint = ''; }
    const es = h('div', { class: 'empty-state' }, icon(ic), h('h3', { text: title }), hint ? h('p', { text: hint }) : null);
    if (v.type === 'all' || v.type === 'folder') es.appendChild(h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: () => actions.import([], v.type === 'folder' ? v.id : '') }, icon('plus', { size: 18 }), t('action.import')));
    return es;
  }

  folderCard(fo) {
    const trashed = !!fo.deletedAt;
    const stats = store.folderStats(fo.id);
    const card = h('div', { class: `folder-card ${this.selectedFolder === fo.id ? 'selected' : ''}`, tabindex: 0, role: 'button', title: fo.name,
      onclick: (e) => { e.stopPropagation(); this.selectedFolder = fo.id; store.clearSelection(); app.showFolderDetails(fo.id); this.updateSelectionOnly(); },
      ondblclick: () => { if (!trashed) actions.openFolder(fo.id); },
      onkeydown: (e) => { if (e.key === 'Enter' && !trashed) actions.openFolder(fo.id); },
      oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); actions.folderMenu(fo.id, { x: e.clientX, y: e.clientY }); } },
      h('span', { html: folderTileSvg(COLORS[fo.color] || fo.color || COLORS.gray, fo.icon, 44) }),
      h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'name', text: fo.name }), h('div', { class: 'meta', text: t('folder.count', { files: fmtNum(stats.files), folders: fmtNum(stats.folders) }) })),
      h('button', { class: 'icon-btn sm', title: t('action.more'), onclick: (e) => { e.stopPropagation(); actions.folderMenu(fo.id, { anchor: e.currentTarget, align: 'end' }); } }, icon('more-v', { size: 16 })));
    if (!trashed) { makeDropTarget(card, { folderId: fo.id }); makeDragSource(card, () => ({ ids: [fo.id], kind: 'folder' })); }
    // mobile: single tap opens
    card.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch' && !trashed) actions.openFolder(fo.id); });
    return card;
  }

  // ---------------- virtual window ----------------
  metrics() {
    const list = store.settings.layout === 'list';
    const cs = getComputedStyle(document.documentElement);
    const cardW = parseInt(cs.getPropertyValue('--card-w')) || 200;
    const cardH = parseInt(cs.getPropertyValue('--card-h')) || 214;
    const width = this.section ? this.section.clientWidth : this.content.clientWidth - 32;
    const cols = list ? 1 : Math.max(1, Math.floor((width + GAP) / (cardW + GAP)));
    const rowH = list ? 46 : cardH + GAP;
    return { cols, rowH, list };
  }
  renderWindow(force = false) {
    if (!this.section || !this.window) return;
    const { cols, rowH, list } = this.metrics();
    const total = this.items.length;
    const rows = Math.ceil(total / cols);
    this.section.style.height = (rows * rowH - (list ? 0 : GAP)) + 'px';
    this.window.style.setProperty('--cols', cols);
    const top = this.section.offsetTop;
    const st = this.content.scrollTop; const vh = this.content.clientHeight;
    const first = Math.max(0, Math.floor((st - top) / rowH) - 2);
    const last = Math.min(rows, Math.ceil((st + vh - top) / rowH) + 2);
    const key = `${first}:${last}:${cols}:${list}`;
    if (!force && key === this._winKey) return;
    this._winKey = key;
    this.window.style.transform = `translateY(${first * rowH}px)`;
    clear(this.window);
    const start = first * cols, end = Math.min(total, last * cols);
    for (let i = start; i < end; i++) this.window.appendChild(list ? this.fileRow(this.items[i], i) : this.fileCard(this.items[i], i));
  }
  refreshThumb(id) {
    if (!this.window) return;
    const el = this.window.querySelector(`[data-id="${id}"] .thumb`);
    if (el) this.fillThumb(el, store.file(id));
  }
  async fillThumb(el, f) {
    if (!f) return;
    const mini = el.classList.contains('mini');
    let inner = el.querySelector(':scope > .thumb-inner');
    if (!inner) { inner = h('div', { class: 'thumb-inner' }); el.prepend(inner); }
    const token = inner.dataset.token = String(Math.random());
    if (f.thumb) {
      const url = await store.thumbURL(f.id);
      if (inner.dataset.token !== token) return;
      if (url && el.isConnected) {
        clear(inner);
        inner.appendChild(h('img', { src: url, alt: '', loading: 'lazy', draggable: false }));
        el.classList.toggle('contain', f.kind === 'pdf' || f.kind === 'doc');
        this.thumbBadges(inner, f, mini);
        return;
      }
    }
    clear(inner);
    const big = h('span', { class: mini ? 'mini-icon' : 'big-icon', style: { background: KIND_COLOR[f.kind] || KIND_COLOR.other } }, icon(KIND_ICON[f.kind] || 'file', { size: mini ? 13 : 26 }));
    if (!mini) big.appendChild(h('span', { class: 'ext', text: (f.ext || '').slice(0, 5) }));
    inner.appendChild(big);
    this.thumbBadges(inner, f, mini);
  }
  thumbBadges(el, f, mini) {
    if (mini) return;
    if (f.color) el.appendChild(h('span', { class: 'color-bar', style: { background: COLORS[f.color] || f.color } }));
    if (!f.hasBlob) el.appendChild(h('span', { class: 'cloud-badge', title: t('details.sync.cloud') }, icon('cloud', { size: 14 })));
  }

  fileCard(f, index) {
    const q = store.view.type === 'search' ? store.view.query : '';
    const card = h('div', { class: `file-card ${store.selection.has(f.id) ? 'selected' : ''} ${f.starred ? 'starred' : ''}`, dataset: { id: f.id, index }, tabindex: -1, title: f.title });
    const thumb = h('div', { class: 'thumb' });
    this.fillThumb(thumb, f);
    thumb.appendChild(h('span', { class: 'check', onclick: (e) => { e.stopPropagation(); store.select([f.id], 'toggle'); this.anchor = index; } }, icon('check', { size: 14, stroke: 3 })));
    thumb.appendChild(h('button', { class: 'star-btn', title: f.starred ? t('action.unstar') : t('action.star'), onclick: (e) => { e.stopPropagation(); actions.star([f.id], !f.starred); } }, icon('star', { size: 14 })));
    card.appendChild(thumb);
    const body = h('div', { class: 'body' });
    body.appendChild(h('div', { class: 'title', html: q ? highlight(f.title, q) : undefined, text: q ? undefined : f.title }));
    if (f.tags?.length) { const tg = h('div', { class: 'tags' }); f.tags.slice(0, 3).forEach(x => tg.appendChild(h('span', { class: 'chip', text: x }))); if (f.tags.length > 3) tg.appendChild(h('span', { class: 'chip', text: '+' + (f.tags.length - 3) })); body.appendChild(tg); }
    const meta = h('div', { class: 'meta' }, h('span', { class: 'bdi', text: (f.ext || t('kind.' + f.kind)).toUpperCase() }), ' · ', h('span', { class: 'ltr', text: formatBytes(f.size, locale()) }), ' · ', h('span', { class: 'bdi', text: fmtDate(f.addedAt) }));
    body.appendChild(meta);
    // one line in a narrow card: start just before the hit so the highlighted word stays visible
    if (this.snippets.has(f.id)) { const sn = h('div', { class: 'result-snippet' }); store.getText(f.id).then(txt => { sn.innerHTML = highlight(snippet(txt, q, 40, 12), q); }); body.appendChild(sn); }
    card.appendChild(body);
    this.wireItem(card, f, index);
    return card;
  }
  fileRow(f, index) {
    const q = store.view.type === 'search' ? store.view.query : '';
    const row = h('div', { class: `file-row ${store.selection.has(f.id) ? 'selected' : ''}`, dataset: { id: f.id, index }, tabindex: -1, style: { marginBottom: '2px' } });
    const thumb = h('div', { class: 'thumb mini' });
    this.fillThumb(thumb, f);
    row.appendChild(thumb);
    const title = h('div', { class: 'title' });
    if (f.color) title.appendChild(h('span', { class: 'dot', style: { background: COLORS[f.color] || f.color } }));
    title.appendChild(h('span', { class: 'ellipsis', html: q ? highlight(f.title, q) : undefined, text: q ? undefined : f.title }));
    if (f.starred) title.appendChild(h('span', { style: { color: '#f5c518', display: 'inline-flex' } }, icon('star', { size: 13 })));
    if (!f.hasBlob) title.appendChild(h('span', { class: 'muted', style: { display: 'inline-flex' }, title: t('details.sync.cloud') }, icon('cloud', { size: 14 })));
    row.appendChild(title);
    const tg = h('div', { class: 'tags' }); (f.tags || []).slice(0, 3).forEach(x => tg.appendChild(h('span', { class: 'chip', text: x }))); row.appendChild(tg);
    row.appendChild(h('div', { class: 'c type', text: (f.ext || f.kind).toUpperCase() }));
    row.appendChild(h('div', { class: 'c' }, h('span', { class: 'ltr', text: formatBytes(f.size, locale()) })));
    row.appendChild(h('div', { class: 'c date', text: fmtDate(f.addedAt) }));
    this.wireItem(row, f, index);
    return row;
  }
  wireItem(el, f, index) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectedFolder = null;
      if (e.shiftKey && this.anchor !== null) {
        const [a, b] = [Math.min(this.anchor, index), Math.max(this.anchor, index)];
        store.select(this.items.slice(a, b + 1).map(x => x.id), e.ctrlKey || e.metaKey ? 'add' : 'replace');
      } else if (e.ctrlKey || e.metaKey) { store.select([f.id], 'toggle'); this.anchor = index; }
      else { store.select([f.id]); this.anchor = index; }
      this.content.focus({ preventScroll: true });
    });
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); if (!f.deletedAt) actions.openFile(f.id, this.items.map(x => x.id)); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!store.selection.has(f.id)) { store.select([f.id]); this.anchor = index; }
      actions.fileMenu(Array.from(store.selection), { x: e.clientX, y: e.clientY });
    });
    // touch: single tap opens when nothing is selected
    let lastTap = 0;
    el.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') return;
      const nowT = Date.now();
      if (nowT - lastTap < 350) return; lastTap = nowT;
      if (!store.selection.size && !f.deletedAt) { setTimeout(() => { if (store.selection.size === 1 && store.selection.has(f.id)) { store.clearSelection(); actions.openFile(f.id, this.items.map(x => x.id)); } }, 30); }
    });
    if (!f.deletedAt) makeDragSource(el, () => ({ ids: store.selection.has(f.id) ? Array.from(store.selection) : [f.id], kind: 'files' }));
  }
  updateSelectionOnly() {
    this.content.classList.toggle('has-selection', store.selection.size > 0);
    if (this.window) for (const el of this.window.children) el.classList.toggle('selected', store.selection.has(el.dataset.id));
    for (const el of this.content.querySelectorAll('.folder-card')) el.classList.toggle('selected', false);
    this.renderBulk();
  }

  // ---------------- bulk bar ----------------
  renderBulk() {
    const b = this.bulk; clear(b);
    const n = store.selection.size;
    document.body.classList.toggle('has-bulk', n > 0);
    if (!n) { b.hidden = true; return; }
    b.hidden = false;
    const ids = Array.from(store.selection);
    const trash = store.view.type === 'trash';
    const btn = (ic, title, fn, cls = '') => h('button', { class: `icon-btn ${cls}`, title, onclick: fn }, icon(ic));
    b.appendChild(h('span', { class: 'label', text: `${fmtNum(n)} ${t('label.selected')}` }));
    if (trash) {
      b.appendChild(btn('restore', t('action.restore'), () => actions.restore(ids)));
      b.appendChild(btn('trash', t('action.deleteForever'), () => actions.purge(ids)));
    } else {
      b.appendChild(btn('star', t('action.star'), () => actions.star(ids)));
      b.appendChild(btn('folder-input', t('action.move'), () => actions.move(ids)));
      b.appendChild(btn('tag', t('action.addTag'), async () => { const v = await promptDialog({ title: t('action.addTag'), label: t('label.tags'), okLabel: t('action.apply') }); if (v) actions.addTags(ids, v.split(/[,،]/).map(s => s.trim()).filter(Boolean)); }));
      b.appendChild(btn('palette', t('action.color'), (e) => showMenu([{ header: t('action.color') }, { custom: colorPicker(n === 1 ? store.file(ids[0])?.color || '' : '', (c) => actions.setColor(ids, c)) }], { anchor: e.currentTarget })));
      if (n === 1) b.appendChild(btn('download', t('action.download'), () => actions.download(ids[0])));
      b.appendChild(btn('trash', t('action.delete'), () => actions.trash(ids)));
    }
    b.appendChild(btn('x', t('action.deselect'), () => store.clearSelection()));
  }

  // ---------------- keyboard ----------------
  onKey(e) {
    if (e.target !== this.content && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const sel = Array.from(store.selection);
    const trash = store.view.type === 'trash';
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.length) { e.preventDefault(); trash ? actions.purge(sel) : actions.trash(sel); } return; }
    if (e.key === 'Enter') { if (sel.length === 1 && !trash) { e.preventDefault(); actions.openFile(sel[0], this.items.map(x => x.id)); } return; }
    if (e.key === 'F2') { if (sel.length === 1) { e.preventDefault(); actions.rename(sel[0]); } return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); store.select(this.items.map(f => f.id)); return; }
    if (e.key === 'Escape') { store.clearSelection(); return; }
    if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && sel.length) { e.preventDefault(); actions.star(sel); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && this.items.length) {
      e.preventDefault();
      const { cols } = this.metrics();
      let i = this.anchor ?? -1;
      const rtl = isRTL();
      const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      if (e.key === 'Home') i = 0; else if (e.key === 'End') i = this.items.length - 1; else i = i < 0 ? 0 : Math.min(this.items.length - 1, Math.max(0, i + step));
      this.anchor = i;
      store.select([this.items[i].id], e.shiftKey ? 'add' : 'replace');
      this.scrollToIndex(i);
    }
  }
  scrollToIndex(i) {
    const { cols, rowH } = this.metrics();
    if (!this.section) return;
    const top = this.section.offsetTop + Math.floor(i / cols) * rowH;
    const st = this.content.scrollTop, vh = this.content.clientHeight;
    if (top < st + 10) this.content.scrollTop = top - 10;
    else if (top + rowH > st + vh) this.content.scrollTop = top + rowH - vh + 10;
    requestAnimationFrame(() => this.window?.querySelector(`[data-index="${i}"]`)?.focus({ preventScroll: true }));
  }
}
