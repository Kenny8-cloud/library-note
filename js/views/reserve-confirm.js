// S-11 予約の確定。選んだ本を子供ごとに並べ、書名をまとめてコピーできる。「予約済みにする」で記録する。
import * as lib from '../library.js';
import { esc, toast } from '../ui.js';
import { topBack } from '../app.js';
import { SELECTION_KEY } from './reserve.js';

export default async function reserveConfirm(root, ctx) {
  let keys = [];
  try { keys = JSON.parse(sessionStorage.getItem(SELECTION_KEY)) || []; } catch { /* 空のまま */ }
  const plan = await lib.reservationPlan();
  const byKey = new Map(plan.flatMap(p => [...p.series, ...p.pending]).map(it => [it.key, it]));
  const picked = keys.map(k => byKey.get(k)).filter(Boolean);
  if (!picked.length) { ctx.go('reserve'); return; }

  const groups = plan.map(p => ({ child: p.child, items: picked.filter(it => it.childId === p.child.id) })).filter(g => g.items.length);
  // 兄弟で同じ本は1回だけ書き出す（図書館では1冊の予約で済む）
  const seen = new Set();
  const text = groups.map(g => {
    const titles = g.items.filter(it => !seen.has(it.book.id) && seen.add(it.book.id)).map(it => it.book.title);
    return titles.length ? `【${g.child.name}】\n${titles.join('\n')}` : '';
  }).filter(Boolean).join('\n\n');
  const uniqueCount = seen.size;

  root.innerHTML = `
    ${topBack(`予約の確定（${uniqueCount}冊）`, { back: 'reserve' })}
    <main class="body">
      ${groups.map(g => `<h3 class="sec"><span class="dot" style="background:${esc(g.child.color)}"></span>${esc(g.child.name)} ${g.items.length}冊</h3>
        <div class="card list">${g.items.map(it => `<div class="item small">${esc(it.book.title)}${it.book.isbn ? `<span class="muted"> ISBN ${esc(it.book.isbn)}</span>` : ''}</div>`).join('')}</div>`).join('')}
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
