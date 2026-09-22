import { h, clear, formatBytes, debounce } from '../utils.js';
import { icon, folderTileSvg, KIND_ICON, KIND_COLOR } from '../icons.js';
import { store, COLORS } from '../store.js';
import { t, locale, fmtDateTime, fmtNum } from '../i18n.js';
import { actions } from './actions.js';
import { tagEditor, colorPicker } from './pickers.js';
import { app } from '../app.js';

export class DetailsPanel {
  constructor(el, { onClose = null } = {}) {
    this.el = el; this.folderId = null; this.currentId = null; this.pinned = null; this.onClose = onClose;
    this.unsubs = [
      store.on('selection', () => { if (this.pinned) return; this.folderId = null; this.schedule(); }),
      store.on('files', (ids) => { if (!ids || !this.currentId || ids.includes(this.currentId)) this.schedule(); }),
      store.on('folders', () => this.schedule()),
      store.on('thumb', (id) => { if (id === this.currentId) this.schedule(); }),
      store.on('nav', () => { if (this.pinned) return; this.folderId = null; this.schedule(); }),
    ];
    this.render();
  }
  destroy() { this.unsubs.forEach(u => u()); this.unsubs = []; }
  schedule() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = null; this.render(); }); }
  showFolder(id) { this.folderId = id; this.render(); }

  render() {
    const el = this.el;
    if (!el.isConnected && this.pinned) return;
    const sel = this.pinned ? [this.pinned] : Array.from(store.selection);
    const ae = document.activeElement;
    if (ae && el.contains(ae) && ['INPUT', 'TEXTAREA'].includes(ae.tagName) && sel.length === 1 && sel[0] === this.currentId && !this.folderId) {
      return; // don't rebuild while the user is typing about the same file
    }
    clear(el);
    el.appendChild(h('div', { class: 'details-head' }, h('span', { text: t('details.title') }), h('button', { class: 'icon-btn sm', title: t('action.close'), onclick: () => (this.onClose ? this.onClose() : app.setDetails(false)) }, icon('x', { size: 18 }))));
    const body = h('div', { class: 'details-body' }); el.appendChild(body);
    if (this.folderId && store.folder(this.folderId)) this.renderFolder(body, store.folder(this.folderId));
    else if (sel.length === 1 && store.file(sel[0])) this.renderFile(body, store.file(sel[0]));
    else if (sel.length > 1) this.renderMulti(body, sel);
    else { this.currentId = null; body.appendChild(h('div', { class: 'empty-state', style: { padding: '40px 10px' } }, icon('info'), h('p', { text: t('details.none') }))); }
  }

  renderMulti(body, ids) {
    this.currentId = null;
    const files = ids.map(id => store.file(id)).filter(Boolean);
    const size = files.reduce((s, f) => s + (f.size || 0), 0);
    body.appendChild(h('h3', { style: { margin: '0 0 8px' }, text: t('details.multi', { n: fmtNum(files.length) }) }));
    body.appendChild(h('div', { class: 'muted small', text: formatBytes(size, locale()) }));
    body.appendChild(h('div', { class: 'divider' }));
    body.appendChild(h('div', { class: 'field' }, h('label', { text: t('label.tags') }), tagEditor([], (tags) => { if (tags.length) actions.addTags(ids, tags); }, { placeholder: t('action.addTag') })));
    body.appendChild(h('div', { class: 'field' }, h('label', { text: t('label.color') }), colorPicker('', (c) => actions.setColor(ids, c))));
    body.appendChild(h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', onclick: () => actions.move(ids) }, icon('folder-input', { size: 16 }), t('action.move')),
      h('button', { class: 'btn sm', onclick: () => actions.star(ids) }, icon('star', { size: 16 }), t('action.star')),
      h('button', { class: 'btn sm danger', onclick: () => actions.trash(ids) }, icon('trash', { size: 16 }), t('action.delete'))));
  }

  renderFolder(body, fo) {
    this.currentId = null;
    const stats = store.folderStats(fo.id);
    let total = 0, count = 0; for (const f of store.files.values()) if (!f.deletedAt && store.descendantFolderIds(fo.id).has(f.folderId)) { total += f.size || 0; count++; }
    body.appendChild(h('div', { style: { display: 'flex', justifyContent: 'center', margin: '4px 0 12px' }, html: folderTileSvg(COLORS[fo.color] || fo.color, fo.icon, 96) }));
    body.appendChild(h('h3', { style: { margin: '0 0 4px', textAlign: 'center' }, text: fo.name }));
    body.appendChild(h('div', { class: 'muted small', style: { textAlign: 'center' }, text: store.folderPathString(fo.parentId) || t('label.root') }));
    const kv = h('dl', { class: 'kv' });
    kv.append(h('dt', { text: t('label.files') }), h('dd', { text: `${fmtNum(stats.files)} (${fmtNum(count)} ${t('label.items')})` }));
    kv.append(h('dt', { text: t('label.subfolders') }), h('dd', { text: fmtNum(stats.folders) }));
    kv.append(h('dt', { text: t('label.size') }), h('dd', {}, h('span', { class: 'ltr', text: formatBytes(total, locale()) })));
    kv.append(h('dt', { text: t('label.added') }), h('dd', { text: fmtDateTime(fo.createdAt) }));
    kv.append(h('dt', { text: t('label.modified') }), h('dd', { text: fmtDateTime(fo.updatedAt) }));
    body.appendChild(kv);
    body.appendChild(h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm primary', onclick: () => actions.openFolder(fo.id) }, icon('folder-open', { size: 16 }), t('action.open')),
      h('button', { class: 'btn sm', onclick: () => actions.editFolder(fo.id) }, icon('pencil', { size: 16 }), t('action.edit')),
      h('button', { class: 'btn sm', onclick: () => actions.import([], fo.id) }, icon('upload', { size: 16 }), t('action.import')),
      h('button', { class: 'btn sm danger', onclick: () => actions.deleteFolder(fo.id) }, icon('trash', { size: 16 }), t('action.delete'))));
  }

  renderFile(body, f) {
    this.currentId = f.id;
    // preview
    const prev = h('div', { class: 'preview', onclick: () => { if (!f.deletedAt) actions.openFile(f.id); } });
    const big = h('span', { class: 'big-icon', style: { background: KIND_COLOR[f.kind] || KIND_COLOR.other } }, icon(KIND_ICON[f.kind] || 'file', { size: 30 }), h('span', { class: 'ext', text: (f.ext || '').slice(0, 5) }));
    prev.appendChild(big);
    if (f.thumb) store.thumbURL(f.id).then(url => { if (url && prev.isConnected) { clear(prev); prev.appendChild(h('img', { src: url, alt: '' })); if (f.kind === 'video') prev.appendChild(h('span', { class: 'play' }, icon('play', { size: 20 }))); } });
    body.appendChild(prev);
    // title
    const title = h('input', { class: 'input title-input', value: f.title, 'aria-label': t('label.title') });
    const saveTitle = () => { const v = title.value.trim(); if (v && v !== store.file(f.id)?.title) store.updateFile(f.id, { title: v }); };
    title.addEventListener('change', saveTitle);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
    body.appendChild(h('div', { class: 'field' }, title, h('div', { class: 'hint ellipsis', title: f.originalName, text: f.originalName ? `${t('label.originalName')}: ${f.originalName}` : '' })));
    // quick actions
    body.appendChild(h('div', { class: 'row wrap', style: { marginBottom: '12px' } },
      f.deletedAt ? h('button', { class: 'btn sm primary', onclick: () => actions.restore([f.id]) }, icon('restore', { size: 16 }), t('action.restore'))
        : h('button', { class: 'btn sm primary', onclick: () => actions.openFile(f.id) }, icon('eye', { size: 16 }), t('action.open')),
      h('button', { class: `icon-btn ${f.starred ? 'active' : ''}`, title: f.starred ? t('action.unstar') : t('action.star'), onclick: () => actions.star([f.id], !f.starred) }, icon('star', { size: 18 })),
      h('button', { class: 'icon-btn', title: t('action.download'), onclick: () => actions.download(f.id) }, icon('download', { size: 18 })),
      h('button', { class: 'icon-btn', title: t('action.move'), onclick: () => actions.move([f.id]) }, icon('folder-input', { size: 18 })),
      h('button', { class: 'icon-btn', title: t('action.more'), onclick: (e) => actions.fileMenu([f.id], { anchor: e.currentTarget }) }, icon('more-h', { size: 18 }))));
    // tags / color / notes
    body.appendChild(h('div', { class: 'field' }, h('label', { text: t('label.tags') }), tagEditor(f.tags, (tags) => store.updateFile(f.id, { tags }))));
    body.appendChild(h('div', { class: 'field' }, h('label', { text: t('label.color') }), colorPicker(f.color, (c) => store.updateFile(f.id, { color: c }))));
    const notes = h('textarea', { class: 'textarea', placeholder: t('label.notesPlaceholder'), 'aria-label': t('label.notes') }); notes.value = f.notes || '';
    const saveNotes = debounce(() => { if (notes.value !== store.file(f.id)?.notes) store.updateFile(f.id, { notes: notes.value }, { emit: false }); }, 500);
    notes.addEventListener('input', saveNotes);
    notes.addEventListener('blur', () => { if (notes.value !== store.file(f.id)?.notes) store.updateFile(f.id, { notes: notes.value }); });
    body.appendChild(h('div', { class: 'field' }, h('label', { text: t('label.notes') }), notes));
    // info
    const kv = h('dl', { class: 'kv' });
    const folderBtn = h('button', { class: 'chip clickable', onclick: () => actions.move([f.id]) }, icon('folder', { size: 13 }), store.folderPathString(f.folderId) || t('label.root'));
    kv.append(h('dt', { text: t('label.folder') }), h('dd', {}, folderBtn));
    kv.append(h('dt', { text: t('label.type') }), h('dd', { text: f.ext && f.ext.toUpperCase() !== t('kind.' + f.kind) ? `${t('kind.' + f.kind)} · ${f.ext.toUpperCase()}` : t('kind.' + f.kind) }));
    kv.append(h('dt', { text: t('label.size') }), h('dd', {}, h('span', { class: 'ltr', text: formatBytes(f.size, locale()) })));
    kv.append(h('dt', { text: t('label.added') }), h('dd', {}, h('span', { class: 'bdi', text: fmtDateTime(f.addedAt) })));
    kv.append(h('dt', { text: t('label.modified') }), h('dd', {}, h('span', { class: 'bdi', text: fmtDateTime(f.updatedAt) })));
    if (f.createdAt && Math.abs(f.createdAt - f.addedAt) > 60000) kv.append(h('dt', { text: t('label.fileDate') }), h('dd', {}, h('span', { class: 'bdi', text: fmtDateTime(f.createdAt) })));
    body.appendChild(kv);
    // text preview
    if (f.indexed && ['pdf', 'doc', 'text', 'code', 'sheet', 'slides'].includes(f.kind)) {
      const tp = h('div', { class: 'text-preview' });
      store.getText(f.id).then(txt => { if (txt && tp.isConnected) { tp.textContent = txt.slice(0, 700).trim() + (txt.length > 700 ? ' …' : ''); } else tp.remove(); });
      body.appendChild(h('div', { class: 'field' }, h('label', { text: t('details.textPreview') }), tp));
    }
  }
}
