// ルーターと共通レイアウト。画面は #/home のようなハッシュで切り替える。
import * as lib from './library.js';
import { esc, kidChips } from './ui.js';
import * as scanner from './scanner.js';

import setup from './views/setup.js';
import home from './views/home.js';
import shelf from './views/shelf.js';
import scan from './views/scan.js';
import register from './views/register.js';
import search from './views/search.js';
import book from './views/book.js';
import reserve from './views/reserve.js';
import settings from './views/settings.js';
import importView from './views/import.js';
import series from './views/series.js';
import seriesNew from './views/series-new.js';
import wishlist from './views/wishlist.js';
import reserveConfirm from './views/reserve-confirm.js';
import receipt from './views/receipt.js';

const routes = {
  setup, home, shelf, scan, register, search, book, reserve, settings, import: importView,
  series, 'series-new': seriesNew, wishlist, 'reserve-confirm': reserveConfirm, receipt,
};
const KID_KEY = 'current-child';

export const ctx = {
  children: [],
  childId: null,
  get child() { return this.children.find(c => c.id === this.childId) || null; },
  go(path) { location.hash = '#/' + path; },
  refresh: () => render(),
};

function rememberKid(id) {
  ctx.childId = id;
  try { localStorage.setItem(KID_KEY, id); } catch { /* 覚えられなくても動く */ }
}

async function loadChildren() {
  ctx.children = await lib.children();
  let saved = null;
  try { saved = localStorage.getItem(KID_KEY); } catch { /* 無視 */ }
  const id = ctx.children.some(c => c.id === ctx.childId) ? ctx.childId
    : ctx.children.some(c => c.id === saved) ? saved
    : ctx.children[0]?.id || null;
  ctx.childId = id;
}

// ---- 共通の部品 ----
export function topKids({ title } = {}) {
  return `<header class="top">
    ${title ? `<h1 class="title">${esc(title)}</h1>` : `<div class="kids">${kidChips(ctx.children, ctx.childId)}</div>`}
    <a class="icon-btn" href="#/settings" aria-label="設定">⚙</a>
  </header>`;
}

export function topBack(title, { back = 'history', right = '' } = {}) {
  return `<header class="top">
    <button class="back" data-back="${esc(back)}" aria-label="戻る">‹</button>
    <h1 class="title">${esc(title)}</h1>${right}
  </header>`;
}

export function tabs(active) {
  const t = (id, label) => `<a href="#/${id}" class="${active === id ? 'on' : ''}">${label}</a>`;
  return `<nav class="tabs">
    ${t('home', '<i>⌂</i>ホーム')}
    ${t('shelf', '<i>▤</i>本棚')}
    <a href="#/scan" class="scan ${active === 'scan' ? 'on' : ''}"><span>◉</span>スキャン</a>
    ${t('reserve', '<i>☑</i>予約')}
  </nav>`;
}

// ---- 描画 ----
let cleanup = null;
let renderSeq = 0;
// 戻る操作で前の画面に戻ったときに、スクロール位置を元に戻すため画面ごとに覚えておく
const scrollPos = new Map();
let goingBack = false;
window.addEventListener('popstate', () => { goingBack = true; });
let scrollTimer;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  const key = location.hash;
  scrollTimer = setTimeout(() => scrollPos.set(key, window.scrollY), 100);
}, { passive: true });

async function render() {
  const seq = ++renderSeq;
  const back = goingBack;
  goingBack = false;
  if (cleanup) { try { await cleanup(); } catch { /* 無視 */ } cleanup = null; }
  await scanner.stop();
  await loadChildren();

  const [name, ...params] = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  let view = routes[name] ? name : 'home';
  if (!ctx.children.length && view !== 'settings') view = 'setup';

  // 画面ごとに新しい要素を作り、できあがってから差し替える（前の画面のイベントを残さず、
  // 準備中に真っ白な画面を見せないため）
  const root = document.getElementById('app').cloneNode(false);
  root.dataset.view = view;
  const result = await routes[view](root, ctx, params.map(decodeURIComponent));
  if (seq !== renderSeq) { if (typeof result === 'function') result(); return; }
  document.getElementById('app').replaceWith(root);
  cleanup = typeof result === 'function' ? result : null;
  window.scrollTo(0, back ? (scrollPos.get(location.hash) || 0) : 0);
}

document.addEventListener('click', e => {
  const kid = e.target.closest('[data-kid]');
  if (kid && kid.closest('.kids')) {
    rememberKid(kid.dataset.kid);
    render();
    return;
  }
  const back = e.target.closest('[data-back]');
  if (back) {
    const to = back.dataset.back;
    if (to === 'history' && history.length > 1) { goingBack = true; history.back(); }
    else ctx.go(to === 'history' ? 'home' : to);
  }
});

window.addEventListener('hashchange', render);
export const setChild = rememberKid;

render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // 新しい版が有効になったら、1回だけ読み込み直して新しいファイルに切り替える
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then(reg => reg.update())
    .catch(() => { /* オフライン対応なしでも動く */ });
}
