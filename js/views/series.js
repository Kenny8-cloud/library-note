// S-09 シリーズ詳細。巻の一覧（借りた／次の巻／未読）、状態の変更、巻数の付け直し、図書館データからの巻の追加。
import * as lib from '../library.js';
import { lookupIsbn, searchTitle } from '../biblio.js';
import { esc, cover, formatDate, toast } from '../ui.js';
import { topBack } from '../app.js';

const STATUS = [['reading', '読み進め中'], ['done', '完了'], ['paused', '中断']];

export default async function seriesView(root, ctx, [seriesId]) {
  const series = await lib.getSeries(seriesId);
  if (!series) { ctx.go('shelf/series'); return; }
  const childId = ctx.childId;
  const books = await lib.seriesBooks(seriesId);
  const progress = await lib.getProgress(childId, seriesId);
  const status = progress?.status || 'reading';

  const loanDates = new Map();
  for (const b of books) {
    const loans = await lib.loansOf(childId, b.id);
    if (loans.length) loanDates.set(b.id, loans.map(l => l.borrowedAt).sort().reverse()[0]);
  }
  const next = books.find(b => !loanDates.has(b.id));
  let results = [];

  root.innerHTML = `
    ${topBack(series.title, { back: 'shelf/series' })}
    <main class="body">
      <label class="field inline">${esc(ctx.child.name)}の状態
        <select class="input" id="status">${STATUS.map(([v, l]) => `<option value="${v}" ${v === status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <p class="muted small">「中断」「完了」にすると、予約候補に出なくなります。</p>

      <div class="card list vols">
        ${books.length ? books.map(b => {
          const d = loanDates.get(b.id);
          const badge = d !== undefined ? `<span class="badge ok">✓ ${esc(formatDate(d))}</span>`
            : b === next ? `<span class="badge acc">次の巻</span>` : `<span class="muted small">未読</span>`;
          return `<div class="row">
            <input class="input vol-in" type="number" min="1" inputmode="numeric" data-vol="${esc(b.id)}" value="${esc(b.volume || '')}" placeholder="巻" aria-label="巻数">
            <a class="t" href="#/book/${esc(b.id)}"><b>${esc(b.title)}</b>${badge}</a>
            <button class="x" data-out="${esc(b.id)}" aria-label="シリーズから外す">✕</button>
          </div>`;
        }).join('') : '<p class="muted">まだ本がありません。下の「図書館のデータで探す」から追加してください。</p>'}
      </div>
      <p class="muted small">巻の数字を変えると並び順が変わります。左の数字が空欄の本は、出版順で後ろに並びます。新しく刷り直された本は出版日が新しくなるため、自動でふった番号がずれることがあります。そのときは数字を直してください。</p>
      <button class="btn ghost" id="number">出版された順に巻数をふる</button>

      <h3 class="sub-h">図書館のデータで巻を探す</h3>
      <form class="search-bar" id="search">
        <input class="input" type="search" name="q" value="${esc(series.title)}">
        <button class="btn sm" type="submit">検索</button>
      </form>
      <p class="muted small">見つからないときは「ゾロリ はなよめ」のように、言葉をスペースで区切ってください。</p>
      <div id="results"></div>

      <details class="card">
        <summary class="small">シリーズ名の変更・削除</summary>
        <form class="stack" id="rename" style="margin-top:8px">
          <input class="input" name="title" value="${esc(series.title)}" required>
          <div class="btns"><button class="btn sm" type="submit">名前を変える</button>
            <button class="link-btn danger" type="button" id="delete">このシリーズを削除</button></div>
          <p class="muted small">削除しても本や貸出記録は消えません。</p>
        </form>
      </details>
    </main>`;

  root.querySelector('#status').addEventListener('change', async e => {
    await lib.setProgress(childId, seriesId, e.target.value);
    toast(`${STATUS.find(s => s[0] === e.target.value)[1]}にしました`);
  });

  root.addEventListener('change', async e => {
    const id = e.target.dataset.vol;
    if (!id) return;
    const b = books.find(x => x.id === id);
    b.volume = e.target.value ? Number(e.target.value) : null;
    await lib.updateBook(b);
    ctx.refresh();
  });

  root.addEventListener('click', async e => {
    const out = e.target.closest('[data-out]');
    if (out) {
      const b = books.find(x => x.id === out.dataset.out);
      b.seriesId = null;
      b.volume = null;
      await lib.updateBook(b);
      toast(`「${b.title}」をシリーズから外しました`);
      ctx.refresh();
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      add.disabled = true;
      const info = results[add.dataset.add];
      const b = await lib.ensureBook(info);
      b.seriesId = seriesId;
      b.pubdate = b.pubdate || info.pubdate || '';
      await lib.updateBook(b);
      add.textContent = '追加済み';
      toast(`「${b.title}」を追加しました`);
      return;
    }
    if (e.target.id === 'number') {
      e.target.disabled = true;
      e.target.textContent = '出版日を調べています…';
      // 出版日が分からない本は書誌データで調べる
      for (const b of books) {
        if (b.pubdate || !b.isbn) continue;
        try {
          const info = await lookupIsbn(b.isbn);
          if (info?.pubdate) { b.pubdate = info.pubdate; await lib.updateBook(b); }
        } catch { /* 調べられなかった本は後ろに並ぶ */ }
      }
      const ordered = [...books].sort((a, b) => (a.pubdate || '9999').localeCompare(b.pubdate || '9999'));
      for (let i = 0; i < ordered.length; i++) { ordered[i].volume = i + 1; await lib.updateBook(ordered[i]); }
      toast('出版順に巻数をふりました');
      ctx.refresh();
      return;
    }
    if (e.target.id === 'delete') {
      if (!confirm(`「${series.title}」を削除しますか？\n本や貸出記録は消えません。`)) return;
      await lib.deleteSeries(seriesId);
      toast('削除しました');
      ctx.go('shelf/series');
    }
  });

  root.querySelector('#search').addEventListener('submit', async e => {
    e.preventDefault();
    const el = root.querySelector('#results');
    el.innerHTML = '<p class="muted">検索中…（10秒ほどかかることがあります）</p>';
    const inSeries = new Set(books.map(b => b.isbn).filter(Boolean));
    try {
      results = (await searchTitle(e.target.q.value.trim())).filter(r => r.isbn)
        .sort((a, b) => (a.pubdate || '').localeCompare(b.pubdate || ''));
    } catch {
      el.innerHTML = '<p class="alert">書誌データに接続できませんでした。</p>';
      return;
    }
    el.innerHTML = results.length ? results.map((r, i) => `<div class="row">
        ${cover(r)}
        <div class="t"><b>${esc(r.title)}</b><span class="muted small">${esc([r.author, (r.pubdate || '').slice(0, 7)].filter(Boolean).join(' ／ '))}</span></div>
        ${inSeries.has(r.isbn) ? '<span class="muted small">追加済み</span>' : `<button class="btn sm" data-add="${i}">追加</button>`}
      </div>`).join('') + `<p class="muted small">追加したら「出版された順に巻数をふる」を押すと並びが整います。</p>`
      : '<p class="muted">見つかりませんでした。</p>';
  });

  root.querySelector('#rename').addEventListener('submit', async e => {
    e.preventDefault();
    const title = e.target.title.value.trim();
    const dup = await lib.findSeriesByTitle(title);
    if (dup && dup.id !== seriesId) { toast('同じ名前のシリーズがすでにあります'); return; }
    await lib.saveSeries({ ...series, title });
    toast('名前を変えました');
    ctx.refresh();
  });
}
