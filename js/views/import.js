// S-16 CSVの取り込み。Claude が書誌データと照合済みの CSV を読み込むので、ここでは通信せずに登録する。
// 列: child,kind,title,author,publisher,isbn,series,volume,borrowed_at,image_file
// child は子供の名前、または「全員」（登録済みの子供全員に登録する）
// kind は loan（借りた本。省略時）か wish（借りたい本）
import * as lib from '../library.js';
import { parseCsv } from '../csv.js';
import { toIsbn13 } from '../isbn.js';
import { esc, toast } from '../ui.js';
import { topBack } from '../app.js';

const ALL = '全員';

function googleCover(isbn) {
  return `https://books.google.com/books/content?vid=ISBN${isbn}&printsec=frontcover&img=1&zoom=1`;
}

// 「2021-01」「2021/1/16」「2021-01-16 07:31」などを YYYY-MM-DD か YYYY-MM にそろえる
function normalizeDate(s) {
  const m = String(s || '').match(/(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
  if (!m) return null;
  const mm = m[2].padStart(2, '0');
  return m[3] ? `${m[1]}-${mm}-${m[3].padStart(2, '0')}` : `${m[1]}-${mm}`;
}

export default async function importView(root, ctx) {
  root.innerHTML = `
    ${topBack('過去の履歴を取り込む', { back: 'settings' })}
    <main class="body">
      <div class="card stack">
        <p>Claude が作った履歴のCSVファイルを選んでください。</p>
        <label class="btn ghost">CSVファイルを選ぶ<input type="file" id="file" accept=".csv,text/csv" hidden></label>
      </div>
      <div id="preview"></div>
    </main>`;

  const preview = root.querySelector('#preview');
  let plan = null;

  root.querySelector('#file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (!rows.length || !('title' in rows[0])) {
      preview.innerHTML = `<p class="alert">このファイルは読み込めません（title 列が見つかりません）。</p>`;
      return;
    }

    const norm = s => String(s || '').normalize('NFKC').replace(/[\s　]/g, '');
    const byName = new Map(ctx.children.map(c => [norm(c.name), c]));
    const namesOf = r => ((r.child || ALL) === ALL ? [ALL] : r.child.split(/[、・/]/).map(s => s.trim()).filter(Boolean));
    // CSVの名前とアプリの名前が違うとき（ひらがな・愛称など）は、どの子のことか選んでもらう
    const unknown = [...new Set(rows.flatMap(namesOf))].filter(n => n !== ALL && !byName.has(norm(n)));
    const nameMap = new Map();

    const build = () => {
      const entries = [];
      for (const r of rows) {
        if (!r.title) continue;
        const kids = namesOf(r).flatMap(n => n === ALL ? ctx.children
          : byName.get(norm(n)) ? [byName.get(norm(n))]
          : nameMap.get(n) ? [ctx.children.find(c => c.id === nameMap.get(n))] : []).filter(Boolean);
        if (kids.length) entries.push({ row: r, kids: [...new Map(kids.map(k => [k.id, k])).values()] });
      }
      return entries;
    };

    const draw = () => {
      const entries = build();
      plan = entries;
      const titles = new Set(entries.map(x => toIsbn13(x.row.isbn) || x.row.title));
      const noIsbn = entries.filter(x => !toIsbn13(x.row.isbn)).length;
      const wishes = entries.filter(x => x.row.kind === 'wish').length;
      const count = name => rows.filter(r => namesOf(r).includes(name)).length;
      preview.innerHTML = `
        ${unknown.length ? `<div class="card stack is-warn">
          <h4>CSVの名前がアプリの名前と違います。どのお子さんの記録か選んでください</h4>
          ${unknown.map(n => `<label class="field inline">「${esc(n)}」（${count(n)}件）
            <select class="input" data-map="${esc(n)}">
              <option value="">取り込まない</option>
              ${ctx.children.map(c => `<option value="${esc(c.id)}" ${nameMap.get(n) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select></label>`).join('')}
        </div>` : ''}
        <div class="card">
          <h4>読み込んだ内容</h4>
          <p><b>${entries.length - wishes}</b>件の貸出記録${wishes ? `、<b>${wishes}</b>件の借りたい本` : ''}（本 <b>${titles.size}</b>冊）</p>
          <p class="muted small">登録先: ${ctx.children.map(c => esc(c.name)).join('、')}${noIsbn ? `<br>ISBNのない本 ${noIsbn}件は、書名だけで登録します（あとで本の詳細から直せます）` : ''}</p>
          <p class="muted small">すでに登録されている記録は、二重に登録しません。借りたことのある本は、借りたい本に入れません。</p>
        </div>
        <button class="btn" id="run" ${entries.length ? '' : 'disabled'}>取り込む</button>
        <p class="muted small" id="progress"></p>`;
    };
    preview.onchange = ev => {
      const n = ev.target.dataset.map;
      if (n == null) return;
      if (ev.target.value) nameMap.set(n, ev.target.value); else nameMap.delete(n);
      draw();
    };
    draw();
  });

  preview.addEventListener('click', async e => {
    if (e.target.id !== 'run' || !plan) return;
    e.target.disabled = true;
    const progress = root.querySelector('#progress');
    let added = 0, wished = 0, skipped = 0;
    // ISBN のない本は書名と作者で同じ本を探す（取り込みを2回しても本が増えないように）
    const key = (title, author) => `${title}|${author || ''}`;
    const byTitle = new Map((await lib.allBooks()).filter(b => !b.isbn).map(b => [key(b.title, b.author), b]));

    for (let i = 0; i < plan.length; i++) {
      const { row, kids } = plan[i];
      const isbn = toIsbn13(row.isbn);
      let book = isbn ? await lib.bookByIsbn(isbn) : byTitle.get(key(row.title, row.author));
      if (!book) {
        book = await lib.ensureBook({
          isbn, title: row.title, author: row.author, publisher: row.publisher,
          coverUrl: isbn ? googleCover(isbn) : null,
        });
        if (!isbn) byTitle.set(key(book.title, book.author), book);
      }
      // シリーズ未設定の本にだけシリーズを付ける（アプリで設定したものは上書きしない）
      if (row.series && !book.seriesId) await lib.setBookSeries(book, row.series, row.volume);
      const date = normalizeDate(row.borrowed_at);
      for (const kid of kids) {
        const existing = await lib.loansOf(kid.id, book.id);
        if (row.kind === 'wish') {
          if (existing.length || !(await lib.addWish(kid.id, book.id))) { skipped++; continue; }
          wished++;
          continue;
        }
        // 日付のない記録は、その本を一度でも借りていれば足さない
        if (existing.some(l => (l.borrowedAt || null) === date) || (!date && existing.length)) { skipped++; continue; }
        await lib.addLoan(kid.id, book.id, date);
        added++;
      }
      if (i % 20 === 0) progress.textContent = `取り込み中… ${i + 1} / ${plan.length}`;
    }
    toast(`${added}件の貸出${wished ? `と${wished}件の借りたい本` : ''}を取り込みました${skipped ? `（重複 ${skipped}件はスキップ）` : ''}`);
    ctx.go('shelf');
  });
}
