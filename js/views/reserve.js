// S-10 予約候補（家族全体）。上の子供のタブで切り替えて、その子の「新刊 → シリーズの続き → 借りたい本」を並べる。
// チェックは最初は付けず、自分で選んだ本だけを予約する。予約済みの本は家族で1つにまとめて一番上に置く。
import * as lib from '../library.js';
import { esc, cover, formatDate, toast, kidChips, today, longPress } from '../ui.js';
import { topKids, tabs } from '../app.js';
import { suggestionsOf, needsRefresh, refreshSuggestions, dismissSuggestion, wishSuggestion } from '../suggestions.js';

export const SELECTION_KEY = 'reserve-selection';

function loadSelection() {
  try { return JSON.parse(sessionStorage.getItem(SELECTION_KEY)) || []; } catch { return []; }
}

export default async function reserve(root, ctx) {
  const plan = await lib.reservationPlan();
  const { targetCount, maxCount, lastReservedAt } = await lib.reserveSettings();
  const current = plan.find(p => p.child.id === ctx.childId) || plan[0];

  // 兄弟で同じ本は、最初の子のタブにだけ出す（図書館では1冊の予約で済む）。
  // 予約すると、その本が候補に入っている子全員の記録になる
  const rows = new Map();
  for (const p of plan) {
    for (const it of [...p.releases, ...p.series, ...p.pending]) {
      if (rows.has(it.book.id)) rows.get(it.book.id).items.push(it);
      else rows.set(it.book.id, { book: it.book, owner: p.child.id, items: [it] });
    }
  }
  const mine = list => list.filter(it => rows.get(it.book.id).owner === current.child.id);
  const releases = mine(current.releases), series = mine(current.series), pending = mine(current.pending);

  // 選んだ本は描き直しても残す（お気に入りに似た本を候補に入れたときなど）。チェックは最初は付けない
  const saved = new Set(loadSelection());
  const checked = new Set([...rows.values()].filter(r => r.items.some(it => saved.has(it.key))).map(r => r.book.id));
  const saveSelection = () => {
    const keys = [...rows.values()].filter(r => checked.has(r.book.id)).flatMap(r => r.items.map(it => it.key));
    try { sessionStorage.setItem(SELECTION_KEY, JSON.stringify(keys)); } catch { /* 下の画面で候補なしになる */ }
  };

  // 家族の誰かが借りたことがある本には印を付ける。過去のメモの本と ISBN つきの本が別々に登録されていることがあるので、
  // 同じ本かどうかは書名で見る。履歴は新しい順なので、子供ごとの最初の1件が最後に借りた日になる
  const titleKey = t => String(t || '').normalize('NFKC').toLowerCase().replace(/[\s・!?、。,.「」『』()（）〜~ー\-:：]/g, '');
  const borrowed = new Map();
  for (const l of await lib.familyHistory()) {
    const key = titleKey(l.book.title);
    if (!borrowed.has(key)) borrowed.set(key, new Map());
    for (const k of l.kids) if (!borrowed.get(key).has(k.name)) borrowed.get(key).set(k.name, l.borrowedAt);
  }
  const borrowedBadge = book => {
    const who = borrowed.get(titleKey(book.title));
    if (!who) return '';
    const text = [...who].map(([name, date]) => (date ? `${name} ${formatDate(date)}` : name)).join('、');
    return `<span class="badge warn">借りたことあり（${esc(text)}）</span>`;
  };

  const row = it => {
    const { book } = it;
    return `<label class="row" data-press="${esc(book.id)}">
      <input type="checkbox" class="chk-in" data-book="${esc(book.id)}" ${checked.has(book.id) ? 'checked' : ''}>
      ${cover(book)}
      <div class="t"><b>${esc(book.title)}</b>
        ${borrowedBadge(book)}
        <span class="muted small">${it.release
          ? `<span class="badge acc">${it.upcoming ? '発売予定' : '新刊'}</span> ${esc(book.pubdate || '')}`
          : it.series
          ? esc(`${it.series.title}${book.volume ? ` ${book.volume}巻` : ''}`)
          : `<span class="badge">${{ manual: '手動', author: '同じ作者', ai: 'AI', series: 'シリーズ', favorite: 'お気に入りから' }[it.wish.source] || '手動'}</span>`}</span></div>
    </label>`;
  };

  // 行を長押ししたときのメニュー（兄弟に移す・候補から外す・読んだ本に登録）
  const openMenu = id => {
    if (root.querySelector('.sheet-back')) return;
    const { book } = rows.get(id);
    root.insertAdjacentHTML('beforeend', `<div class="sheet-back">
      <div class="sheet" role="dialog" aria-label="${esc(book.title)}">
        <b class="sheet-title">${esc(book.title)}</b>
        ${ctx.children.filter(c => c.id !== current.child.id).map(c => `<button class="btn ghost" data-move="${esc(id)}" data-to="${esc(c.id)}">${esc(c.name)}に移す</button>`).join('')}
        <button class="btn ghost" data-hide="${esc(id)}">候補から外す</button>
        <div class="sheet-read">
          <h4 class="sub-h">読んだ本に登録</h4>
          <label class="field inline">読んだ日<input type="date" id="read-date" value="${today()}" max="${today()}"></label>
          <div class="sheet-kids">
            ${ctx.children.map(c => `<button class="btn sm" data-read="${esc(id)}" data-kid-ids="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
            ${ctx.children.length > 1 ? `<button class="btn sm" data-read="${esc(id)}" data-kid-ids="${esc(ctx.children.map(c => c.id).join(','))}">全員</button>` : ''}
          </div>
        </div>
        <button class="link-btn" data-close>やめる</button>
      </div>
    </div>`);
  };

  // 予約候補から外した本。兄弟で同じ本は1行にまとめ、「戻す」で全員の候補に戻す
  const hidden = new Map();
  for (const p of plan) {
    for (const it of p.hidden) {
      if (rows.has(it.book.id)) continue;   // 別の子へ移した本は、移した先の候補に出ている
      if (!hidden.has(it.book.id)) hidden.set(it.book.id, []);
      hidden.get(it.book.id).push(it);
    }
  }

  // お気に入りに似た本。「候補に入れる」と借りたい本に入り、上のチェックの一覧に並ぶ。
  // 先の子の候補や提案と同じ本は出さない
  const suggest = new Map();
  const taken = new Set([...rows.values()].filter(r => r.owner !== current.child.id).map(r => r.book.isbn).filter(Boolean));
  for (const p of plan) {
    const list = await suggestionsOf(p.child.id);
    suggest.set(p.child.id, list);
    if (p === current) break;
    list.forEach(s => taken.add(s.isbn));
  }
  const searching = await needsRefresh();
  const suggestHtml = p => {
    const list = suggest.get(p.child.id).filter(s => !taken.has(s.isbn));
    if (!list.length && !searching) return '';
    return `<details class="suggest" ${list.length ? 'open' : ''}>
      <summary><h4 class="sub-h">♥ お気に入りに似た本${list.length ? ` ${list.length}冊` : ''}</h4></summary>
      ${list.map(s => `<div class="row">
        ${cover(s)}
        <div class="t"><b>${esc(s.title)}</b>
          <span class="muted small">${esc(s.authorName)} ・ 「${esc(s.because)}」が好きなので</span></div>
        <div class="suggest-btns">
          <button class="btn sm" data-suggest="${esc(p.child.id)}|${esc(s.isbn)}">候補に入れる</button>
          <button class="link-btn small" data-nosuggest="${esc(p.child.id)}|${esc(s.isbn)}">いらない</button>
        </div>
      </div>`).join('')}
      ${searching ? '<p class="muted small">お気に入りに似た本を探しています…（1分ほどかかります）</p>' : ''}
    </details>`;
  };

  // 予約済みの本は、兄弟で同じ本を1行にまとめて家族で1つの一覧にする
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
      ${reserved.size ? `<details class="card reserved-top"><summary>🔖 予約済み（まだ借りていない） <b>${reserved.size}冊</b></summary>
        ${[...reserved.values()].map(list => `<div class="row">${cover(list[0].book)}<div class="t"><b>${esc(list[0].book.title)}</b>
          <span class="muted small">${esc(formatDate(list[0].reservedAt))} に予約</span></div>
          <button class="link-btn small" data-unreserve="${esc(list[0].book.id)}">取り消す</button></div>`).join('')}
      </details>` : ''}
      <div class="kids">${kidChips(ctx.children, current.child.id)}</div>
      <section class="kid-sec">
        ${rows.size ? '<p class="muted small">本を長押しすると、兄弟に移す・候補から外す・読んだ本に登録ができます。</p>' : ''}
        ${releases.length ? `<h4 class="sub-h">📣 新刊（最優先）</h4>${releases.map(row).join('')}` : ''}
        ${series.length ? `<h4 class="sub-h">シリーズの続き</h4>${series.map(row).join('')}` : ''}
        ${current.needVolume.length ? `<details class="reserved"><summary class="small">次の巻が未登録のシリーズ ${current.needVolume.length}件（最新巻まで読んだシリーズを含む）</summary>
          ${current.needVolume.map(s => `<a class="note" href="#/series/${esc(s.series.id)}">「${esc(s.series.title)}」 ${s.readCount}冊読了 ›</a>`).join('')}
          <p class="muted small">続きが出ていれば、シリーズの画面で追加すると候補に出ます。読み終えたシリーズは「完了」にすると、ここに出なくなります。</p>
        </details>` : ''}
        ${pending.length ? `<h4 class="sub-h">借りたい本</h4>${pending.map(row).join('')}` : ''}
        ${!releases.length && !series.length && !pending.length ? '<p class="muted small">候補はありません。</p>' : ''}
        ${suggestHtml(current)}
        ${hidden.size ? `<details class="reserved"><summary class="small">外した本 ${hidden.size}冊</summary>
          ${[...hidden.values()].map(list => `<div class="row">${cover(list[0].book)}<div class="t"><b>${esc(list[0].book.title)}</b></div>
            <button class="link-btn small" data-show="${esc(list[0].book.id)}">戻す</button></div>`).join('')}
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

  longPress(root, openMenu);

  root.addEventListener('click', async e => {
    if (e.target.closest('[data-close]') || e.target.classList.contains('sheet-back')) {
      root.querySelector('.sheet-back')?.remove();
      return;
    }
    const read = e.target.closest('[data-read]');
    if (read) {
      const bookId = read.dataset.read;
      const date = root.querySelector('#read-date').value || null;
      for (const kidId of read.dataset.kidIds.split(',')) {
        if ((await lib.loansOf(kidId, bookId)).some(l => l.borrowedAt === date)) continue;
        await lib.addLoan(kidId, bookId, date);
      }
      checked.delete(bookId);
      saveSelection();
      toast('読んだ本に登録しました');
      ctx.refresh();
      return;
    }
    const hide = e.target.closest('[data-hide]');
    if (hide) {
      e.preventDefault();   // 行全体がチェックボックスのラベルなので、チェックが切り替わらないようにする
      await lib.hideCandidates(rows.get(hide.dataset.hide).items);
      checked.delete(hide.dataset.hide);
      saveSelection();
      toast('予約候補から外しました');
      ctx.refresh();
      return;
    }
    const move = e.target.closest('[data-move]');
    if (move) {
      e.preventDefault();
      await lib.moveCandidate(rows.get(move.dataset.move).items, move.dataset.to);
      toast(`${ctx.children.find(c => c.id === move.dataset.to)?.name}の候補に移しました`);
      ctx.refresh();
      return;
    }
    const show = e.target.closest('[data-show]');
    if (show) {
      e.preventDefault();
      await lib.showCandidates(hidden.get(show.dataset.show));
      ctx.refresh();
      return;
    }
    const sg = e.target.closest('[data-suggest]') || e.target.closest('[data-nosuggest]');
    if (sg) {
      e.preventDefault();
      sg.disabled = true;
      const [childId, isbn] = (sg.dataset.suggest || sg.dataset.nosuggest).split('|');
      if (sg.dataset.suggest) {
        await wishSuggestion(childId, suggest.get(childId).find(s => s.isbn === isbn));
        toast('借りたい本に入れました');
      } else {
        await dismissSuggestion(childId, isbn);
      }
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
