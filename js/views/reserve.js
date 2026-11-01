// S-10 予約候補（家族全体）。予約はまとめて行うので子供別に分けず、「新刊 → シリーズの続き → 借りたい本」を1つの一覧に並べる。
// チェックは最初は付けず、自分で選んだ本だけを予約する。
import * as lib from '../library.js';
import { esc, cover, formatDate, toast } from '../ui.js';
import { topKids, tabs } from '../app.js';
import { suggestionsOf, needsRefresh, refreshSuggestions, dismissSuggestion, wishSuggestion } from '../suggestions.js';

export const SELECTION_KEY = 'reserve-selection';

function loadSelection() {
  try { return JSON.parse(sessionStorage.getItem(SELECTION_KEY)) || []; } catch { return []; }
}

export default async function reserve(root, ctx) {
  const plan = await lib.reservationPlan();
  const { targetCount, maxCount, lastReservedAt } = await lib.reserveSettings();
  const childOf = id => ctx.children.find(c => c.id === id);
  const kidDots = ids => `<span class="kid-dots">${[...new Set(ids)].map(childOf).filter(Boolean)
    .map(c => `<i class="dot" style="background:${esc(c.color)}" title="${esc(c.name)}"></i>`).join('')}</span>`;

  // 兄弟で同じ本は1行にまとめる（図書館では1冊の予約で済む）。予約すると、まとめた子全員の記録になる
  const rows = new Map();
  for (const section of ['releases', 'series', 'pending']) {
    for (const p of plan) {
      for (const it of p[section]) {
        if (rows.has(it.book.id)) rows.get(it.book.id).items.push(it);
        else rows.set(it.book.id, { section, book: it.book, main: it, items: [it] });
      }
    }
  }
  const rowsOf = section => [...rows.values()].filter(r => r.section === section);
  const seriesRows = rowsOf('series').sort((a, b) => a.main.series.title.localeCompare(b.main.series.title, 'ja'));

  // 選んだ本は描き直しても残す（お気に入りに似た本を候補に入れたときなど）。チェックは最初は付けない
  const saved = new Set(loadSelection());
  const checked = new Set([...rows.values()].filter(r => r.items.some(it => saved.has(it.key))).map(r => r.book.id));
  const saveSelection = () => {
    const keys = [...rows.values()].filter(r => checked.has(r.book.id)).flatMap(r => r.items.map(it => it.key));
    try { sessionStorage.setItem(SELECTION_KEY, JSON.stringify(keys)); } catch { /* 下の画面で候補なしになる */ }
  };

  const row = ({ book, main, items }) => `<label class="row">
      <input type="checkbox" class="chk-in" data-book="${esc(book.id)}" ${checked.has(book.id) ? 'checked' : ''}>
      ${cover(book)}
      <div class="t"><b>${esc(book.title)}</b>
        <span class="muted small">${kidDots(items.map(it => it.childId))}${main.release
          ? `<span class="badge acc">${main.upcoming ? '発売予定' : '新刊'}</span> ${esc(book.pubdate || '')}`
          : main.series
          ? esc(`${main.series.title}${book.volume ? ` ${book.volume}巻` : ''}`)
          : `<span class="badge">${{ manual: '手動', author: '同じ作者', ai: 'AI', series: 'シリーズ', favorite: 'お気に入りから' }[main.wish.source] || '手動'}</span>`}</span></div>
    </label>`;

  // お気に入りに似た本も、兄弟で同じ本は1行にまとめる。「候補に入れる」と借りたい本に入り、上のチェックの一覧に並ぶ
  const suggest = new Map();
  for (const p of plan) {
    for (const s of await suggestionsOf(p.child.id)) {
      if (!suggest.has(s.isbn)) suggest.set(s.isbn, { s, childIds: [] });
      suggest.get(s.isbn).childIds.push(p.child.id);
    }
  }
  const searching = await needsRefresh();
  const suggestHtml = () => {
    if (!suggest.size && !searching) return '';
    return `<details class="suggest" ${suggest.size ? 'open' : ''}>
      <summary><h4 class="sub-h">♥ お気に入りに似た本${suggest.size ? ` ${suggest.size}冊` : ''}</h4></summary>
      ${[...suggest.values()].map(({ s, childIds }) => `<div class="row">
        ${cover(s)}
        <div class="t"><b>${esc(s.title)}</b>
          <span class="muted small">${kidDots(childIds)}${esc(s.authorName)} ・ 「${esc(s.because)}」が好きなので</span></div>
        <div class="suggest-btns">
          <button class="btn sm" data-suggest="${esc(s.isbn)}">候補に入れる</button>
          <button class="link-btn small" data-nosuggest="${esc(s.isbn)}">いらない</button>
        </div>
      </div>`).join('')}
      ${searching ? '<p class="muted small">お気に入りに似た本を探しています…（1分ほどかかります）</p>' : ''}
    </details>`;
  };

  // 次の巻が未登録のシリーズ（シリーズ詳細で追加してもらう）と、予約済みの本も、家族で1つの一覧にする
  const needVolume = new Map();
  for (const p of plan) for (const s of p.needVolume) if (!needVolume.has(s.series.id)) needVolume.set(s.series.id, s);
  const reserved = new Map();
  for (const p of plan) {
    for (const w of p.reserved) {
      if (!reserved.has(w.book.id)) reserved.set(w.book.id, []);
      reserved.get(w.book.id).push(w);
    }
  }

  root.innerHTML = `
    ${topKids({ title: '予約候補（家族全体）' })}
    <main class="body">
      <div class="btns" style="margin-top:0">
        <span class="muted small">前回の予約: ${lastReservedAt ? esc(formatDate(lastReservedAt)) : 'まだありません'}</span>
        <a class="btn ghost sm" href="#/wishlist">借りたい本リストを管理</a>
      </div>
      <section class="kid-sec">
        ${rowsOf('releases').length ? `<h4 class="sub-h">📣 新刊（最優先）</h4>${rowsOf('releases').map(row).join('')}` : ''}
        ${seriesRows.length ? `<h4 class="sub-h">シリーズの続き</h4>${seriesRows.map(row).join('')}` : ''}
        ${needVolume.size ? `<details class="reserved"><summary class="small">次の巻が未登録のシリーズ ${needVolume.size}件（最新巻まで読んだシリーズを含む）</summary>
          ${[...needVolume.values()].map(s => `<a class="note" href="#/series/${esc(s.series.id)}">「${esc(s.series.title)}」 ${s.readCount}冊読了 ›</a>`).join('')}
          <p class="muted small">続きが出ていれば、シリーズの画面で追加すると候補に出ます。読み終えたシリーズは「完了」にすると、ここに出なくなります。</p>
        </details>` : ''}
        ${rowsOf('pending').length ? `<h4 class="sub-h">借りたい本</h4>${rowsOf('pending').map(row).join('')}` : ''}
        ${!rows.size ? '<p class="muted small">候補はありません。</p>' : ''}
        ${suggestHtml()}
        ${reserved.size ? `<details class="reserved"><summary class="small">予約済み（まだ借りていない） ${reserved.size}冊</summary>
          ${[...reserved.values()].map(list => `<div class="row">${cover(list[0].book)}<div class="t"><b>${esc(list[0].book.title)}</b>
            <span class="muted small">${esc(formatDate(list[0].reservedAt))} に予約</span></div>
            <button class="link-btn small" data-unreserve="${esc(list[0].book.id)}">取り消す</button></div>`).join('')}
        </details>` : ''}
      </section>
    </main>
    <footer class="foot above-tabs">
      <div class="count-line"><b id="count"></b><span class="muted small">目安 ${targetCount}冊 ・ 上限 ${maxCount}冊</span></div>
      <div class="meter"><i id="meter"></i></div>
      <p class="alert" id="over" hidden></p>
      <button class="btn" id="go">予約する本を確認</button>
    </footer>
    ${tabs('reserve')}`;

  const update = () => {
    const n = checked.size;
    const count = root.querySelector('#count');
    count.textContent = `選択 ${n} / ${targetCount}冊`;
    count.classList.toggle('warn-text', n > targetCount);
    const meter = root.querySelector('#meter');
    meter.style.width = `${Math.min(100, n / targetCount * 100)}%`;
    meter.classList.toggle('over', n > targetCount);
    const over = root.querySelector('#over');
    over.hidden = n <= maxCount;
    over.textContent = `上限の${maxCount}冊を超えています。図書館で予約できない分があります。`;
    root.querySelector('#go').disabled = n === 0;
  };

  root.addEventListener('change', e => {
    const id = e.target.dataset.book;
    if (!id) return;
    if (e.target.checked) checked.add(id); else checked.delete(id);
    saveSelection();
    update();
  });

  root.addEventListener('click', async e => {
    const sg = e.target.closest('[data-suggest]') || e.target.closest('[data-nosuggest]');
    if (sg) {
      e.preventDefault();
      sg.disabled = true;
      const { s, childIds } = suggest.get(sg.dataset.suggest || sg.dataset.nosuggest);
      for (const id of childIds) {
        if (sg.dataset.suggest) await wishSuggestion(id, s); else await dismissSuggestion(id, s.isbn);
      }
      if (sg.dataset.suggest) toast('借りたい本に入れました');
      ctx.refresh();
      return;
    }
    const un = e.target.closest('[data-unreserve]');
    if (un) {
      e.preventDefault();
      for (const w of reserved.get(un.dataset.unreserve)) {
        // シリーズの続きとして予約したものはリストから消し、手で入れたものは未予約に戻す
        if (w.source === 'series') await lib.removeWish(w.id);
        else await lib.updateWish({ ...w, status: 'none' });
      }
      ctx.refresh();
      return;
    }
    if (e.target.id === 'go') {
      saveSelection();
      ctx.go('reserve-confirm');
    }
  });

  update();

  // お気に入りが変わったときや1週間たったときは、裏で探し直してから描き直す
  if (searching) {
    refreshSuggestions().then(() => {
      if (location.hash.startsWith('#/reserve') && !location.hash.startsWith('#/reserve-')) ctx.refresh();
    }).catch(() => { /* 通信できないときは次に開いたとき */ });
  }
}
