// Unit tests for PDF text rebuilding (Arabic PDFs drawn glyph by glyph).  Run: node test/pdftext.test.js
// Fixtures: real pdf.js textContent items of PDFs saved with Chrome/Edge "Save as PDF".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageText, unshapeArabic } from '../js/pdftext.js';
import { indexWords, normalize } from '../js/search.js';

const items = JSON.parse(readFileSync(new URL('./fixtures/pdf-items.json', import.meta.url), 'utf8'));
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name); console.error(e.message); process.exitCode = 1; } };
const words = (name) => new Set(indexWords(pageText(items[name])));
console.log('PDF text tests');

test('presentation forms become ordinary letters', () => {
  assert.equal(unshapeArabic('ﻋﻘﺪ'), 'عقد');
  assert.equal(unshapeArabic('ﻻ'), 'لا');
  assert.equal(unshapeArabic('abc 123'), 'abc 123');
});
test('Arabic lines read right to left, as whole words', () => {
  const text = pageText(items['contract.pdf']);
  assert.ok(text.includes('عقد إيجار شقة سكنية'), text.slice(0, 80));
  assert.ok(text.includes('الطرف الأول (المؤجر)'), 'brackets are not mirrored');
  const w = words('contract.pdf');
  for (const x of ['الايجار', 'المستاجر', 'دينارا', 'عمان']) assert.ok(w.has(normalize(x)), x);
});
test('numbers inside Arabic lines keep their order', () => {
  const text = pageText(items['contract.pdf']);
  assert.ok(text.includes('2026/0417'), 'contract number');
  assert.ok(text.includes('1/10/2026'), 'date');
});
test('shadda and tanween do not split a word', () => {
  assert.ok(words('degree.pdf').has(normalize('تخرّج')));
  assert.ok(words('degree.pdf').has(normalize('أتمّت')));
});
test('pages without Arabic keep the previous joining', () => {
  const eng = items['english.pdf'];
  let old = ''; for (const it of eng) { if (it.str) old += it.str; old += it.hasEOL ? '\n' : ' '; }
  assert.equal(pageText(eng), old);
});
test('an Arabic phrase inside an English line is found', () => {
  const w = words('mixed.pdf');
  for (const x of ['الايجار', 'الجديد', 'budget', '2026']) assert.ok(w.has(normalize(x)), x);
});
test('empty or odd input does not throw', () => {
  assert.equal(pageText([]), '');
  assert.equal(pageText(undefined), '');
  assert.equal(typeof pageText([{ str: 'ﻋ' }, { str: '' }, null]), 'string');
});
console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
