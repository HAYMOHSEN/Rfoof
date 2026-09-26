// Unit tests for the automatic-backup schedule.  Run: node test/autobackup.test.js
import assert from 'node:assert/strict';
import { store } from '../js/store.js';
import { INTERVALS, nextDue, isDue, interval } from '../js/autobackup.js';

store.setSetting = async (k, v) => { store.settings[k] = v; };   // no IndexedDB in Node
const folder = { name: 'Backups', getDirectoryHandle() {} };      // looks like a FileSystemDirectoryHandle
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name); console.error(e.message); process.exitCode = 1; } };
console.log('Automatic backup tests');
const HOUR = 3600000, DAY = 24 * HOUR, now = Date.UTC(2026, 8, 26, 12);

test('off by default and for unknown values', () => {
  delete store.settings.autoBackup; assert.equal(interval(), 0); assert.equal(nextDue(), 0); assert.equal(isDue(now), false);
  store.settings.autoBackup = 'every-minute'; assert.equal(interval(), 0);
});
test('the offered choices', () => {
  assert.deepEqual(Object.keys(INTERVALS), ['off', 'hourly', 'h6', 'daily', 'weekly', 'monthly']);
  assert.equal(INTERVALS.daily, DAY); assert.equal(INTERVALS.weekly, 7 * DAY);
});
test('folder backups: due one interval after the last backup', () => {
  store.settings.backupDir = folder; store.settings.autoBackup = 'daily';
  store.settings.lastBackup = now - 23 * HOUR; assert.equal(isDue(now), false);
  assert.equal(nextDue(), now + HOUR);
  store.settings.lastBackup = now - 25 * HOUR; assert.equal(isDue(now), true);
});
test('a library that was never backed up is due right away', () => {
  store.settings.lastBackup = 0; assert.equal(isDue(now), true);
});
test('without a folder the ZIP backups count', () => {
  store.settings.backupDir = null; store.settings.autoBackup = 'weekly';
  store.settings.lastBackup = now;                     // folder time is ignored now
  store.settings.lastZipBackup = now - 6 * DAY; assert.equal(isDue(now), false);
  store.settings.lastZipBackup = now - 8 * DAY; assert.equal(isDue(now), true);
});
console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
