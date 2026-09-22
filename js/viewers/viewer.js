// ============================================================
//  Rfoof – full-screen file viewer
// ============================================================
import { h, clear, formatBytes, loadStyle, escapeHtml, isTextLike, downloadBlob, debounce } from '../utils.js';
import { icon, KIND_ICON, KIND_COLOR } from '../icons.js';
import { store } from '../store.js';
import { t, locale, isRTL, fmtDate } from '../i18n.js';
import { actions } from '../ui/actions.js';
import { toast } from '../ui/toast.js';
import { app } from '../app.js';
import { imageView } from './imageView.js';
import { pdfView } from './pdfView.js';
import { docxToHtml, xlsxToSheets, csvParse, pptxToSlides, zipEntries } from '../office.js';
import { DetailsPanel } from '../ui/details.js';

let current = null;
const CLOUD_CONVERTIBLE = new Set(['doc', 'docx', 'dot', 'dotx', 'docm', 'odt', 'rtf', 'ppt', 'pptx', 'pps', 'ppsx', 'pptm', 'odp', 'xls', 'xlsx', 'xlsm', 'ods', 'epub']);

export function openViewer(id, list) {
  if (current) current.close();
  const v = new Viewer(id, list && list.length ? list : [id]);
  current = v;
  return v;
}
export function closeViewer() { current?.close(); }

class Viewer {
  constructor(id, list) {
    this.list = list; this.index = Math.max(0, list.indexOf(id));
    this.handlers = {}; this.cleanup = null; this.ctrlState = {};
    this.build();
    document.body.appendChild(this.root);
    this.onKey = this.onKey.bind(this);
    document.addEventListener('keydown', this.onKey, true);
    this.prevFocus = document.activeElement;
    this.show();
  }
  build() {
    this.root = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true' });
    const top = h('div', { class: 'viewer-top' });
    const ib = (ic, title, fn, cls = '') => h('button', { class: `icon-btn ${cls}`, title, 'aria-label': title, onclick: fn }, icon(ic));
    this.btnClose = ib('arrow-left', t('action.close'), () => this.close(), 'flip');
    this.title = h('div', { class: 'vtitle' });
    this.meta = h('div', { class: 'vmeta' });
    this.zoomLabel = h('span', { class: 'zoom-label' });
    this.btnZoomOut = ib('zoom-out', t('viewer.zoomOut'), () => this.call('zoomOut'));
    this.btnZoomIn = ib('zoom-in', t('viewer.zoomIn'), () => this.call('zoomIn'));
    this.btnFit = ib('maximize', t('viewer.fit'), () => this.call('fit'), 'v-fit');
    this.btnRotate = ib('rotate', t('viewer.rotate'), () => this.call('rotate'));
    this.btnFind = ib('search', t('viewer.textSearch'), () => this.toggleFind());
    this.btnCloud = ib('cloud', t('viewer.cloudPreview'), () => this.cloudPreview(true));
    this.btnStar = ib('star', t('action.star'), () => { const f = this.file(); if (f) actions.star([f.id], !f.starred).then(() => this.updateStar()); });
    this.btnDownload = ib('download', t('action.download'), () => { const f = this.file(); if (f) actions.download(f.id); }, 'v-dl');
    this.btnInfo = ib('info', t('viewer.info'), () => this.toggleInfo());
    this.btnMore = ib('more-v', t('action.more'), (e) => { const f = this.file(); if (f) actions.fileMenu([f.id], { anchor: e.currentTarget, align: 'end' }); });
    this.btnFull = ib('fullscreen', t('viewer.fullscreen'), () => { if (document.fullscreenElement) document.exitFullscreen(); else this.root.requestFullscreen?.(); }, 'v-full');
    top.append(this.btnClose, this.title, this.meta, this.btnZoomOut, this.zoomLabel, this.btnZoomIn, this.btnFit, this.btnRotate, this.btnFind, this.btnCloud, this.btnStar, this.btnDownload, this.btnFull, this.btnInfo, this.btnMore);
    const body = h('div', { class: 'viewer-body' });
    this.stage = h('div', { class: 'viewer-stage' });
    this.side = h('div', { class: 'viewer-side', hidden: true });
    this.prev = h('button', { class: 'viewer-nav prev', title: t('viewer.prev'), onclick: () => this.step(-1) }, icon('chevron-left', { size: 28, cls: 'flip' }));
    this.next = h('button', { class: 'viewer-nav next', title: t('viewer.next'), onclick: () => this.step(1) }, icon('chevron-right', { size: 28, cls: 'flip' }));
    this.findBox = h('div', { class: 'viewer-find', hidden: true });
    this.findInput = h('input', { placeholder: t('viewer.textSearch') });
    this.findCount = h('span', { class: 'cnt' });
    this.findBox.append(this.findInput, this.findCount,
      h('button', { class: 'icon-btn sm', onclick: () => this.call('findPrev') }, icon('chevron-up', { size: 16 })),
      h('button', { class: 'icon-btn sm', onclick: () => this.call('findNext') }, icon('chevron-down', { size: 16 })),
      h('button', { class: 'icon-btn sm', onclick: () => this.toggleFind(false) }, icon('x', { size: 16 })));
    this.findInput.addEventListener('input', debounce(() => this.call('find', this.findInput.value.trim()), 300));
    this.findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.call(e.shiftKey ? 'findPrev' : 'findNext'); } if (e.key === 'Escape') { e.stopPropagation(); this.toggleFind(false); } });
    body.append(this.stage, this.findBox, this.prev, this.next, this.side);
    this.root.append(top, body);
    // touch swipe navigation
    let sx = null, sy = null;
    this.stage.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
    this.stage.addEventListener('touchend', (e) => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null; if (Math.abs(dx) > 80 && Math.abs(dy) < 60 && this.ctrlState.zoomable !== 'image') this.step(dx < 0 ? 1 : -1); }, { passive: true });
  }
  file() { return store.file(this.list[this.index]); }
  call(name, ...args) { this.handlers[name]?.(...args); }
  ctrl() {
    return {
      on: (hs) => Object.assign(this.handlers, hs),
      setZoom: (z) => { this.zoomLabel.textContent = Math.round(z * 100) + '%'; },
      setMeta: (m) => { this.meta.textContent = m; },
      setZoomable: (v) => { this.ctrlState.zoomable = v; [this.btnZoomIn, this.btnZoomOut, this.btnFit, this.zoomLabel].forEach(b => b.hidden = !v); },
      setRotatable: (v) => { this.btnRotate.hidden = !v; if (v) this.ctrlState.zoomable = 'image'; },
      setFindable: (v) => { this.btnFind.hidden = !v; },
      setFindCount: (s) => { this.findCount.textContent = s; },
      fail: () => this.renderGeneric(this.file(), t('viewer.noPreview')),
    };
  }
  resetControls() {
    this.handlers = {}; this.ctrlState = {};
    [this.btnZoomIn, this.btnZoomOut, this.btnFit, this.zoomLabel, this.btnRotate, this.btnFind, this.btnCloud].forEach(b => b.hidden = true);
    this.findBox.hidden = true; this.findInput.value = ''; this.findCount.textContent = '';
    this.meta.textContent = '';
  }
  updateStar() { const f = this.file(); this.btnStar.classList.toggle('active', !!f?.starred); this.btnStar.querySelector('svg').style.fill = f?.starred ? '#f5c518' : 'none'; this.btnStar.style.color = f?.starred ? '#f5c518' : ''; }
  toggleFind(force) { const show = force ?? this.findBox.hidden; this.findBox.hidden = !show; if (show) this.findInput.focus(); else this.call('find', ''); }
  toggleInfo(force) {
    const show = force ?? this.side.hidden;
    this.side.hidden = !show; this.btnInfo.classList.toggle('active', show);
    if (show) { if (!this.details) { this.details = new DetailsPanel(this.side, { onClose: () => this.toggleInfo(false) }); } this.details.pinned = this.list[this.index]; this.details.render(); }
  }
  step(d) {
    const n = this.index + d;
    if (n < 0 || n >= this.list.length) return;
    this.index = n; this.show();
  }
  onKey(e) {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) && e.key !== 'Escape') return;
    const rtl = isRTL();
    switch (e.key) {
      case 'Escape': e.preventDefault(); e.stopPropagation(); if (!this.findBox.hidden) this.toggleFind(false); else this.close(); break;
      case 'ArrowRight': e.preventDefault(); this.step(rtl ? -1 : 1); break;
      case 'ArrowLeft': e.preventDefault(); this.step(rtl ? 1 : -1); break;
      case '+': case '=': this.call('zoomIn'); break;
      case '-': this.call('zoomOut'); break;
      case '0': this.call('fit'); break;
      case 'r': case 'R': this.call('rotate'); break;
      case 'i': case 'I': this.toggleInfo(); break;
      case 's': case 'S': if (!e.ctrlKey) this.btnStar.click(); break;
      case 'f': case 'F': if (e.ctrlKey || e.metaKey) { if (!this.btnFind.hidden) { e.preventDefault(); this.toggleFind(true); } } else this.btnFull.click(); break;
      case 'Delete': { const f = this.file(); if (f) { e.preventDefault(); const idx = this.index; actions.trash([f.id]).then(() => { this.list.splice(idx, 1); if (!this.list.length) this.close(); else { this.index = Math.min(idx, this.list.length - 1); this.show(); } }); } break; }
      default: return;
    }
  }
  close() {
    this.cleanup?.(); this.cleanup = null;
    this.details?.destroy();
    document.removeEventListener('keydown', this.onKey, true);
    if (document.fullscreenElement === this.root) document.exitFullscreen?.();
    this.root.remove();
    if (current === this) current = null;
    this.prevFocus?.focus?.();
  }

  async show() {
    const f = this.file();
    if (!f) { this.close(); return; }
    this.cleanup?.(); this.cleanup = null;
    this.resetControls();
    clear(this.stage);
    this.title.textContent = f.title;
    this.updateStar();
    this.prev.disabled = this.index <= 0; this.next.disabled = this.index >= this.list.length - 1;
    this.meta.textContent = `${this.list.length > 1 ? `${this.index + 1} / ${this.list.length} · ` : ''}${formatBytes(f.size, locale())}`;
    if (this.details && !this.side.hidden) { this.details.pinned = f.id; this.details.render(); }
    store.updateFile(f.id, { lastOpened: Date.now() }, { sync: false, emit: false });
    const loading = h('div', { class: 'viewer-loading' }, icon('loader', { size: 36, cls: 'spin' }), h('span', { text: t('viewer.loading') }));
    this.stage.appendChild(loading);
    const token = this.loadToken = Symbol('load');
    let blob = await store.getBlob(f.id);
    if (!blob) {
      if (f.remoteId && app.sync && app.sync.canSync()) {
        try {
          const prog = h('div', { class: 'progress', style: { width: '240px' } }, h('div'));
          loading.appendChild(prog);
          blob = await app.sync.ensureBlob(f.id, (done, total) => { prog.firstChild.style.width = Math.round(done / total * 100) + '%'; });
        } catch (e) { console.warn(e); }
      }
      if (this.loadToken !== token) return;
      if (!blob) { clear(this.stage); this.renderCloudOnly(f); return; }
    }
    if (this.loadToken !== token) return;
    clear(this.stage);
    try { this.cleanup = await this.render(f, blob); }
    catch (e) { console.error('viewer', e); if (this.loadToken === token) { clear(this.stage); this.renderGeneric(f, t('viewer.noPreview')); } }
  }

  async render(f, blob) {
    const ext = f.ext; const ctrl = this.ctrl();
    if (f.kind === 'image') return imageView(this.stage, blob, ctrl);
    if (f.kind === 'pdf') return pdfView(this.stage, blob, ctrl);
    if (f.kind === 'video' || f.kind === 'audio') return this.renderMedia(f, blob);
    if (ext === 'md' || ext === 'markdown') return this.renderMarkdown(f, blob);
    if (isTextLike(ext, f.mime) || ext === 'csv' && false) return this.renderText(f, blob);
    if (ext === 'csv' || ext === 'tsv') return this.renderSheet(f, blob, 'csv');
    if (['xlsx', 'xlsm', 'xltx'].includes(ext)) return this.renderSheet(f, blob, 'xlsx');
    if (['docx', 'dotx', 'docm'].includes(ext)) return this.renderDocx(f, blob);
    if (['pptx', 'ppsx', 'pptm'].includes(ext)) return this.renderPptx(f, blob);
    if (ext === 'zip') return this.renderArchive(f, blob);
    if (CLOUD_CONVERTIBLE.has(ext)) { const c = await this.cloudPreview(false); if (c) return c; }
    return this.renderGeneric(f, t('viewer.noPreview'));
  }

  // ---- media ----
  renderMedia(f, blob) {
    const url = URL.createObjectURL(blob);
    const box = h('div', { class: 'media-stage' });
    if (f.kind === 'video') box.appendChild(h('video', { src: url, controls: true, autoplay: true, playsinline: true }));
    else box.appendChild(h('div', { class: 'audio-box' }, icon('music'), h('div', { style: { fontWeight: 600, fontSize: '16px' }, text: f.title }), h('audio', { src: url, controls: true, autoplay: true })));
    this.stage.appendChild(box);
    return () => { const m = box.querySelector('video,audio'); if (m) { m.pause(); m.removeAttribute('src'); m.load(); } URL.revokeObjectURL(url); };
  }
  // ---- text / code ----
  async renderText(f, blob) {
    const MAX = 2 * 1024 * 1024;
    const text = await blob.slice(0, MAX).text();
    const box = h('div', { class: 'text-stage' });
    const pre = h('pre'); const code = h('code');
    pre.appendChild(code); box.appendChild(pre); this.stage.appendChild(box);
    code.textContent = text;
    if (f.kind === 'code' || ['json', 'xml', 'html', 'css', 'js'].includes(f.ext)) {
      try {
        const [{ default: hljs }] = await Promise.all([import('../../vendor/hljs/core.js'), loadStyle('./vendor/hljs/github-dark.min.css')]);
        const map = { js: 'javascript', mjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', rs: 'rust', cs: 'csharp', sh: 'bash', ps1: 'powershell', yml: 'yaml', htm: 'xml', html: 'xml', svg: 'xml', h: 'c', hpp: 'cpp', m: 'matlab', tex: 'latex', md: 'markdown', toml: 'ini', cfg: 'ini', conf: 'ini', env: 'bash', bat: 'powershell' };
        const lang = map[f.ext] || f.ext;
        const known = ['javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp', 'json', 'xml', 'css', 'bash', 'powershell', 'sql', 'yaml', 'markdown', 'ini', 'go', 'rust', 'php', 'ruby', 'matlab', 'latex', 'plaintext'];
        if (known.includes(lang) && text.length < 600000) {
          if (!hljs.getLanguage(lang)) { const mod = await import(`../../vendor/hljs/languages/${lang}.js`); hljs.registerLanguage(lang, mod.default); }
          code.innerHTML = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
          code.className = 'hljs';
        }
      } catch (e) { console.warn('highlight failed', e); }
    }
    if (blob.size > MAX) pre.appendChild(h('div', { style: { color: '#999', marginTop: '10px' }, text: '… ' + t('viewer.rowsLimited', { n: '2 MB' }) }));
    return () => {};
  }
  async renderMarkdown(f, blob) {
    const text = await blob.slice(0, 2 * 1024 * 1024).text();
    const box = h('div', { class: 'text-stage' });
    const paper = h('div', { class: 'md-paper', dir: 'auto' });
    box.appendChild(paper); this.stage.appendChild(box);
    try {
      const { marked } = await import('../../vendor/marked.esm.js');
      const html = marked.parse(text, { gfm: true, breaks: false });
      // sanitize: strip scripts/handlers via DOMParser
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script, iframe, object, embed, link, style').forEach(n => n.remove());
      doc.querySelectorAll('*').forEach(el => { for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name) || (a.name === 'href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name); });
      paper.innerHTML = doc.body.innerHTML;
      paper.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
    } catch (e) { paper.appendChild(h('pre', { text })); }
    return () => {};
  }
  // ---- docx ----
  async renderDocx(f, blob) {
    const box = h('div', { class: 'doc-stage' }); this.stage.appendChild(box);
    const res = await docxToHtml(await blob.arrayBuffer());
    const paper = h('div', { class: 'doc-paper', dir: 'auto' });
    paper.innerHTML = res.html;
    box.appendChild(paper);
    if (app.sync?.canSync() && f.remoteId) this.btnCloud.hidden = false;
    this.meta.textContent += ' · ' + t('viewer.basicPreview');
    return () => res.revoke();
  }
  // ---- sheets ----
  async renderSheet(f, blob, type) {
    let sheets;
    if (type === 'csv') { const { rows, truncated } = csvParse(await blob.slice(0, 8 * 1024 * 1024).text()); sheets = [{ name: f.title, rows, cols: Math.max(0, ...rows.map(r => r.length)), truncated }]; }
    else sheets = await xlsxToSheets(await blob.arrayBuffer());
    const box = h('div', { class: 'sheet-stage' });
    const tabs = h('div', { class: 'sheet-tabs' }); const scroll = h('div', { class: 'sheet-scroll' });
    box.append(tabs, scroll); this.stage.appendChild(box);
    const MAXR = 2000;
    const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    const fmtNumber = new Intl.NumberFormat(locale(), { maximumFractionDigits: 6 });
    const renderSheetTable = (s) => {
      clear(scroll);
      const table = h('table', { dir: 'auto' });
      const thead = h('tr'); thead.appendChild(h('th', { class: 'rn' }));
      for (let c = 0; c < s.cols; c++) thead.appendChild(h('th', { text: colName(c) }));
      table.appendChild(h('thead', {}, thead));
      const tbody = h('tbody');
      const skip = new Set(); const span = new Map();
      for (const m of s.merges || []) { span.set(`${m.r1},${m.c1}`, { rs: m.r2 - m.r1 + 1, cs: m.c2 - m.c1 + 1 }); for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) skip.add(`${r},${c}`); }
      const n = Math.min(s.rows.length, MAXR);
      for (let r = 0; r < n; r++) {
        const tr = h('tr'); tr.appendChild(h('th', { class: 'rn', text: String(r + 1) }));
        const row = s.rows[r] || [];
        for (let c = 0; c < s.cols; c++) {
          if (skip.has(`${r},${c}`)) continue;
          const v = row[c]; let txt = '', cls = '';
          if (v && typeof v === 'object') { if ('num' in v) { txt = fmtNumber.format(v.num); cls = 'num'; } else if (v.date) { txt = fmtDate(v.date.getTime(), { dateStyle: 'medium', ...(v.date.getUTCHours() || v.date.getUTCMinutes() ? { timeStyle: 'short' } : {}) }); } }
          else if (v !== undefined && v !== null) { txt = String(v); if (/^-?\d+(\.\d+)?$/.test(txt)) cls = 'num'; }
          const td = h('td', { class: cls, text: txt, title: txt.length > 40 ? txt : null });
          const sp = span.get(`${r},${c}`); if (sp) { if (sp.rs > 1) td.rowSpan = sp.rs; if (sp.cs > 1) td.colSpan = sp.cs; }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody); scroll.appendChild(table);
      if (s.rows.length > MAXR || s.truncated) scroll.appendChild(h('div', { class: 'note', text: t('viewer.rowsLimited', { n: MAXR }) }));
    };
    sheets.forEach((s, i) => tabs.appendChild(h('button', { class: i === 0 ? 'on' : '', onclick: (e) => { tabs.querySelectorAll('button').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); renderSheetTable(s); } }, s.name || `${t('viewer.sheet')} ${i + 1}`)));
    if (sheets.length) renderSheetTable(sheets[0]); else scroll.appendChild(h('div', { class: 'note', text: t('viewer.noPreview') }));
    if (type !== 'csv' && app.sync?.canSync() && f.remoteId) this.btnCloud.hidden = false;
    return () => {};
  }
  // ---- pptx ----
  async renderPptx(f, blob) {
    const box = h('div', { class: 'slides-stage' }); this.stage.appendChild(box);
    const res = await pptxToSlides(await blob.arrayBuffer());
    res.slides.forEach((s, i) => {
      const sl = h('div', { class: 'slide', style: { '--ratio': res.ratio }, dir: 'auto' });
      if (s.title) sl.appendChild(h('h2', { text: s.title }));
      for (const b of s.blocks) {
        if (b.kind === 'table') { const tb = h('table'); for (const r of b.rows) { const tr = h('tr'); r.forEach(c => tr.appendChild(h('td', { text: c }))); tb.appendChild(tr); } sl.appendChild(tb); continue; }
        if (b.kind === 'subtitle') { sl.appendChild(h('div', { class: 'sub', text: b.paras.map(p => p.text).join(' ') })); continue; }
        const ul = h('ul'); for (const p of b.paras) ul.appendChild(h('li', { style: { marginInlineStart: (p.lvl * 16) + 'px' }, text: p.text })); sl.appendChild(ul);
      }
      if (s.images.length) { const im = h('div', { class: 'imgs' }); s.images.forEach(u => im.appendChild(h('img', { src: u, alt: '' }))); sl.appendChild(im); }
      sl.appendChild(h('span', { class: 'snum', text: `${i + 1} / ${res.slides.length}` }));
      box.appendChild(sl);
    });
    this.meta.textContent += ` · ${res.slides.length} ${t('viewer.slide')} · ${t('viewer.basicPreview')}`;
    if (app.sync?.canSync() && f.remoteId) this.btnCloud.hidden = false;
    return () => res.revoke();
  }
  // ---- zip ----
  async renderArchive(f, blob) {
    const entries = await zipEntries(await blob.arrayBuffer());
    const box = h('div', { class: 'archive-stage' }); const list = h('div', { class: 'archive-list' });
    list.appendChild(h('div', { class: 'ahead', text: `${f.title} · ${entries.length} ${t('viewer.entries')}` }));
    for (const en of entries.slice(0, 2000)) list.appendChild(h('div', { class: 'arow' }, icon(en.dir ? 'folder' : 'file', { size: 16 }), h('span', { class: 'ellipsis', text: en.path, dir: 'auto' }), h('span', { class: 'sz', text: en.dir ? '' : formatBytes(en.size, locale()) }), h('span', { class: 'dt', text: en.date ? fmtDate(en.date.getTime()) : '' })));
    box.appendChild(list); this.stage.appendChild(box);
    return () => {};
  }
  // ---- cloud conversion (Office → PDF via OneDrive) ----
  async cloudPreview(userInitiated) {
    const f = this.file(); if (!f) return null;
    if (!app.sync) { if (userInitiated) toast(t('toast.needSignIn'), { type: 'error' }); return null; }
    if (!f.remoteId) { if (userInitiated) toast(t('sync.pending'), { type: 'error' }); return null; }
    const cached = await store.getPreview(f.id);
    let pdfBlob = cached && cached.etag === f.remoteEtag ? cached.blob : null;
    if (!pdfBlob) {
      if (!app.sync.canSync()) { if (userInitiated) toast(t('toast.needOnline'), { type: 'error' }); return null; }
      const token = this.loadToken;
      clear(this.stage);
      this.stage.appendChild(h('div', { class: 'viewer-loading' }, icon('loader', { size: 36, cls: 'spin' }), h('span', { text: t('viewer.converting') })));
      try { pdfBlob = await app.sync.graph.convertToPdf(f.remoteId); await store.setPreview(f.id, pdfBlob, f.remoteEtag); }
      catch (e) { console.warn('convert failed', e); if (this.loadToken !== token) return null; clear(this.stage); if (userInitiated) { toast(t('toast.error'), { type: 'error' }); this.show(); } return null; }
      if (this.loadToken !== token) return null;
      clear(this.stage);
    } else clear(this.stage);
    this.cleanup?.(); this.resetControls();
    const cleanup = await pdfView(this.stage, pdfBlob, this.ctrl());
    this.cleanup = cleanup;
    return cleanup;
  }
  // ---- fallbacks ----
  renderGeneric(f, message) {
    clear(this.stage);
    const msg = h('div', { class: 'viewer-msg' },
      h('span', { class: 'big-icon', style: { background: KIND_COLOR[f.kind] || KIND_COLOR.other } }, icon(KIND_ICON[f.kind] || 'file'), h('span', { class: 'ext', text: (f.ext || '').slice(0, 5) })),
      h('h3', { text: f.title }), h('div', { text: `${formatBytes(f.size, locale())} · ${f.originalName || ''}` }),
      h('p', { text: message }), h('p', { class: 'small', text: t('viewer.downloadHint') }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => actions.download(f.id) }, icon('download', { size: 18 }), t('action.download')),
        CLOUD_CONVERTIBLE.has(f.ext) && app.sync ? h('button', { class: 'btn', onclick: () => this.cloudPreview(true) }, icon('cloud', { size: 18 }), t('viewer.cloudPreview')) : null));
    this.stage.appendChild(msg);
    return () => {};
  }
  renderCloudOnly(f) {
    const msg = h('div', { class: 'viewer-msg' },
      h('span', { class: 'big-icon', style: { background: KIND_COLOR[f.kind] || KIND_COLOR.other } }, icon('cloud'), h('span', { class: 'ext', text: (f.ext || '').slice(0, 5) })),
      h('h3', { text: f.title }), h('p', { text: t('viewer.notDownloaded') }),
      h('button', { class: 'btn primary', onclick: () => { if (!app.sync?.canSync()) return toast(t('toast.needOnline'), { type: 'error' }); this.show(); } }, icon('cloud-download', { size: 18 }), t('viewer.downloadNow')));
    this.stage.appendChild(msg);
  }
}
