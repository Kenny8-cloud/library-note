// S-10 予約候補（家族全体）。子供ごとに「シリーズの続き → 借りたい本」を並べ、チェックした本を予約する。
import * as lib from '../library.js';
import { esc, cover, formatDate } from '../ui.js';
import { topKids, tabs } from '../app.js';

export const SELECTION_KEY = 'reserve-selection';

export default async function reserve(root, ctx) {
  const plan = await lib.reservationPlan();
  const { targetCount, maxCount, lastReservedAt } = await lib.reserveSettings();
  const items = new Map();
  // シリーズの続きは最初から選んでおく。借りたい本は自分で選ぶ
  const checked = new Set();
  for (const p of plan) {
    for (const it of [...p.series, ...p.pending]) items.set(it.key, it);
    p.series.forEach(it => checked.add(it.key));
  }

  // 兄弟で同じ本が候補になったときは、図書館では1冊の予約で済むので、冊数は1冊として数える
  const firstChildOf = new Map();
  for (const p of plan) {
    for (const it of [...p.series, ...p.pending]) if (!firstChildOf.has(it.book.id)) firstChildOf.set(it.book.id, p.child);
  }
  const row = it => `<label class="row">
      <input type="checkbox" class="chk-in" data-key="${esc(it.key)}" ${checked.has(it.key) ? 'checked' : ''}>
      ${cover(it.book)}
      <div class="t"><b>${esc(it.book.title)}</b>
        ${firstChildOf.get(it.book.id).id !== it.childId ? `<span class="badge">${esc(firstChildOf.get(it.book.id).name)}と同じ本</span>` : ''}
        <span class="muted small">${it.series
          ? esc(`${it.series.title}${it.book.volume ? ` ${it.book.volume}巻` : ''}`)
          : `<span class="badge">${{ manual: '手動', author: '同じ作者', ai: 'AI', series: 'シリーズ' }[it.wish.source] || '手動'}</span>`}</span></div>
    </label>`;

  root.innerHTML = `
    ${topKids({ title: '予約候補（家族全体）' })}
    <main class="body">
      <div class="btns" style="margin-top:0">
        <span class="muted small">前回の予約: ${lastReservedAt ? esc(formatDate(lastReservedAt)) : 'まだありません'}</span>
        <a class="btn ghost sm" href="#/wishlist">借りたい本リストを管理</a>
      </div>
      ${plan.map(p => `
        <section class="kid-sec">
          <h3 class="sec"><span class="dot" style="background:${esc(p.child.color)}"></span>${esc(p.child.name)}</h3>
          ${p.series.length ? `<h4 class="sub-h">シリーズの続き</h4>${p.series.map(row).join('')}` : ''}
          ${p.needVolume.length ? `<details class="reserved"><summary class="small">次の巻が未登録のシリーズ ${p.needVolume.length}件（最新巻まで読んだシリーズを含む）</summary>
            ${p.needVolume.map(s => `<a class="note" href="#/series/${esc(s.series.id)}">「${esc(s.series.title)}」 ${s.readCount}冊読了 ›</a>`).join('')}
            <p class="muted small">続きが出ていれば、シリーズの画面で追加すると候補に出ます。読み終えたシリーズは「完了」にすると、ここに出なくなります。</p>
          </details>` : ''}
          ${p.pending.length ? `<h4 class="sub-h">借りたい本</h4>${p.pending.map(row).join('')}` : ''}
          ${!p.series.length && !p.pending.length ? '<p class="muted small">候補はありません。</p>' : ''}
          ${p.reserved.length ? `<details class="reserved"><summary class="small">予約済み（まだ借りていない） ${p.reserved.length}冊</summary>
            ${p.reserved.map(w => `<div class="row">${cover(w.book)}<div class="t"><b>${esc(w.book.title)}</b>
              <span class="muted small">${esc(formatDate(w.reservedAt))} に予約</span></div>
              <button class="link-btn small" data-unreserve="${esc(w.id)}">取り消す</button></div>`).join('')}
          </details>` : ''}
        </section>`).join('')}
    </main>
    <footer class="foot above-tabs">
      <div class="count-line"><b id="count"></b><span class="muted small">目安 ${targetCount}冊 ・ 上限 ${maxCount}冊</span></div>
      <div class="meter"><i id="meter"></i></div>
      <p class="alert" id="over" hidden></p>
      <button class="btn" id="go">予約する本を確認</button>
    </footer>
    ${tabs('reserve')}`;

  const update = () => {
    const n = new Set([...checked].map(k => items.get(k)?.book.id).filter(Boolean)).size;
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
    const key = e.target.dataset.key;
    if (!key) return;
    if (e.target.checked) checked.add(key); else checked.delete(key);
    update();
  });

  root.addEventListener('click', async e => {
    const un = e.target.closest('[data-unreserve]');
    if (un) {
      e.preventDefault();
      const w = plan.flatMap(p => p.reserved).find(x => x.id === un.dataset.unreserve);
      // シリーズの続きとして予約したものはリストから消し、手で入れたものは未予約に戻す
      if (w.source === 'series') await lib.removeWish(w.id);
      else await lib.updateWish({ ...w, status: 'none' });
      ctx.refresh();
      return;
    }
    if (e.target.id === 'go') {
      const keys = [...checked].filter(k => items.has(k));
      try { sessionStorage.setItem(SELECTION_KEY, JSON.stringify(keys)); } catch { /* 下の画面で候補なしになる */ }
      ctx.go('reserve-confirm');
    }
  });

  update();
}
