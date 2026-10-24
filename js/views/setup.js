// S-01 初回セットアップ。段階1では子供の登録だけを行う（Googleログインと復元は段階3）。
import * as lib from '../library.js';
import { esc, KID_COLORS, toast, gradeLabel } from '../ui.js';
import { childForm, readChildForm } from './child-form.js';

export default async function setup(root, ctx) {
  const drafts = [];

  const draw = () => {
    root.innerHTML = `
      <header class="top"><h1 class="title">はじめに</h1></header>
      <main class="body">
        <section class="hero">
          <div class="hero-mark">📚</div>
          <h2>図書館で借りた本を記録しましょう</h2>
          <p class="muted">まず、本を借りるお子さんを登録してください。あとから設定で追加・変更できます。</p>
        </section>
        ${drafts.length ? `<ul class="plain-list card">${drafts.map(d => `
          <li><span class="dot" style="background:${esc(d.color)}"></span>${esc(d.name)}
            <span class="muted">${esc(gradeLabel(d.birthMonth))}</span></li>`).join('')}</ul>` : ''}
        <form class="card stack" id="kid-form">
          <h3>${drafts.length ? 'もう1人追加' : 'お子さんを登録'}</h3>
          ${childForm({ color: KID_COLORS[drafts.length % KID_COLORS.length] })}
          <button class="btn ghost" type="submit">＋ 追加する</button>
        </form>
        <p class="muted small">データはこのスマホの中だけに保存されます。iPhoneの場合は、Safariの共有メニューから「ホーム画面に追加」して使ってください。</p>
      </main>
      <footer class="foot"><button class="btn" id="start" ${drafts.length ? '' : 'disabled'}>はじめる</button></footer>`;

    root.querySelector('#kid-form').addEventListener('submit', e => {
      e.preventDefault();
      const child = readChildForm(e.target);
      if (!child) return;
      drafts.push(child);
      draw();
    });
    root.querySelector('#start').addEventListener('click', async () => {
      for (const d of drafts) await lib.saveChild(d);
      toast(`${drafts.length}人を登録しました`);
      ctx.go('home');
    });
  };
  draw();
}
