// S-02 ホーム。図書館の雰囲気（貸出カード・木の書棚・目録の引き出し）で、予約の時期、蔵書数、最近借りた本を見せる。
// 本棚と同じく、借りた本の冊数と最近借りた本は家族全体で表示する
import * as lib from '../library.js';
import { esc, cover, formatDate, toast } from '../ui.js';
import { tabs } from '../app.js';
import { releases, checkNewReleases, dismissRelease, wishRelease } from '../releases.js';
import { defaultYear } from './review.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// 図書館のデータには発売前の本が載ることもあるので、今月より先なら「発売予定」とする
function releaseDate(d) {
  if (!d) return '';
  const [y, m] = d.split('-');
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return (m ? `${y}年${Number(m)}月` : `${y}年`) + (d > thisMonth ? '発売予定' : '発売');
}

export default async function home(root, ctx) {
  const news = (await releases()).sort((a, b) => (b.pubdate || '').localeCompare(a.pubdate || ''));
  const kidName = id => ctx.children.find(c => c.id === id)?.name || '';
  const history = await lib.familyHistory();
  const latestDate = history[0]?.borrowedAt;
  const latest = history.filter(l => l.borrowedAt === latestDate).slice(0, 12);
  const bookCount = new Set(history.map(l => l.bookId)).size;

  const plan = await lib.reservationPlan();
  const candidates = plan.reduce((n, p) => n + p.series.length + p.pending.length, 0);
  const now = new Date();

  root.innerHTML = `
    <header class="home-hero">
      <a class="icon-btn" href="#/settings" aria-label="設定">⚙</a>
      <div class="eyebrow">FAMILY LIBRARY</div>
      <h1>図書館ノート</h1>
      <div class="date">${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${WEEK[now.getDay()]}）</div>
      <div class="ornament">❦</div>
    </header>
    <main class="home-body">
      <div class="due-card holdings-card">
        <div class="holdings">
          <div class="spine"><i style="height:30px"></i><i style="height:38px"></i><i style="height:26px"></i></div>
          <div class="t"><h4>これまでに借りた本</h4><div class="num">${bookCount.toLocaleString()}<small>冊</small></div></div>
          <a href="#/shelf">本棚へ ›</a>
        </div>
      </div>

      ${[11, 0].includes(now.getMonth()) ? `<a class="review-banner" href="#/review/${defaultYear()}">
        <span>🎉</span><div><b>${defaultYear()}年の読書をふりかえろう</b><small>子供ごとの冊数・よく読んだシリーズ・お気に入り</small></div><i>›</i></a>` : ''}

      ${news.length ? `<section class="news-card">
        <h3>📣 新刊のお知らせ<small>${news.length}冊</small></h3>
        ${news.slice(0, 5).map(r => `<div class="row">
          ${cover({ title: r.title, isbn: r.isbn })}
          <div class="t"><b>${esc(r.title)}</b>
            <span class="muted small">${esc(r.seriesTitle)}${r.volume ? ` ${r.volume}巻` : ''} ・ ${esc(releaseDate(r.pubdate))} ・ ${r.childIds.map(kidName).map(esc).join('・')}が読み進め中</span>
            <span class="news-btns"><button class="btn sm" data-wishnew="${esc(r.isbn)}">借りたい本に追加</button>
              <button class="link-btn small" data-dismiss="${esc(r.isbn)}">表示しない</button></span></div>
        </div>`).join('')}
        ${news.length > 5 ? `<p class="muted small">ほか ${news.length - 5}冊（追加するか「表示しない」を押すと次が出ます）</p>` : ''}
      </section>` : ''}

      <a class="holdings reserve-row" href="#/reserve">
        <span class="card-icon">🔖</span>
        <div class="t"><h4>予約候補</h4><div class="num">${candidates}<small>冊</small></div></div>
        <span class="go">予約へ ›</span>
      </a>

      <section class="bookshelf-card">
        <h3>最近借りた本${latest.length ? `<small>${esc(formatDate(latestDate))} に${latest.length}冊</small>` : ''}</h3>
        ${latest.length ? `
          <div class="wood-shelf">${latest.map(l => `<a href="#/book/${esc(l.book.id)}" title="${esc(l.book.title)}">${cover(l.book)}</a>`).join('')}</div>
          <div class="shelf-board"></div>`
        : `<p class="empty muted">まだ記録がありません。図書館で借りたら、レシートを撮影して登録しましょう。</p>`}
      </section>

      <div class="drawers">
        <div class="drawer register-drawer">
          <b>借りた本を登録</b>
          <div class="register-ways">
            <a href="#/receipt"><span class="plate">🧾</span>レシートを撮影</a>
            <a href="#/scan"><span class="plate">▥</span>本のバーコードを読む</a>
          </div>
        </div>
        <a class="drawer" href="#/scan/check"><span class="plate">🔍</span><b>貸出履歴の確認</b><small>借りたことがあるか調べる</small></a>
        <a class="drawer" href="#/review"><span class="plate">📖</span><b>読書のきろく</b><small>1年をふりかえる</small></a>
      </div>
    </main>
    ${tabs('home')}`;

  root.addEventListener('click', async e => {
    const w = e.target.closest('[data-wishnew]');
    if (w) {
      w.disabled = true;
      await wishRelease(news.find(r => r.isbn === w.dataset.wishnew));
      toast('借りたい本に追加しました。予約候補に出ます');
      ctx.refresh();
      return;
    }
    const d = e.target.closest('[data-dismiss]');
    if (d) { await dismissRelease(d.dataset.dismiss); ctx.refresh(); }
  });

  // 新刊の確認は3日に1回、裏で行う。新しく見つかったらホームを描き直す
  checkNewReleases().then(r => {
    const onHome = !location.hash || location.hash === '#' || location.hash.startsWith('#/home');
    if (r?.added && onHome) ctx.refresh();
  }).catch(() => { /* 通信できないときは次の機会に */ });
}
