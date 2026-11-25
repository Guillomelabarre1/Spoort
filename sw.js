// Service worker : l'app marche hors-ligne une fois chargée.
// - Interface (html/js/css) : réseau d'abord, pour recevoir les mises à jour ; cache si hors-ligne.
// - vendor/ (MediaPipe, modèles ~15-30 Mo) : cache d'abord, téléchargé une seule fois.
const VERSION = 'v16';
const SHELL = `repcounter-shell-${VERSION}`;
const VENDOR = 'repcounter-vendor-v1';

const SHELL_FILES = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/counter.js', 'js/voice.js', 'js/stats.js', 'js/exercises.js', 'js/musclemap.js', 'js/merge.js', 'js/store.js', 'js/body.js', 'js/bodyui.js', 'js/body3d.js', 'js/program.js', 'js/programui.js', 'js/library.js', 'js/form.js', 'js/profileui.js', 'js/pinpad.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png', 'icons/favicon-32.png', 'icons/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== SHELL && key !== VENDOR) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/vendor/')) {
    event.respondWith((async () => {
      const cache = await caches.open(VENDOR);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    } catch {
      return (await cache.match(event.request, { ignoreSearch: true })) ?? (await cache.match('index.html'));
    }
  })());
});
