// スキャン中の本の一覧（登録前の一時データ）。子供ごとに持ち、画面を再読み込みしても消えないよう sessionStorage に置く。
const KEY = 'scan-session';

function load() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

let data = load();

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch { /* 保存できなくても画面上の一覧は使える */ }
}

export function items(childId) {
  return data[childId] || [];
}

// item: { key, isbn?, status: 'loading' | 'ok' | 'notfound' | 'error', info? }
export function add(childId, item) {
  const list = items(childId);
  if (list.some(i => i.key === item.key)) return false;
  data[childId] = [item, ...list];
  save();
  return true;
}

export function update(childId, key, patch) {
  data[childId] = items(childId).map(i => (i.key === key ? { ...i, ...patch } : i));
  save();
}

export function removeItem(childId, key) {
  data[childId] = items(childId).filter(i => i.key !== key);
  save();
}

export function clear(childId) {
  delete data[childId];
  save();
}
