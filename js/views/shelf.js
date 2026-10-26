// S-06 本棚（履歴）と S-08 シリーズ一覧（段階1では借りた巻の一覧だけ）
import * as lib from '../library.js';
import { esc, cover } from '../ui.js';
import { topKids, tabs } from '../app.js';

function monthLabel(iso) {
  if (!iso) return '日付なし';
  const [y, m] = iso.split('-');
  return `${y}年${Number(m)}月`;
}

// 全角・半角、大文字・小文字、空白や記号の違いを無視して比べる
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s・!?！？、。,.「」『』()（）〜~ー\-:：]/g, '');

// 書名・作者名に加えて、シリーズ名でも探す（「なんでも魔女商会」の本は書名にシリーズ名が入っていないことがある）
// 一度に描く冊数。1,700冊以上を一度に並べるとスマホで描画に時間がかかるので、少しずつ増やす
const PAGE = 120;

// 表紙の幅（px）。ピンチで変えられ、端末に覚えておく。SMALL より小さいと表紙だけの表示になる
const SIZE_KEY = 'shelf-cover-size';
const DEFAULT_SIZE = 72, MIN_SIZE = 22, MAX_SIZE = 160, SMALL = 46;
function loadSize() {
  try { return Number(localStorage.getItem(SIZE_KEY)) || DEFAULT_SIZE; } catch { return DEFAULT_SIZE; }
}
function saveSize(v) {
  try { localStorage.setItem(SIZE_KEY, String(v)); } catch { /* 覚えられなくても動く */ }
}
// 表紙が小さいほど1画面に入る冊数が増えるので、最初に描く冊数も増やす（面積の比で）
const pageFor = size => Math.round(PAGE * (DEFAULT_SIZE / size) ** 2);

function historyHtml(history, q, seriesNames, limit = Infinity, favs = new Map(), byYear = false) {
  const needle = norm(q);
  const list = needle
    ? history.filter(l => norm(`${l.book.title}${l.book.author}${seriesNames.get(l.book.seriesId) || ''}`).includes(needle))
    : history;
  if (!history.length) return `<p class="empty">まだ記録がありません。</p>`;
  const books = new Set(list.map(l => l.book.id)).size;
  const count = needle
    ? `<p class="hit-count">「${esc(q.trim())}」の検索結果: <b>${books}</b>冊${list.length > books ? `（借りた回数 ${list.length}回）` : ''}</p>`
    : `<p class="muted small">これまでに ${books}冊${list.length > books ? `（借りた回数 ${list.length}回）` : ''}</p>`;
  if (!list.length) return `${count}<p class="empty">「${esc(q)}」に当てはまる本はありません。</p>`;

  const groups = new Map();
  const keyOf = l => (byYear ? (l.borrowedAt ? `${l.borrowedAt.slice(0, 4)}年` : '日付なし') : monthLabel(l.borrowedAt));
  // 見出しの冊数は、まだ表示していない分も含めた数にする
  const totals = new Map();
  for (const l of list) totals.set(keyOf(l), (totals.get(keyOf(l)) || 0) + 1);
  for (const l of list.slice(0, limit)) {
    // 縮小しているときは年ごとにまとめ、1年に読んだ本の多さが表紙の量で分かるようにする
    const key = keyOf(l);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  return count + [...groups].map(([label, loans]) => `
    <h3 class="month">${esc(label)}<small>${totals.get(label)}冊</small></h3>
    <div class="shelf"${byYear ? ' data-year' : ''}>${loans.map(l => `
      <a href="#/book/${esc(l.book.id)}">${cover(l.book, byYear ? 'xs' : '')}${favs.has(l.book.id) ? '<em class="fav-mark" aria-label="お気に入り">♥</em>' : ''}<span>${esc(l.book.title)}</span>
        <i class="who">${(l.kids || []).map(k => `<b style="background:${esc(k.color)}" title="${esc(k.name)}"></b>`).join('')}</i></a>`).join('')}
    </div>`).join('')
    + (list.length > limit ? `<button class="btn ghost" id="more">さらに表示（残り ${list.length - limit}冊）</button>` : '');
}

// 本の詳細から戻ったときに、検索語・絞り込み・表示した冊数を元に戻すため、画面をまたいで覚えておく
const state = { q: '', who: '', fav: false, limit: PAGE };

const STATUS_LABEL = { reading: '読み進め中', done: '完了', paused: '中断' };

async function seriesHtml(childId, filter) {
  const list = await lib.seriesStatusOf(childId);
  const counts = { reading: 0, done: 0, paused: 0 };
  list.forEach(s => counts[s.status]++);
  const chips = Object.keys(STATUS_LABEL).map(k =>
    `<a class="chip ${filter === k ? 'on' : ''}" href="#/shelf/series/${k}">${STATUS_LABEL[k]} ${counts[k]}</a>`).join('');
  const shown = list.filter(s => s.status === filter);
  const rows = shown.map(s => {
    const total = s.books.length;
    const next = s.next
      ? `次: ${esc(s.next.volume ? `${s.next.volume}巻` : s.next.title)}`
      : (s.status === 'reading' ? '<span class="badge warn">次の巻が未登録</span>' : '');
    return `<a class="card series-card" href="#/series/${esc(s.series.id)}">
      <b>${esc(s.series.title)}</b>
      <div class="muted small">${s.readCount} / ${total}冊 ・ ${next}</div>
      <div class="prog"><i style="width:${total ? Math.round(s.readCount / total * 100) : 0}%"></i></div>
    </a>`;
  }).join('');
  return `<div class="chips">${chips}</div>
    ${rows || `<p class="empty">${STATUS_LABEL[filter]}のシリーズはありません。</p>`}
    <a class="btn ghost" href="#/series-new">＋ シリーズを作る</a>
    <p class="muted small">本棚の本をまとめてシリーズにできます。シリーズにすると、次に借りる巻が予約候補に出ます。</p>`;
}

// 履歴は家族共通。だれが借りたかは色の点で示し、必要なら子供ごとに絞り込める。
// シリーズの読み進め（次の巻）は子供ごとに違うので、シリーズのタブは子供ごとのまま
export default async function shelf(root, ctx, [tab, filter = 'reading']) {
  const isSeries = tab === 'series';
  const all = isSeries ? [] : await lib.familyHistory();
  const seriesNames = isSeries ? new Map() : new Map((await lib.seriesList()).map(s => [s.id, s.title]));
  // 本ごとに、お気に入りにしている子の一覧
  const favs = new Map();
  for (const f of isSeries ? [] : await lib.allFavorites()) {
    if (!favs.has(f.bookId)) favs.set(f.bookId, []);
    favs.get(f.bookId).push(f.childId);
  }

  root.innerHTML = `
    ${isSeries ? topKids() : topKids({ title: '本棚（家族）' })}
    <main class="body">
      <div class="seg">
        <a href="#/shelf" class="${isSeries ? '' : 'on'}">履歴</a>
        <a href="#/shelf/series" class="${isSeries ? 'on' : ''}">シリーズ</a>
      </div>
      ${isSeries ? await seriesHtml(ctx.childId, filter) : `
        <input class="input" type="search" id="q" placeholder="🔍 書名・作者・シリーズ名で検索" autocomplete="off" value="${esc(state.q)}">
        <div class="chips" id="who">
          <button class="chip ${state.who ? '' : 'on'}" data-who="">全員</button>
          ${ctx.children.map(c => `<button class="chip ${state.who === c.id ? 'on' : ''}" data-who="${esc(c.id)}"><span class="dot" style="background:${esc(c.color)}"></span> ${esc(c.name)}</button>`).join('')}
          <button class="chip ${state.who === 'unknown' ? 'on' : ''}" data-who="unknown">？ 本が未特定</button>
          <button class="chip fav-chip ${state.fav ? 'on' : ''}" id="fav-only">♥ お気に入り</button>
        </div>
        <div class="zoom-bar">
          <span class="muted small">ピンチで拡大・縮小</span>
          <button class="zoom-btn" data-zoom="-1" aria-label="表紙を小さく">－</button>
          <button class="zoom-btn" data-zoom="1" aria-label="表紙を大きく">＋</button>
        </div>
        <div id="list"></div>`}
    </main>
    ${tabs('shelf')}`;

  if (isSeries) return;
  const q = root.querySelector('#q');
  const draw = () => {
    // 「本が未特定」は、ISBN がなく書名だけで登録され、まだ確かめていない本（lib.isUnidentified）
    let list = state.who === 'unknown' ? all.filter(l => lib.isUnidentified(l.book))
      : state.who ? all.filter(l => l.kids.some(k => k.id === state.who)) : all;
    // 「お気に入り」は、子供を選んでいればその子の、全員ならだれかのお気に入り。同じ本は1冊だけ出す
    if (state.fav) {
      const seen = new Set();
      list = list.filter(l => {
        const who = favs.get(l.book.id) || [];
        const hit = state.who && state.who !== 'unknown' ? who.includes(state.who) : who.length > 0;
        return hit && !seen.has(l.book.id) && seen.add(l.book.id);
      });
    }
    // 「本が未特定」のときは、まとめて特定する画面への入口を出す（特定すると表紙が付く）
    const unknownBanner = state.who === 'unknown' && list.length
      ? `<a class="identify-banner" href="#/identify"><b>まとめて本を特定する ›</b>
          <small>ISBN がない本には表紙が出ません。図書館のデータから正しい本を選ぶと、表紙が付きます</small></a>` : '';
    listEl.innerHTML = unknownBanner + historyHtml(list, state.q, seriesNames, Math.max(state.limit, pageFor(size)), favs, size < SMALL);
    const more = listEl.querySelector('#more');
    if (more) moreObserver.observe(more);
  };

  // ---- 表紙の大きさ（ピンチ・－＋ボタン） ----
  const listEl = root.querySelector('#list');
  let size = loadSize();
  const applySize = () => {
    listEl.style.setProperty('--cw', `${size}px`);
    // 小さくしたときは書名や印を消して、表紙だけをぎっしり並べる
    listEl.classList.toggle('tiny', size < SMALL);
  };
  // 大きさを変えても、画面の真ん中あたりに見えていた本がそのまま見えるように、スクロール位置を割合で保つ
  const resize = next => {
    next = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, next)));
    if (next === size) return;
    const top = listEl.getBoundingClientRect().top + window.scrollY;
    const ratio = (window.scrollY + window.innerHeight / 2 - top) / (listEl.offsetHeight || 1);
    size = next;
    applySize();
    window.scrollTo(0, top + ratio * listEl.offsetHeight - window.innerHeight / 2);
  };
  // 小さくしたときに足りなくなった分を読み足す
  const settle = () => {
    saveSize(size);
    // 表紙だけの表示との切り替え（月ごと⇔年ごと）や、読み足しが必要なときは描き直す
    const byYearNow = Boolean(listEl.querySelector('.shelf[data-year]'));
    if (byYearNow !== size < SMALL || (listEl.querySelector('#more') && pageFor(size) > state.limit)) draw();
  };
  applySize();

  let pinch = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  listEl.addEventListener('touchstart', e => {
    if (e.touches.length === 2) pinch = { d: dist(e.touches), size };
  }, { passive: true });
  listEl.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();   // ブラウザの画面全体の拡大を止め、表紙の大きさだけを変える
    pinch.next = pinch.size * dist(e.touches) / pinch.d;
    cancelAnimationFrame(pinch.raf);
    pinch.raf = requestAnimationFrame(() => resize(pinch.next));
  }, { passive: false });
  listEl.addEventListener('touchend', e => {
    if (!pinch || e.touches.length >= 2) return;
    // 指を離したときは、まだ描いていない最後の大きさをすぐに反映する
    cancelAnimationFrame(pinch.raf);
    if (pinch.next) resize(pinch.next);
    pinch = null;
    settle();
  });
  // iPhone の Safari は touchmove を止めても画面全体を拡大しようとするので、そちらも止める
  for (const ev of ['gesturestart', 'gesturechange']) listEl.addEventListener(ev, e => e.preventDefault());

  root.querySelector('.zoom-bar').addEventListener('click', e => {
    const b = e.target.closest('[data-zoom]');
    if (!b) return;
    resize(size * (b.dataset.zoom === '1' ? 1.35 : 1 / 1.35));
    settle();
  });

  // 「さらに表示」が見えてきたら自動で続きを出す（縮小して一気にスクロールしたときのため）
  const moreObserver = new IntersectionObserver(entries => {
    if (!entries.some(x => x.isIntersecting)) return;
    state.limit = Math.max(state.limit, pageFor(size)) + PAGE * 3;
    draw();
  }, { rootMargin: '600px' });
  q.addEventListener('input', () => { state.q = q.value; state.limit = PAGE; draw(); });
  root.querySelector('#who').addEventListener('click', e => {
    const favBtn = e.target.closest('#fav-only');
    if (favBtn) {
      state.fav = !state.fav;
      state.limit = PAGE;
      favBtn.classList.toggle('on', state.fav);
      draw();
      return;
    }
    const b = e.target.closest('[data-who]');
    if (!b) return;
    state.who = b.dataset.who;
    state.limit = PAGE;
    root.querySelectorAll('#who [data-who]').forEach(c => c.classList.toggle('on', c === b));
    draw();
  });
  listEl.addEventListener('click', e => {
    if (e.target.id !== 'more') return;
    state.limit = Math.max(state.limit, pageFor(size)) + PAGE * 3;
    draw();
  });
  draw();
  return () => moreObserver.disconnect();
}
