// オフラインでも起動できるよう、アプリのファイルをキャッシュする。
// 通信できるときは常にネットワークの最新版を使い、つながらないときだけキャッシュを使う。
// ファイルを追加したら FILES に加え、VERSION を上げる。
const VERSION = 'v12';
const CACHE = `library-log-${VERSION}`;
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/isbn.js', './js/biblio.js', './js/library.js', './js/scanner.js', './js/session.js', './js/ui.js', './js/csv.js',
  './js/views/setup.js', './js/views/child-form.js', './js/views/home.js', './js/views/shelf.js', './js/views/scan.js',
  './js/views/register.js', './js/views/search.js', './js/views/book.js', './js/views/reserve.js', './js/views/settings.js', './js/views/import.js',
  './js/views/series.js', './js/views/series-new.js', './js/views/wishlist.js', './js/views/reserve-confirm.js',
  './js/views/receipt.js', './js/ocr.js',
  './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js',
];

self.addEventListener('install', e => {
  // ブラウザのHTTPキャッシュに残った古いファイルを拾わないよう、cache: 'reload' で取り直す
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('library-log-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// アプリのファイルはネットワークを優先し、取れたらキャッシュも更新する。書誌データや表紙画像は扱わない
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isAppFile = url.origin === location.origin || url.href.startsWith('https://unpkg.com/@zxing/');
  if (!isAppFile) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' })
    .then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
