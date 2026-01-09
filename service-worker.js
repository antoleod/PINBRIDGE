const CACHE_NAME = 'pinbridge-v7';
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
    './src/modules/coach/coach.css',
    './src/modules/coach/coach.js',
    './src/modules/coach/coachEngine.js',
    './src/modules/coach/coachStore.js',
    './src/modules/coach/examEngine.js',
    './src/modules/coach/i18n.js',
    './src/modules/coach/packImportWizard.js',
    './src/modules/coach/packLoader.js',
    './src/modules/coach/packSync.js',
    './src/modules/coach/quizEngine.js',
    './src/modules/coach/tts.js',
    './src/modules/coach/uiRenderer.js',
    './src/modules/coach/views/add-skill.html',
    './src/modules/coach/views/checklist.html',
    './src/modules/coach/views/dashboard.html',
    './src/modules/coach/views/error-cards.html',
    './src/modules/coach/views/exam-center.html',
    './src/modules/coach/views/exam-results.html',
    './src/modules/coach/views/exam.html',
    './src/modules/coach/views/export.html',
    './src/modules/coach/views/feedback.html',
    './src/modules/coach/views/import-pack.html',
    './src/modules/coach/views/interview.html',
    './src/modules/coach/views/loginRequired.html',
    './src/modules/coach/views/module.html',
    './src/modules/coach/views/packs.html',
    './src/modules/coach/views/quiz.html',
    './src/modules/coach/views/quizzes.html',
    './src/modules/coach/views/roadmap-day.html',
    './src/modules/coach/views/roadmap.html',
    './src/modules/coach/views/session.html',
    './src/modules/coach/views/settings.html',
    './src/modules/coach/views/skills.html',
    './src/public/packs/en_b1_vocab_core_40.json',
    './src/public/packs/fr_b1_vocab_core_40.json',
    './src/public/packs/nl_b1_vocab_core_40.json',
    './src/public/packs/fr_b1_mixed_premium_pack_100.json',
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
