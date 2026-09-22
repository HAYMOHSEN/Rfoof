import { h } from '../utils.js';
import { icon } from '../icons.js';

let current = null;

/**
 * showMenu(items, {x, y, anchor})
 * item: {label, icon, onClick, danger, disabled, separator, header, custom: Node, kbd}
 */
export function showMenu(items, { x = 0, y = 0, anchor = null, align = 'start' } = {}) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.separator) { menu.appendChild(h('div', { class: 'menu-sep' })); continue; }
    if (it.header) { menu.appendChild(h('div', { class: 'menu-label', text: it.header })); continue; }
    if (it.custom) { menu.appendChild(it.custom); continue; }
    const b = h('button', {
      class: `menu-item ${it.danger ? 'danger' : ''}`, role: 'menuitem', disabled: it.disabled || null,
      onclick: (e) => { e.stopPropagation(); if (!it.keepOpen) closeMenu(); it.onClick?.(e); },
    }, it.icon ? icon(it.icon, { size: 18 }) : h('span', { style: { width: '18px' } }), h('span', { class: 'grow', text: it.label }), it.checked ? icon('check', { size: 16 }) : null, it.kbd ? h('span', { class: 'kbd', text: it.kbd }) : null);
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  // position
  const rtl = document.documentElement.dir === 'rtl';
  let px = x, py = y;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    py = r.bottom + 4;
    px = (align === 'end') !== rtl ? r.right - menu.offsetWidth : r.left;
    if (align === 'end' && rtl) px = r.left; else if (align === 'end') px = r.right - menu.offsetWidth;
  } else if (rtl) { px = x - menu.offsetWidth; }
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  if (px + mw > window.innerWidth - 8) px = window.innerWidth - mw - 8;
  if (px < 8) px = 8;
  if (py + mh > window.innerHeight - 8) py = Math.max(8, window.innerHeight - mh - 8);
  menu.style.left = px + 'px'; menu.style.top = py + 'px';
  current = menu;
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, { capture: true });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
  }, 0);
  const first = menu.querySelector('button:not(:disabled)'); first?.focus();
  return menu;
}
function onDoc(e) { if (current && !current.contains(e.target)) closeMenu(); }
function onKey(e) {
  if (!current) return;
  if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const btns = Array.from(current.querySelectorAll('button:not(:disabled)'));
    const i = btns.indexOf(document.activeElement);
    const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
    btns[n]?.focus();
  }
}
export function closeMenu() {
  if (current) { current.remove(); current = null; }
  document.removeEventListener('mousedown', onDoc, { capture: true });
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', closeMenu);
  window.removeEventListener('resize', closeMenu);
}
export function isMenuOpen() { return !!current; }
