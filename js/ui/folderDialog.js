import { h } from '../utils.js';
import { t } from '../i18n.js';
import { store, COLORS } from '../store.js';
import { openDialog } from './dialog.js';
import { colorPicker, iconPicker, folderTree } from './pickers.js';
import { folderTileSvg } from '../icons.js';
import { toast } from './toast.js';

export function folderDialog({ folder = null, parentId = '' } = {}) {
  return new Promise((resolve) => {
    const state = { name: folder?.name || '', color: folder?.color || 'blue', icon: folder?.icon || 'folder', parentId: folder ? folder.parentId : parentId };
    const preview = h('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '10px' } });
    const updatePreview = () => { preview.innerHTML = folderTileSvg(COLORS[state.color] || state.color, state.icon, 96); };
    updatePreview();
    const nameInput = h('input', { class: 'input', value: state.name, placeholder: t('folder.namePlaceholder'), maxlength: 120, oninput: (e) => { state.name = e.target.value; } });
    const exclude = folder ? store.descendantFolderIds(folder.id) : new Set();
    const tree = folderTree({ selected: state.parentId, exclude, onSelect: (v) => { state.parentId = v; } });
    tree.style.maxHeight = '180px'; tree.style.overflow = 'auto'; tree.style.border = '1px solid var(--border)'; tree.style.borderRadius = 'var(--radius)'; tree.style.padding = '4px';
    const body = [
      preview,
      h('div', { class: 'field' }, h('label', { text: t('folder.name') }), nameInput),
      h('div', { class: 'field' }, h('label', { text: t('folder.color') }), colorPicker(state.color, (c) => { state.color = c || 'gray'; updatePreview(); }, { allowNone: false })),
      h('div', { class: 'field' }, h('label', { text: t('folder.icon') }), iconPicker(state.icon, state.color, (i) => { state.icon = i; updatePreview(); })),
      h('div', { class: 'field' }, h('label', { text: t('folder.parent') }), tree),
    ];
    const dlg = openDialog({
      title: folder ? t('folder.edit') : t('folder.new'), body, size: 'md', icon: folder ? 'pencil' : 'folder-plus',
      actions: [
        { label: t('action.cancel'), onClick: () => resolve(null) },
        {
          label: folder ? t('action.save') : t('action.create'), primary: true,
          onClick: async () => {
            const name = state.name.trim();
            if (!name) { nameInput.focus(); return false; }
            if (folder) {
              await store.updateFolder(folder.id, { name, color: state.color, icon: state.icon, parentId: state.parentId });
              toast(t('toast.saved'), { type: 'success' });
              resolve(folder);
            } else {
              const rec = await store.createFolder({ name, color: state.color, icon: state.icon, parentId: state.parentId });
              toast(t('toast.folderCreated'), { type: 'success' });
              resolve(rec);
            }
          },
        },
      ],
      onClose: () => resolve(null),
    });
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dlg.el.querySelector('.btn.primary').click(); } });
    requestAnimationFrame(() => { nameInput.focus(); nameInput.select(); });
  });
}
