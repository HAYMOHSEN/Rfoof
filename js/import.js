// ============================================================
//  Rfoof – import pipeline: naming, thumbnails, text indexing
// ============================================================
import { store } from './store.js';
import { LIMITS } from './config.js';
import { extOf, baseName, kindOf, mimeOf, uid, sha256Hex, ymd, hms, pad2, sleep, isTextLike, Emitter } from './utils.js';
import { indexWords } from './search.js';
import { docxText, xlsxText, pptxText } from './office.js';
import { license } from './license.js';

export const importEvents = new Emitter();

// ---------------- pdf.js loader ----------------
let pdfjsPromise = null;
export function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdfjs/pdf.min.mjs').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    }).catch(e => { pdfjsPromise = null; throw e; });
  }
  return pdfjsPromise;
}
export function pdfDocOptions(data) {
  const base = new URL('../vendor/pdfjs/', import.meta.url).href;
  return { data, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/', isEvalSupported: false };
}

// ---------------- naming ----------------
export function applyTemplate(tpl, ctx) {
  const d = ctx.date || new Date();
  const map = {
    name: ctx.name ?? '', ext: ctx.ext ?? '', folder: ctx.folder ?? '', tag: ctx.tag ?? '',
    date: ymd(d), time: hms(d), year: String(d.getFullYear()), month: pad2(d.getMonth() + 1), day: pad2(d.getDate()),
  };
  return String(tpl || '{name}')
    .replace(/\{n(?::(\d))?\}/g, (_, w) => String(ctx.n ?? 1).padStart(w ? +w : 1, '0'))
    .replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m))
    .replace(/\s+/g, ' ').trim();
}

// Clean a raw file name into a human-friendly title suggestion
export function suggestTitle(fileName) {
  let s = baseName(fileName).trim();
  // camera / screenshot / scanner style names → "Photo 2024-09-12"
  const m = /^(?:IMG|DSC|PXL|VID|MOV|Screenshot|Screen Shot|WhatsApp Image|WhatsApp Video|Scan|SCAN|Photo|Capture)[ _-]*(\d{4})[-_]?(\d{2})[-_]?(\d{2})/i.exec(s);
  if (m) {
    const kind = /^(VID|MOV|WhatsApp Video)/i.test(s) ? 'Video' : /^(Screen|Capture)/i.test(s) ? 'Screenshot' : /^Scan/i.test(s) ? 'Scan' : 'Photo';
    return `${kind} ${m[1]}-${m[2]}-${m[3]}`;
  }
  // protect ISO dates, then turn separators into spaces
  const dates = [];
  s = s.replace(/\d{4}-\d{2}-\d{2}/g, (d) => { dates.push(d); return `\u0000${dates.length - 1}\u0000`; });
  s = s.replace(/\b(\d{4})(\d{2})(\d{2})(?:[-_ ]?\d{4,6})?\b/g, (all, y, mo, d) => (+mo <= 12 && +d <= 31 ? `${y}-${mo}-${d}` : all));
  s = s.replace(/[_\-.]+/g, ' ').replace(/\s*\(\d+\)\s*$/, '').replace(/\s+copy(\s*\d*)$/i, '').replace(/\s+(final|v\d+|draft)$/i, ' $1');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => dates[+i]);
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s) return 'Untitled';
  if (/^[a-z]/.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

// ---------------- thumbnails ----------------
async function canvasToBlob(canvas) {
  return new Promise(res => canvas.toBlob(b => res(b), 'image/webp', 0.82));
}
function fitSize(w, h, max) {
  const r = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
}
export async function imageThumb(blob, max = LIMITS.thumbSize) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    // fall back to <img> (e.g. SVG)
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const { w, h } = fitSize(img.naturalWidth || 300, img.naturalHeight || 300, max);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      return await canvasToBlob(c);
    } finally { URL.revokeObjectURL(url); }
  }
  try {
    const { w, h } = fitSize(bmp.width, bmp.height, max);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return await canvasToBlob(c);
  } finally { bmp.close?.(); }
}
export async function videoThumb(blob, max = LIMITS.thumbSize) {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video')); setTimeout(() => rej(new Error('timeout')), 8000); });
    const t = Math.min(1.5, (v.duration || 1) * 0.1);
    await new Promise((res, rej) => { v.onseeked = res; v.onerror = rej; v.currentTime = t; setTimeout(res, 4000); });
    const { w, h } = fitSize(v.videoWidth || 320, v.videoHeight || 180, max);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    return await canvasToBlob(c);
  } finally { URL.revokeObjectURL(url); }
}
export async function pdfThumb(blob, max = LIMITS.thumbSize) {
  const lib = await pdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const doc = await lib.getDocument(pdfDocOptions(data)).promise;
  try {
    const page = await doc.getPage(1);
    const vp0 = page.getViewport({ scale: 1 });
    const scale = max / Math.max(vp0.width, vp0.height);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return await canvasToBlob(c);
  } finally { await doc.destroy(); }
}

// ---------------- text extraction ----------------
export async function extractText(file, blob) {
  const max = LIMITS.textIndexChars;
  const ext = file.ext; const kind = file.kind;
  try {
    if (isTextLike(ext, file.mime) || ext === 'csv' || ext === 'tsv') {
      const t = await blob.slice(0, max * 2).text();
      return t.slice(0, max);
    }
    if (kind === 'pdf') {
      const lib = await pdfjs();
      const data = new Uint8Array(await blob.arrayBuffer());
      const doc = await lib.getDocument(pdfDocOptions(data)).promise;
      try {
        const n = Math.min(doc.numPages, LIMITS.pdfIndexPages);
        let out = '';
        for (let i = 1; i <= n && out.length < max; i++) {
          const page = await doc.getPage(i);
          const tc = await page.getTextContent();
          let line = '';
          for (const it of tc.items) { if (it.str) line += it.str; if (it.hasEOL) line += '\n'; else line += ' '; }
          out += line + '\n';
        }
        const meta = await doc.getMetadata().catch(() => null);
        if (meta?.info?.Title) out = meta.info.Title + '\n' + out;
        return out.slice(0, max);
      } finally { await doc.destroy(); }
    }
    if (ext === 'docx' || ext === 'dotx' || ext === 'docm') return (await docxText(await blob.arrayBuffer(), max)).slice(0, max);
    if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xltx') return (await xlsxText(await blob.arrayBuffer(), max)).slice(0, max);
    if (ext === 'pptx' || ext === 'ppsx' || ext === 'pptm') return (await pptxText(await blob.arrayBuffer(), max)).slice(0, max);
  } catch (e) {
    console.warn('text extraction failed', file.title, e);
  }
  return '';
}

export async function makeThumb(file, blob) {
  try {
    if (file.kind === 'image' && !['heic', 'heif', 'tif', 'tiff'].includes(file.ext)) return await imageThumb(blob);
    if (file.kind === 'pdf') return await pdfThumb(blob);
    if (file.kind === 'video') return await videoThumb(blob);
  } catch (e) { console.warn('thumbnail failed', file.title, e); }
  return null;
}

// ---------------- background indexer ----------------
class Indexer {
  constructor() { this.queue = []; this.running = false; this.busy = new Set(); }
  add(ids) {
    for (const id of ids) if (!this.busy.has(id) && !this.queue.includes(id)) this.queue.push(id);
    this.run();
  }
  async run() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const id = this.queue.shift();
      this.busy.add(id);
      try { await this.process(id); } catch (e) { console.warn('index error', e); }
      this.busy.delete(id);
      importEvents.emit('progress', { remaining: this.queue.length });
      await sleep(30);
    }
    this.running = false;
    importEvents.emit('idle');
  }
  async process(id) {
    const f = store.file(id); if (!f || f.deletedAt) return;
    const blob = await store.getBlob(id); if (!blob) return;
    if (!f.thumb) { const th = await makeThumb(f, blob); if (th) await store.setThumb(id, th); }
    if (!f.indexed) {
      const text = await extractText(f, blob);
      const words = text ? indexWords(text, LIMITS.maxWordsPerFile) : [];
      await store.setIndex(id, text, words);
    }
  }
  async reindexAll() {
    const ids = [];
    for (const f of store.files.values()) if (!f.deletedAt && f.hasBlob) { f.indexed = false; f.thumb = false; store.revokeThumb(f.id); ids.push(f.id); }
    this.add(ids);
  }
}
export const indexer = new Indexer();

// ---------------- import ----------------
/**
 * entries: [{file: File, title: string, tags?: string[], color?: string}]
 * opts: {folderId, tags, color}
 * onProgress({done, total, current})
 */
export async function importEntries(entries, opts = {}, onProgress = () => {}) {
  const added = []; const failed = [];
  const folderName = store.folder(opts.folderId)?.name || '';
  // free version: only `remaining` more files may be added on this device
  const remaining = license.remaining();
  const blocked = entries.length > remaining ? entries.slice(remaining) : [];
  entries = entries.slice(0, remaining);
  let n = 0;
  for (const e of entries) {
    n++;
    const file = e.file;
    onProgress({ done: n - 1, total: entries.length, current: file.name });
    try {
      const ext = extOf(file.name);
      const kind = kindOf(ext, file.type || '');
      const mime = file.type || mimeOf(ext);
      const blob = file.slice(0, file.size, mime);
      let hash = '';
      if (file.size <= 64 * 1024 * 1024) { try { hash = await sha256Hex(blob); } catch { /* ignore */ } }
      const tags = Array.from(new Set([...(opts.tags || []), ...(e.tags || [])].map(t => t.trim()).filter(Boolean)));
      const title = (e.title || applyTemplate(opts.template || store.settings.template, { name: baseName(file.name), ext, folder: folderName, n, tag: tags[0] })).trim() || baseName(file.name) || 'Untitled';
      // quick thumbnail for images so the card looks right immediately
      let thumb = null;
      if (kind === 'image' && file.size < 25 * 1024 * 1024) thumb = await makeThumb({ kind, ext }, blob);
      const rec = await store.createFile({
        id: uid(), folderId: opts.folderId || '', title, originalName: file.name, ext, kind, mime, size: file.size,
        tags, color: e.color || opts.color || '', hash, createdAt: file.lastModified || Date.now(),
      }, blob, { thumb });
      if (thumb) rec.thumb = true;
      added.push(rec.id);
    } catch (err) {
      console.error('import failed', file.name, err);
      failed.push({ name: file.name, error: err });
    }
    await sleep(0);
  }
  onProgress({ done: entries.length, total: entries.length, current: '' });
  indexer.add(added);
  await license.countImports(added.length);
  return { added, failed, blocked };
}

export function findDuplicateByHash(hash) {
  if (!hash) return null;
  for (const f of store.files.values()) if (!f.deletedAt && f.hash === hash) return f;
  return null;
}

// Read all files from a dropped DataTransfer (supports folders)
export async function filesFromDataTransfer(dt) {
  const out = [];
  const items = dt.items ? Array.from(dt.items) : [];
  const entries = items.map(it => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null));
  if (entries.some(Boolean)) {
    const walk = async (entry, prefix = '') => {
      if (!entry) return;
      if (entry.isFile) {
        const f = await new Promise((res, rej) => entry.file(res, rej));
        if (prefix) { try { Object.defineProperty(f, 'relativePath', { value: prefix + f.name }); } catch { /* ignore */ } }
        out.push(f);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const e of batch) await walk(e, prefix + entry.name + '/');
        } while (batch.length);
      }
    };
    for (const e of entries) await walk(e);
    if (out.length) return out;
  }
  return Array.from(dt.files || []);
}
