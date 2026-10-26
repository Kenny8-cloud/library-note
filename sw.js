// オフラインでも起動できるよう、アプリのファイルをキャッシュする。
// 通信できるときは常にネットワークの最新版を使い、つながらないときだけキャッシュを使う。
// ファイルを追加したら FILES に加え、VERSION を上げる。
const VERSION = 'v29';
const CACHE = `library-log-${VERSION}`;
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/isbn.js', './js/biblio.js', './js/library.js', './js/scanner.js', './js/session.js', './js/ui.js', './js/csv.js',
  './js/views/setup.js', './js/views/child-form.js', './js/views/home.js', './js/views/shelf.js', './js/views/scan.js',
  './js/views/register.js', './js/views/search.js', './js/views/book.js', './js/views/reserve.js', './js/views/settings.js', './js/views/import.js',
  './js/views/series.js', './js/views/series-new.js', './js/views/wishlist.js', './js/views/reserve-confirm.js',
  './js/views/receipt.js', './js/ocr.js', './js/releases.js', './js/suggestions.js', './js/views/review.js',
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

// Amazon の表紙画像は1日しかブラウザに残らないので、アプリ側のキャッシュに長く置いて2回目からすぐ出す。
// 版を上げても消さないよう、アプリのファイルとは別のキャッシュにする
const COVER_CACHE = 'library-covers';
const MAX_COVERS = 5000;
let coverPuts = 0;

async function coverFromCache(request) {
  const cache = await caches.open(COVER_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  // Amazon は CORS に対応しているので、中身の分かる形で取ってキャッシュする（不透明な応答は容量を大きく取られるため）
  const res = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
  // 表紙がない本は 1x1 の小さな画像が返る。あとで表紙が付くこともあるので、それはキャッシュしない
  const size = Number(res.headers.get('content-length') || 0);
  if (res.ok && (size === 0 || size > 200)) {
    await cache.put(request.url, res.clone());
    if (++coverPuts % 200 === 0) trimCovers(cache);
  }
  return res;
}

// 古いものから消して、表紙のキャッシュが増えすぎないようにする
async function trimCovers(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_COVERS))) await cache.delete(k);
}

// アプリのファイルはネットワークを優先し、取れたらキャッシュも更新する。書誌データは扱わない
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname === 'images-na.ssl-images-amazon.com' && url.pathname.startsWith('/images/P/')) {
    e.respondWith(coverFromCache(e.request).catch(() => fetch(e.request)));
    return;
  }
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
