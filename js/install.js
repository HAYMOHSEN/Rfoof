// ============================================================
//  Rfoof – "Install app" helper (PWA)
//
//  Chromium browsers (Edge, Chrome) fire `beforeinstallprompt` once a site
//  passes the installability checks (HTTPS + valid manifest). We keep that
//  event so the app can show its own "Install" button in the sidebar and in
//  Settings → General, instead of relying on the small address-bar icon.
// ============================================================
import { Emitter } from './utils.js';

export const installEvents = new Emitter();
let deferred = null;     // the captured BeforeInstallPromptEvent
let installed = false;   // set by the `appinstalled` event

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  try {
    return matchMedia('(display-mode: standalone)').matches
      || matchMedia('(display-mode: window-controls-overlay)').matches
      || matchMedia('(display-mode: minimal-ui)').matches
      || navigator.standalone === true;
  } catch { return false; }
}

function take(ev) {
  if (!ev) return;
  deferred = ev;
  installEvents.emit('change');
}

/** Call once at startup (before the shell renders). */
export function initInstall() {
  if (typeof window === 'undefined') return;
  // index.html captures an early event (fired before the modules were loaded)
  if (window.__rfoofInstallPrompt) { take(window.__rfoofInstallPrompt); window.__rfoofInstallPrompt = null; }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); take(e); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; installEvents.emit('change'); });
}

export const install = {
  /** true when the browser offered an install prompt that we can open ourselves */
  canPrompt() { return !!deferred && !installed && !isStandalone(); },
  /** true when this browser can install web apps at all (Edge / Chrome) */
  isSupported() { return typeof window !== 'undefined' && 'onbeforeinstallprompt' in window; },
  isStandalone,
  isInstalled() { return installed; },
  isEdge() { return typeof navigator !== 'undefined' && /Edg\//.test(navigator.userAgent); },

  /** Opens the browser's install dialog. Resolves to 'accepted' | 'dismissed' | 'unavailable' | 'error'. */
  async prompt() {
    const ev = deferred;
    if (!ev) return 'unavailable';
    deferred = null; // a BeforeInstallPromptEvent can only be used once
    installEvents.emit('change');
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      const outcome = choice?.outcome || 'dismissed';
      if (outcome === 'accepted') installed = true;
      installEvents.emit('change');
      return outcome;
    } catch (e) {
      console.warn('install prompt failed', e);
      installEvents.emit('change');
      return 'error';
    }
  },
};
