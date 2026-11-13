const CACHE = 'terra-link-shell-v4';
const SHELL = ['/manifest.webmanifest', '/offline-capture.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('terra-link-shell-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/offline-capture.html') {
    event.respondWith(caches.match('/offline-capture.html').then((cached) => cached ?? fetch(request)));
    return;
  }
  if (request.mode === 'navigate' && url.pathname.includes('/parcelas/')) {
    event.respondWith(fetch(request).catch(() => caches.match('/offline-capture.html')));
    return;
  }
  // Never cache authenticated application pages or documents. The IndexedDB queue is the offline data store.
  if (url.pathname.startsWith('/organizaciones') || url.pathname.startsWith('/cuenta')) {
    if (url.pathname.match(/^\/organizaciones\/[^/]+\/captura$/)) {
      event.respondWith(fetch(request).catch(() => caches.match('/offline-capture.html')));
    }
    return;
  }
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
