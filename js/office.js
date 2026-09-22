// ============================================================
//  Rfoof – Office Open XML (docx / xlsx / pptx) reading without
//  heavy libraries: text extraction + basic previews.
//  Requires JSZip (loaded lazily as window.JSZip).
// ============================================================
import { loadScript, escapeHtml } from './utils.js';

export async function zipLib() {
  if (!window.JSZip) await loadScript('./vendor/jszip.min.js');
  return window.JSZip;
}

function parseXml(str) {
  const doc = new DOMParser().parseFromString(str, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML parse error');
  return doc;
}
const all = (node, local) => Array.from(node.getElementsByTagNameNS('*', local));
const kids = (node, local) => Array.from(node.childNodes).filter(n => n.nodeType === 1 && n.localName === local);
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const attr = (node, name, ns = null) => {
  if (!node) return null;
  // match by local name (optionally restricted to a namespace)
  for (const a of Array.from(node.attributes || [])) if (a.localName === name && (!ns || a.namespaceURI === ns)) return a.value;
  return null;
};
const relId = (node) => attr(node, 'id', REL_NS) || attr(node, 'id');

async function readRels(zip, relsPath) {
  const f = zip.file(relsPath);
  if (!f) return {};
  const doc = parseXml(await f.async('string'));
  const map = {};
  for (const r of all(doc, 'Relationship')) map[r.getAttribute('Id')] = { target: r.getAttribute('Target'), type: r.getAttribute('Type'), mode: r.getAttribute('TargetMode') };
  return map;
}
function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
async function mediaUrl(zip, path, urls) {
  const f = zip.file(path); if (!f) return null;
  const ext = (path.split('.').pop() || '').toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', emf: 'image/emf', wmf: 'image/wmf', tif: 'image/tiff', tiff: 'image/tiff' }[ext] || 'application/octet-stream';
  const blob = new Blob([await f.async('uint8array')], { type: mime });
  const url = URL.createObjectURL(blob); urls.push(url);
  return url;
}

// =========================== DOCX ===========================
export async function docxToHtml(buffer) {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Not a DOCX file');
  const doc = parseXml(await docFile.async('string'));
  const rels = await readRels(zip, 'word/_rels/document.xml.rels');
  const urls = [];
  // numbering
  const numFmt = {}; // numId -> 'bullet' | 'decimal'
  const numFile = zip.file('word/numbering.xml');
  if (numFile) {
    try {
      const nd = parseXml(await numFile.async('string'));
      const abs = {};
      for (const a of all(nd, 'abstractNum')) {
        const lvl = kids(a, 'lvl')[0];
        const fmt = lvl ? attr(kids(lvl, 'numFmt')[0], 'val') : 'bullet';
        abs[attr(a, 'abstractNumId')] = fmt;
      }
      for (const n of all(nd, 'num')) numFmt[attr(n, 'numId')] = abs[attr(kids(n, 'abstractNumId')[0], 'val')] || 'bullet';
    } catch { /* ignore */ }
  }
  // styles: id -> {heading level}
  const styleMap = {};
  const stFile = zip.file('word/styles.xml');
  if (stFile) {
    try {
      const sd = parseXml(await stFile.async('string'));
      for (const s of all(sd, 'style')) {
        const id = attr(s, 'styleId'); const name = attr(kids(s, 'name')[0], 'val') || '';
        const m = /^heading\s*(\d)$/i.exec(name) || /^Heading(\d)$/i.exec(id || '');
        if (m) styleMap[id] = { h: Math.min(6, +m[1]) };
        else if (/^title$/i.test(name)) styleMap[id] = { h: 1, title: true };
        else if (/^subtitle$/i.test(name)) styleMap[id] = { sub: true };
        // list styles carry their numbering in the style definition
        const spPr = kids(s, 'pPr')[0]; const sNum = spPr && kids(spPr, 'numPr')[0];
        if (sNum) styleMap[id] = { ...(styleMap[id] || {}), numId: attr(kids(sNum, 'numId')[0], 'val') };
      }
    } catch { /* ignore */ }
  }

  const body = all(doc, 'body')[0];
  let html = '';
  let listOpen = null; // 'ul' | 'ol'

  const closeList = () => { if (listOpen) { html += `</${listOpen}>`; listOpen = null; } };

  const renderRun = async (r) => {
    const rPr = kids(r, 'rPr')[0];
    let out = '';
    for (const c of Array.from(r.childNodes)) {
      if (c.nodeType !== 1) continue;
      switch (c.localName) {
        case 't': out += escapeHtml(c.textContent); break;
        case 'tab': out += '<span class="tab"></span>'; break;
        case 'br': out += attr(c, 'type') === 'page' ? '<hr class="pagebreak">' : '<br>'; break;
        case 'sym': out += '&#x25A0;'; break;
        case 'drawing': case 'pict': {
          const blip = all(c, 'blip')[0];
          const rid = blip ? (attr(blip, 'embed') || attr(blip, 'link')) : null;
          const rel = rid && rels[rid];
          if (rel) {
            const url = await mediaUrl(zip, resolvePath('word/document.xml', rel.target), urls);
            if (url) out += `<img src="${url}" alt="">`;
          }
          break;
        }
        case 'footnoteReference': out += '<sup>*</sup>'; break;
        default: break;
      }
    }
    if (!out) return '';
    if (rPr) {
      const has = n => kids(rPr, n).some(e => attr(e, 'val') !== 'false' && attr(e, 'val') !== '0');
      const styles = [];
      const color = attr(kids(rPr, 'color')[0], 'val');
      if (color && /^[0-9a-f]{6}$/i.test(color) && color.toLowerCase() !== '000000') styles.push(`color:#${color}`);
      const sz = attr(kids(rPr, 'sz')[0], 'val');
      if (sz) styles.push(`font-size:${(+sz) / 2}pt`);
      const hl = attr(kids(rPr, 'highlight')[0], 'val');
      if (hl && hl !== 'none') styles.push(`background:${hl}`);
      const shd = attr(kids(rPr, 'shd')[0], 'fill');
      if (shd && /^[0-9a-f]{6}$/i.test(shd) && shd.toLowerCase() !== 'ffffff' && !hl) styles.push(`background:#${shd}`);
      if (has('b')) out = `<strong>${out}</strong>`;
      if (has('i')) out = `<em>${out}</em>`;
      if (kids(rPr, 'u').length && attr(kids(rPr, 'u')[0], 'val') !== 'none') out = `<u>${out}</u>`;
      if (has('strike') || has('dstrike')) out = `<s>${out}</s>`;
      const va = attr(kids(rPr, 'vertAlign')[0], 'val');
      if (va === 'superscript') out = `<sup>${out}</sup>`; else if (va === 'subscript') out = `<sub>${out}</sub>`;
      if (styles.length) out = `<span style="${styles.join(';')}">${out}</span>`;
    }
    return out;
  };

  const renderParagraphInner = async (p) => {
    let out = '';
    for (const c of Array.from(p.childNodes)) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'r') out += await renderRun(c);
      else if (c.localName === 'hyperlink') {
        const rid = relId(c); const rel = rid && rels[rid];
        let inner = '';
        for (const r of kids(c, 'r')) inner += await renderRun(r);
        out += rel && rel.mode === 'External' ? `<a href="${escapeHtml(rel.target)}" target="_blank" rel="noopener">${inner}</a>` : inner;
      } else if (c.localName === 'smartTag' || c.localName === 'sdt' || c.localName === 'ins' || c.localName === 'fldSimple') {
        for (const r of all(c, 'r')) out += await renderRun(r);
      }
    }
    return out;
  };

  const renderParagraph = async (p) => {
    const pPr = kids(p, 'pPr')[0];
    const inner = await renderParagraphInner(p);
    let tag = 'p'; const styles = []; let cls = '';
    let numId = null;
    if (pPr) {
      const st = attr(kids(pPr, 'pStyle')[0], 'val');
      const sm = st && styleMap[st];
      if (sm && sm.h) tag = 'h' + sm.h;
      if (sm && sm.title) cls = 'doc-title';
      if (sm && sm.sub) cls = 'doc-subtitle';
      const jc = attr(kids(pPr, 'jc')[0], 'val');
      if (jc === 'center') styles.push('text-align:center');
      else if (jc === 'right' || jc === 'end') styles.push('text-align:end');
      else if (jc === 'both' || jc === 'distribute') styles.push('text-align:justify');
      if (kids(pPr, 'bidi').length) styles.push('direction:rtl');
      const numPr = kids(pPr, 'numPr')[0];
      if (numPr) numId = attr(kids(numPr, 'numId')[0], 'val');
      else if (sm && sm.numId) numId = sm.numId;
      const ind = kids(pPr, 'ind')[0];
      const left = ind && (attr(ind, 'left') || attr(ind, 'start'));
      if (left && !numId) styles.push(`margin-inline-start:${Math.round(+left / 20)}pt`);
    }
    if (numId && numId !== '0') {
      const kind = numFmt[numId] === 'bullet' ? 'ul' : 'ol';
      if (listOpen !== kind) { closeList(); html += `<${kind}>`; listOpen = kind; }
      html += `<li dir="auto"${styles.length ? ` style="${styles.join(';')}"` : ''}>${inner || '&nbsp;'}</li>`;
      return;
    }
    closeList();
    html += `<${tag} dir="auto"${cls ? ` class="${cls}"` : ''}${styles.length ? ` style="${styles.join(';')}"` : ''}>${inner || '&nbsp;'}</${tag}>`;
  };

  const renderTable = async (tbl) => {
    closeList();
    let out = '<table dir="auto">';
    for (const tr of kids(tbl, 'tr')) {
      out += '<tr>';
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kids(tc, 'tcPr')[0];
        const span = tcPr ? attr(kids(tcPr, 'gridSpan')[0], 'val') : null;
        const shd = tcPr ? attr(kids(tcPr, 'shd')[0], 'fill') : null;
        let cell = '';
        const saved = html; html = ''; const savedList = listOpen; listOpen = null;
        for (const c of Array.from(tc.childNodes)) {
          if (c.nodeType !== 1) continue;
          if (c.localName === 'p') await renderParagraph(c);
          else if (c.localName === 'tbl') await renderTable(c);
        }
        closeList();
        cell = html; html = saved; listOpen = savedList;
        const style = shd && /^[0-9a-f]{6}$/i.test(shd) && shd.toLowerCase() !== 'ffffff' ? ` style="background:#${shd}"` : '';
        out += `<td${span ? ` colspan="${span}"` : ''}${style}>${cell}</td>`;
      }
      out += '</tr>';
    }
    out += '</table>';
    html += out;
  };

  for (const c of Array.from(body.childNodes)) {
    if (c.nodeType !== 1) continue;
    if (c.localName === 'p') await renderParagraph(c);
    else if (c.localName === 'tbl') await renderTable(c);
    else if (c.localName === 'sdt') { for (const p of all(c, 'p')) await renderParagraph(p); }
  }
  closeList();
  return { html, urls, revoke: () => urls.forEach(u => URL.revokeObjectURL(u)) };
}

export async function docxText(buffer, maxChars = 200000) {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(buffer);
  const f = zip.file('word/document.xml'); if (!f) return '';
  const doc = parseXml(await f.async('string'));
  const parts = [];
  let total = 0;
  for (const p of all(doc, 'p')) {
    const t = Array.from(p.getElementsByTagNameNS('*', 't')).map(e => e.textContent).join('');
    if (t.trim()) { parts.push(t); total += t.length; if (total > maxChars) break; }
  }
  return parts.join('\n');
}

// =========================== XLSX ===========================
function colIndex(ref) {
  let n = 0;
  for (const ch of ref) { const c = ch.charCodeAt(0); if (c >= 65 && c <= 90) n = n * 26 + (c - 64); else break; }
  return n - 1;
}
function excelDate(serial, date1904) {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial * 86400000);
  return new Date(ms);
}
const DATE_BUILTIN = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function isDateFormat(code) {
  if (!code) return false;
  const c = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '');
  return /[dmyh]/i.test(c) && !/#|0\.0|@/.test(c);
}

export async function xlsxToSheets(buffer, { maxRows = 5000, maxCols = 100 } = {}) {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(buffer);
  const wbFile = zip.file('xl/workbook.xml'); if (!wbFile) throw new Error('Not an XLSX file');
  const wb = parseXml(await wbFile.async('string'));
  const date1904 = attr(all(wb, 'workbookPr')[0], 'date1904') === '1';
  const rels = await readRels(zip, 'xl/_rels/workbook.xml.rels');
  // shared strings
  const shared = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const sd = parseXml(await ssFile.async('string'));
    for (const si of kids(sd.documentElement, 'si')) shared.push(all(si, 't').map(t => t.textContent).join(''));
  }
  // styles → date flags per xf index
  const dateXf = [];
  const stFile = zip.file('xl/styles.xml');
  if (stFile) {
    try {
      const sd = parseXml(await stFile.async('string'));
      const custom = {};
      for (const nf of all(sd, 'numFmt')) custom[attr(nf, 'numFmtId')] = attr(nf, 'formatCode');
      const cellXfs = all(sd, 'cellXfs')[0];
      if (cellXfs) for (const xf of kids(cellXfs, 'xf')) {
        const id = +attr(xf, 'numFmtId') || 0;
        dateXf.push(DATE_BUILTIN.has(id) || isDateFormat(custom[id]));
      }
    } catch { /* ignore */ }
  }
  const sheets = [];
  for (const s of all(wb, 'sheet')) {
    const name = attr(s, 'name'); const rid = relId(s);
    const rel = rels[rid]; if (!rel) continue;
    const path = resolvePath('xl/workbook.xml', rel.target);
    const sf = zip.file(path); if (!sf) continue;
    const sd = parseXml(await sf.async('string'));
    const rows = []; let maxC = 0; let truncated = false;
    const merges = [];
    for (const m of all(sd, 'mergeCell')) {
      const [a, b] = (attr(m, 'ref') || '').split(':'); if (!a || !b) continue;
      const ra = /([A-Z]+)(\d+)/.exec(a), rb = /([A-Z]+)(\d+)/.exec(b);
      if (ra && rb) merges.push({ r1: +ra[2] - 1, c1: colIndex(ra[1]), r2: +rb[2] - 1, c2: colIndex(rb[1]) });
    }
    for (const row of all(sd, 'row')) {
      const rIdx = (+attr(row, 'r') || rows.length + 1) - 1;
      if (rIdx >= maxRows) { truncated = true; break; }
      while (rows.length <= rIdx) rows.push([]);
      const cells = rows[rIdx];
      for (const c of kids(row, 'c')) {
        const ref = attr(c, 'r') || ''; const ci = colIndex(ref.replace(/\d+/g, ''));
        if (ci >= maxCols || ci < 0) continue;
        const type = attr(c, 't'); const sIdx = +attr(c, 's') || 0;
        const vEl = kids(c, 'v')[0];
        let val = '';
        if (type === 's') val = shared[+vEl?.textContent] ?? '';
        else if (type === 'inlineStr') val = all(c, 't').map(t => t.textContent).join('');
        else if (type === 'b') val = vEl?.textContent === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'e') val = vEl?.textContent || '#ERR';
        else if (type === 'str') val = vEl?.textContent || '';
        else if (type === 'd') val = vEl?.textContent || '';
        else if (vEl) {
          const num = parseFloat(vEl.textContent);
          if (Number.isFinite(num)) {
            if (dateXf[sIdx]) { const d = excelDate(num, date1904); val = { date: d }; }
            else val = { num };
          } else val = vEl.textContent;
        }
        cells[ci] = val;
        if (ci + 1 > maxC) maxC = ci + 1;
      }
    }
    sheets.push({ name, rows, cols: maxC, truncated, merges });
  }
  return sheets;
}

export async function xlsxText(buffer, maxChars = 200000) {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(buffer);
  const parts = []; let total = 0;
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const sd = parseXml(await ssFile.async('string'));
    for (const si of kids(sd.documentElement, 'si')) { const t = all(si, 't').map(x => x.textContent).join(''); if (t.trim()) { parts.push(t); total += t.length; if (total > maxChars) break; } }
  }
  const wbFile = zip.file('xl/workbook.xml');
  if (wbFile) { const wb = parseXml(await wbFile.async('string')); for (const s of all(wb, 'sheet')) parts.unshift(attr(s, 'name') || ''); }
  return parts.join('\n');
}

export function csvParse(text, { maxRows = 5000 } = {}) {
  const delim = (text.split('\n', 5).join('\n').match(/;/g) || []).length > (text.split('\n', 5).join('\n').match(/,/g) || []).length ? ';' : (text.includes('\t') && !text.includes(',') ? '\t' : ',');
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; if (rows.length >= maxRows) return { rows, truncated: true }; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return { rows, truncated: false };
}

// =========================== PPTX ===========================
export async function pptxToSlides(buffer) {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(buffer);
  const presFile = zip.file('ppt/presentation.xml'); if (!presFile) throw new Error('Not a PPTX file');
  const pres = parseXml(await presFile.async('string'));
  const rels = await readRels(zip, 'ppt/_rels/presentation.xml.rels');
  const urls = [];
  const slides = [];
  const sldSz = all(pres, 'sldSz')[0];
  const ratio = sldSz ? (+attr(sldSz, 'cx') / +attr(sldSz, 'cy')) : 16 / 9;
  for (const sid of all(pres, 'sldId')) {
    const rel = rels[relId(sid)]; if (!rel) continue;
    const path = resolvePath('ppt/presentation.xml', rel.target);
    const sf = zip.file(path); if (!sf) continue;
    const sd = parseXml(await sf.async('string'));
    const srels = await readRels(zip, path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'));
    const slide = { title: '', blocks: [], images: [], notes: '' };
    for (const sp of all(sd, 'sp')) {
      const ph = all(sp, 'ph')[0];
      const phType = ph ? (attr(ph, 'type') || 'body') : '';
      const paras = [];
      for (const p of all(sp, 'p')) {
        const t = all(p, 'r').concat(all(p, 'fld')).map(r => all(r, 't').map(x => x.textContent).join('')).join('');
        const lvl = +attr(kids(p, 'pPr')[0], 'lvl') || 0;
        if (t.trim()) paras.push({ text: t, lvl });
      }
      if (!paras.length) continue;
      if ((phType === 'title' || phType === 'ctrTitle') && !slide.title) slide.title = paras.map(p => p.text).join(' ');
      else slide.blocks.push({ kind: phType === 'subTitle' ? 'subtitle' : 'body', paras });
    }
    for (const pic of all(sd, 'pic')) {
      const blip = all(pic, 'blip')[0]; const rid = blip && (attr(blip, 'embed', REL_NS) || attr(blip, 'embed'));
      const r = rid && srels[rid]; if (!r) continue;
      const url = await mediaUrl(zip, resolvePath(path, r.target), urls);
      if (url) slide.images.push(url);
    }
    // tables
    for (const tbl of all(sd, 'tbl')) {
      const rows = [];
      for (const tr of kids(tbl, 'tr')) rows.push(kids(tr, 'tc').map(tc => all(tc, 't').map(x => x.textContent).join('')));
      if (rows.length) slide.blocks.push({ kind: 'table', rows });
    }
    slides.push(slide);
  }
  return { slides, ratio, urls, revoke: () => urls.forEach(u => URL.revokeObjectURL(u)) };
}

export async function pptxText(buffer, maxChars = 200000) {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(n => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(n)).sort((a, b) => (+(a.match(/\d+/) || [0])[0]) - (+(b.match(/\d+/) || [0])[0]));
  const parts = []; let total = 0;
  for (const n of names) {
    const doc = parseXml(await zip.file(n).async('string'));
    for (const p of all(doc, 'p')) { const t = all(p, 't').map(x => x.textContent).join(''); if (t.trim()) { parts.push(t); total += t.length; } }
    if (total > maxChars) break;
  }
  return parts.join('\n');
}

// =========================== ZIP listing ===========================
export async function zipEntries(buffer) {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(buffer);
  const out = [];
  zip.forEach((path, f) => { out.push({ path, dir: f.dir, size: f._data?.uncompressedSize ?? 0, date: f.date }); });
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
