import { h, clear } from '../utils.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';

let container = null;
function ensure() {
  if (!container) container = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  if (!container.isConnected) document.body.appendChild(container);
  return container;
}

/**
 * toast(message, {type:'info'|'success'|'error', action:{label, fn}, duration})
 */
export function toast(message, opts = {}) {
  const c = ensure();
  const el = h('div', { class: `toast ${opts.type || ''}` });
  if (opts.type === 'success') el.appendChild(icon('check-circle', { size: 18 }));
  if (opts.type === 'error') el.appendChild(icon('alert', { size: 18 }));
  el.appendChild(h('span', { text: message }));
  let timer;
  const remove = () => { clearTimeout(timer); el.style.opacity = '0'; el.style.transition = 'opacity .15s'; setTimeout(() => el.remove(), 150); };
  if (opts.action) el.appendChild(h('button', { onclick: () => { opts.action.fn(); remove(); } }, opts.action.label));
  el.appendChild(h('button', { class: 'x', 'aria-label': t('action.close'), onclick: remove }, icon('x', { size: 16 })));
  c.appendChild(el);
  while (c.children.length > 4) c.firstChild.remove();
  timer = setTimeout(remove, opts.duration || (opts.action ? 7000 : 3500));
  return { remove };
}
