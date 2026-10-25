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
// 書名の行を整える: 先頭の記号を外し、日本語の間の空白を詰める。括弧の中（シリーズ名・巻数）はレシートどおりに残す
function cleanTitle(raw) {
  let t = raw.replace(/^[\s_|\-—–'"“”‘’.,、。:;!]+/, '');
  // Tesseract は文字の間に空白を入れるので、日本語の間の空白は詰める
  t = t.replace(/(?<=[぀-ヿ一-鿿（）()])\s+(?=[぀-ヿ一-鿿（）()])/g, '');
  t = t.replace(/[|_]+/g, '').replace(/\s{2,}/g, ' ').trim();
  return t;
}

// 図書館のデータを探すときの言葉: 括弧より前、括弧の中、括弧の後ろ（副題）に分ける
export function searchParts(title) {
  const s = title.normalize('NFKC');
  const parts = s.split(/[()]/).map(p => p.replace(/^シリーズ/, '').trim()).filter(p => /[぀-ヿ一-鿿]/.test(p) && p.length >= 3);
  // さらに空白・読点・長い線・巻数で区切った言葉も使う（「いちばんすてきなママはだれ」「ちいさなハンター」など）
  const pieces = parts.flatMap(p => p.split(/[\s、,!?！？]+|ー{2,}|\d+/)).map(p => p.trim())
    .filter(p => /[぀-ヿ一-鿿]/.test(p) && p.length >= 4);
  return [...new Set([...parts, ...pieces])].slice(0, 6);
}

// 資料番号の行（例: 430019403905 (21/08/27)）。数字は日本語より正しく読めるので、1冊の終わりの目印にする
const ID_LINE = /\d{8,}/;
const isIdLine = s => ID_LINE.test(s.replace(/\s/g, ''));
// 「No 書名」の行。番号は 1〜2桁で、l・I・| と読み違えることがある
const NO_LINE = /^[_|\-—–'"“”‘’.,、。]*\s*([0-9lI|]{1,2})\s+(.*[぀-ヿ一-鿿].*)$/;
// レシートの見出しや、一覧の後ろのお知らせ・広告の行（書名ではない）
const NOT_TITLE = /貸出資料|資料ID|資料ＩＤ|返却期限|資料数|合計|休館|お知らせ|施設点検|蔵書点検|キャンペーン|特典|[●◆■]/;

// レシートの書式: 1冊ごとに「No 書名（長いと複数行）」の次に「資料番号（返却期限）」の行が続く。
// No の行から資料番号の行の手前までを1冊の書名としてつなげる
export function parseReceipt(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const books = [];
  const pending = [];   // No の行が見つかる前の、日本語を含む行
  let cur = null;
  const finish = () => {
    if (cur) {
      const t = cleanTitle(cur.parts.join(''));
      if (t.length >= 2) books.push({ no: cur.no, title: t });
    }
    cur = null;
  };
  for (const line of lines) {
    if (isIdLine(line)) {
      // 資料番号の行で1冊が終わる。No の行が読めなかったときは、前の資料番号からここまでの行を書名とみなす
      if (!cur && pending.length) cur = { no: null, parts: pending.splice(0) };
      finish();
      pending.length = 0;
      continue;
    }
    if (NOT_TITLE.test(line)) { finish(); pending.length = 0; continue; }
    const lastNo = cur?.no ?? books.at(-1)?.no ?? 0;
    let m = line.match(NO_LINE);
    // 書名の途中で数字から始まる行（「2 (ポプラ社…」など）は、次の No（今の No＋1）でなければ書名の続きとみなす
    if (m && cur && cur.no != null && /^\d+$/.test(m[1]) && Number(m[1]) !== cur.no + 1) m = null;
    // 紙の端の影などを文字と読み違えて、No の前に余計な文字が付くことがある（例:「回証明… 1 杉森くん」）。
    // 行の途中に「次の No＋空白＋日本語」があれば、そこから書名とみなす
    if (!m) {
      const next = lastNo + 1;
      const re = new RegExp(`(?:^|[\\s。、.,ー―\\-])(${next}${next === 1 ? '|l|I|\\|' : ''})\\s+(.*[\\u3040-\\u30ff\\u4e00-\\u9fff].*)$`);
      const e = line.match(re);
      if (e) m = [e[0], String(next), e[2]];
    }
    if (m) {
      finish();
      cur = { no: /^\d+$/.test(m[1]) ? Number(m[1]) : lastNo + 1, parts: [m[2]] };
    } else if (cur) {
      if (/[぀-ヿ一-鿿]/.test(line)) cur.parts.push(line);   // 書名の続きの行
    } else if (/[぀-ヿ一-鿿]/.test(line)) {
      pending.push(line);
    }
  }
  // 最後の本は資料番号の行が読めていないことがあるので、No の行があれば書名として残す
  finish();
  // No を読み違えた本は、前後の No から補う。並びはレシートの順のまま
  const list = books.map((b, i) => ({ no: b.no ?? i + 1, title: b.title }));
  // 返却期限（例: 21/08/27）が読めたら、その14日前を借りた日の目安にする
  const due = text.replace(/\s/g, '').match(/\((\d{2})[\/ノ](\d{2})[\/ノ](\d{2})\)/);
  return { titles: list, due: due ? `20${due[1]}-${due[2]}-${due[3]}` : null };
}
