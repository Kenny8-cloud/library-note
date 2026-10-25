// S-12 借りたい本リスト。子供ごとに並べ替え・削除・追加ができる。並び順はそのまま予約候補の順になる。
import * as lib from '../library.js';
import { esc, cover, kidChips, toast } from '../ui.js';
import { topBack } from '../app.js';

const SOURCE = { manual: '手動', author: '同じ作者', ai: 'AI', series: 'シリーズ' };

export default async function wishlist(root, ctx) {
  const childId = ctx.childId;
  const wishes = await lib.wishesOf(childId);
  const borrowed = new Set((await lib.historyOf(childId)).map(l => l.bookId));

  root.innerHTML = `
    ${topBack('借りたい本リスト', { back: 'reserve' })}
    <main class="body">
      <div class="kids">${kidChips(ctx.children, childId)}</div>
      ${wishes.length ? `<div class="card list">${wishes.map((w, i) => `
        <div class="row">
          <div class="updown">
            <button class="x" data-move="${esc(w.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">▲</button>
            <button class="x" data-move="${esc(w.id)}" data-dir="1" ${i === wishes.length - 1 ? 'disabled' : ''} aria-label="下へ">▼</button>
          </div>
          <a href="#/book/${esc(w.book.id)}">${cover(w.book)}</a>
          <div class="t"><b>${esc(w.book.title)}</b>
            <span><span class="badge">${SOURCE[w.source] || '手動'}</span>
              ${w.status === 'reserved' ? '<span class="badge ok">予約済み</span>' : ''}
              ${borrowed.has(w.book.id) ? '<span class="badge warn">借りたことあり</span>' : ''}</span></div>
          <button class="x" data-del="${esc(w.id)}" aria-label="リストから外す">✕</button>
        </div>`).join('')}</div>
        <p class="muted small">上にある本ほど、予約候補の上に並びます。借りて登録すると、リストから自動で消えます。</p>`
      : `<p class="empty">${esc(ctx.child.name)}の借りたい本はまだありません。</p>`}
    </main>
    <footer class="foot two-btn">
      <a class="btn ghost" href="#/scan/wish">◉ スキャンで追加</a>
      <a class="btn ghost" href="#/search/wish">🔍 書名で追加</a>
    </footer>`;

  root.addEventListener('click', async e => {
    const move = e.target.closest('[data-move]');
    if (move) {
      await lib.moveWish(childId, move.dataset.move, Number(move.dataset.dir));
      ctx.refresh();
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const w = wishes.find(x => x.id === del.dataset.del);
      await lib.removeWish(w.id);
      toast(`「${w.book.title}」をリストから外しました`);
      ctx.refresh();
    }
  });
}
