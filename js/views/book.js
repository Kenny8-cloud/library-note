// S-07 本の詳細。書誌情報の編集、貸出日の修正・削除、借りたい本への追加。
import * as lib from '../library.js';
import { format as formatIsbn } from '../isbn.js';
import { esc, cover, formatDate, today, toast } from '../ui.js';
import { topBack } from '../app.js';

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

  root.innerHTML = `
    ${topBack('本の詳細', { right: `<button class="link-btn" id="edit-toggle">編集</button>` })}
    <main class="body">
      ${cover(b, 'lg')}
      <div class="center">
        <h2 class="book-title">${esc(b.title)}</h2>
        <p class="muted small">${esc([b.author, b.publisher].filter(Boolean).join(' ／ '))}${b.isbn ? `<br>ISBN ${esc(formatIsbn(b.isbn))}` : ''}</p>
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

  root.addEventListener('change', async e => {
    const id = e.target.dataset.loan;
    if (!id) return;
    const loan = mine.find(l => l.id === id);
    loan.borrowedAt = e.target.value || null;
    await lib.updateLoan(loan);
    toast('借りた日を変更しました');
  });

  root.addEventListener('click', async e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!confirm('この貸出記録を削除しますか？')) return;
      await lib.deleteLoan(del.dataset.del);
      toast('削除しました');
      // この子の記録がなくなったら本棚へ戻る
      if (mine.length <= 1) ctx.go('shelf'); else ctx.refresh();
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
