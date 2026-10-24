// 子供の名前・色・生まれ年月の入力欄（初回セットアップと設定で共通）
import { esc, KID_COLORS, toast } from '../ui.js';

export function childForm(child = {}) {
  const color = child.color || KID_COLORS[0];
  return `
    <label class="field">名前<input name="name" required maxlength="20" value="${esc(child.name || '')}" placeholder="例: はると"></label>
    <label class="field">生まれた年月<input name="birthMonth" type="month" value="${esc(child.birthMonth || '')}"></label>
    <fieldset class="field colors"><legend>表示色</legend>
      ${KID_COLORS.map(c => `<label class="swatch" style="--c:${c}">
        <input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span></span></label>`).join('')}
    </fieldset>`;
}

export function readChildForm(form) {
  const f = new FormData(form);
  const name = String(f.get('name') || '').trim();
  if (!name) {
    toast('名前を入力してください');
    return null;
  }
  return { name, birthMonth: String(f.get('birthMonth') || ''), color: String(f.get('color') || KID_COLORS[0]) };
}
