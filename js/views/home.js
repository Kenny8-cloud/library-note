// S-02 ホーム。前回の予約からの日数、予約候補の冊数、最近借りた本を表示する（おすすめは段階5）。
import * as lib from '../library.js';
import { esc, cover, formatDate, today } from '../ui.js';
import { topKids, tabs } from '../app.js';

export default async function home(root, ctx) {
  const history = await lib.historyOf(ctx.childId);
  const latestDate = history[0]?.borrowedAt;
  const latest = history.filter(l => l.borrowedAt === latestDate).slice(0, 10);
  const name = ctx.child.name;

  const { lastReservedAt } = await lib.reserveSettings();
  const plan = await lib.reservationPlan();
  const candidates = plan.reduce((n, p) => n + p.series.length + p.pending.length, 0);
  const days = lastReservedAt ? Math.floor((new Date(today()) - new Date(lastReservedAt)) / 86400000) : null;

  root.innerHTML = `
    ${topKids()}
    <main class="body">
      <a class="card stat" href="#/reserve">
        <div>
          <h4>${days === null ? '予約' : '前回の予約から'}</h4>
          <div class="big">${days === null ? 'まだ' : `${days}<small>日</small>`}</div>
          ${days === null || days >= 14 ? '<p class="alert small">そろそろ予約の時期です</p>' : ''}
        </div>
        <div class="right"><h4>予約候補（家族）</h4><div class="big">${candidates}<small>冊</small></div><span class="link small">予約へ ›</span></div>
      </a>
      <div class="card stat">
        <div><h4>${esc(name)}がこれまでに借りた本</h4><div class="big">${history.length}<small>冊</small></div></div>
        <a class="link" href="#/shelf">本棚へ ›</a>
      </div>
      <div class="card">
        <h4>最近借りた本</h4>
        ${latest.length ? `
          <div class="covers">${latest.map(l => `<a href="#/book/${esc(l.book.id)}" title="${esc(l.book.title)}">${cover(l.book, 'md')}</a>`).join('')}</div>
          <p class="muted small">${esc(formatDate(latestDate))} に${latest.length}冊</p>`
        : `<p class="muted">まだ記録がありません。図書館で借りたら、スキャンして登録しましょう。</p>`}
      </div>
      <div class="actions">
        <a class="action" href="#/receipt"><span>🧾</span><b>借りた本を登録</b><small>レシートを撮影</small></a>
        <a class="action" href="#/scan/check"><span>？</span><b>借りたことある？</b><small>図書館で調べる</small></a>
      </div>
    </main>
    ${tabs('home')}`;
}
