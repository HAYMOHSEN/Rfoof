// ============================================================
//  Rfoof – shared utilities
// ============================================================

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const a = new Uint8Array(10); crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

export const now = () => Date.now();

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function throttle(fn, ms = 100) {
  let last = 0, t;
  return (...a) => {
    const n = Date.now();
    if (n - last >= ms) { last = n; fn(...a); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (n - last)); }
  };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- DOM helpers ----------
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// ---------- lazy script / module loading ----------
const loaded = new Map();
export function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => res();
    s.onerror = () => { loaded.delete(src); rej(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}
export function loadStyle(href) {
  if (loaded.has(href)) return loaded.get(href);
  const p = new Promise((res, rej) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = () => res(); l.onerror = () => { loaded.delete(href); rej(new Error('Failed to load ' + href)); };
    document.head.appendChild(l);
  });
  loaded.set(href, p);
  return p;
}

// ---------- files & types ----------
export function extOf(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}
export function baseName(name) {
  const e = extOf(name);
  return e ? name.slice(0, -(e.length + 1)) : name;
}

const KIND_EXT = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'tif', 'tiff', 'heic', 'heif', 'jfif'],
  pdf: ['pdf'],
  doc: ['doc', 'docx', 'odt', 'rtf', 'dot', 'dotx', 'docm', 'wps'],
  sheet: ['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'xlt', 'xltx'],
  slides: ['ppt', 'pptx', 'pptm', 'odp', 'pps', 'ppsx', 'key'],
  video: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'ogv', 'wmv', '3gp'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'wma', 'opus', 'weba'],
  text: ['txt', 'md', 'markdown', 'log', 'rtf', 'nfo', 'srt', 'vtt', 'tex'],
  code: ['js', 'mjs', 'ts', 'tsx', 'jsx', 'json', 'html', 'htm', 'css', 'scss', 'xml', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'bat', 'ps1', 'sql', 'yaml', 'yml', 'ini', 'toml', 'm', 'r', 'kt', 'swift', 'dart', 'lua', 'ino', 'cfg', 'conf', 'env', 'csproj', 'gradle', 'vue', 'svelte', 'ipynb'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso'],
  ebook: ['epub', 'mobi', 'azw', 'azw3', 'djvu'],
};
const EXT_KIND = {};
for (const [k, list] of Object.entries(KIND_EXT)) for (const e of list) EXT_KIND[e] = k;

export function kindOf(ext, mime = '') {
  if (ext && EXT_KIND[ext]) return EXT_KIND[ext];
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
}

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  html: 'text/html', htm: 'text/html', xml: 'application/xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
};
export function mimeOf(ext, fallback = '') {
  return MIME[ext] || fallback || 'application/octet-stream';
}

// Text-like extensions we can display as code/text
export function isTextLike(ext, mime = '') {
  const k = kindOf(ext, mime);
  return k === 'text' || k === 'code' || mime.startsWith('text/');
}

export function sanitizeFileName(name) {
  return String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 180) || 'untitled';
}

export function formatBytes(n, locale = 'en') {
  if (!(n >= 0)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v);
  return `${num} ${units[i]}`;
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
export function readText(blob) { return blob.text(); }

export async function sha256Hex(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || 'file'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Simple event emitter
export class Emitter {
  constructor() { this._m = new Map(); }
  on(ev, fn) { if (!this._m.has(ev)) this._m.set(ev, new Set()); this._m.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this._m.get(ev)?.delete(fn); }
  emit(ev, ...args) { this._m.get(ev)?.forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } }); }
}

// Sort helper with locale-aware string compare
export function makeComparator(field, dir = 1, locale = 'en') {
  const coll = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  return (a, b) => {
    let va = a[field], vb = b[field];
    if (typeof va === 'string' || typeof vb === 'string') return coll.compare(String(va ?? ''), String(vb ?? '')) * dir;
    return ((va ?? 0) - (vb ?? 0)) * dir;
  };
}

export function fileToUint8(file) { return file.arrayBuffer().then(b => new Uint8Array(b)); }

export function isOnline() { return navigator.onLine !== false; }

export function relTime(ts, locale = 'en') {
  const diff = (Date.now() - ts) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diff < 60) return rtf.format(-Math.round(diff), 'second');
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  if (diff < 86400 * 365) return rtf.format(-Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(-Math.round(diff / (86400 * 365)), 'year');
}

export function pad2(n) { return String(n).padStart(2, '0'); }
export function ymd(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function hms(d = new Date()) { return `${pad2(d.getHours())}${pad2(d.getMinutes())}`; }
