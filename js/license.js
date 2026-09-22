// ============================================================
//  Rfoof – licensing: Microsoft Store edition / trial / license keys
//
//  • Store edition: when the app is launched from the Microsoft Store
//    package, Edge sets document.referrer to
//    "app-info://platform/microsoft-store" on the first navigation.
//    We remember that on the device → full version.
//  • License key: SHA-256 of the key must be listed in
//    APP.licenseKeyHashes (config.js) → full version on any device.
//  • Otherwise: trial – adding files is limited to APP.trialImportLimit.
// ============================================================
import { APP } from './config.js';
import { store } from './store.js';
import { Emitter } from './utils.js';

export const STORE_REFERRER = 'app-info://platform/microsoft-store';
export const licenseEvents = new Emitter();

export function normalizeKey(key) {
  return String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export async function hashKey(key) {
  const data = new TextEncoder().encode('rfoof:' + normalizeKey(key));
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Fallback(data); // non-secure http origins have no crypto.subtle
}

// Minimal SHA-256 (used only when crypto.subtle is unavailable)
function sha256Fallback(bytes) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = bytes.length; const padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[l] = 0x80;
  const dv = new DataView(padded.buffer); dv.setUint32(padded.length - 4, (l * 8) >>> 0); dv.setUint32(padded.length - 8, Math.floor((l * 8) / 0x100000000));
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) { const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3); const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10); w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22); const maj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) >>> 0);
  }
  return H.map(v => v.toString(16).padStart(8, '0')).join('');
}

// A copy served from the developer's own machine (Rfoof-Desktop.bat / localhost)
// is never a customer's copy, so it always runs as the full version.
export function isLocalDevCopy() {
  if (typeof location === 'undefined') return false;
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}

export const license = {
  /** true when the full version is unlocked (or the app is configured as free) */
  isActive() {
    if (!APP.trialImportLimit) return true;
    if (isLocalDevCopy()) return true;
    return !!store.settings.licensed;
  },
  source() {
    if (store.settings.licensed) return store.settings.licenseSource || 'store';
    return isLocalDevCopy() ? 'local' : '';
  },
  isTrial() { return !this.isActive(); },
  limit() { return APP.trialImportLimit || 0; },
  used() { return store.settings.trialImports || 0; },
  remaining() { return this.isActive() ? Infinity : Math.max(0, this.limit() - this.used()); },

  /** Call once at startup. Returns true if this launch activated the Store edition. */
  async detectStoreLaunch(referrer = (typeof document !== 'undefined' ? document.referrer : '')) {
    if (referrer !== STORE_REFERRER) return false;
    if (!store.settings.licensed) await this.activate('store');
    return true;
  },

  async activate(source) {
    await store.setSetting('licensed', true);
    await store.setSetting('licenseSource', source);
    await store.setSetting('licensedAt', Date.now());
    licenseEvents.emit('change');
  },

  /** Validates a key typed by the user. Returns true on success. */
  async activateWithKey(key) {
    const k = normalizeKey(key);
    if (k.length < 8 || !APP.licenseKeyHashes?.length) return false;
    let h = '';
    try { h = await hashKey(k); } catch (e) { console.warn('hash failed', e); return false; }
    if (!APP.licenseKeyHashes.map(x => String(x).toLowerCase()).includes(h)) return false;
    await this.activate('key');
    await store.setSetting('licenseKey', k);
    return true;
  },

  async countImports(n) {
    if (this.isActive() || !n) return;
    await store.setSetting('trialImports', this.used() + n);
    licenseEvents.emit('change');
  },

  storeUrl() {
    const id = APP.storeProductId;
    if (!id) return '';
    return `https://apps.microsoft.com/detail/${id}`;
  },
  storeProtocolUrl() {
    const id = APP.storeProductId;
    return id ? `ms-windows-store://pdp/?productid=${id}` : '';
  },
  /** Opens the Store listing (Store app on Windows, web page elsewhere). */
  openStore() {
    const web = this.storeUrl();
    if (!web) return false;
    const isWindows = /Windows/i.test(navigator.userAgent);
    if (isWindows) {
      // try the Store app first, then fall back to the web listing
      const t = Date.now();
      location.href = this.storeProtocolUrl();
      setTimeout(() => { if (Date.now() - t < 2500 && document.visibilityState === 'visible') window.open(web, '_blank', 'noopener'); }, 1200);
    } else window.open(web, '_blank', 'noopener');
    return true;
  },
};
