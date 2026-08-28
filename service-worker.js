const CACHE_NAME = 'debooger-shell-deboogs27';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/debooger-icon.svg',
  './styles.css',
  './styles/files.css',
  './styles/paste.css',
  './styles/audit.css',
  './src/app.js',
  './src/audit-engine.js',
  './src/export-engine.js',
  './src/file-launch.js',
  './src/file-utils.js',
  './src/library-backup.js',
  './src/library-restore.js',
  './src/package-utils.js',
  './src/paste-engine.js',
  './src/preview-engine.js',
  './src/project-engine.js',
  './src/project-file-browser.js',
  './src/pwa.js',
  './src/runtime-router.js',
  './src/share-intake.js',
  './src/state.js',
  './src/storage.js',
  './src/viewer.js',
  './src/webcontainer-engine.js',
  './src/zip-codec.js',
  './src/zip-engine.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('debooger-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
