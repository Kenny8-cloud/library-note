// S-15 設定。段階1では子供の管理と、ファイルへの手動バックアップを扱う。
import * as lib from '../library.js';
import * as db from '../db.js';
import { esc, KID_COLORS, toast, gradeLabel, today, APP_VERSION } from '../ui.js';
import { topBack } from '../app.js';
import { childForm, readChildForm } from './child-form.js';

export default async function settings(root, ctx) {
  const children = ctx.children;
  const reserve = await lib.reserveSettings();

  root.innerHTML = `
    ${topBack('設定', { back: 'home' })}
    <main class="body">
      <h3 class="sub-h">子供</h3>
      <div class="card list">
        ${children.map(c => `
          <details class="item-details">
            <summary><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}
              <span class="muted small">${esc(gradeLabel(c.birthMonth))}</span><span class="link small">編集</span></summary>
            <form class="stack" data-child="${esc(c.id)}">
              ${childForm(c)}
              <div class="btns"><button class="btn sm" type="submit">保存</button>
                <button class="link-btn danger" type="button" data-delete="${esc(c.id)}">この子を削除</button></div>
            </form>
          </details>`).join('')}
        <details class="item-details">
          <summary><span class="link">＋ 子供を追加</span></summary>
          <form class="stack" data-child="">
            ${childForm({ color: KID_COLORS[children.length % KID_COLORS.length] })}
            <button class="btn sm" type="submit">追加</button>
          </form>
        </details>
      </div>

      <h3 class="sub-h">予約</h3>
      <form class="card stack" id="reserve-settings">
        <div class="two">
          <label class="field">冊数の目安（家族全体）<input name="targetCount" type="number" min="1" max="200" inputmode="numeric" value="${esc(reserve.targetCount)}"></label>
          <label class="field">上限<input name="maxCount" type="number" min="1" max="200" inputmode="numeric" value="${esc(reserve.maxCount)}"></label>
        </div>
        <button class="btn sm" type="submit">保存</button>
      </form>

      <h3 class="sub-h">データ</h3>
      <div class="card list">
        <a class="list-btn" href="#/import">過去の履歴を取り込む（CSV）</a>
        <button class="list-btn" id="export">ファイルに書き出す（バックアップ）</button>
        <label class="list-btn">ファイルから読み込む（復元）<input type="file" id="import" accept="application/json,.json" hidden></label>
      </div>
      <p class="muted small">Googleドライブへの自動バックアップは段階3で追加します。それまでは、ときどきファイルに書き出しておくと安心です。</p>
      <p class="muted small center">図書館ノート 版 ${esc(APP_VERSION)}</p>
    </main>`;

  root.addEventListener('submit', async e => {
    if (e.target.id === 'reserve-settings') {
      e.preventDefault();
      const target = Number(e.target.targetCount.value) || 15;
      const max = Math.max(target, Number(e.target.maxCount.value) || 40);
      await lib.saveSetting('targetCount', target);
      await lib.saveSetting('maxCount', max);
      toast('保存しました');
      ctx.refresh();
      return;
    }
    const form = e.target.closest('[data-child]');
    if (!form) return;
    e.preventDefault();
    const values = readChildForm(form);
    if (!values) return;
    const id = form.dataset.child;
    const existing = children.find(c => c.id === id);
    await lib.saveChild(existing ? { ...existing, ...values } : values);
    toast(existing ? '保存しました' : `${values.name}を追加しました`);
    ctx.refresh();
  });

  root.addEventListener('click', async e => {
    const del = e.target.closest('[data-delete]');
    if (del) {
      const c = children.find(x => x.id === del.dataset.delete);
      if (!confirm(`${c.name}を削除しますか？\n${c.name}の貸出履歴もすべて消えます。`)) return;
      if (!confirm(`本当に削除しますか？ 元に戻せません。`)) return;
      await lib.deleteChild(c.id);
      toast('削除しました');
      ctx.refresh();
      return;
    }
    if (e.target.id === 'export') {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `図書館アプリ-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
  });

  root.querySelector('#import').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirm(`${data.exportedAt ? new Date(data.exportedAt).toLocaleString('ja-JP') + ' の' : ''}バックアップを読み込みます。\n今のデータは上書きされます。よろしいですか？`)) return;
      await db.importAll(data);
      toast('読み込みました');
      ctx.go('home');
    } catch (err) {
      toast(err.message || '読み込めませんでした');
    } finally {
      e.target.value = '';
    }
  });
}
