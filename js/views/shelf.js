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
function historyHtml(history, q, seriesNames) {
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
  for (const l of list) {
    const key = monthLabel(l.borrowedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  return count + [...groups].map(([label, loans]) => `
    <h3 class="month">${esc(label)}<small>${loans.length}冊</small></h3>
    <div class="shelf">${loans.map(l => `
      <a href="#/book/${esc(l.book.id)}">${cover(l.book)}<span>${esc(l.book.title)}</span>
        <i class="who">${(l.kids || []).map(k => `<b style="background:${esc(k.color)}" title="${esc(k.name)}"></b>`).join('')}</i></a>`).join('')}
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

// 履歴は家族共通。だれが借りたかは色の点で示し、必要なら子供ごとに絞り込める。
// シリーズの読み進め（次の巻）は子供ごとに違うので、シリーズのタブは子供ごとのまま
export default async function shelf(root, ctx, [tab, filter = 'reading']) {
  const isSeries = tab === 'series';
  const all = isSeries ? [] : await lib.familyHistory();
  const seriesNames = isSeries ? new Map() : new Map((await lib.seriesList()).map(s => [s.id, s.title]));
  let who = '';

  root.innerHTML = `
    ${isSeries ? topKids() : topKids({ title: '本棚（家族）' })}
    <main class="body">
      <div class="seg">
        <a href="#/shelf" class="${isSeries ? '' : 'on'}">履歴</a>
        <a href="#/shelf/series" class="${isSeries ? 'on' : ''}">シリーズ</a>
      </div>
      ${isSeries ? await seriesHtml(ctx.childId, filter) : `
        <input class="input" type="search" id="q" placeholder="🔍 書名・作者・シリーズ名で検索" autocomplete="off">
        <div class="chips" id="who">
          <button class="chip on" data-who="">全員</button>
          ${ctx.children.map(c => `<button class="chip" data-who="${esc(c.id)}"><span class="dot" style="background:${esc(c.color)}"></span> ${esc(c.name)}</button>`).join('')}
        </div>
        <div id="list"></div>`}
    </main>
    ${tabs('shelf')}`;

  if (isSeries) return;
  const q = root.querySelector('#q');
  const draw = () => {
    const list = who ? all.filter(l => l.kids.some(k => k.id === who)) : all;
    root.querySelector('#list').innerHTML = historyHtml(list, q.value, seriesNames);
  };
  q.addEventListener('input', draw);
  root.querySelector('#who').addEventListener('click', e => {
    const b = e.target.closest('[data-who]');
    if (!b) return;
    who = b.dataset.who;
    root.querySelectorAll('#who .chip').forEach(c => c.classList.toggle('on', c === b));
    draw();
  });
  draw();
}
