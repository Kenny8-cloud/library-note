// 画面描画の小さな道具。テンプレート文字列に埋め込む値は必ず esc を通す。

// 設定画面に表示する版。公開するたびに更新する（スマホが最新版か確かめるため）
export const APP_VERSION = '3.8（2026-10-25）';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const KID_COLORS = ['#3f7fd0', '#d0577f', '#3a9a6a', '#d08a2a', '#8a5ad0', '#4aa6b5'];

// ISBN-13（978で始まるもの）を ISBN-10 にする。Amazon の画像アドレスは ISBN-10 で作るため
function isbn10(isbn) {
  const s = String(isbn || '');
  if (s.length === 10) return s;
  if (!/^978\d{10}$/.test(s)) return null;
  const body = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(body[i]) * (10 - i);
  const c = (11 - (sum % 11)) % 11;
  return body + (c === 10 ? 'X' : String(c));
}

function amazonCover(isbn) {
  const i10 = isbn10(isbn);
  return i10 ? `https://images-na.ssl-images-amazon.com/images/P/${i10}.09.LZZZZZZZ.jpg` : '';
}

// 表紙が読み込めなかったときは次の候補へ。Google Books の「image not available」
// （ブラウザでは 128x186、それ以外では 128x170 で返る）と Amazon の「画像なし」（1x1）は表紙なしとして扱う
window.__coverLoad = img => {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (w < 20 || (w === 128 && (h === 170 || h === 186))) window.__coverFail(img);
};
window.__coverFail = img => {
  const next = img.dataset.next;
  if (next && img.src !== next) {
    img.dataset.next = '';
    img.src = next;
  } else {
    img.remove();
  }
};

export function cover(book, size = '') {
  const initial = esc((book.title || '？').slice(0, 6));
  // Amazon は表紙がないと 1x1 の画像を返すので確実に見分けられる。Google の「image not available」は
  // 端末によって大きさが違い見分けにくいため、Amazon を先に試し、なければ Google（または書誌データの表紙）にする
  const amazon = amazonCover(book.isbn);
  const first = amazon || book.coverUrl;
  const next = amazon && book.coverUrl ? book.coverUrl : '';
  const img = first
    ? `<img src="${esc(first)}" data-next="${esc(next)}" alt="" loading="lazy"
        onerror="__coverFail(this)" onload="__coverLoad(this)">`
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
