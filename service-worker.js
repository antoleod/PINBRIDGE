const CACHE_NAME = 'pinbridge-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './src/styles.css',
    './src/app.js',
    './src/core/bus.js',
    './src/crypto/crypto.js',
    './src/storage/db.js',
    './src/utils/helpers.js',
    './src/modules/auth/auth.js',
    './src/modules/vault/vault.js'
];

const ICONS_CACHE = [
    'public/icons/favicon.ico',
    'public/icons/android/icon-192.png',
    'public/icons/android/icon-512.png',
    'public/icons/web/icon-32.png',
    'public/icons/web/icon-16.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll([...ASSETS_TO_CACHE, ...ICONS_CACHE]);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            // Return cached response if found
            if (response) {
                return response;
            }
            // Otherwise fetch from network
            return fetch(event.request);
        })
    );
});

self.addEventListener('activate', (event) => {
    self.clients.claim();
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
