// PDF viewer built on pdf.js (lazy loaded) with native-viewer fallback
import { h, clear, debounce, clamp } from '../utils.js';
import { t } from '../i18n.js';
import { pdfjs, pdfDocOptions } from '../import.js';
import { icon } from '../icons.js';
import { normalize } from '../search.js';

export async function pdfView(stage, blob, ctrl) {
  let lib;
  try { lib = await pdfjs(); } catch (e) { return nativePdf(stage, blob, ctrl); }
  const data = new Uint8Array(await blob.arrayBuffer());
  let doc;
  try { doc = await lib.getDocument(pdfDocOptions(data)).promise; }
  catch (e) { console.warn('pdf.js failed, using native viewer', e); return nativePdf(stage, blob, ctrl); }
  stage.classList.add('top');
  const wrap = h('div', { class: 'pdf-pages' });
  stage.appendChild(wrap);
  const n = doc.numPages;
  const pages = []; const textCache = new Map();
  let scale = 1; let baseW = 0; let findState = { q: '', pages: [], idx: -1 };
  const page1 = await doc.getPage(1);
  const vp1 = page1.getViewport({ scale: 1 });
  baseW = vp1.width;
  const fitWidthScale = () => clamp((stage.clientWidth - 48) / baseW, 0.3, 4);
  scale = Math.min(1.5, fitWidthScale());
  ctrl.setMeta(`${t('viewer.page')} 1 ${t('viewer.of')} ${n}`);

  const supportsTextLayer = !!lib.TextLayer;
  for (let i = 1; i <= n; i++) {
    const el = h('div', { class: 'pdf-page', dataset: { page: i } });
    el.style.width = Math.floor(vp1.width * scale) + 'px'; el.style.height = Math.floor(vp1.height * scale) + 'px';
    wrap.appendChild(el);
    pages.push({ el, rendered: 0, task: null });
  }
  const renderPage = async (i) => {
    const p = pages[i - 1];
    if (p.rendered === scale || p.task) return;
    p.task = (async () => {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: scale * (window.devicePixelRatio > 1 ? 1 : 1) });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = Math.floor(vp.width) + 'px'; canvas.style.height = Math.floor(vp.height) + 'px';
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      p.el.style.width = Math.floor(vp.width) + 'px'; p.el.style.height = Math.floor(vp.height) + 'px';
      clear(p.el); p.el.appendChild(canvas);
      if (supportsTextLayer) {
        try {
          const tl = h('div', { class: 'textLayer' });
          p.el.style.setProperty('--scale-factor', String(vp.scale));
          p.el.appendChild(tl);
          const textContent = await page.getTextContent();
          textCache.set(i, textContent);
          await new lib.TextLayer({ textContentSource: textContent, container: tl, viewport: vp }).render();
          if (findState.q) markMatches(tl, findState.q);
        } catch (e) { /* text layer optional */ }
      }
      p.rendered = scale;
    })().catch(e => console.warn('render page', i, e)).finally(() => { p.task = null; });
  };
  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) { const i = +en.target.dataset.page; if (en.isIntersecting) { visible.add(i); renderPage(i); } else visible.delete(i); }
    if (visible.size) { const cur = Math.min(...visible); ctrl.setMeta(`${t('viewer.page')} ${cur} ${t('viewer.of')} ${n}`); }
  }, { root: stage, rootMargin: '600px 0px' });
  pages.forEach(p => io.observe(p.el));

  const rescale = debounce(() => {
    for (const p of pages) { p.el.style.width = Math.floor(vp1.width * scale) + 'px'; p.el.style.height = Math.floor(vp1.height * scale) + 'px'; p.rendered = 0; }
    for (const i of visible) renderPage(i);
    ctrl.setZoom(scale);
  }, 120);
  const setScale = (s) => { const ratio = s / scale; const st = stage.scrollTop; scale = clamp(s, 0.3, 5); stage.scrollTop = st * ratio; rescale(); ctrl.setZoom(scale); };
  stage.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setScale(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
  const ro = new ResizeObserver(debounce(() => { /* keep scale */ }, 200)); ro.observe(stage);

  // ---- find ----
  const markMatches = (tl, q) => {
    const nq = normalize(q); if (!nq) return;
    for (const span of Array.from(tl.querySelectorAll('span'))) {
      const txt = span.textContent; const nt = normalize(txt);
      if (!nt.includes(nq) || nt.length !== txt.length) { if (nt.includes(nq)) span.classList.add('hit'); continue; }
      let html = ''; let pos = 0; let idx;
      while ((idx = nt.indexOf(nq, pos)) !== -1) { html += esc(txt.slice(pos, idx)) + '<mark style="background:rgba(255,200,0,.6);color:transparent">' + esc(txt.slice(idx, idx + nq.length)) + '</mark>'; pos = idx + nq.length; }
      html += esc(txt.slice(pos)); span.innerHTML = html;
    }
  };
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const find = async (q) => {
    findState = { q, pages: [], idx: -1 };
    if (!q) { for (const p of pages) p.rendered = 0; for (const i of visible) renderPage(i); ctrl.setFindCount(''); return; }
    const nq = normalize(q);
    for (let i = 1; i <= n; i++) {
      let tc = textCache.get(i);
      if (!tc) { try { tc = await (await doc.getPage(i)).getTextContent(); textCache.set(i, tc); } catch { continue; } }
      const text = tc.items.map(it => it.str || '').join(' ');
      if (normalize(text).includes(nq)) findState.pages.push(i);
      if (findState.q !== q) return;
    }
    for (const p of pages) p.rendered = 0; for (const i of visible) renderPage(i);
    ctrl.setFindCount(findState.pages.length ? `${findState.pages.length} ${t('viewer.page').toLowerCase()}` : '0');
    if (findState.pages.length) findNext(1);
  };
  const findNext = (dir) => {
    if (!findState.pages.length) return;
    findState.idx = (findState.idx + dir + findState.pages.length) % findState.pages.length;
    const pg = findState.pages[findState.idx];
    pages[pg - 1].el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    ctrl.setFindCount(`${findState.idx + 1} / ${findState.pages.length}`);
  };
  ctrl.on({
    zoomIn: () => setScale(scale * 1.25), zoomOut: () => setScale(scale / 1.25), fit: () => setScale(fitWidthScale()), actual: () => setScale(1),
    find, findNext: () => findNext(1), findPrev: () => findNext(-1),
    goPage: (p) => pages[clamp(p, 1, n) - 1]?.el.scrollIntoView({ block: 'start' }),
  });
  ctrl.setZoomable(true); ctrl.setFindable(true); ctrl.setZoom(scale);
  return () => { io.disconnect(); ro.disconnect(); doc.destroy().catch(() => {}); stage.classList.remove('top'); };
}

function nativePdf(stage, blob, ctrl) {
  const url = URL.createObjectURL(blob);
  const frame = h('iframe', { class: 'pdf-frame', src: url + '#toolbar=1', title: 'PDF' });
  stage.appendChild(frame);
  ctrl.setMeta('PDF');
  return () => URL.revokeObjectURL(url);
}
