// S-06 本棚（履歴）と S-08 シリーズ一覧（段階1では借りた巻の一覧だけ）
import * as lib from '../library.js';
import { esc, cover } from '../ui.js';
import { topKids, tabs } from '../app.js';

function monthLabel(iso) {
  if (!iso) return '日付なし';
  const [y, m] = iso.split('-');
  return `${y}年${Number(m)}月`;
}

function historyHtml(history, q) {
  const needle = q.trim().toLowerCase();
  const list = needle
    ? history.filter(l => `${l.book.title} ${l.book.author}`.toLowerCase().includes(needle))
    : history;
  if (!history.length) return `<p class="empty">まだ記録がありません。</p>`;
  if (!list.length) return `<p class="empty">「${esc(q)}」に当てはまる本はありません。</p>`;

  const groups = new Map();
  for (const l of list) {
    const key = monthLabel(l.borrowedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  return [...groups].map(([label, loans]) => `
    <h3 class="month">${esc(label)}<small>${loans.length}冊</small></h3>
    <div class="shelf">${loans.map(l => `
      <a href="#/book/${esc(l.book.id)}">${cover(l.book)}<span>${esc(l.book.title)}</span></a>`).join('')}
    </div>`).join('');
}

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

export default async function shelf(root, ctx, [tab, filter = 'reading']) {
  const isSeries = tab === 'series';
  const history = isSeries ? [] : await lib.historyOf(ctx.childId);

  root.innerHTML = `
    ${topKids()}
    <main class="body">
      <div class="seg">
        <a href="#/shelf" class="${isSeries ? '' : 'on'}">履歴</a>
        <a href="#/shelf/series" class="${isSeries ? 'on' : ''}">シリーズ</a>
      </div>
      ${isSeries ? await seriesHtml(ctx.childId, filter) : `
        <input class="input" type="search" id="q" placeholder="🔍 書名・作者で検索" autocomplete="off">
        <p class="muted small">これまでに ${history.length}冊</p>
        <div id="list">${historyHtml(history, '')}</div>`}
    </main>
    ${tabs('shelf')}`;

  const q = root.querySelector('#q');
  if (q) q.addEventListener('input', () => { root.querySelector('#list').innerHTML = historyHtml(history, q.value); });
}
