// レシートから登録。図書館のレシートを撮影 → 文字認識で書名を取り出す → 国立国会図書館サーチで本を特定 → 確認して登録。
// 家族でまとめて借りるので、本ごとに誰の分かを選ぶ（初期値は全員）。
import * as lib from '../library.js';
import { preprocess, recognize, parseReceipt } from '../ocr.js';
import { searchTitle } from '../biblio.js';
import { esc, cover, today, toast } from '../ui.js';
import { topBack } from '../app.js';

// 文字の並びの近さ（2文字ずつの組の一致率）。認識の1文字違いに強い
function similarity(a, b) {
  const norm = s => String(s || '').normalize('NFKC').replace(/[\s・!！?？、。,.「」『』()（）〜~ー\-:：]/g, '');
  const grams = s => { const g = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const gx = grams(x), gy = grams(y);
  let hit = 0;
  for (const [k, n] of gx) hit += Math.min(n, gy.get(k) || 0);
  const total = Math.max(1, x.length - 1) + Math.max(1, y.length - 1);
  // 書名が長い本（副題つき）に負けないよう、短い方がまるごと含まれていれば高めにする
  const contained = y.startsWith(x) || x.startsWith(y) ? 0.15 : 0;
  return Math.min(1, (2 * hit) / total + contained);
}

export default async function receipt(root, ctx) {
  const kids = ctx.children;
  let rows = [];   // { title, candidates, pick, kids:Set, include, status }
  let img = null;

  root.innerHTML = `
    ${topBack('レシートから登録', { back: 'scan' })}
    <main class="body">
      <div class="card stack">
        <label class="btn">📷 レシートを撮影する<input type="file" id="photo" accept="image/*" capture="environment" hidden></label>
        <label class="btn ghost">🖼 写真から選ぶ<input type="file" id="pick" accept="image/*" hidden></label>
        <p class="muted small">明るい場所で、レシートの書名の部分が画面いっぱいになるように撮ってください。</p>
      </div>
      <div id="crop" hidden class="card stack">
        <h4>書名が並んでいる範囲を選ぶ</h4>
        <div class="crop-box"><img id="preview" alt="レシート"><div class="crop-mask top"></div><div class="crop-mask bottom"></div></div>
        <label class="field">上のはし<input type="range" id="top" min="0" max="90" value="0"></label>
        <label class="field">下のはし<input type="range" id="bottom" min="10" max="100" value="100"></label>
        <button class="btn" id="read">この範囲を読み取る</button>
        <p class="muted small" id="ocr-status"></p>
      </div>
      <details class="card">
        <summary class="small">文字を貼り付けて登録する（iPhoneの「テキスト認識表示」でコピーした文字など）</summary>
        <textarea class="input" id="paste" rows="6" placeholder="1 まほうでなんでやねん&#10;2 もりのがっしょうだん"></textarea>
        <button class="btn ghost sm" id="use-paste">この文字から書名を探す</button>
      </details>
      <div id="result"></div>
    </main>
    <footer class="foot" id="foot" hidden>
      <label class="field inline">借りた日<input type="date" id="date" value="${today()}" max="${today()}"></label>
      <button class="btn" id="save">登録する</button>
    </footer>`;

  const $ = s => root.querySelector(s);
  const status = $('#ocr-status');

  const updateMask = () => {
    let t = Number($('#top').value), b = Number($('#bottom').value);
    if (b - t < 10) { b = Math.min(100, t + 10); $('#bottom').value = b; }
    root.querySelector('.crop-mask.top').style.height = `${t}%`;
    root.querySelector('.crop-mask.bottom').style.height = `${100 - b}%`;
  };
  $('#top').addEventListener('input', updateMask);
  $('#bottom').addEventListener('input', updateMask);

  const onFile = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    img = new Image();
    img.src = url;
    try { await img.decode(); } catch { toast('写真を読み込めませんでした'); return; }
    $('#preview').src = url;
    $('#crop').hidden = false;
    // レシートの上の方は日付や見出し、下の方は広告なので、最初は真ん中あたりを選んでおく
    $('#top').value = 20; $('#bottom').value = 70;
    updateMask();
    $('#crop').scrollIntoView({ behavior: 'smooth' });
  };
  $('#photo').addEventListener('change', onFile);
  $('#pick').addEventListener('change', onFile);

  $('#read').addEventListener('click', async () => {
    if (!img) return;
    const btn = $('#read');
    btn.disabled = true;
    const t = Number($('#top').value) / 100, b = Number($('#bottom').value) / 100;
    const h = img.naturalHeight;
    try {
      status.textContent = '画像を整えています…';
      await new Promise(r => setTimeout(r, 30));
      const canvas = preprocess(img, [0, Math.round(h * t), img.naturalWidth, Math.round(h * (b - t))]);
      const text = await recognize(canvas, (s, p) => {
        status.textContent = s === 'recognizing text' ? `読み取り中… ${Math.round((p || 0) * 100)}%`
          : '読み取りの準備をしています…（初回は1分ほどかかります）';
      });
      handleText(text);
    } catch (err) {
      status.textContent = err.message || '読み取りに失敗しました';
    } finally {
      btn.disabled = false;
    }
  });

  $('#use-paste').addEventListener('click', () => {
    const text = $('#paste').value;
    // 貼り付けた文字は番号がないこともあるので、番号がなければ1行1冊とみなす
    const parsed = parseReceipt(text);
    if (!parsed.titles.length) {
      parsed.titles = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length >= 2 && !/^\d+\s*[(（]/.test(s) && !/^\d{6,}/.test(s))
        .map((title, i) => ({ no: i + 1, title }));
    }
    handleText(null, parsed);
  });

  async function handleText(text, parsed = parseReceipt(text)) {
    if (!parsed.titles.length) {
      status.textContent = '書名を見つけられませんでした。範囲を変えるか、撮り直してください。';
      return;
    }
    status.textContent = `${parsed.titles.length}冊の書名を読み取りました。図書館のデータで本を探しています…`;
    if (parsed.due) {
      const d = new Date(parsed.due); d.setDate(d.getDate() - 14);
      const guess = d.toISOString().slice(0, 10);
      if (guess <= today()) $('#date').value = guess;
    }
    rows = parsed.titles.map(t => ({ title: t.title, candidates: null, pick: -1, kids: new Set(kids.map(k => k.id)), include: true }));
    draw();
    // 図書館サーチに負担をかけないよう、2冊ずつ探す
    const queue = rows.map((_, i) => i);
    await Promise.all([0, 1].map(async () => { while (queue.length) await find(queue.shift()); }));
    status.textContent = '内容を確かめて「登録する」を押してください。';
  }

  async function find(i) {
    const r = rows[i];
    r.candidates = null;
    draw();
    try {
      const q = r.title.replace(/[^぀-ヿ一-鿿A-Za-z0-9０-９ー]/g, '').trim();
      let list = await searchTitle(q);
      // 認識の1文字違いで見つからないときは、前半・後半に分けて探し直す（どちらかは正しく読めていることが多い）
      if (!list.some(c => c.isbn) && q.length >= 6) {
        const n = Math.max(3, Math.ceil(q.length * 0.5));
        const parts = [...new Set([q.slice(0, n), q.slice(-n)])];
        for (const p of parts) list = list.concat(await searchTitle(p).catch(() => []));
      }
      const seen = new Set();
      list = list.filter(c => c.isbn && !seen.has(c.isbn) && seen.add(c.isbn))
        .map(c => ({ ...c, score: similarity(r.title, c.title) + (c.isChildren ? 0.05 : 0) }))
        .sort((a, b) => b.score - a.score).slice(0, 5);
      r.candidates = list;
      r.pick = list.length && list[0].score >= 0.4 ? 0 : -1;
    } catch {
      r.candidates = [];
      r.pick = -1;
      r.error = true;
    }
    draw();
  }

  function draw() {
    const el = $('#result');
    $('#foot').hidden = !rows.length;
    el.innerHTML = rows.map((r, i) => {
      const c = r.pick >= 0 ? r.candidates[r.pick] : null;
      const opts = r.candidates === null ? '<p class="muted small">探しています…</p>'
        : `<select class="input" data-pick="${i}">
            ${r.candidates.map((x, j) => `<option value="${j}" ${j === r.pick ? 'selected' : ''}>${esc(x.title)}（${esc(x.author || x.publisher || '')}）</option>`).join('')}
            <option value="-1" ${r.pick === -1 ? 'selected' : ''}>${r.candidates.length ? 'どれでもない（書名だけで登録）' : '見つかりません（書名だけで登録）'}</option>
          </select>`;
      return `<div class="card receipt-row ${r.include ? '' : 'off'}">
        <div class="row">
          <input type="checkbox" data-inc="${i}" ${r.include ? 'checked' : ''} aria-label="登録する">
          ${cover(c || { title: r.title })}
          <div class="t"><input class="input" data-title="${i}" value="${esc(r.title)}" aria-label="読み取った書名">
            <button class="link-btn small" data-find="${i}">この書名で探し直す</button></div>
        </div>
        ${opts}
        <div class="kid-pick">${kids.map(k => `<button class="kid ${r.kids.has(k.id) ? 'on' : ''}" style="--kid:${esc(k.color)}" data-kidpick="${i}:${esc(k.id)}">${esc(k.name)}</button>`).join('')}</div>
      </div>`;
    }).join('');
    const n = rows.filter(r => r.include && r.kids.size).length;
    $('#save').textContent = `登録する（${n}冊）`;
    $('#save').disabled = !n || rows.some(r => r.include && r.candidates === null);
  }

  $('#result').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.pick != null) { rows[t.dataset.pick].pick = Number(t.value); draw(); }
    if (t.dataset.inc != null) { rows[t.dataset.inc].include = t.checked; draw(); }
    if (t.dataset.title != null) rows[t.dataset.title].title = t.value.trim();
  });

  $('#result').addEventListener('click', e => {
    const kp = e.target.closest('[data-kidpick]');
    if (kp) {
      const [i, id] = kp.dataset.kidpick.split(':');
      const set = rows[i].kids;
      if (set.has(id)) set.delete(id); else set.add(id);
      draw();
      return;
    }
    const f = e.target.closest('[data-find]');
    if (f) find(Number(f.dataset.find));
  });

  $('#save').addEventListener('click', async e => {
    e.target.disabled = true;
    const date = $('#date').value || today();
    let added = 0, skipped = 0;
    for (const r of rows) {
      if (!r.include || !r.kids.size) continue;
      const c = r.pick >= 0 ? r.candidates[r.pick] : null;
      const book = await lib.ensureBook(c || { title: r.title });
      for (const kidId of r.kids) {
        if ((await lib.loansOf(kidId, book.id)).some(l => l.borrowedAt === date)) { skipped++; continue; }
        await lib.addLoan(kidId, book.id, date);
        added++;
      }
    }
    toast(`${added}件を登録しました${skipped ? `（登録済み ${skipped}件）` : ''}`);
    ctx.go('shelf');
  });
}
