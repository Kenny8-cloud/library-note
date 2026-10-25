// 読書のきろく。1年ごとに、子供ごとの借りた冊数・月ごとの冊数・よく読んだシリーズ・お気に入りを振り返る。
import * as lib from '../library.js';
import { esc, cover } from '../ui.js';
import { topBack } from '../app.js';

// 1月はまだ前の年を振り返りたい時期なので、前の年を最初に見せる
export function defaultYear() {
  const now = new Date();
  return now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
}

function childYear(child, history, year, favs, seriesTitles) {
  const all = history.filter(l => l.kids.some(k => k.id === child.id));
  const loans = all.filter(l => (l.borrowedAt || '').startsWith(`${year}-`));
  if (!loans.length) return `<section class="review-kid card"><h3><span class="dot" style="background:${esc(child.color)}"></span>${esc(child.name)}</h3>
    <p class="muted">${year}年の記録はありません。</p></section>`;

  const books = new Set(loans.map(l => l.bookId));
  const months = Array(12).fill(0);
  loans.forEach(l => months[Number(l.borrowedAt.slice(5, 7)) - 1]++);
  const top = Math.max(...months);
  const bestMonth = months.indexOf(top) + 1;

  // よく読んだシリーズ（この年に借りた冊数の多い順）
  const bySeries = new Map();
  for (const l of loans) {
    if (!l.book.seriesId) continue;
    if (!bySeries.has(l.book.seriesId)) bySeries.set(l.book.seriesId, new Set());
    bySeries.get(l.book.seriesId).add(l.bookId);
  }
  const topSeries = [...bySeries].filter(([, set]) => set.size >= 2).sort((a, b) => b[1].size - a[1].size).slice(0, 3);
  // 今年の月平均は、今月までの月数で割る
  const now = new Date();
  const monthsSoFar = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  // この年に読み始めたシリーズ（そのシリーズを初めて借りたのがこの年）
  const firstOf = new Map();
  for (const l of all) {
    const s = l.book.seriesId;
    if (s && l.borrowedAt && (!firstOf.has(s) || l.borrowedAt < firstOf.get(s))) firstOf.set(s, l.borrowedAt);
  }
  const started = [...firstOf].filter(([, d]) => d.startsWith(`${year}-`)).length;

  // 何度も借りた本（同じ年に2回以上）
  const times = new Map();
  loans.forEach(l => times.set(l.bookId, (times.get(l.bookId) || 0) + 1));
  const again = [...times].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([id, n]) => ({ book: loans.find(l => l.bookId === id).book, n }));

  // お気に入り: この年に借りた本か、この年にお気に入りにした本
  const favBooks = favs.filter(f => f.childId === child.id && (books.has(f.bookId) || (f.at || '').startsWith(`${year}-`)))
    .map(f => history.find(l => l.bookId === f.bookId)?.book).filter(Boolean);

  const first = [...loans].sort((a, b) => a.borrowedAt.localeCompare(b.borrowedAt))[0];

  return `<section class="review-kid card">
    <h3><span class="dot" style="background:${esc(child.color)}"></span>${esc(child.name)}</h3>
    <div class="review-num"><b>${books.size.toLocaleString()}</b><small>冊</small>
      <span class="muted small">借りた回数 ${loans.length}回 ・ 月平均 ${(books.size / monthsSoFar).toFixed(1)}冊</span></div>

    <h4 class="sub-h">月ごとの冊数</h4>
    <div class="month-bars" role="img" aria-label="月ごとの冊数">
      ${months.map((n, i) => `<div class="mb ${n === top && n ? 'best' : ''}"><span class="v">${n || ''}</span>
        <i style="height:${top ? Math.round(n / top * 100) : 0}%"></i><span class="m">${i + 1}</span></div>`).join('')}
    </div>
    <p class="small">いちばん読んだのは <b>${bestMonth}月</b>（${top}冊）${started ? ` ・ 新しく読み始めたシリーズ <b>${started}</b>` : ''}</p>

    ${favBooks.length ? `<h4 class="sub-h">♥ お気に入り</h4>
      <div class="review-covers">${favBooks.slice(0, 12).map(b => `<a href="#/book/${esc(b.id)}" title="${esc(b.title)}">${cover(b)}</a>`).join('')}</div>` : ''}

    ${topSeries.length ? `<h4 class="sub-h">よく読んだシリーズ</h4>
      <ol class="review-rank">${topSeries.map(([id, set]) => `<li><a href="#/series/${esc(id)}">${esc(seriesTitles.get(id) || '')}</a><span>${set.size}冊</span></li>`).join('')}</ol>` : ''}

    ${again.length ? `<h4 class="sub-h">何度も借りた本</h4>
      ${again.map(a => `<a class="row" href="#/book/${esc(a.book.id)}">${cover(a.book)}<div class="t"><b>${esc(a.book.title)}</b><span class="muted small">${a.n}回</span></div></a>`).join('')}` : ''}

    <p class="muted small">${year}年の最初の1冊: <a class="link" href="#/book/${esc(first.book.id)}">${esc(first.book.title)}</a>（${Number(first.borrowedAt.slice(5, 7))}月${Number(first.borrowedAt.slice(8, 10)) || ''}${first.borrowedAt.length > 7 ? '日' : ''}）</p>
  </section>`;
}

export default async function review(root, ctx, [yearParam]) {
  const history = await lib.familyHistory();
  const favs = await lib.allFavorites();
  const seriesTitles = new Map((await lib.seriesList()).map(s => [s.id, s.title]));
  const years = [...new Set(history.map(l => Number((l.borrowedAt || '').slice(0, 4))).filter(Boolean))].sort((a, b) => b - a);
  const year = Number(yearParam) || (years.includes(defaultYear()) ? defaultYear() : years[0] || defaultYear());

  const inYear = history.filter(l => (l.borrowedAt || '').startsWith(`${year}-`));
  const familyBooks = new Set(inYear.map(l => l.bookId)).size;
  const prevBooks = new Set(history.filter(l => (l.borrowedAt || '').startsWith(`${year - 1}-`)).map(l => l.bookId)).size;
  // 家族の本棚に並べたときの高さ（児童書1冊の厚さを約1.5cmとして）
  const meters = (familyBooks * 0.015).toFixed(1);

  root.innerHTML = `
    ${topBack('読書のきろく', { back: 'home' })}
    <main class="body">
      <div class="chips">${years.map(y => `<a class="chip ${y === year ? 'on' : ''}" href="#/review/${y}">${y}年</a>`).join('')}</div>
      <section class="review-hero">
        <div class="eyebrow">${year} READING RECORD</div>
        <h2>${year}年の読書</h2>
        <div class="review-num big"><b>${familyBooks.toLocaleString()}</b><small>冊</small></div>
        <p>家族で借りた本${prevBooks ? `（前の年は ${prevBooks.toLocaleString()}冊${familyBooks > prevBooks ? `、${(familyBooks - prevBooks).toLocaleString()}冊ふえました` : ''}）` : ''}</p>
        ${familyBooks ? `<p class="small">積み上げると約 ${meters}m の高さです</p>` : ''}
      </section>
      ${ctx.children.map(c => childYear(c, history, year, favs, seriesTitles)).join('')}
      <p class="muted small center">本の詳細で「♥ お気に入り」を押すと、ここに並びます。</p>
    </main>`;
}
