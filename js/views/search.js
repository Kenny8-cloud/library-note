// S-05 手入力・書名検索。選んだ本はスキャン中の一覧に加えて、スキャン画面に戻る。
// #/search/wish のときは、選んだ本を借りたい本リストに加えて、リストに戻る。
import * as session from '../session.js';
import * as lib from '../library.js';
import { lookupIsbn, searchTitle } from '../biblio.js';
import { toIsbn13 } from '../isbn.js';
import { newId } from '../db.js';
import { esc, cover, toast } from '../ui.js';
import { topBack } from '../app.js';

export default async function search(root, ctx, [mode]) {
  const childId = ctx.childId;
  const isWish = mode === 'wish';
  let results = [];

  root.innerHTML = `
    ${topBack(isWish ? `借りたい本を探す（${ctx.child.name}）` : '本をさがす', { back: isWish ? 'wishlist' : 'scan' })}
    <main class="body">
      <form id="search-form" class="search-bar">
        <input class="input" type="search" name="q" placeholder="書名 または ISBN" autocomplete="off" required>
        <button class="btn sm" type="submit">検索</button>
      </form>
      <div id="results"><p class="muted small">国立国会図書館サーチで探します。ISBN（978〜の13桁）を入れると1冊だけ探します。</p></div>
      <form class="card stack" id="manual">
        <h3>見つからないときは手入力</h3>
        <label class="field">書名（必須）<input name="title" required></label>
        <label class="field">作者<input name="author"></label>
        <div class="two">
          <label class="field">シリーズ名<input name="series"></label>
          <label class="field vol">巻<input name="volume" type="number" min="1" inputmode="numeric"></label>
        </div>
        <p class="muted small">表紙の撮影は段階3（Googleドライブ連携）で追加します。</p>
        <button class="btn" type="submit">${isWish ? '借りたい本に追加' : '一覧に追加'}</button>
      </form>
    </main>`;

  const resultsEl = root.querySelector('#results');

  const addAndBack = async (item) => {
    if (isWish) {
      const book = await lib.ensureBook(item.info);
      if (item.info.seriesCandidate?.title && !book.seriesId) {
        await lib.setBookSeries(book, item.info.seriesCandidate.title, item.info.seriesCandidate.volume);
      }
      const borrowed = (await lib.loansOf(childId, book.id)).length;
      toast(!(await lib.addWish(childId, book.id)) ? 'この本はすでにリストにあります'
        : borrowed ? `「${book.title}」を追加しました（前に借りたことがあります）` : `「${book.title}」を追加しました`);
      ctx.go('wishlist');
      return;
    }
    if (!session.add(childId, item)) toast('この本はすでに一覧にあります');
    else toast(`「${item.info.title}」を一覧に追加しました`);
    ctx.go('scan');
  };

  root.querySelector('#search-form').addEventListener('submit', async e => {
    e.preventDefault();
    const q = new FormData(e.target).get('q').trim();
    resultsEl.innerHTML = `<p class="muted">検索中…</p>`;
    try {
      const isbn = toIsbn13(q);
      if (isbn) {
        const info = await lookupIsbn(isbn);
        results = info ? [info] : [];
      } else {
        results = await searchTitle(q);
      }
    } catch {
      resultsEl.innerHTML = `<p class="alert">書誌データに接続できませんでした。通信状態を確かめてください。</p>`;
      return;
    }
    resultsEl.innerHTML = results.length
      ? results.map((r, i) => `<div class="row">
          ${cover(r)}
          <div class="t"><b>${esc(r.title)}</b><span class="muted small">${esc([r.author, r.publisher, (r.pubdate || '').slice(0, 4)].filter(Boolean).join(' ／ '))}</span></div>
          <button class="btn sm" data-pick="${i}">選ぶ</button></div>`).join('')
      : `<p class="muted">見つかりませんでした。下の手入力をお使いください。</p>`;
  });

  resultsEl.addEventListener('click', e => {
    const pick = e.target.closest('[data-pick]');
    if (!pick) return;
    const info = results[pick.dataset.pick];
    addAndBack({ key: info.isbn || `ndl:${info.title}|${info.publisher}`, isbn: info.isbn || null, status: 'ok', info });
  });

  root.querySelector('#manual').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const series = String(f.get('series') || '').trim();
    const info = {
      title: String(f.get('title')).trim(),
      author: String(f.get('author') || '').trim(),
      seriesCandidate: series ? { title: series, volume: Number(f.get('volume')) || null } : null,
    };
    addAndBack({ key: `manual:${newId()}`, isbn: null, status: 'ok', info });
  });
}
