// Drag & drop helpers (internal moves + external file drops)
import { store } from '../store.js';
import { actions } from './actions.js';
import { filesFromDataTransfer } from '../import.js';
import { t } from '../i18n.js';

export const DND = { ids: null, kind: null };
const MIME = 'application/x-rfoof';

export function makeDragSource(el, getPayload) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    const p = getPayload();
    if (!p || !p.ids?.length) { e.preventDefault(); return; }
    DND.ids = p.ids; DND.kind = p.kind;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(MIME, JSON.stringify(p));
    e.dataTransfer.setData('text/plain', p.ids.join(','));
    el.classList.add('dragging');
    // drag image: count badge
    if (p.ids.length > 1) {
      const badge = document.createElement('div');
      badge.textContent = String(p.ids.length);
      Object.assign(badge.style, { position: 'fixed', top: '-100px', left: '-100px', padding: '6px 12px', borderRadius: '20px', background: 'var(--accent)', color: 'var(--accent-text)', fontWeight: '700', fontSize: '14px' });
      document.body.appendChild(badge);
      e.dataTransfer.setDragImage(badge, 20, 20);
      setTimeout(() => badge.remove(), 0);
    }
  });
  el.addEventListener('dragend', () => { el.classList.remove('dragging'); DND.ids = null; DND.kind = null; });
}

function isExternal(e) { return Array.from(e.dataTransfer?.types || []).includes('Files') && !Array.from(e.dataTransfer.types).includes(MIME); }

/**
 * makeDropTarget(el, { folderId, acceptFolders })
 * Internal drags move files/folders into folderId; external drops import into folderId.
 */
export function makeDropTarget(el, { folderId = '', getFolderId = null, acceptFolders = true, onExternal = null, label = '' } = {}) {
  let depth = 0;
  const target = () => (getFolderId ? getFolderId() : folderId);
  const valid = (e) => {
    if (isExternal(e)) return true;
    if (!DND.ids) return false;
    const fid = target();
    if (DND.kind === 'folder') {
      if (!acceptFolders) return false;
      for (const id of DND.ids) if (id === fid || store.isDescendant(fid, id)) return false;
      return true;
    }
    if (fid === null || fid === undefined) return false;
    return !DND.ids.every(id => store.file(id)?.folderId === fid);
  };
  el.addEventListener('dragenter', (e) => { if (!valid(e)) return; e.preventDefault(); depth++; el.classList.add('drop-target'); if (label) el.dataset.dropLabel = isExternal(e) ? t('misc.dropToImport') : t('misc.dropToMove'); });
  el.addEventListener('dragover', (e) => { if (!valid(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = isExternal(e) ? 'copy' : 'move'; });
  el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove('drop-target'); });
  el.addEventListener('drop', async (e) => {
    depth = 0; el.classList.remove('drop-target');
    if (!valid(e)) return;
    e.preventDefault(); e.stopPropagation();
    const fid = target();
    if (isExternal(e)) {
      const files = await filesFromDataTransfer(e.dataTransfer);
      if (!files.length) return;
      if (onExternal) onExternal(files, fid); else actions.import(files, fid || '');
      return;
    }
    const ids = DND.ids; const kind = DND.kind; DND.ids = null;
    if (kind === 'folder') { for (const id of ids) await actions.moveFolder(id, fid || ''); }
    else await actions.move(ids, fid || '');
  });
}
