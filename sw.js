// Offline support: app files and CDN libraries are cached; Supabase and exchange-rate calls always go to the network.
const VERSION = 'vh5-v23';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'src/main.js', 'src/kit.js', 'src/home.js', 'src/expenses.js', 'src/income.js', 'src/overview.js', 'src/settings.js', 'src/search.js',
  'src/api.js', 'src/vat.js', 'src/export.js', 'src/ui.js', 'src/config.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/silhouette.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never caches old files.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.endsWith('supabase.co') || url.hostname.includes('frankfurter')) return;
  const sameOrigin = url.origin === location.origin;
  // App files: network first so updates show up, cache when offline. CDN files (pinned versions): cache first.
  e.respondWith(sameOrigin
    ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
    : caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })));
});
