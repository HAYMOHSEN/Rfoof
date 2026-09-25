// ============================================================
//  Rfoof – readable text from a PDF page (pdf.js textContent)
//
//  pdf.js returns text in the order it was drawn. Many PDFs – notably the
//  ones Edge / Chrome "Print → Save as PDF" produce – draw Arabic one glyph
//  at a time, right to left, using presentation forms. Joined naively that
//  gives the letters of "عقد" reversed and spaced out, so nothing Arabic in
//  such a PDF could be found. For pages that contain right-to-left text we
//  therefore rebuild each line from the glyph positions: right-to-left order
//  for Arabic lines (keeping numbers and Latin words left-to-right inside
//  them), spaces only where there is a real gap, and presentation forms
//  turned back into ordinary letters. Pages without RTL text keep the
//  previous, proven behaviour.
// ============================================================

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const RTL_ALL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/g;
const LTR_CHAR = /[A-Za-z0-9\u00C0-\u024F\u0660-\u0669\u06F0-\u06F9]/;
const LATIN_ALL = /[A-Za-z\u00C0-\u024F]/g;
// harakat (shadda, tanween …) on their own
const MARKS_ONLY = /^[\u064B-\u065F\u0670\u06D6-\u06ED\u0300-\u036F]+$/;
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '\u00AB': '\u00BB', '\u00BB': '\u00AB' };

/** Arabic presentation forms (isolated / initial / medial / final letters, lam-alef …) → ordinary letters. */
export function unshapeArabic(s) {
  return String(s || '')
    // harakat forms U+FE70–FE7F decompose to "space + mark" or "tatweel + mark": keep the mark only
    .replace(/[\uFE70-\uFE7F]/g, (m) => m.normalize('NFKC').replace(/[ \u0640]/g, ''))
    .replace(/[\uFB50-\uFDFF\uFE80-\uFEFC]+/g, (m) => m.normalize('NFKC'));
}

/** The previous joining rule, kept for pages without right-to-left text. */
function simpleJoin(items) {
  let out = '';
  for (const it of items) { if (!it) continue; if (it.str) out += it.str; out += it.hasEOL ? '\n' : ' '; }
  return out;
}

/**
 * Text of one PDF page.
 * @param {Array<{str:string, transform:number[], width:number, height:number, hasEOL?:boolean}>} items  textContent.items
 */
export function pageText(items) {
  items = Array.isArray(items) ? items : [];
  if (!items.some(it => it && it.str && RTL_CHAR.test(it.str))) return simpleJoin(items);

  const glyphs = [];
  for (const it of items) {
    if (!it || typeof it.str !== 'string' || !it.str.trim()) continue;   // spaces come back from the gaps below
    if (MARKS_ONLY.test(unshapeArabic(it.str))) continue;                  // a lone shadda / tanween glyph can't be placed reliably; search ignores harakat anyway
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const size = Math.abs(it.height) || Math.hypot(tr[2], tr[3]) || 10;
    glyphs.push({ s: it.str, x: tr[4], y: tr[5], w: Math.abs(it.width) || 0, size });
  }
  // lines: top to bottom (PDF y grows upwards); a glyph joins the current line when its
  // baseline is within half a font size of it
  glyphs.sort((a, b) => b.y - a.y);
  const lines = [];
  for (const g of glyphs) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - g.y) <= Math.max(line.size, g.size) * 0.5) line.items.push(g);
    else lines.push({ y: g.y, size: g.size, items: [g] });
  }
  return lines.map(lineText).join('\n') + '\n';
}

function lineText(line) {
  const text = line.items.map(g => g.s).join('');
  const rtl = (text.match(RTL_ALL) || []).length >= (text.match(LATIN_ALL) || []).length;
  const its = line.items.slice().sort(rtl ? (a, b) => (b.x + b.w) - (a.x + a.w) : (a, b) => a.x - b.x);
  // runs written in the other direction (numbers / Latin words inside an Arabic line, Arabic
  // words inside a Latin line) were sorted the wrong way round: turn each run back
  const kind = (g) => (RTL_CHAR.test(g.s) ? 'r' : LTR_CHAR.test(g.s) ? 'l' : 'n');
  const other = rtl ? 'l' : 'r', main = rtl ? 'r' : 'l';
  let i = 0;
  while (i < its.length) {
    if (kind(its[i]) !== other) { i++; continue; }
    let j = i, last = i;
    while (j + 1 < its.length && kind(its[j + 1]) !== main) { j++; if (kind(its[j]) === other) last = j; }
    if (last > i) its.splice(i, last - i + 1, ...its.slice(i, last + 1).reverse());
    i = last + 1;
  }
  // brackets drawn in an Arabic line are mirrored: the glyph on the right of "(المؤجر)" is ")"
  if (rtl) {
    let inRun = false;
    for (let k = 0; k < its.length; k++) {
      const kd = kind(its[k]);
      if (kd === 'l') inRun = true; else if (kd === 'r') inRun = false;
      if (!inRun && MIRROR[its[k].s]) its[k] = { ...its[k], s: MIRROR[its[k].s] };
    }
  }
  let out = '';
  for (let k = 0; k < its.length; k++) {
    const g = its[k];
    if (k > 0) {
      const p = its[k - 1];
      // horizontal distance between the two glyph boxes, whatever their order
      const gap = (p.w || g.w) ? Math.max(p.x, g.x) - Math.min(p.x + p.w, g.x + g.w) : Infinity;
      if (gap > Math.max(p.size, g.size) * 0.15 && !out.endsWith(' ') && !g.s.startsWith(' ')) out += ' ';
    }
    out += g.s;
  }
  return unshapeArabic(out).replace(/[ \t]+/g, ' ').trim();
}
