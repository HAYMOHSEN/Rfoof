// Unit tests for licensing (trial limit, Store-launch activation, license keys).  Run: node test/license.test.js
import assert from 'node:assert/strict';
import { APP } from '../js/config.js';
import { store } from '../js/store.js';
import { license, hashKey, normalizeKey, STORE_REFERRER, RATE_MIN_FILES } from '../js/license.js';

store.setSetting = async (k, v) => { store.settings[k] = v; };   // no IndexedDB in Node
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name); console.error(e.message); process.exitCode = 1; } };
console.log('License tests');
APP.trialImportLimit = 5; APP.licenseKeyHashes = [];
await test('starts as a trial with the configured limit', async () => {
  assert.equal(license.isActive(), false); assert.equal(license.remaining(), 5);
});
await test('counts imports and blocks at the limit', async () => {
  await license.countImports(3); assert.equal(license.remaining(), 2);
  await license.countImports(2); assert.equal(license.remaining(), 0);
});
await test('a Microsoft Store launch activates the full version', async () => {
  assert.equal(await license.detectStoreLaunch('https://example.com'), false);
  assert.equal(await license.detectStoreLaunch(STORE_REFERRER), true);
  assert.equal(license.isActive(), true); assert.equal(license.source(), 'store'); assert.equal(license.remaining(), Infinity);
});
await test('license keys are normalized and verified by hash', async () => {
  store.settings.licensed = false; store.settings.licenseSource = '';
  const key = 'RFOOF-AB12-CD34-EF56';
  assert.equal(normalizeKey(' rfoof ab12-cd34_ef56 '), 'RFOOFAB12CD34EF56');
  APP.licenseKeyHashes = [await hashKey(key)];
  assert.equal(await license.activateWithKey('wrong-key-000'), false);
  assert.equal(license.isActive(), false);
  assert.equal(await license.activateWithKey('rfoof-ab12-cd34-ef56'), true);
  assert.equal(license.isActive(), true); assert.equal(license.source(), 'key');
});
await test('Store links carry the product ID and the in-app campaign ID', async () => {
  APP.storeProductId = '9NKH02WXWH03'; APP.storeCampaignId = 'rfoof-app';
  assert.equal(license.storeUrl(), 'https://apps.microsoft.com/detail/9NKH02WXWH03?cid=rfoof-app');
  assert.equal(license.storeProtocolUrl(), 'ms-windows-store://pdp/?productid=9NKH02WXWH03&cid=rfoof-app');
  assert.equal(license.reviewProtocolUrl(), 'ms-windows-store://review/?ProductId=9NKH02WXWH03');
  APP.storeCampaignId = '';
  assert.equal(license.storeUrl(), 'https://apps.microsoft.com/detail/9NKH02WXWH03');
  APP.storeProductId = '';
  assert.equal(license.storeUrl(), ''); assert.equal(license.reviewProtocolUrl(), '');
});
await test('rating: owners only, once, after real use', async () => {
  const day = 86400000, now = Date.now();
  APP.storeProductId = '9NKH02WXWH03';
  store.settings.licensed = false; store.settings.licenseSource = ''; store.settings.ratePrompted = 0;
  assert.equal(license.canRate(), false, 'trial users do not own the app yet');
  store.settings.licensed = true; store.settings.licenseSource = 'store'; store.settings.licensedAt = now - 5 * day;
  assert.equal(license.canRate(), true);
  assert.equal(license.shouldAskForRating(RATE_MIN_FILES - 1, now), false, 'not enough files yet');
  assert.equal(license.shouldAskForRating(RATE_MIN_FILES, now), true);
  store.settings.licensedAt = now - 1 * day;
  assert.equal(license.shouldAskForRating(100, now), false, 'too soon after activation');
  store.settings.licensedAt = now - 5 * day; store.settings.ratePrompted = now;
  assert.equal(license.shouldAskForRating(100, now), false, 'never asks twice');
  store.settings.licenseSource = 'local'; store.settings.ratePrompted = 0;
  assert.equal(license.canRate(), false, 'developer copy');
  store.settings.licensed = false; store.settings.licenseSource = '';
});
await test('trialImportLimit = 0 means a free, unlimited app', async () => {
  store.settings.licensed = false; APP.trialImportLimit = 0;
  assert.equal(license.isActive(), true); assert.equal(license.remaining(), Infinity);
});
console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
