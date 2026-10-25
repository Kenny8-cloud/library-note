// S-02 ホーム。図書館の雰囲気（貸出カード・木の書棚・目録の引き出し）で、予約の時期、蔵書数、最近借りた本を見せる。
// 本棚と同じく、借りた本の冊数と最近借りた本は家族全体で表示する
import * as lib from '../library.js';
import { esc, cover, formatDate } from '../ui.js';
import { tabs } from '../app.js';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export default async function home(root) {
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
        <a class="drawer" href="#/receipt"><span class="plate">🧾</span><b>借りた本を登録</b><small>レシートを撮影</small></a>
        <a class="drawer" href="#/scan/check"><span class="plate">🔍</span><b>借りたことがあるかチェック</b><small>図書館で調べる</small></a>
      </div>
    </main>
    ${tabs('home')}`;
}
