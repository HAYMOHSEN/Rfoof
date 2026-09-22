import { h, clear, debounce } from '../utils.js';
import { icon, folderTileSvg, KIND_ICON, KIND_COLOR } from '../icons.js';
import { store, COLORS } from '../store.js';
import { t } from '../i18n.js';
import { search, normalize } from '../search.js';
import { actions } from './actions.js';
import { app } from '../app.js';

let open = null;

export function openPalette(initial = '') {
  if (open) { open.close(); return; }
  const overlay = h('div', { class: 'overlay', style: { alignItems: 'flex-start' } });
  const box = h('div', { class: 'palette', role: 'dialog' });
  const input = h('input', { placeholder: t('palette.placeholder'), value: initial, 'aria-label': t('action.search') });
  const list = h('div', { class: 'palette-list' });
  box.appendChild(h('div', { class: 'searchbox' }, icon('search'), input));
  box.appendChild(list);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  let items = []; let hl = 0;
  const close = () => { overlay.remove(); open = null; document.removeEventListener('keydown', onKey, true); };
  open = { close };
  const commands = () => [
    { label: t('action.import'), icon: 'upload', run: () => actions.import([]) },
    { label: t('action.newFolder'), icon: 'folder-plus', run: () => actions.newFolder(store.view.type === 'folder' ? store.view.id : '') },
    { label: t('nav.allFiles'), icon: 'layers', run: () => store.navigate({ type: 'all' }) },
    { label: t('nav.recent'), icon: 'clock', run: () => store.navigate({ type: 'recent' }) },
    { label: t('nav.starred'), icon: 'star', run: () => store.navigate({ type: 'starred' }) },
    { label: t('nav.trash'), icon: 'trash', run: () => store.navigate({ type: 'trash' }) },
    { label: t('settings.title'), icon: 'settings', run: () => app.openSettings() },
    { label: t('settings.theme') + ': ' + t('settings.theme.' + (store.settings.theme === 'dark' ? 'light' : 'dark')), icon: store.settings.theme === 'dark' ? 'sun' : 'moon', run: () => { store.setSetting('theme', store.settings.theme === 'dark' ? 'light' : 'dark'); app.applyTheme(); } },
    { label: t('settings.language') + ': ' + (document.documentElement.lang === 'ar' ? 'English' : 'العربية'), icon: 'globe', run: () => app.setLanguage(document.documentElement.lang === 'ar' ? 'en' : 'ar') },
    { label: t('action.sync'), icon: 'refresh', run: () => app.syncNow() },
    { label: t('action.export'), icon: 'archive', run: () => app.openSettings('backup') },
    { label: t('label.view') + ': ' + (store.settings.layout === 'grid' ? t('label.list') : t('label.grid')), icon: store.settings.layout === 'grid' ? 'list' : 'grid', run: () => store.setSetting('layout', store.settings.layout === 'grid' ? 'list' : 'grid') },
    { label: t('action.keyboard'), icon: 'keyboard', run: () => app.openSettings('about') },
  ];
  const render = async () => {
    const q = input.value.trim(); const nq = normalize(q);
    items = [];
    clear(list);
    const add = (group, arr) => { if (!arr.length) return; list.appendChild(h('div', { class: 'palette-group', text: group })); for (const it of arr) { const i = items.length; items.push(it); list.appendChild(it.el); it.el.dataset.i = i; } };
    if (q) {
      const folders = store.liveFolders().filter(fo => normalize(fo.name).includes(nq)).slice(0, 5).map(fo => ({ el: h('button', { class: 'palette-item', onclick: () => { close(); actions.openFolder(fo.id); } }, h('span', { html: folderTileSvg(COLORS[fo.color] || fo.color, fo.icon, 26) }), h('span', { class: 'grow ellipsis', text: fo.name }), h('span', { class: 'sub', text: store.folderPathString(fo.parentId) })), run: () => actions.openFolder(fo.id) }));
      const res = await search(q, store.files.values(), { content: store.settings.contentSearch !== false, limit: 8 });
      if (input.value.trim() !== q) return;
      const files = res.map(r => { const f = r.file; const th = h('span', { class: 'thumbmini', style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: f.thumb ? '' : KIND_COLOR[f.kind], color: '#fff' } }, f.thumb ? null : icon(KIND_ICON[f.kind], { size: 16 })); if (f.thumb) store.thumbURL(f.id).then(u => { if (u) { clear(th); th.appendChild(h('img', { src: u, class: 'thumbmini', alt: '' })); } }); return { el: h('button', { class: 'palette-item', onclick: () => { close(); actions.openFile(f.id); } }, th, h('span', { class: 'grow ellipsis', text: f.title }), h('span', { class: 'sub', text: store.folderPathString(f.folderId) || t('label.root') })), run: () => actions.openFile(f.id) }; });
      const tags = Array.from(store.tagIndex().keys()).filter(tg => normalize(tg).includes(nq)).slice(0, 4).map(tg => ({ el: h('button', { class: 'palette-item', onclick: () => { close(); store.navigate({ type: 'tag', tag: tg }); } }, icon('tag'), h('span', { class: 'grow', text: tg })), run: () => store.navigate({ type: 'tag', tag: tg }) }));
      add(t('palette.folders'), folders); add(t('palette.files'), files); add(t('nav.tags'), tags);
      if (res.length >= 8) items.push({ el: list.appendChild(h('button', { class: 'palette-item', onclick: () => { close(); app.runSearch(q); } }, icon('search'), h('span', { class: 'grow', text: `${t('action.search')}: “${q}”` }))), run: () => app.runSearch(q) });
    }
    const cmds = commands().filter(c => !q || normalize(c.label).includes(nq)).map(c => ({ el: h('button', { class: 'palette-item', onclick: () => { close(); c.run(); } }, icon(c.icon), h('span', { class: 'grow', text: c.label })), run: c.run }));
    add(t('palette.commands'), cmds);
    if (!items.length) list.appendChild(h('div', { class: 'palette-group', text: t('palette.noResults') }));
    hl = 0; highlightItem();
  };
  const highlightItem = () => { items.forEach((it, i) => it.el.classList.toggle('hl', i === hl)); items[hl]?.el.scrollIntoView({ block: 'nearest' }); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(items.length - 1, hl + 1); highlightItem(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(0, hl - 1); highlightItem(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[hl]; if (it) { close(); it.run(); } else if (input.value.trim()) { close(); app.runSearch(input.value.trim()); } }
  };
  document.addEventListener('keydown', onKey, true);
  input.addEventListener('input', debounce(render, 80));
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  render();
  requestAnimationFrame(() => input.focus());
  return open;
}
