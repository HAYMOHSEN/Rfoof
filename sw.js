// ============================================================
//  Rfoof – service worker (offline app shell)
//  Bump VERSION whenever you publish a new build.
// ============================================================
const VERSION = '2.0.0';
const CACHE = 'rfoof-' + VERSION;
const PRECACHE = [
  './',
  './css/app.css',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
  './index.html',
  './js/app.js',
  './js/backup.js',
  './js/config.js',
  './js/db.js',
  './js/i18n.js',
  './js/icons.js',
  './js/import.js',
  './js/license.js',
  './js/install.js',
  './js/logo.js',
  './js/office.js',
  './js/search.js',
  './js/store.js',
  './js/ui/actions.js',
  './js/ui/content.js',
  './js/ui/details.js',
  './js/ui/dialog.js',
  './js/ui/dnd.js',
  './js/ui/folderDialog.js',
  './js/ui/importDialog.js',
  './js/ui/menu.js',
  './js/ui/palette.js',
  './js/ui/pickers.js',
  './js/ui/settings.js',
  './js/ui/sidebar.js',
  './js/ui/toast.js',
  './js/ui/welcome.js',
  './js/utils.js',
  './js/viewers/imageView.js',
  './js/viewers/pdfView.js',
  './js/viewers/viewer.js',
  './licenses.html',
  './manifest.webmanifest',
  './privacy.html',
  './vendor/hljs/core.js',
  './vendor/hljs/github-dark.min.css',
  './vendor/hljs/github.min.css',
  './vendor/hljs/languages/bash.js',
  './vendor/hljs/languages/c.js',
  './vendor/hljs/languages/cpp.js',
  './vendor/hljs/languages/csharp.js',
  './vendor/hljs/languages/css.js',
  './vendor/hljs/languages/go.js',
  './vendor/hljs/languages/ini.js',
  './vendor/hljs/languages/java.js',
  './vendor/hljs/languages/javascript.js',
  './vendor/hljs/languages/json.js',
  './vendor/hljs/languages/latex.js',
  './vendor/hljs/languages/markdown.js',
  './vendor/hljs/languages/matlab.js',
  './vendor/hljs/languages/php.js',
  './vendor/hljs/languages/plaintext.js',
  './vendor/hljs/languages/powershell.js',
  './vendor/hljs/languages/python.js',
  './vendor/hljs/languages/ruby.js',
  './vendor/hljs/languages/rust.js',
  './vendor/hljs/languages/sql.js',
  './vendor/hljs/languages/typescript.js',
  './vendor/hljs/languages/xml.js',
  './vendor/hljs/languages/yaml.js',
  './vendor/jszip.min.js',
  './vendor/marked.esm.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
  './vendor/pdfjs/standard_fonts/FoxitDingbats.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixed.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerif.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSymbol.pfb',
  './vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
  './vendor/pdfjs/wasm/jbig2.wasm',
  './vendor/pdfjs/wasm/jbig2_nowasm_fallback.js',
  './vendor/pdfjs/wasm/openjpeg.wasm',
  './vendor/pdfjs/wasm/openjpeg_nowasm_fallback.js',
  './vendor/pdfjs/wasm/qcms_bg.wasm',
  './vendor/pdfjs/wasm/quickjs-eval.js',
  './vendor/pdfjs/wasm/quickjs-eval.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // add files one by one so a single missing file cannot break the install
    await Promise.allSettled(PRECACHE.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('rfoof-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Microsoft Graph, login, downloads: network only
  if (req.mode === 'navigate') {
    // app shell: serve the cached index for any in-scope navigation (offline-first)
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./index.html') || await cache.match('./');
      if (cached) return cached;
      try { return await fetch(req); } catch { return new Response('Offline', { status: 503 }); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && (url.pathname.includes('/vendor/') || url.pathname.includes('/icons/') || url.pathname.includes('/screenshots/'))) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (e) {
      return new Response('', { status: 504 });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
