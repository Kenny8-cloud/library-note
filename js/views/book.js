// S-07 本の詳細。書誌情報の編集、貸出日の修正・削除、借りたい本への追加。
import * as lib from '../library.js';
import { format as formatIsbn } from '../isbn.js';
import { esc, cover, formatDate, today, toast } from '../ui.js';
import { topBack } from '../app.js';
import { searchTitle } from '../biblio.js';
import { searchParts } from '../ocr.js';

export default async function book(root, ctx, [bookId]) {
  const b = await lib.getBook(bookId);
  if (!b) {
    ctx.go('shelf');
    return;
  }
  const childId = ctx.childId;
  const series = await lib.getSeries(b.seriesId);
  const allSeries = await lib.seriesList();
  const loans = await lib.loansOfBook(b.id);
  const mine = loans.filter(l => l.childId === childId).sort((x, y) => (y.borrowedAt || '').localeCompare(x.borrowedAt || ''));
  const others = ctx.children.filter(c => c.id !== childId).map(c => {
    const theirs = loans.filter(l => l.childId === c.id).map(l => l.borrowedAt).sort().reverse();
    return `${esc(c.name)}: ${theirs.length ? theirs.map(d => esc(formatDate(d))).join('、') : '借りていません'}`;
  });
  const wished = await lib.isWished(childId, b.id);
  const favs = (await lib.allFavorites()).filter(f => f.bookId === b.id).map(f => f.childId);

  root.innerHTML = `
    ${topBack('本の詳細', { right: `<button class="link-btn" id="edit-toggle">編集</button>` })}
    <main class="body">
      ${cover(b, 'lg')}
      <div class="center">
        <h2 class="book-title">${esc(b.title)}</h2>
        <p class="muted small">${esc([b.author, b.publisher].filter(Boolean).join(' ／ '))}${b.isbn ? `<br>ISBN ${esc(formatIsbn(b.isbn))}` : ''}</p>
      </div>

      <div class="fav-bar">
        ${ctx.children.map(c => `<button class="fav-btn ${favs.includes(c.id) ? 'on' : ''}" data-fav="${esc(c.id)}" style="--kid:${esc(c.color)}"
          aria-pressed="${favs.includes(c.id)}">${favs.includes(c.id) ? '♥' : '♡'} ${esc(c.name)}のお気に入り</button>`).join('')}
      </div>

      <form class="card stack" id="edit" hidden>
        <h3>本の情報を編集</h3>
        <label class="field">書名<input name="title" required value="${esc(b.title)}"></label>
        <label class="field">作者<input name="author" value="${esc(b.author)}"></label>
        <label class="field">出版社<input name="publisher" value="${esc(b.publisher)}"></label>
        <datalist id="series-list">${allSeries.map(s => `<option value="${esc(s.title)}">`).join('')}</datalist>
        <div class="two">
          <label class="field">シリーズ名<input name="series" list="series-list" value="${esc(series?.title || '')}"></label>
          <label class="field vol">巻<input name="volume" type="number" min="1" inputmode="numeric" value="${esc(b.volume || '')}"></label>
        </div>
        ${b.coverUrl ? `<label class="check-label"><input type="checkbox" name="hideCover"> 表紙の画像を表示しない（違う本の表紙が出るとき）</label>` : ''}
        <button class="btn" type="submit">保存</button>
      </form>

      <details class="card" id="lookup" ${b.isbn ? '' : 'open'}>
        <summary><h4 style="display:inline">${b.isbn ? '別の本に付け直す（図書館のデータで探す）' : '図書館のデータで本を探す'}</h4></summary>
        ${b.isbn ? '' : '<p class="muted small">この本はまだ特定できていません。正しい本を選ぶと、表紙や作者が付きます。</p>'}
        <form class="search-bar" id="lookup-form" style="margin-top:8px">
          <input class="input" name="q" value="${esc(b.title)}" autocomplete="off">
          <button class="btn sm" type="submit">検索</button>
        </form>
        <p class="muted small">見つからないときは、書名の一部やシリーズ名だけにして探してください。</p>
        <div id="lookup-results"></div>
      </details>

      <div class="card"><h4>シリーズ</h4>${series ? `<a class="link" href="#/series/${esc(series.id)}">${esc(series.title)}${b.volume ? `（${b.volume}巻）` : ''} ›</a>` : '<span class="muted">なし（「編集」から設定できます）</span>'}</div>

      <div class="card">
        <h4>${esc(ctx.child.name)}が借りた日</h4>
        ${mine.length ? mine.map(l => `<div class="loan-row">
            <input type="date" class="input" data-loan="${esc(l.id)}" value="${esc(l.borrowedAt || '')}" max="${today()}">
            <button class="link-btn danger" data-del="${esc(l.id)}">削除</button>
          </div>`).join('') : '<p class="muted">借りていません</p>'}
        <button class="link-btn" id="add-loan">＋ この子が借りた日を追加</button>
        ${others.length ? `<p class="muted small">${others.join('<br>')}</p>` : ''}
      </div>

      <button class="btn ghost" id="wish" ${wished ? 'disabled' : ''}>${wished ? '借りたい本に追加済み' : '＋ 借りたい本に追加'}</button>

      <button class="link-btn danger delete-book" id="delete-book">この本を本棚から削除</button>
      <p class="muted small center">間違えて登録したときに使います。家族全員の貸出記録も消えます。</p>
    </main>`;

  root.querySelector('#edit-toggle').addEventListener('click', () => {
    const form = root.querySelector('#edit');
    form.hidden = !form.hidden;
  });

  root.querySelector('#edit').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    b.title = String(f.get('title')).trim() || b.title;
    b.author = String(f.get('author') || '').trim();
    b.publisher = String(f.get('publisher') || '').trim();
    if (f.get('hideCover')) b.coverUrl = null;
    await lib.setBookSeries(b, String(f.get('series') || ''), f.get('volume'));
    toast('保存しました');
    ctx.refresh();
  });

  // 図書館のデータで探して、この本に付け直す。括弧の前・中・後ろの言葉でも同時に探す
  let found = [];
  const resultsEl = root.querySelector('#lookup-results');
  root.querySelector('#lookup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (!q) return;
    resultsEl.innerHTML = '<p class="muted">検索中…（10秒ほどかかることがあります）</p>';
    const words = [...new Set([q, ...searchParts(q)])].slice(0, 5);
    const lists = await Promise.all(words.map(w => searchTitle(w).catch(() => null)));
    if (lists.every(l => l === null)) {
      resultsEl.innerHTML = '<p class="alert">図書館のデータに接続できませんでした。少し待ってからもう一度お試しください。</p>';
      return;
    }
    // 検索した言葉に近い順に並べる（2文字ずつの組がどれだけ重なるか）
    const norm = s => String(s || '').normalize('NFKC').replace(/[\s・!?、。,.「」『』()〜~ー\-:]/g, '');
    const grams = s => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
    const qg = grams(norm(q));
    const near = c => { const g = grams(norm(c.title)); let hit = 0; g.forEach(x => qg.has(x) && hit++); return (2 * hit) / (g.size + qg.size || 1) + (c.isChildren ? 0.05 : 0); };
    const seen = new Set();
    found = lists.flat().filter(c => c && c.isbn && !seen.has(c.isbn) && seen.add(c.isbn))
      .sort((x, y) => near(y) - near(x)).slice(0, 20);
    resultsEl.innerHTML = found.length ? found.map((c, i) => `<div class="row">
        ${cover(c)}
        <div class="t"><b>${esc(c.title)}</b><span class="muted small">${esc([c.author, c.publisher, (c.pubdate || '').slice(0, 4)].filter(Boolean).join(' ／ '))}</span></div>
        <button class="btn sm" data-pickbook="${i}">これ</button>
      </div>`).join('') : '<p class="muted">見つかりませんでした。言葉を短くして探してみてください。</p>';
  });
  resultsEl.addEventListener('click', async e => {
    const pick = e.target.closest('[data-pickbook]');
    if (!pick) return;
    const c = found[pick.dataset.pickbook];
    const existing = await lib.bookByIsbn(c.isbn);
    if (existing && existing.id !== b.id) {
      // 同じ本がすでに本棚にあれば、そちらにまとめる（貸出記録は消えない）
      await lib.mergeBook(b.id, existing.id);
      toast('本棚にある同じ本にまとめました');
      ctx.go(`book/${existing.id}`);
      return;
    }
    await lib.updateBook({ ...b, isbn: c.isbn, title: c.title, author: c.author || b.author, publisher: c.publisher || b.publisher,
      pubdate: c.pubdate || b.pubdate, coverUrl: c.coverUrl || null });
    toast('本の情報を付け直しました');
    ctx.refresh();
  });

  root.addEventListener('change', async e => {
    const id = e.target.dataset.loan;
    if (!id) return;
    const loan = mine.find(l => l.id === id);
    loan.borrowedAt = e.target.value || null;
    await lib.updateLoan(loan);
    toast('借りた日を変更しました');
  });

  root.addEventListener('click', async e => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const on = await lib.toggleFavorite(fav.dataset.fav, b.id);
      const name = ctx.children.find(c => c.id === fav.dataset.fav)?.name || '';
      toast(on ? `${name}のお気に入りにしました。似た本を予約候補で提案します` : `${name}のお気に入りから外しました`);
      ctx.refresh();
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!confirm('この貸出記録を削除しますか？')) return;
      await lib.deleteLoan(del.dataset.del);
      toast('削除しました');
      // この子の記録がなくなったら本棚へ戻る
      if (mine.length <= 1) ctx.go('shelf'); else ctx.refresh();
      return;
    }
    if (e.target.id === 'delete-book') {
      const n = loans.length;
      if (!confirm(`「${b.title}」を本棚から削除しますか？${n ? `\n家族の貸出記録 ${n}件も消えます。` : ''}\n元に戻せません。`)) return;
      await lib.deleteBook(b.id);
      toast('本棚から削除しました');
      ctx.go('shelf');
      return;
    }
    if (e.target.id === 'add-loan') {
      await lib.addLoan(childId, b.id, today());
      toast('今日の日付で追加しました。日付は変更できます');
      ctx.refresh();
      return;
    }
    if (e.target.id === 'wish') {
      await lib.addWish(childId, b.id);
      toast('借りたい本に追加しました');
      ctx.refresh();
    }
  });
}
