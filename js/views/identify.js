// まとめて本を特定する。ISBN がない本（過去のメモの書名だけで登録した本など）を1冊ずつ図書館のデータで探し、
// 候補から選んでもらう。選ぶと ISBN が付き、表紙・作者・シリーズが分かるようになる。
// 自動では付け直さない（メモの書名は略されていることが多く、違う本の表紙が付くのを避けるため）
import * as lib from '../library.js';
import * as db from '../db.js';
import { searchTitle } from '../biblio.js';
import { searchParts } from '../ocr.js';
import { esc, cover, formatDate, toast } from '../ui.js';
import { topBack } from '../app.js';

const SKIP_KEY = 'identifySkipped';

const norm = s => String(s || '').normalize('NFKC').replace(/[\s・!?、。,.「」『』()（）〜~ー\-:]/g, '');
const grams = s => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
function similarity(a, b) {
  const ga = grams(norm(a)), gb = grams(norm(b));
  let hit = 0;
  ga.forEach(x => gb.has(x) && hit++);
  return (2 * hit) / (ga.size + gb.size || 1);
}

// 書名と、その一部（括弧の前など）で探す。図書館のデータは一度にたくさん問い合わせると断られるので、
// 1冊につき2回まで、1回ずつ順に問い合わせる
async function findCandidates(q) {
  const words = [...new Set([q, ...searchParts(q)])].slice(0, 2);
  const lists = [];
  for (const w of words) lists.push(await searchTitle(w).catch(e => (e.busy ? 'busy' : null)));
  if (lists.includes('busy')) return 'busy';
  if (lists.every(l => l === null)) return null;
  const seen = new Set();
  // 外国語版（韓国語・中国語など）は除く。かなのない書名は、記録の書名にもかながないときだけ残す
  const kana = s => /[ぁ-んァ-ヶ]/.test(s);
  const japanese = c => !/[가-힯]/.test(c.title) && (kana(c.title) || !kana(q));
  return lists.flat().filter(c => c && c !== 'busy' && c.isbn && japanese(c) && !seen.has(c.isbn) && seen.add(c.isbn))
    .map(c => ({ ...c, score: similarity(q, c.title) + (c.isChildren ? 0.05 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export default async function identify(root, ctx) {
  const history = await lib.familyHistory();
  const skipped = new Set(await db.getSetting(SKIP_KEY, []));
  const seen = new Set();
  const all = history.filter(l => !l.book.isbn && !seen.has(l.book.id) && seen.add(l.book.id));
  const queue = all.filter(l => !skipped.has(l.book.id));

  // 次の本の候補を先に探しておき、選んだらすぐ次が出るようにする
  const pending = new Map();
  const candidatesOf = (id, q) => {
    const key = `${id}|${q}`;
    if (!pending.has(key)) pending.set(key, findCandidates(q));
    return pending.get(key);
  };

  let index = 0;
  let found = 0;

  root.innerHTML = `
    ${topBack('本を特定する', { back: 'shelf' })}
    <main class="body" id="identify"></main>`;
  const main = root.querySelector('#identify');

  async function show() {
    const item = queue[index];
    if (!item) {
      main.innerHTML = `<div class="card center stack">
        <h3>${found ? `${found}冊の本を特定しました` : '特定する本はもうありません'}</h3>
        <p class="muted small">${queue.length ? 'スキップした本は、また今度ここで探せます。' : ''}</p>
        ${skipped.size ? `<button class="btn ghost" id="reset-skip">スキップした本（${skipped.size}冊）をもう一度探す</button>` : ''}
        <a class="btn" href="#/shelf">本棚へ</a>
      </div>`;
      return;
    }
    const b = item.book;
    const q = item.q || b.title;
    main.innerHTML = `
      <p class="muted small">残り ${queue.length - index}冊（ISBN がない本 ${all.length}冊）</p>
      <div class="card identify-card">
        <span class="muted small">記録されている書名</span>
        <b class="identify-title">${esc(b.title)}</b>
        <span class="muted small">${item.kids.map(k => esc(k.name)).join('・')} ・ ${esc(formatDate(item.borrowedAt))}</span>
      </div>
      <form class="search-bar" id="q-form">
        <input class="input" name="q" value="${esc(q)}" autocomplete="off">
        <button class="btn sm" type="submit">検索</button>
      </form>
      <div id="cands"><p class="muted">図書館のデータで探しています…（10秒ほどかかることがあります）</p></div>
      <div class="btns identify-skip">
        <button class="btn ghost" id="skip">見つからない・あとで</button>
      </div>`;

    const list = await candidatesOf(b.id, q);
    // この本の候補が出てから、次の1冊を先に探しておく（同時に問い合わせすぎないように）
    const next = queue[index + 1];
    if (next && list !== 'busy') candidatesOf(next.book.id, next.book.title);
    if (queue[index] !== item || (item.q || b.title) !== q) return;   // 待っている間に次へ進んだ
    const el = main.querySelector('#cands');
    if (list === 'busy') {
      pending.delete(`${b.id}|${q}`);
      el.innerHTML = '<p class="alert">図書館のデータが混み合っています。1〜2分待ってから「検索」を押してください。</p>';
      return;
    }
    if (list === null) {
      pending.delete(`${b.id}|${q}`);
      el.innerHTML = '<p class="alert">図書館のデータに接続できませんでした。少し待ってから「検索」を押してください。</p>';
      return;
    }
    el.innerHTML = list.length ? `<p class="muted small">正しい本を選んでください</p>${list.map((c, i) => `<div class="row identify-row">
        ${cover(c, 'md')}
        <div class="t"><b>${esc(c.title)}</b><span class="muted small">${esc([c.author, c.publisher, (c.pubdate || '').slice(0, 4)].filter(Boolean).join(' ／ '))}</span></div>
        <button class="btn sm" data-pick="${i}">これ</button>
      </div>`).join('')}`
      : '<p class="muted">見つかりませんでした。書名を短くしたり、シリーズ名だけにしたりして「検索」してください。</p>';
    el.dataset.for = b.id;
    item.list = list;
  }

  main.addEventListener('submit', e => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (!q) return;
    queue[index].q = q;
    show();
  });

  main.addEventListener('click', async e => {
    const item = queue[index];
    const pick = e.target.closest('[data-pick]');
    if (pick && item?.list) {
      pick.disabled = true;
      const c = item.list[pick.dataset.pick];
      const b = item.book;
      const existing = await lib.bookByIsbn(c.isbn);
      if (existing && existing.id !== b.id) {
        // 同じ本がすでに本棚にあれば、そちらにまとめる（貸出記録は消えない）
        await lib.mergeBook(b.id, existing.id);
      } else {
        await lib.updateBook({ ...b, isbn: c.isbn, title: c.title, author: c.author || b.author, publisher: c.publisher || b.publisher,
          pubdate: c.pubdate || b.pubdate, coverUrl: c.coverUrl || null });
      }
      found++;
      toast(`「${c.title}」にしました`);
      index++;
      show();
      return;
    }
    if (e.target.id === 'skip' && item) {
      skipped.add(item.book.id);
      await db.setSetting(SKIP_KEY, [...skipped]);
      index++;
      show();
      return;
    }
    if (e.target.id === 'reset-skip') {
      await db.setSetting(SKIP_KEY, []);
      ctx.refresh();
    }
  });

  show();
}
