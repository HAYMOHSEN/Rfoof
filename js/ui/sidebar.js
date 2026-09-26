import { h, clear, formatBytes } from '../utils.js';
import { icon, folderTileSvg, KIND_ICON } from '../icons.js';
import { store, COLORS } from '../store.js';
import { t, locale, fmtNum } from '../i18n.js';
import { actions } from './actions.js';
import { makeDropTarget, makeDragSource } from './dnd.js';
import { db } from '../db.js';
import { app } from '../app.js';
import { license, licenseEvents } from '../license.js';
import { install, installEvents } from '../install.js';
import { toast } from './toast.js';

export class Sidebar {
  constructor(el) {
    this.el = el;
    this.tagsExpanded = false;
    this.render = this.render.bind(this);
    this.unsubs = ['folders', 'files', 'nav', 'ready'].map(ev => store.on(ev, () => this.schedule()));
    this.unsubs.push(store.on('settings', (k) => { if (k === 'expanded' || k === 'licensed' || k === 'trialImports') this.schedule(); }));
    this.unsubs.push(licenseEvents.on('change', () => this.schedule()));
    this.unsubs.push(installEvents.on('change', () => this.schedule()));
    this.render();
  }
  destroy() { this.unsubs.forEach(u => u()); this.unsubs = []; }
  schedule() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = null; this.render(); }); }

  navItem({ label, ic, view, count, active, dropFolder, color }) {
    const b = h('button', { class: `nav-item ${active ? 'active' : ''}`, onclick: () => { store.navigate(view); app.closeSidebarOnMobile(); } },
      color ? h('span', { class: 'dot', style: { background: color } }) : icon(ic, { size: 18 }),
      h('span', { class: 'name', text: label }),
      count !== undefined && count !== null ? h('span', { class: 'count', text: fmtNum(count) }) : null);
    if (dropFolder !== undefined) makeDropTarget(b, { folderId: dropFolder });
    return b;
  }

  render() {
    const v = store.view;
    const el = this.el; clear(el);
    const live = store.liveFiles();
    const trash = store.trashedItems();
    const cloudOnly = live.filter(f => !f.hasBlob).length;

    // ---- quick access ----
    const quick = h('div', { class: 'nav-section' });
    quick.appendChild(this.navItem({ label: t('nav.allFiles'), ic: 'layers', view: { type: 'all' }, count: live.length, active: v.type === 'all', dropFolder: '' }));
    quick.appendChild(this.navItem({ label: t('nav.recent'), ic: 'clock', view: { type: 'recent' }, active: v.type === 'recent' }));
    quick.appendChild(this.navItem({ label: t('nav.starred'), ic: 'star', view: { type: 'starred' }, count: live.filter(f => f.starred).length || null, active: v.type === 'starred' }));
    if (cloudOnly) quick.appendChild(this.navItem({ label: t('nav.cloudOnly'), ic: 'cloud', view: { type: 'cloud' }, count: cloudOnly, active: v.type === 'cloud' }));
    quick.appendChild(this.navItem({ label: t('nav.trash'), ic: 'trash', view: { type: 'trash' }, count: (trash.files.length + trash.folders.length) || null, active: v.type === 'trash' }));
    el.appendChild(quick);

    // ---- folders ----
    const sec = h('div', { class: 'nav-section' });
    sec.appendChild(h('div', { class: 'nav-title' }, h('span', { text: t('nav.folders') }),
      h('button', { class: 'icon-btn', title: t('action.newFolder'), onclick: () => actions.newFolder('') }, icon('plus', { size: 16 }))));
    const expanded = store.settings.expanded || {};
    const activeFolderId = v.type === 'folder' ? v.id : null;
    const isAncestorOfActive = (id) => activeFolderId && activeFolderId !== id && store.isDescendant(activeFolderId, id);
    const walk = (parentId, container, depth) => {
      for (const fo of store.childFolders(parentId)) {
        const kids = store.childFolders(fo.id);
        const open = expanded[fo.id] || isAncestorOfActive(fo.id);
        const stats = store.folderStats(fo.id);
        const twisty = h('span', { class: `twisty ${kids.length ? (open ? 'open' : '') : 'leaf'}`, onclick: (e) => { e.stopPropagation(); const ex = { ...(store.settings.expanded || {}) }; ex[fo.id] = !open; store.setSetting('expanded', ex); } }, icon('chevron-right', { size: 14 }));
        const item = h('button', { class: `tree-item ${activeFolderId === fo.id ? 'active' : ''}`, title: fo.name, onclick: () => { store.navigate({ type: 'folder', id: fo.id }); app.closeSidebarOnMobile(); }, oncontextmenu: (e) => { e.preventDefault(); actions.folderMenu(fo.id, { x: e.clientX, y: e.clientY }); } },
          twisty,
          h('span', { class: 'fico', html: folderTileSvg(COLORS[fo.color] || fo.color || COLORS.gray, fo.icon, 22) }),
          h('span', { class: 'name', text: fo.name }),
          stats.files ? h('span', { class: 'count', text: fmtNum(stats.files) }) : null);
        makeDropTarget(item, { folderId: fo.id });
        makeDragSource(item, () => ({ ids: [fo.id], kind: 'folder' }));
        container.appendChild(item);
        if (kids.length && open) { const box = h('div', { class: 'tree-children' }); walk(fo.id, box, depth + 1); container.appendChild(box); }
      }
    };
    walk('', sec, 0);
    if (!store.liveFolders().length) sec.appendChild(h('div', { class: 'empty-note', text: t('misc.noFolders') }));
    el.appendChild(sec);

    // ---- tags ----
    const tags = store.tagIndex();
    if (tags.size) {
      const tsec = h('div', { class: 'nav-section' });
      tsec.appendChild(h('div', { class: 'nav-title' }, h('span', { text: t('nav.tags') }),
        tags.size > 8 ? h('button', { class: 'icon-btn', title: t('action.more'), onclick: () => { this.tagsExpanded = !this.tagsExpanded; this.render(); } }, icon(this.tagsExpanded ? 'chevron-up' : 'chevron-down', { size: 16 })) : null));
      let i = 0;
      for (const [tag, count] of tags) {
        if (!this.tagsExpanded && i++ >= 8) break;
        tsec.appendChild(this.navItem({ label: tag, ic: 'tag', view: { type: 'tag', tag }, count, active: v.type === 'tag' && v.tag === tag }));
      }
      el.appendChild(tsec);
    }

    // ---- types ----
    const kinds = store.kindIndex();
    if (kinds.size) {
      const ksec = h('div', { class: 'nav-section' });
      ksec.appendChild(h('div', { class: 'nav-title' }, h('span', { text: t('nav.types') })));
      const order = ['pdf', 'doc', 'image', 'sheet', 'slides', 'video', 'audio', 'text', 'code', 'archive', 'ebook', 'other'];
      for (const k of order) if (kinds.get(k)) ksec.appendChild(this.navItem({ label: t('kind.' + k), ic: KIND_ICON[k], view: { type: 'kind', kind: k }, count: kinds.get(k), active: v.type === 'kind' && v.kind === k }));
      el.appendChild(ksec);
    }

    // ---- footer: install button + trial badge + storage ----
    const foot = h('div', { class: 'sidebar-footer' });
    if (install.canPrompt()) {
      foot.appendChild(h('button', { class: 'install-badge', title: t('install.hint'), onclick: async (e) => {
        e.currentTarget.disabled = true;
        const r = await install.prompt();
        if (r === 'accepted') toast(t('install.done'), { type: 'success', duration: 6000 });
        this.schedule();
      } }, icon('download', { size: 16 }), h('span', { class: 'grow ellipsis', text: t('install.button') })));
    }
    if (license.isTrial()) {
      foot.appendChild(h('button', { class: 'trial-badge', onclick: () => app.openSettings('license') },
        h('span', { class: 'row' }, icon('sparkles', { size: 16 }), h('span', { class: 'grow ellipsis', text: t('license.trialBadge', { n: fmtNum(license.remaining()) }) })),
        h('span', { class: 'link', text: t('license.getFullShort') })));
    }
    const meter = h('div', { class: 'storage-meter' });
    foot.appendChild(meter);
    el.appendChild(foot);
    db.storageInfo().then(({ usage, quota, free, capped }) => {
      const pct = quota ? Math.min(100, Math.round((usage / quota) * 100)) : 0;
      clear(meter);
      meter.appendChild(h('div', { class: 'row between' }, h('span', { text: t('label.storage') }), h('span', { class: 'ltr', text: formatBytes(usage, locale()) + (quota && !capped ? ' / ' + formatBytes(quota, locale()) : '') })));
      // Edge / Chrome report at most 10 GB free (see db.storageInfo): show "more than 10 GB free" instead of a bar that would fill up at 10 GB
      if (capped) meter.appendChild(h('div', { class: 'muted small', text: `${t('settings.available')}: ${t('settings.availableMore', { size: formatBytes(free, locale()) })}` }));
      else meter.appendChild(h('div', { class: 'progress' }, h('div', { style: { width: pct + '%' } })));
    });
  }
}
