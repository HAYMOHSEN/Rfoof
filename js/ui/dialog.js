import { h } from '../utils.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';

const stack = [];

/**
 * openDialog({title, body: Node|Node[], actions: [{label, primary, danger, onClick(close), keepOpen}], size, onClose, closable})
 * returns {close, el, body}
 */
export function openDialog({ title, body, actions = [], size = '', onClose, closable = true, icon: ic = null, extraClass = '' }) {
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
  const dlg = h('div', { class: `dialog ${size} ${extraClass}` });
  const bodyEl = h('div', { class: 'dialog-body' });
  const foot = h('div', { class: 'dialog-foot' });
  let closed = false;
  const close = (result) => {
    if (closed) return; closed = true;
    overlay.remove();
    const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
    onClose?.(result);
    // restore focus
    api.prevFocus?.focus?.();
  };
  const api = { close, el: dlg, body: bodyEl, overlay, prevFocus: document.activeElement };
  if (title !== undefined) {
    const head = h('div', { class: 'dialog-head' }, ic ? icon(ic, { size: 22 }) : null, h('span', { class: 'grow ellipsis', text: title }));
    if (closable) head.appendChild(h('button', { class: 'icon-btn', 'aria-label': t('action.close'), onclick: () => close() }, icon('x')));
    dlg.appendChild(head);
  }
  if (Array.isArray(body)) body.forEach(b => b && bodyEl.appendChild(b)); else if (body) bodyEl.appendChild(body);
  dlg.appendChild(bodyEl);
  if (actions.length) {
    for (const a of actions) {
      const btn = h('button', {
        class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger solid' : ''} ${a.start ? 'start' : ''} ${a.ghost ? 'ghost' : ''}`,
        onclick: async () => { const r = await a.onClick?.(close, api); if (!a.keepOpen && r !== false) close(r ?? a.value); },
      }, a.icon ? icon(a.icon, { size: 18 }) : null, a.label);
      if (a.id) btn.id = a.id;
      a.el = btn;
      foot.appendChild(btn);
    }
    dlg.appendChild(foot);
  }
  overlay.appendChild(dlg);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && closable) close(); });
  document.body.appendChild(overlay);
  stack.push(api);
  // focus first input
  requestAnimationFrame(() => { const f = dlg.querySelector('input:not([type=hidden]), textarea, select, button.primary, button'); f?.focus?.(); });
  return api;
}

export function topDialog() { return stack[stack.length - 1] || null; }
export function closeTopDialog() { const d = topDialog(); if (d) { d.close(); return true; } return false; }

export function confirmDialog({ title = t('confirm.title'), message, okLabel = t('action.ok'), danger = false, cancelLabel = t('action.cancel') }) {
  return new Promise((resolve) => {
    openDialog({
      title, body: h('p', { style: { margin: '4px 0 8px', whiteSpace: 'pre-wrap' } }, message),
      actions: [
        { label: cancelLabel, onClick: () => { resolve(false); } },
        { label: okLabel, primary: !danger, danger, onClick: () => { resolve(true); } },
      ],
      onClose: () => resolve(false),
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', okLabel = t('action.save'), validate }) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value, placeholder });
    let done = false;
    const finish = (v, close) => { if (done) return; done = true; resolve(v); close?.(); };
    const dlg = openDialog({
      title,
      body: h('div', { class: 'field' }, label ? h('label', { text: label }) : null, input),
      actions: [
        { label: t('action.cancel'), onClick: (close) => finish(null, close) },
        { label: okLabel, primary: true, onClick: (close) => { const v = input.value.trim(); if (!v || (validate && !validate(v))) { input.focus(); return false; } finish(v, close); } },
      ],
      onClose: () => finish(null),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dlg.el.querySelector('.btn.primary').click(); } });
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}

// keyboard: Esc closes the top dialog
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) { const d = topDialog(); if (d && !d.el.dataset.noEsc) { e.stopPropagation(); d.close(); } }
}, true);
