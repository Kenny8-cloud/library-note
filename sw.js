// オフラインでも起動できるよう、アプリのファイルをキャッシュする。
// ファイルを更新したら VERSION を上げる（古いキャッシュが消え、新しいファイルが使われる）。
const VERSION = 'v2';
const CACHE = `library-log-${VERSION}`;
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/isbn.js', './js/biblio.js', './js/library.js', './js/scanner.js', './js/session.js', './js/ui.js', './js/csv.js',
  './js/views/setup.js', './js/views/child-form.js', './js/views/home.js', './js/views/shelf.js', './js/views/scan.js',
  './js/views/register.js', './js/views/search.js', './js/views/book.js', './js/views/reserve.js', './js/views/settings.js', './js/views/import.js',
  './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('library-log-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// アプリのファイルはキャッシュを優先し、書誌データや表紙画像はネットワークから取る
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isAppFile = url.origin === location.origin || url.href.startsWith('https://unpkg.com/@zxing/');
  if (!isAppFile) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
