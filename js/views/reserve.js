// S-10 予約候補。段階2で作る。今は追加済みの「借りたい本」の冊数だけ表示する。
import * as db from '../db.js';
import { esc } from '../ui.js';
import { topKids, tabs } from '../app.js';

export default async function reserve(root, ctx) {
  const wishes = await db.all('wishlist');
  const counts = ctx.children.map(c => `${esc(c.name)} ${wishes.filter(w => w.childId === c.id).length}冊`).join('、');

  root.innerHTML = `
    ${topKids({ title: '予約候補（家族全体）' })}
    <main class="body">
      <div class="card">
        <h4>準備中</h4>
        <p>予約候補の画面は、段階2（シリーズ・借りたい本リスト・予約）で追加します。</p>
        <p class="muted small">「借りたことある？」や本の詳細から追加した借りたい本: ${counts}</p>
      </div>
    </main>
    ${tabs('reserve')}`;
}
