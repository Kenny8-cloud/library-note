// S-11 予約の確定。選んだ本を子供ごとに並べ、書名をまとめてコピーできる。「予約済みにする」で記録する。
import * as lib from '../library.js';
import { esc, toast } from '../ui.js';
import { topBack } from '../app.js';
import { SELECTION_KEY } from './reserve.js';

export default async function reserveConfirm(root, ctx) {
  let keys = [];
  try { keys = JSON.parse(sessionStorage.getItem(SELECTION_KEY)) || []; } catch { /* 空のまま */ }
  const plan = await lib.reservationPlan();
  const byKey = new Map(plan.flatMap(p => [...p.releases, ...p.series, ...p.pending]).map(it => [it.key, it]));
  const picked = keys.map(k => byKey.get(k)).filter(Boolean);
  if (!picked.length) { ctx.go('reserve'); return; }

  // 予約はまとめて行うので、子供別に分けず1つの一覧にする。兄弟で同じ本は1回だけ書き出す（図書館では1冊の予約で済む）
  const seen = new Set();
  const books = picked.filter(it => !seen.has(it.book.id) && seen.add(it.book.id)).map(it => it.book);
  const text = books.map(b => b.title).join('\n');
  const uniqueCount = books.length;

  root.innerHTML = `
    ${topBack(`予約の確定（${uniqueCount}冊）`, { back: 'reserve' })}
    <main class="body">
      <div class="card list">${books.map(b => `<div class="item small">${esc(b.title)}${b.isbn ? `<span class="muted"> ISBN ${esc(b.isbn)}</span>` : ''}</div>`).join('')}</div>
      <button class="btn ghost" id="copy">📋 書名をまとめてコピー</button>
      <p class="muted small">図書館のサイトで書名を検索して予約するときに使います。予約が終わったら、下のボタンを押してください。チェックしなかった本は次回まで候補に残ります。</p>
    </main>
    <footer class="foot"><button class="btn" id="done">予約済みにする</button></footer>`;

  root.querySelector('#copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('書名をコピーしました');
    } catch {
      // クリップボードが使えないときは、選択して手でコピーしてもらう
      const ta = document.createElement('textarea');
      ta.className = 'input';
      ta.rows = 8;
      ta.value = text;
      root.querySelector('#copy').after(ta);
      ta.select();
      toast('表示した文字を長押ししてコピーしてください');
    }
  });

  root.querySelector('#done').addEventListener('click', async e => {
    e.target.disabled = true;
    await lib.confirmReservation(picked);
    try { sessionStorage.removeItem(SELECTION_KEY); } catch { /* 無視 */ }
    toast(`${uniqueCount}冊を予約済みにしました`);
    ctx.go('reserve');
  });
}
