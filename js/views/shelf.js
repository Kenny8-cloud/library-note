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

async function seriesHtml(history) {
  const bySeries = new Map();
  for (const l of history) {
    if (!l.book.seriesId) continue;
    if (!bySeries.has(l.book.seriesId)) bySeries.set(l.book.seriesId, new Set());
    if (l.book.volume) bySeries.get(l.book.seriesId).add(l.book.volume);
  }
  if (!bySeries.size) {
    return `<p class="empty">シリーズに登録した本はまだありません。<br>登録の確認画面や本の詳細で、シリーズ名と巻数を設定できます。</p>`;
  }
  const rows = [];
  for (const [id, vols] of bySeries) {
    const s = await lib.getSeries(id);
    const sorted = [...vols].sort((a, b) => a - b);
    rows.push({ title: s?.title || '', sorted });
  }
  rows.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  return rows.map(r => `
    <div class="card">
      <b>${esc(r.title)}</b>
      <div class="muted small">借りた巻: ${r.sorted.length ? r.sorted.map(v => `${v}巻`).join('・') : '巻数なし'}</div>
    </div>`).join('') + `<p class="muted small">次の巻の表示や予約候補への追加は、段階2で追加します。</p>`;
}

export default async function shelf(root, ctx, [tab]) {
  const history = await lib.historyOf(ctx.childId);
  const isSeries = tab === 'series';

  root.innerHTML = `
    ${topKids()}
    <main class="body">
      <div class="seg">
        <a href="#/shelf" class="${isSeries ? '' : 'on'}">履歴</a>
        <a href="#/shelf/series" class="${isSeries ? 'on' : ''}">シリーズ</a>
      </div>
      ${isSeries ? await seriesHtml(history) : `
        <input class="input" type="search" id="q" placeholder="🔍 書名・作者で検索" autocomplete="off">
        <p class="muted small">これまでに ${history.length}冊</p>
        <div id="list">${historyHtml(history, '')}</div>`}
    </main>
    ${tabs('shelf')}`;

  const q = root.querySelector('#q');
  if (q) q.addEventListener('input', () => { root.querySelector('#list').innerHTML = historyHtml(history, q.value); });
}
