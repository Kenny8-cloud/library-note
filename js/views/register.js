// S-04 登録の確認。再貸出の警告、シリーズと巻数の確認をして、まとめて登録する。
import * as lib from '../library.js';
import * as session from '../session.js';
import { esc, cover, formatDate, today, toast } from '../ui.js';
import { topBack } from '../app.js';

export default async function register(root, ctx) {
  const childId = ctx.childId;
  const items = session.items(childId);
  if (!items.length) {
    ctx.go('scan');
    return;
  }

  const allSeries = await lib.seriesList();
  const seriesById = new Map(allSeries.map(s => [s.id, s]));

  // 各行に、既存の本・過去の貸出・シリーズの初期値を用意する
  const rows = [];
  for (const item of items) {
    const row = { item, book: null, loans: [], seriesTitle: '', volume: '', candidate: null };
    if (item.isbn) row.book = await lib.bookByIsbn(item.isbn);
    if (row.book) {
      row.loans = (await lib.loansOf(childId, row.book.id)).sort((a, b) => (b.borrowedAt || '').localeCompare(a.borrowedAt || ''));
      const s = seriesById.get(row.book.seriesId);
      if (s) { row.seriesTitle = s.title; row.volume = row.book.volume || ''; }
    }
    const cand = item.info?.seriesCandidate;
    if (!row.seriesTitle && cand?.title) {
      // 登録済みのシリーズと同じ名前なら、そのまま使う。初めて見る名前は候補として出すだけにする
      // （国会図書館の「叢書名」は出版社のレーベル名のこともあるため）。手入力したシリーズ名はそのまま使う
      if (item.key.startsWith('manual:') || allSeries.some(s => s.title === cand.title)) {
        row.seriesTitle = cand.title;
        row.volume = cand.volume || '';
      } else {
        row.candidate = cand;
      }
    }
    rows.push(row);
  }

  const okCount = () => rows.filter(r => r.item.status === 'ok').length;

  root.innerHTML = `
    ${topBack(`登録の確認（${ctx.child.name}）`, { back: 'scan' })}
    <main class="body">
      <label class="field inline">借りた日<input type="date" id="date" value="${today()}" max="${today()}"></label>
      <datalist id="series-list">${allSeries.map(s => `<option value="${esc(s.title)}">`).join('')}</datalist>
      ${rows.map((r, i) => {
        const info = r.item.info || {};
        if (r.item.status !== 'ok') {
          return `<div class="card is-warn" data-i="${i}">
            <div class="row">${cover({})}<div class="t"><b>ISBN ${esc(r.item.isbn || '')}</b>
              <span class="badge warn">${r.item.status === 'error' ? '通信できませんでした' : '書誌データが見つかりません'}</span></div></div>
            <p class="small muted">この本は登録されません。書名で探すか、手入力で追加してください。</p>
            <div class="btns"><a class="btn ghost sm" href="#/search">書名で探す・手入力</a>
              <button class="btn ghost sm" data-drop="${i}">一覧から外す</button></div>
          </div>`;
        }
        const warn = r.loans.length ? `
          <div class="alert">⚠ ${r.loans.map(l => esc(formatDate(l.borrowedAt))).join('、')} に借りています。もう一度登録しますか？</div>
          <div class="btns"><span class="muted small">このまま登録する場合は何もしなくて大丈夫です</span>
            <button class="btn ghost sm" data-drop="${i}">一覧から外す</button></div>` : '';
        const hint = r.candidate ? `
          <p class="small">候補: ${esc(r.candidate.title)}${r.candidate.volume ? ` ${r.candidate.volume}巻` : ''}
            <button class="link-btn" data-use="${i}">このシリーズにする</button></p>` : '';
        return `<div class="card ${r.loans.length ? 'is-warn' : ''}" data-i="${i}">
          <div class="row">${cover(info)}<div class="t"><b>${esc(info.title)}</b><span class="muted small">${esc(info.author || '')}</span></div></div>
          <details>
            <summary class="small">シリーズ: <span data-label="${i}">${r.seriesTitle ? `${esc(r.seriesTitle)}${r.volume ? ` ${esc(r.volume)}巻` : ''}` : 'なし'}</span> <span class="link">設定</span></summary>
            <div class="series-edit">
              <input class="input" list="series-list" data-st="${i}" placeholder="シリーズ名（なければ空欄）" value="${esc(r.seriesTitle)}">
              <input class="input vol" type="number" min="1" inputmode="numeric" data-vol="${i}" placeholder="巻" value="${esc(r.volume)}">
            </div>
          </details>
          ${hint}${warn}
        </div>`;
      }).join('')}
      <p class="muted small">シリーズを設定しておくと、段階2で「次の巻」を予約候補に出せるようになります。</p>
    </main>
    <footer class="foot"><button class="btn" id="save" ${okCount() ? '' : 'disabled'}>登録する（${okCount()}冊）</button></footer>`;

  const label = i => {
    const r = rows[i];
    root.querySelector(`[data-label="${i}"]`).textContent = r.seriesTitle ? `${r.seriesTitle}${r.volume ? ` ${r.volume}巻` : ''}` : 'なし';
  };

  root.addEventListener('input', e => {
    const st = e.target.dataset.st, vol = e.target.dataset.vol;
    if (st != null) { rows[st].seriesTitle = e.target.value.trim(); label(st); }
    if (vol != null) { rows[vol].volume = e.target.value; label(vol); }
  });

  root.addEventListener('click', async e => {
    const use = e.target.closest('[data-use]');
    if (use) {
      const i = use.dataset.use, r = rows[i];
      r.seriesTitle = r.candidate.title;
      r.volume = r.candidate.volume || '';
      root.querySelector(`[data-st="${i}"]`).value = r.seriesTitle;
      root.querySelector(`[data-vol="${i}"]`).value = r.volume;
      label(i);
      use.closest('p').remove();
      return;
    }
    const drop = e.target.closest('[data-drop]');
    if (drop) {
      session.removeItem(childId, rows[drop.dataset.drop].item.key);
      ctx.refresh();
      return;
    }
    if (e.target.id === 'save') {
      e.target.disabled = true;
      const date = root.querySelector('#date').value || null;
      let n = 0;
      for (const r of rows) {
        if (r.item.status !== 'ok') continue;
        const book = r.book || await lib.ensureBook(r.item.info);
        const current = seriesById.get(book.seriesId)?.title || '';
        if (r.seriesTitle !== current || String(r.volume || '') !== String(book.volume || '')) {
          await lib.setBookSeries(book, r.seriesTitle, r.volume);
        }
        await lib.addLoan(childId, book.id, date);
        session.removeItem(childId, r.item.key);
        n++;
      }
      toast(`${n}冊登録しました`);
      ctx.go('shelf');
    }
  });
}
