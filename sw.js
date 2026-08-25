// RISE — service worker
// Enables "Add to Home Screen" / install prompts and a basic offline app shell.
const CACHE_NAME = 'rise-app-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigation requests (so live app data/Firebase still works),
// falling back to the cached shell when offline. Cache-first for the app's own
// static assets (icons/manifest). Everything else (Firebase, fonts, etc.) just
// passes straight through to the network.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (isSameOrigin && APP_SHELL.some((p) => url.pathname.endsWith(p.replace('./', '')))) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});
