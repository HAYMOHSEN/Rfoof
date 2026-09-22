import { h, clear, extOf, baseName, kindOf, formatBytes, sha256Hex, sleep } from '../utils.js';
import { t, locale } from '../i18n.js';
import { store, COLORS } from '../store.js';
import { openDialog } from './dialog.js';
import { colorPicker, tagEditor } from './pickers.js';
import { icon, KIND_ICON, KIND_COLOR } from '../icons.js';
import { applyTemplate, suggestTitle, importEntries, findDuplicateByHash } from '../import.js';
import { toast } from './toast.js';
import { license } from '../license.js';
import { app } from '../app.js';

function folderOptions(selected) {
  const sel = h('select', { class: 'select' });
  sel.appendChild(h('option', { value: '', text: t('label.root') }));
  const walk = (parentId, depth) => {
    for (const fo of store.childFolders(parentId)) {
      sel.appendChild(h('option', { value: fo.id, text: `${'   '.repeat(depth)}${depth ? '└ ' : ''}${fo.name}` }));
      walk(fo.id, depth + 1);
    }
  };
  walk('', 0);
  sel.value = store.folder(selected) ? selected : '';
  return sel;
}

/**
 * Opens the import dialog. initialFiles: File[] (optional)
 */
export function importDialog({ files = [], folderId = '' } = {}) {
  return new Promise((resolve) => {
    const entries = [];
    const state = { folderId: folderId || (store.view.type === 'folder' ? store.view.id : ''), tags: [], color: '', template: store.settings.template || '{name}' };
    const list = h('div', { class: 'import-list' });
    const countLabel = h('span', { class: 'muted small' });
    const trialNote = h('div', { class: 'card-box trial-note', hidden: true });
    const importBtnLabel = h('span', { text: t('import.import') });
    const fileInput = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: (e) => { addFiles(Array.from(e.target.files)); e.target.value = ''; } });
    const dirInput = h('input', { type: 'file', multiple: true, webkitdirectory: true, style: { display: 'none' }, onchange: (e) => { addFiles(Array.from(e.target.files)); e.target.value = ''; } });
    const dropzone = h('div', { class: 'dropzone', tabindex: 0, role: 'button', onclick: () => fileInput.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); } },
      icon('upload'), h('div', { style: { fontWeight: 600 } }, t('import.drop')), h('div', { class: 'small' }, t('import.dropHint')));
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
    dropzone.addEventListener('drop', async (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('over'); const { filesFromDataTransfer } = await import('../import.js'); addFiles(await filesFromDataTransfer(e.dataTransfer)); });

    const folderSel = folderOptions(state.folderId);
    folderSel.addEventListener('change', () => { state.folderId = folderSel.value; });
    const tmplInput = h('input', { class: 'input', value: state.template, oninput: (e) => { state.template = e.target.value; } });
    const chips = h('div', { class: 'template-chips' });
    for (const p of ['{name}', '{date}', '{time}', '{folder}', '{n}', '{year}', '{month}', '{day}']) {
      chips.appendChild(h('button', { type: 'button', class: 'chip clickable', onclick: () => { tmplInput.value += (tmplInput.value && !tmplInput.value.endsWith(' ') ? ' ' : '') + p; state.template = tmplInput.value; tmplInput.focus(); } }, p));
    }
    const applyAll = () => {
      const folderName = store.folder(state.folderId)?.name || '';
      entries.forEach((en, i) => { en.title = applyTemplate(state.template, { name: baseName(en.file.name), ext: extOf(en.file.name), folder: folderName, n: i + 1, tag: state.tags[0] || '' }); });
      renderList();
    };
    const suggestAll = () => { entries.forEach(en => { en.title = suggestTitle(en.file.name); }); renderList(); };
    const keepAll = () => { entries.forEach(en => { en.title = baseName(en.file.name); }); renderList(); };

    const renderList = () => {
      clear(list);
      if (!entries.length) { list.appendChild(h('div', { class: 'muted small', style: { padding: '6px' } }, t('import.noFiles'))); }
      for (const en of entries) {
        const ext = extOf(en.file.name); const kind = kindOf(ext, en.file.type);
        const thumb = h('div', { class: 'ithumb' });
        if (en.thumbUrl) thumb.appendChild(h('img', { src: en.thumbUrl, alt: '' }));
        else thumb.appendChild(h('span', { class: 'mini-icon', style: { background: KIND_COLOR[kind] } }, icon(KIND_ICON[kind], { size: 13 })));
        const input = h('input', { class: 'input', value: en.title, 'aria-label': t('import.newTitle'), oninput: (e) => { en.title = e.target.value; } });
        const row = h('div', { class: 'import-item' },
          thumb,
          h('div', { class: 'grow' }, input, h('div', { class: 'orig' }, `${en.file.name} · ${formatBytes(en.file.size, locale())}`, en.dup ? h('span', { class: 'dup' }, ' · ' + t('import.duplicate')) : null)),
          h('button', { class: 'icon-btn sm', title: t('import.remove'), onclick: () => { const i = entries.indexOf(en); if (i >= 0) { if (en.thumbUrl) URL.revokeObjectURL(en.thumbUrl); entries.splice(i, 1); } renderList(); } }, icon('x', { size: 16 })));
        list.appendChild(row);
      }
      const size = entries.reduce((s, e) => s + e.file.size, 0);
      countLabel.textContent = t('import.count', { n: entries.length, size: formatBytes(size, locale()) });
      // free-version notice
      if (license.isTrial()) {
        const rem = license.remaining();
        clear(trialNote); trialNote.hidden = false;
        const msg = rem <= 0 ? t('license.limitReached', { limit: license.limit() }) : (entries.length > rem ? t('license.importPartial', { n: rem }) : t('license.remaining', { n: rem, limit: license.limit() }));
        trialNote.appendChild(h('div', { class: 'row wrap' }, icon(rem <= 0 || entries.length > rem ? 'alert' : 'info', { size: 18 }), h('span', { class: 'grow', text: msg }),
          h('button', { class: 'btn sm primary', type: 'button', onclick: () => { if (!license.openStore()) app.openSettings('license'); } }, icon('shopping-bag', { size: 15 }), t('license.getFullShort'))));
      } else trialNote.hidden = true;
      importBtnLabel.textContent = entries.length ? `${t('import.import')} (${entries.length})` : t('import.import');
      dlg?.el.querySelector('#importGo')?.toggleAttribute('disabled', !entries.length);
    };

    const addFiles = (files) => {
      const folderName = store.folder(state.folderId)?.name || '';
      const startN = entries.length;
      files.forEach((file, i) => {
        if (entries.some(e => e.file === file)) return;
        const en = { file, title: applyTemplate(state.template, { name: baseName(file.name), ext: extOf(file.name), folder: folderName, n: startN + i + 1 }), thumbUrl: '', dup: false };
        if (kindOf(extOf(file.name), file.type) === 'image' && file.size < 15 * 1024 * 1024) en.thumbUrl = URL.createObjectURL(file);
        entries.push(en);
      });
      renderList();
      checkDuplicates(files.map(f => entries.find(e => e.file === f)).filter(Boolean));
    };
    const checkDuplicates = async (list) => {
      for (const en of list) {
        if (!en || en.file.size > 40 * 1024 * 1024) continue;
        try { const hash = await sha256Hex(en.file); const d = findDuplicateByHash(hash); if (d) { en.dup = true; } } catch { /* ignore */ }
        await sleep(0);
      }
      renderList();
    };

    const body = [
      trialNote,
      dropzone,
      h('div', { class: 'row', style: { margin: '10px 0' } },
        h('button', { class: 'btn sm', onclick: () => fileInput.click() }, icon('file', { size: 16 }), t('action.chooseFiles')),
        h('button', { class: 'btn sm', onclick: () => dirInput.click() }, icon('folder', { size: 16 }), t('action.importFolder')),
        h('span', { class: 'grow' }), countLabel),
      list,
      h('div', { class: 'divider' }),
      h('div', { class: 'field' }, h('label', { text: t('import.destination') }), folderSel),
      h('div', { class: 'field' }, h('label', { text: t('import.template') }), tmplInput, chips, h('div', { class: 'hint' }, t('import.templateHelp')),
        h('div', { class: 'row wrap', style: { marginTop: '6px' } },
          h('button', { class: 'btn sm', onclick: applyAll }, icon('sparkles', { size: 15 }), t('import.applyAll')),
          h('button', { class: 'btn sm', onclick: suggestAll }, icon('pencil', { size: 15 }), t('import.suggest')),
          h('button', { class: 'btn sm ghost', onclick: keepAll }, t('import.keepNames')))),
      h('div', { class: 'field' }, h('label', { text: t('import.tags') }), tagEditor([], (v) => { state.tags = v; })),
      h('div', { class: 'field' }, h('label', { text: t('import.color') }), colorPicker('', (c) => { state.color = c; })),
      fileInput, dirInput,
    ];
    const progress = h('div', { class: 'progress', style: { display: 'none', marginTop: '8px' } }, h('div'));
    body.push(progress);

    let dlg = null;
    dlg = openDialog({
      title: t('import.title'), body, size: 'md', icon: 'upload',
      actions: [
        { label: t('action.cancel'), onClick: () => { entries.forEach(e => e.thumbUrl && URL.revokeObjectURL(e.thumbUrl)); resolve(null); } },
        {
          id: 'importGo', label: importBtnLabel, primary: true, keepOpen: true,
          onClick: async (close, api) => {
            if (!entries.length) return false;
            api.el.querySelectorAll('.btn').forEach(b => b.disabled = true);
            progress.style.display = ''; progress.firstChild.style.width = '0%';
            const res = await importEntries(entries.map(e => ({ file: e.file, title: e.title })), { folderId: state.folderId, tags: state.tags, color: state.color, template: state.template },
              (p) => { progress.firstChild.style.width = Math.round((p.done / Math.max(1, p.total)) * 100) + '%'; });
            entries.forEach(e => e.thumbUrl && URL.revokeObjectURL(e.thumbUrl));
            if (res.failed.length) toast(t('import.failed') + ' (' + res.failed.length + ')', { type: 'error' });
            if (res.blocked?.length) toast(t('license.importBlocked', { n: res.blocked.length }), { type: 'error', duration: 8000, action: { label: t('license.getFullShort'), fn: () => { if (!license.openStore()) app.openSettings('license'); } } });
            if (res.added.length) toast(t('toast.imported', { n: res.added.length }), { type: 'success' });
            close();
            resolve(res);
          },
        },
      ],
      onClose: () => resolve(null),
    });
    if (files.length) addFiles(files); else renderList();
  });
}
