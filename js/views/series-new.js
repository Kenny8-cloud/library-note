// シリーズを作る。キーワードで本棚の本を探し、選んだ本をまとめて1つのシリーズにする。
import * as lib from '../library.js';
import { esc, cover, toast } from '../ui.js';
import { topBack } from '../app.js';

export default async function seriesNew(root, ctx) {
  const books = (await lib.allBooks()).filter(b => b.title);
  const seriesById = new Map((await lib.seriesList()).map(s => [s.id, s]));
  let matches = [];

  root.innerHTML = `
    ${topBack('シリーズを作る', { back: 'shelf/series' })}
    <main class="body">
      <form class="card stack" id="form">
        <label class="field">シリーズ名<input name="title" required placeholder="例: かいけつゾロリ"></label>
        <label class="field">書名に含まれる言葉<input name="keyword" placeholder="空欄ならシリーズ名で探します"></label>
        <button class="btn ghost" type="button" id="find">本棚から探す</button>
      </form>
      <div id="found"></div>
    </main>
    <footer class="foot"><button class="btn" id="save" disabled>シリーズを作る</button></footer>`;

  const form = root.querySelector('#form');
  const found = root.querySelector('#found');
  const save = root.querySelector('#save');

  const find = () => {
    const keyword = (form.keyword.value || form.title.value).trim();
    if (!keyword) { toast('シリーズ名を入力してください'); return; }
    const norm = s => s.replace(/[\s　・!！?？、。]/g, '');
    const k = norm(keyword);
    matches = lib.sortVolumes(books.filter(b => norm(b.title).includes(k)));
    found.innerHTML = matches.length ? `
      <p class="muted small">${matches.length}冊見つかりました。シリーズに入れる本を選んでください。</p>
      ${matches.map((b, i) => {
        const other = b.seriesId && seriesById.get(b.seriesId);
        return `<label class="row">
          <input type="checkbox" data-i="${i}" ${other ? '' : 'checked'}>
          ${cover(b)}
          <div class="t"><b>${esc(b.title)}</b><span class="muted small">${esc(b.author || '')}${other ? ` ・ 今は「${esc(other.title)}」` : ''}</span></div>
        </label>`;
      }).join('')}`
      : `<p class="empty">「${esc(keyword)}」を含む本は本棚にありません。<br>シリーズを作ってから、図書館のデータで巻を探して追加することもできます。</p>`;
    save.disabled = false;
  };

  root.querySelector('#find').addEventListener('click', find);
  form.addEventListener('submit', e => { e.preventDefault(); find(); });

  save.addEventListener('click', async () => {
    const title = form.title.value.trim();
    if (!title) { toast('シリーズ名を入力してください'); return; }
    if (await lib.findSeriesByTitle(title)) { toast('同じ名前のシリーズがすでにあります'); return; }
    save.disabled = true;
    const series = await lib.ensureSeries(title);
    const picked = [...found.querySelectorAll('input[type=checkbox]:checked')].map(c => matches[c.dataset.i]);
    for (const b of picked) {
      b.seriesId = series.id;
      b.volume = null;
      await lib.updateBook(b);
    }
    toast(`「${title}」を作りました（${picked.length}冊）`);
    ctx.go(`series/${series.id}`);
  });
}
