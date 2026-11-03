const CACHE_NAME = 'dok-archiv-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './js/validation.js',
  './js/db.js',
  './js/pdf.js',
  './js/auth.js',
  './js/drive.js',
  './js/calendar.js',
  './js/gemini.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});