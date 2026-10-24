// 画面描画の小さな道具。テンプレート文字列に埋め込む値は必ず esc を通す。

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const KID_COLORS = ['#3f7fd0', '#d0577f', '#3a9a6a', '#d08a2a', '#8a5ad0', '#4aa6b5'];

export function cover(book, size = '') {
  const initial = esc((book.title || '？').slice(0, 6));
  const img = book.coverUrl
    ? `<img src="${esc(book.coverUrl)}" alt="" loading="lazy" onerror="this.remove()" onload="if(this.naturalWidth<20)this.remove()">`
    : '';
  return `<div class="cover ${size}"><span>${initial}</span>${img}</div>`;
}

export function kidChips(children, currentId) {
  return children.map(c => `
    <button class="kid ${c.id === currentId ? 'on' : ''}" data-kid="${esc(c.id)}"
      style="--kid:${esc(c.color)}">${esc(c.name)}</button>`).join('');
}

let toastTimer;
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function formatDate(iso) {
  if (!iso) return '日付なし';
  const [y, m, d] = iso.split('-');
  return d ? `${y}/${m}/${d}` : `${y}/${m}`;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 4月始まりの学年。未就学は「年少」などではなく「◯歳」と表す
export function gradeLabel(birthMonth) {
  if (!birthMonth) return '';
  const [by, bm] = birthMonth.split('-').map(Number);
  const now = new Date();
  const fiscalYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  // 1〜3月生まれ（早生まれ）は6歳になった年の4月、それ以外は翌年の4月に入学する（4月1日生まれは月単位では区別しない）
  const entryYear = bm <= 3 ? by + 6 : by + 7;
  const grade = fiscalYear - entryYear + 1;
  if (grade >= 1 && grade <= 6) return `小学${grade}年`;
  if (grade >= 7 && grade <= 9) return `中学${grade - 6}年`;
  if (grade > 9) return '';
  const age = now.getFullYear() - by - (now.getMonth() + 1 < bm ? 1 : 0);
  return `${age}歳`;
}
