// S-03 スキャン。登録モード（#/scan）と「借りたことある？」モード（#/scan/check）。
import * as lib from '../library.js';
import * as session from '../session.js';
import * as scanner from '../scanner.js';
import { lookupIsbn } from '../biblio.js';
import { esc, cover, formatDate, toast } from '../ui.js';
import { topKids, tabs } from '../app.js';

// 「借りたことある？」の結果は画面を離れたら消してよいので、メモリにだけ置く
const checkResults = [];

export default async function scan(root, ctx, [mode]) {
  // 借りたい本リストからの「スキャンで追加」は、借りたことある？モードと同じ画面で追加ボタンを使う
  const isWish = mode === 'wish';
  const isCheck = mode === 'check' || isWish;
  const childId = ctx.childId;

  root.innerHTML = `
    ${topKids()}
    <main class="body">
      ${isWish ? `<div class="wish-head"><a class="back-link" href="#/wishlist">‹ 借りたい本リスト</a><b>スキャンして借りたい本に追加</b></div>` : `
      <div class="seg">
        <a href="#/scan" class="${isCheck ? '' : 'on'}">登録</a>
        <a href="#/scan/check" class="${isCheck ? 'on' : ''}">借りたことある？</a>
      </div>`}
      <div class="camera">
        <video muted playsinline></video>
        <div class="guide"></div>
        <p class="camera-msg">${isCheck ? 'かざすだけで調べます（登録はしません）' : '裏表紙の上の段のバーコードを枠に合わせてください'}</p>
        <button class="btn sm camera-start" hidden>カメラを起動</button>
      </div>
      ${isCheck ? `<div id="results"></div>` : `
        <h3 class="sub-h">スキャンした本（${esc(ctx.child.name)}）</h3>
        <div id="list"></div>`}
      <a class="link small" href="#/search${isWish ? '/wish' : ''}">${isWish ? '書名で探して追加' : 'バーコードがない本・ISBNを入力'} ›</a>
    </main>
    ${isCheck ? '' : `<footer class="foot above-tabs"><button class="btn" id="next">登録へ</button></footer>`}
    ${tabs('scan')}`;

  const video = root.querySelector('video');
  const msg = root.querySelector('.camera-msg');
  const startBtn = root.querySelector('.camera-start');

  // ---- 登録モード ----
  async function drawList() {
    const list = root.querySelector('#list');
    if (!list) return;
    const items = session.items(childId);
    const rows = [];
    for (const item of items) {
      let badge = '';
      if (item.status === 'loading') badge = `<span class="badge">確認中…</span>`;
      else if (item.status === 'notfound') badge = `<span class="badge warn">書誌データが見つかりません</span>`;
      else if (item.status === 'error') badge = `<span class="badge warn">通信できませんでした</span>`;
      else {
        const book = item.isbn ? await lib.bookByIsbn(item.isbn) : null;
        const loans = book ? await lib.loansOf(childId, book.id) : [];
        badge = loans.length
          ? `<span class="badge warn">⚠ ${esc(formatDate(loans.sort((a, b) => (b.borrowedAt || '').localeCompare(a.borrowedAt || ''))[0].borrowedAt))} に借りています</span>`
          : `<span class="muted small">${esc(item.info?.author || '')}</span>`;
      }
      const title = item.info?.title || (item.isbn ? `ISBN ${item.isbn}` : '');
      rows.push(`<div class="row">
        ${cover(item.info || {})}
        <div class="t"><b>${esc(title)}</b>${badge}</div>
        <button class="x" data-remove="${esc(item.key)}" aria-label="一覧から外す">✕</button>
      </div>`);
    }
    list.innerHTML = rows.join('') || `<p class="empty small">まだありません。続けて何冊でもスキャンできます。</p>`;
    const ready = items.filter(i => i.status !== 'loading').length;
    const next = root.querySelector('#next');
    next.textContent = `登録へ（${items.length}冊）`;
    next.disabled = !items.length || ready !== items.length;
  }

  async function fetchInfo(isbn) {
    const local = await lib.bookByIsbn(isbn);
    if (local) return { status: 'ok', info: local };
    try {
      const info = await lookupIsbn(isbn);
      return info ? { status: 'ok', info } : { status: 'notfound', info: null };
    } catch {
      return { status: 'error', info: null };
    }
  }

  async function onRegisterCode(isbn) {
    if (!session.add(childId, { key: isbn, isbn, status: 'loading' })) {
      toast('この本はすでに一覧にあります');
      return;
    }
    drawList();
    session.update(childId, isbn, await fetchInfo(isbn));
    drawList();
  }

  // ---- 借りたことある？モード ----
  function drawResults() {
    const el = root.querySelector('#results');
    if (!el) return;
    el.innerHTML = checkResults.filter(r => r.childId === childId).map(r => {
      const title = r.info?.title || `ISBN ${r.isbn}`;
      let body;
      if (r.status === 'loading') body = `<div class="alert">確認中…</div>`;
      else if (r.mine.length) {
        body = `<div class="alert big-alert">⚠ ${esc(ctx.child.name)}は ${r.mine.map(d => esc(formatDate(d))).join('、')} に借りています</div>`;
      } else {
        body = `<div class="alert ok big-alert">✓ まだ借りていません</div>
          ${r.info ? `<button class="btn ghost sm" data-wish="${esc(r.isbn)}" ${r.wished ? 'disabled' : ''}>${r.wished ? '借りたい本に追加済み' : '＋ 借りたい本に追加'}</button>` : ''}`;
      }
      const others = r.others.length ? `<p class="muted small">${r.others.map(o => `${esc(o.name)}も借りています（${esc(formatDate(o.date))}）`).join('<br>')}</p>` : '';
      return `<div class="card check ${r.mine.length ? 'is-warn' : ''}">
        <div class="row">${cover(r.info || {})}<div class="t"><b>${esc(title)}</b><span class="muted small">${esc(r.info?.author || '')}</span></div></div>
        ${body}${others}
      </div>`;
    }).join('') || `<p class="empty small">バーコードをかざすと、ここに結果が出ます。</p>`;
  }

  async function onCheckCode(isbn) {
    const prev = checkResults.findIndex(r => r.isbn === isbn && r.childId === childId);
    if (prev >= 0) checkResults.splice(prev, 1);
    const r = { isbn, childId, status: 'loading', info: null, mine: [], others: [], wished: false };
    checkResults.unshift(r);
    drawResults();

    const book = await lib.bookByIsbn(isbn);
    if (book) {
      r.info = book;
      const loans = await lib.loansOfBook(book.id);
      r.mine = loans.filter(l => l.childId === childId).map(l => l.borrowedAt).sort().reverse();
      for (const c of ctx.children) {
        if (c.id === childId) continue;
        const theirs = loans.filter(l => l.childId === c.id).map(l => l.borrowedAt).sort().reverse();
        if (theirs.length) r.others.push({ name: c.name, date: theirs[0] });
      }
      r.wished = await lib.isWished(childId, book.id);
    }
    r.status = 'done';
    drawResults();
    if (!book) {
      const { info } = await fetchInfo(isbn);
      r.info = info;
      drawResults();
    }
  }

  root.addEventListener('click', async e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      session.removeItem(childId, rm.dataset.remove);
      drawList();
    }
    const wish = e.target.closest('[data-wish]');
    if (wish) {
      const r = checkResults.find(x => x.isbn === wish.dataset.wish && x.childId === childId);
      const book = await lib.ensureBook(r.info);
      await lib.addWish(childId, book.id);
      r.wished = true;
      toast('借りたい本に追加しました');
      drawResults();
    }
    if (e.target.id === 'next') ctx.go('register');
  });

  async function startCamera() {
    startBtn.hidden = true;
    try {
      await scanner.start(video, isCheck ? onCheckCode : onRegisterCode);
    } catch (err) {
      msg.textContent = scanner.explainError(err);
      startBtn.hidden = false;
    }
  }
  startBtn.addEventListener('click', startCamera);

  if (isCheck) drawResults(); else drawList();
  startCamera();
  return () => scanner.stop();
}
