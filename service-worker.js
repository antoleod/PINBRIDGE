const CACHE_NAME = 'pinbridge-v6';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './src/styles.css',
    './src/app.js',
    './src/firebase.js',
    './src/auth.js',
    './src/vault.js',
    './src/sync.js',
    './src/core/bus.js',
    './src/crypto/crypto.js',
    './src/storage/db.js',
    './src/utils/helpers.js',
    './src/modules/notes/notes.js',
    './src/modules/search/search.js',
    './src/modules/settings/settings.js',
    './src/ui/ui.js',
    './docs/FIRESTORE_RULES_SETUP.md',
    './firestore.rules'
];

const ICONS_CACHE = [
    'src/public/icons/web/pinbridge_32x32.png',
    'src/public/icons/android/pinbridge_192x192.png',
    'src/public/icons/android/pinbridge_512x512.png',
    'src/public/icons/web/pinbridge_64x64.png'
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
