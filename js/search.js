// ============================================================
//  Rfoof – Arabic/English aware search
// ============================================================
import { db } from './db.js';

const DIACRITICS = /[ً-ٰٟـۖ-ۭ]/g;      // harakat, tatweel, quranic marks
const LATIN_MARKS = /[̀-ͯ]/g;

export function normalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(LATIN_MARKS, '')
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))   // Arabic-Indic digits → 0-9
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0));
}

const TOKEN_RE = /[\p{L}\p{N}]+/gu;
export function tokenize(s) {
  const n = normalize(s);
  return n.match(TOKEN_RE) || [];
}

// Unique tokens for the inverted index (min length 2, capped)
export function indexWords(text, max = 6000) {
  const set = new Set();
  const n = normalize(text);
  let m; TOKEN_RE.lastIndex = 0;
  const re = new RegExp(TOKEN_RE.source, 'gu');
  while ((m = re.exec(n)) && set.size < max) {
    const w = m[0];
    if (w.length >= 2 && w.length <= 40) set.add(w);
  }
  return Array.from(set);
}

// Build the metadata search key for a file (title, original name, tags, notes, folder path)
export function searchKey(file, folderPath = '') {
  return normalize([file.title, file.originalName, (file.tags || []).join(' '), file.notes, folderPath, file.ext].filter(Boolean).join(' \u0001 '));
}

/**
 * Rank files for a query. Returns array of {file, score, contentHit}
 * @param {string} query
 * @param {Iterable} files      file records (with ._key precomputed by store)
 * @param {Object} opts         {content: boolean, kinds:Set, folderId, tags:[], limit}
 */
export async function search(query, files, opts = {}) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const nq = normalize(query).trim();
  const limit = opts.limit || 500;

  let contentIds = null;
  if (opts.content !== false) {
    contentIds = new Set();
    // intersect prefix hits per term
    let first = true;
    for (const term of terms) {
      if (term.length < 2) continue;
      const ids = await db.wordPrefix(term);
      if (first) { for (const id of ids) contentIds.add(id); first = false; }
      else { for (const id of Array.from(contentIds)) if (!ids.has(id)) contentIds.delete(id); }
      if (!contentIds.size) break;
    }
  }

  const out = [];
  for (const f of files) {
    if (f.deletedAt) continue;
    if (opts.kinds && !opts.kinds.has(f.kind)) continue;
    if (opts.folderIds && !opts.folderIds.has(f.folderId)) continue;
    const key = f._key || '';
    const titleN = f._titleN || normalize(f.title || '');
    let score = 0;
    let metaMatch = true;
    for (const term of terms) {
      if (titleN === nq) score += 100;
      else if (titleN.startsWith(term)) score += 40;
      else if (titleN.includes(term)) score += 25;
      else if ((f._tagsN || '').includes(term)) score += 20;
      else if (key.includes(term)) score += 10;
      else { metaMatch = false; }
    }
    if (!metaMatch) score = 0;
    let contentHit = false;
    if (contentIds && contentIds.has(f.id)) { contentHit = true; score += metaMatch ? 5 : 8; }
    if (score > 0) {
      // recency tie-breaker
      score += Math.min(4, (f.updatedAt || 0) / 1e13);
      out.push({ file: f, score, contentHit });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// Highlight helper: returns HTML with <mark> around matches (escaped)
export function highlight(text, query) {
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const terms = tokenize(query).filter(t => t.length >= 2);
  if (!terms.length || !text) return esc(text || '');
  // Match against normalized string but keep original text: map indices via per-char normalization
  const orig = String(text);
  const chars = Array.from(orig);
  const normChars = chars.map(c => normalize(c));
  let norm = ''; const map = [];
  normChars.forEach((nc, i) => { for (let k = 0; k < nc.length; k++) { norm += nc[k]; map.push(i); } });
  const marks = new Array(chars.length).fill(false);
  for (const term of terms) {
    let idx = norm.indexOf(term);
    while (idx !== -1) {
      for (let k = idx; k < idx + term.length; k++) marks[map[k]] = true;
      idx = norm.indexOf(term, idx + term.length);
    }
  }
  let html = ''; let open = false;
  chars.forEach((c, i) => {
    if (marks[i] && !open) { html += '<mark>'; open = true; }
    if (!marks[i] && open) { html += '</mark>'; open = false; }
    html += esc(c);
  });
  if (open) html += '</mark>';
  return html;
}

// Extract a snippet around the first matched term in a text
export function snippet(text, query, radius = 60, before = radius) {
  if (!text) return '';
  const terms = tokenize(query).filter(t => t.length >= 2);
  const orig = String(text);
  // normalized string with index map back to the original
  const chars = Array.from(orig.slice(0, 200000));
  let norm = ''; const map = [];
  chars.forEach((c, i) => { const nc = normalize(c); for (let k = 0; k < nc.length; k++) { norm += nc[k]; map.push(i); } });
  let pos = -1;
  for (const term of terms) { pos = norm.indexOf(term); if (pos !== -1) break; }
  if (pos === -1) return chars.slice(0, radius * 2).join('').replace(/\s+/g, ' ');
  const oPos = map[pos] ?? 0;
  const start = Math.max(0, oPos - before);
  const end = Math.min(chars.length, oPos + radius);
  return (start > 0 ? '…' : '') + chars.slice(start, end).join('').replace(/\s+/g, ' ') + (end < chars.length ? '…' : '');
}
