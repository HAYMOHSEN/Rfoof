import { h, clear } from '../utils.js';
import { icon, FOLDER_ICONS, folderTileSvg } from '../icons.js';
import { COLORS, COLOR_KEYS, store } from '../store.js';
import { t } from '../i18n.js';
import { openDialog } from './dialog.js';
import { normalize } from '../search.js';

// ---------- color picker ----------
export function colorPicker(value, onChange, { allowNone = true } = {}) {
  const wrap = h('div', { class: 'color-picker', role: 'radiogroup' });
  const render = () => {
    clear(wrap);
    if (allowNone) wrap.appendChild(h('button', { class: `color-swatch none ${!value ? 'on' : ''}`, title: t('action.removeColor'), 'aria-label': t('action.removeColor'), onclick: () => { value = ''; onChange(''); render(); } }, icon('x', { size: 14 })));
    for (const k of COLOR_KEYS) {
      wrap.appendChild(h('button', {
        class: `color-swatch ${value === k ? 'on' : ''}`, style: { background: COLORS[k], color: COLORS[k] }, title: t('colors.' + k), 'aria-label': t('colors.' + k),
        onclick: () => { value = k; onChange(k); render(); },
      }, value === k ? h('span', { style: { color: '#fff', display: 'inline-flex' } }, icon('check', { size: 14, stroke: 3 })) : null));
    }
  };
  render();
  wrap.setValue = (v) => { value = v; render(); };
  return wrap;
}

// ---------- icon picker ----------
export function iconPicker(value, color, onChange) {
  const wrap = h('div', { class: 'icon-picker', role: 'radiogroup' });
  const render = () => {
    clear(wrap);
    for (const name of FOLDER_ICONS) {
      wrap.appendChild(h('button', { class: value === name ? 'on' : '', title: name, onclick: () => { value = name; onChange(name); render(); } }, icon(name, { size: 20 })));
    }
  };
  render();
  wrap.setValue = (v) => { value = v; render(); };
  return wrap;
}

// ---------- tag editor ----------
export function tagEditor(tags, onChange, { placeholder } = {}) {
  let list = Array.from(tags || []);
  const wrap = h('div', { class: 'tag-editor' });
  const input = h('input', { placeholder: placeholder || t('label.tagsPlaceholder'), 'aria-label': t('label.tags') });
  let suggest = null; let hl = -1;
  const commit = (raw) => {
    const parts = String(raw).split(/[,،;]/).map(s => s.trim()).filter(Boolean);
    let changed = false;
    for (const p of parts) if (!list.some(x => normalize(x) === normalize(p))) { list.push(p); changed = true; }
    input.value = '';
    closeSuggest();
    if (changed) { onChange(list.slice()); render(); }
  };
  const remove = (tag) => { list = list.filter(x => x !== tag); onChange(list.slice()); render(); };
  const closeSuggest = () => { if (suggest) { suggest.remove(); suggest = null; hl = -1; } };
  const openSuggest = () => {
    closeSuggest();
    const q = normalize(input.value.trim());
    const all = Array.from(store.tagIndex().keys()).filter(tg => !list.includes(tg) && (!q || normalize(tg).includes(q))).slice(0, 8);
    if (!all.length) return;
    suggest = h('div', { class: 'tag-suggest' });
    all.forEach((tg, i) => suggest.appendChild(h('button', { type: 'button', onmousedown: (e) => { e.preventDefault(); commit(tg); } }, tg)));
    const r = input.getBoundingClientRect();
    suggest.style.left = (document.documentElement.dir === 'rtl' ? r.right - 200 : r.left) + 'px';
    suggest.style.top = (r.bottom + 4) + 'px';
    document.body.appendChild(suggest);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '،') {
      e.preventDefault();
      if (suggest && hl >= 0) { suggest.children[hl].dispatchEvent(new MouseEvent('mousedown')); return; }
      if (input.value.trim()) commit(input.value);
    } else if (e.key === 'Backspace' && !input.value && list.length) { remove(list[list.length - 1]); }
    else if (e.key === 'ArrowDown' && suggest) { e.preventDefault(); hl = (hl + 1) % suggest.children.length; Array.from(suggest.children).forEach((c, i) => c.classList.toggle('hl', i === hl)); }
    else if (e.key === 'ArrowUp' && suggest) { e.preventDefault(); hl = (hl - 1 + suggest.children.length) % suggest.children.length; Array.from(suggest.children).forEach((c, i) => c.classList.toggle('hl', i === hl)); }
    else if (e.key === 'Escape' && suggest) { e.stopPropagation(); closeSuggest(); }
  });
  input.addEventListener('input', openSuggest);
  input.addEventListener('focus', openSuggest);
  input.addEventListener('blur', () => { setTimeout(() => { if (input.value.trim()) commit(input.value); closeSuggest(); }, 120); });
  const render = () => {
    clear(wrap);
    for (const tg of list) wrap.appendChild(h('span', { class: 'chip accent' }, tg, h('button', { class: 'x', type: 'button', 'aria-label': t('action.clear'), onclick: () => remove(tg) }, icon('x', { size: 12 }))));
    wrap.appendChild(input);
  };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) input.focus(); });
  render();
  wrap.getTags = () => list.slice();
  wrap.setTags = (v) => { list = Array.from(v || []); render(); };
  return wrap;
}

// ---------- folder tree select ----------
export function folderTree({ selected = '', exclude = new Set(), onSelect, includeRoot = true, rootLabel }) {
  const wrap = h('div', { class: 'folder-tree', role: 'tree' });
  let value = selected;
  const rows = [];
  const render = () => {
    clear(wrap); rows.length = 0;
    if (includeRoot) {
      const b = h('button', { class: `tree-item ${value === '' ? 'active' : ''}`, type: 'button', onclick: () => { value = ''; onSelect(''); render(); } },
        h('span', { class: 'twisty leaf' }), h('span', { class: 'fico', style: { color: 'var(--text-3)' } }, icon('home', { size: 18 })), h('span', { class: 'name', text: rootLabel || t('label.root') }));
      wrap.appendChild(b);
    }
    const walk = (parentId, depth, container) => {
      for (const fo of store.childFolders(parentId)) {
        if (exclude.has(fo.id)) continue;
        const kidsBox = h('div', { class: 'tree-children' });
        const b = h('button', { class: `tree-item ${value === fo.id ? 'active' : ''}`, type: 'button', onclick: () => { value = fo.id; onSelect(fo.id); render(); } },
          h('span', { class: 'twisty leaf' }), h('span', { class: 'fico', html: folderTileSvg(COLORS[fo.color] || fo.color || COLORS.gray, fo.icon, 22) }), h('span', { class: 'name', text: fo.name }));
        container.appendChild(b); container.appendChild(kidsBox);
        walk(fo.id, depth + 1, kidsBox);
      }
    };
    walk('', 0, wrap);
    if (!store.liveFolders().length) wrap.appendChild(h('div', { class: 'empty-note', text: t('misc.noFolders') }));
  };
  render();
  wrap.getValue = () => value;
  return wrap;
}

export function pickFolderDialog({ title, selected = '', exclude = new Set(), okLabel }) {
  return new Promise((resolve) => {
    let value = selected;
    const tree = folderTree({ selected, exclude, onSelect: (v) => { value = v; } });
    tree.style.maxHeight = '50vh'; tree.style.overflow = 'auto';
    openDialog({
      title: title || t('misc.moveTo'), body: tree,
      actions: [
        { label: t('action.cancel'), onClick: () => resolve(null) },
        { label: okLabel || t('action.move'), primary: true, onClick: () => resolve(value) },
      ],
      onClose: () => resolve(null),
    });
  });
}
