// S-02 ホーム。段階1では最近借りた本と冊数を表示する（予約・おすすめは段階2・5）。
import * as lib from '../library.js';
import { esc, cover, formatDate } from '../ui.js';
import { topKids, tabs } from '../app.js';

export default async function home(root, ctx) {
  const history = await lib.historyOf(ctx.childId);
  const latestDate = history[0]?.borrowedAt;
  const latest = history.filter(l => l.borrowedAt === latestDate).slice(0, 10);
  const name = ctx.child.name;

  root.innerHTML = `
    ${topKids()}
    <main class="body">
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
        <a class="action" href="#/scan"><span>◉</span><b>借りた本を登録</b><small>バーコードをスキャン</small></a>
        <a class="action" href="#/scan/check"><span>？</span><b>借りたことある？</b><small>図書館で調べる</small></a>
      </div>
    </main>
    ${tabs('home')}`;
}
