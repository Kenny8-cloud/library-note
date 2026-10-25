// レシート写真の文字認識。Tesseract.js（日本語）をスマホの中で動かす。初回は約10MBの読み込みがある。
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let workerPromise = null;

function loadScript() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('文字認識の機能を読み込めませんでした。通信状態を確かめてください。'));
    document.head.append(s);
  });
}

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript();
      return window.Tesseract.createWorker('jpn', 1, {
        logger: m => onProgress && onProgress(m.status, m.progress),
      });
    })().catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

// 感熱紙の写真は明るさのむらが大きいので、周辺の平均より暗いところだけを黒にする（適応的二値化）
export function preprocess(img, crop) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const [sx, sy, sw, sh] = crop || [0, 0, iw, ih];
  const scale = Math.min(1, 1800 / Math.max(sw, 1));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h), p = d.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2];
  const W = w + 1;
  const ii = new Float64Array(W * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) { row += gray[(y - 1) * w + x - 1]; ii[y * W + x] = ii[(y - 1) * W + x] + row; }
  }
  const r = Math.max(8, Math.round(w / 40));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const mean = (ii[y1 * W + x1] - ii[y0 * W + x1] - ii[y1 * W + x0] + ii[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x] < mean * 0.85 ? 0 : 255;
      const k = (y * w + x) * 4;
      p[k] = p[k + 1] = p[k + 2] = v; p[k + 3] = 255;
    }
  }
  g.putImageData(d, 0, 0);
  return c;
}

export async function recognize(canvas, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return data.text;
}

const KANA = /[぀-ヿ一-鿿]/;

// 認識結果から書名の行を取り出す。川崎市立図書館のレシートは「1 書名」「資料ID (返却期限)」の2行で1冊
// 書名の行を整える: 先頭の番号（1 や l、| と読み違えたものも）を外し、日本語の間の空白を詰め、後ろの（出版社・叢書名）を外す
function cleanTitle(raw) {
  let t = raw.replace(/^[\s_|\-—–'"“”‘’.,、。:;!]*([0-9lI|]{1,2}[\s.、:]+)?/, '');
  // Tesseract は文字の間に空白を入れるので、日本語の間の空白は詰める
  t = t.replace(/(?<=[぀-ヿ一-鿿])\s+(?=[぀-ヿ一-鿿])/g, '');
  t = t.replace(/\s*[（(].*$/, '').replace(/[|_]+/g, '').trim();
  return t;
}

// 資料番号の行（例: 430019403905 (21/08/27)）。数字は日本語より正しく読めるので、書名を見つける手がかりにする
const ID_LINE = /\d{8,}/;

export function parseReceipt(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const titles = [];
  const used = new Set();
  // 1) 資料番号の行の、すぐ上の行を書名とみなす（先頭の番号が読めていなくても拾える）
  lines.forEach((line, i) => {
    if (!ID_LINE.test(line.replace(/\s/g, ''))) return;
    for (let j = i - 1; j >= 0 && j >= i - 2; j--) {
      if (ID_LINE.test(lines[j].replace(/\s/g, ''))) break;
      if (!KANA.test(lines[j])) continue;
      const t = cleanTitle(lines[j]);
      if (t.length >= 2 && !used.has(j)) { titles.push({ line: j, title: t }); used.add(j); }
      break;
    }
  });
  // 2) 「番号 書名」の形の行も拾う（資料番号の行が読めなかった本のため）
  lines.forEach((line, i) => {
    if (used.has(i)) return;
    const m = line.replace(/^[_|\-—–'"“”‘’.,、。]+\s*/, '').match(/^(\d{1,2})\s+(.+)$/);
    if (!m || !KANA.test(m[2]) || ID_LINE.test(line.replace(/\s/g, ''))) return;
    const t = cleanTitle(line);
    if (t.length >= 2) { titles.push({ line: i, title: t }); used.add(i); }
  });
  // レシートの順に並べる
  const list = titles.sort((a, b) => a.line - b.line).map((x, k) => ({ no: k + 1, title: x.title }));
  // 返却期限（例: 21/08/27）が読めたら、その14日前を借りた日の目安にする
  const due = text.replace(/\s/g, '').match(/\((\d{2})[\/ノ](\d{2})[\/ノ](\d{2})\)/);
  return { titles: list, due: due ? `20${due[1]}-${due[2]}-${due[3]}` : null };
}
