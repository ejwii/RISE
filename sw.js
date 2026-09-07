// RISE service worker
// Handles: (1) installability/offline shell, (2) push notifications that
// arrive while the app is fully closed.
//
// NOTE: if you already had a sw.js with custom caching logic before this,
// merge that logic in below instead of replacing the whole file — the
// important new part is the firebase-messaging block at the bottom.

const CACHE_NAME = 'rise-shell-v1';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Basic network-first fetch passthrough — keeps the app installable
// without introducing stale-cache bugs. Expand this with real caching
// later if you want true offline support.
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ------------------------------------------------------------
// PUSH NOTIFICATIONS (background / app fully closed)
// ------------------------------------------------------------
// Requires the compat SDK inside the service worker context.
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

// Same config as index.html — service workers can't read your page's
// JS variables, so it's repeated here.
firebase.initializeApp({
  apiKey: "AIzaSyCgWSGpVj1FumHulfjOta3MYeukQwDdIXo",
  authDomain: "rise-82a62.firebaseapp.com",
  projectId: "rise-82a62",
  storageBucket: "rise-82a62.firebasestorage.app",
  messagingSenderId: "535666284881",
  appId: "1:535666284881:web:3941c87c1ec2964ce01b70"
});

const messaging = firebase.messaging();

// Fired by FCM when a push arrives and the app/tab is NOT in the
// foreground. This is what makes a notification show up even if RISE
// is fully closed — the OS wakes this file up just long enough to run.
messaging.onBackgroundMessage(payload => {
  const title = (payload.notification && payload.notification.title) || 'RISE';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, {
    body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: (payload.data && payload.data.tag) || 'rise-push',
    data: payload.data || {}
  });
});

// Tapping the OS notification opens (or focuses) the app.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
