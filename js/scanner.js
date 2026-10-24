// カメラでバーコードを読み取る。標準の BarcodeDetector があれば使い、なければ（iPhone など）ZXing を使う。
import { toIsbn13 } from './isbn.js';

const ZXING_URL = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
const SAME_CODE_INTERVAL = 2500;

let active = null;

function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ZXING_URL;
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => reject(new Error('読み取り機能を読み込めませんでした'));
    document.head.append(s);
  });
}

async function hasNativeEan13() {
  if (!('BarcodeDetector' in window)) return false;
  try {
    return (await window.BarcodeDetector.getSupportedFormats()).includes('ean_13');
  } catch {
    return false;
  }
}

// onIsbn は ISBN として正しいコードを読み取ったときだけ呼ばれる（192 始まりの価格コードは無視）
export async function start(video, onIsbn) {
  await stop();
  let last = { code: null, at: 0 };
  const handle = raw => {
    const isbn = toIsbn13(raw);
    if (!isbn) return;
    const now = Date.now();
    if (isbn === last.code && now - last.at < SAME_CODE_INTERVAL) return;
    last = { code: isbn, at: now };
    if (navigator.vibrate) navigator.vibrate(60);
    onIsbn(isbn);
  };

  const constraints = { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };

  if (await hasNativeEan13()) {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    const detector = new window.BarcodeDetector({ formats: ['ean_13'] });
    const session = { stopped: false, stream };
    active = session;
    const loop = async () => {
      if (session.stopped) return;
      try {
        for (const code of await detector.detect(video)) handle(code.rawValue);
      } catch { /* フレームが準備できていないときは無視 */ }
      setTimeout(loop, 200);
    };
    loop();
    return;
  }

  const ZXing = await loadZxing();
  const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13]]]);
  const reader = new ZXing.BrowserMultiFormatReader(hints, 250);
  active = { reader };
  video.setAttribute('playsinline', '');
  await reader.decodeFromConstraints(constraints, video, result => {
    if (result) handle(result.getText());
  });
}

export async function stop() {
  if (!active) return;
  const s = active;
  active = null;
  if (s.reader) s.reader.reset();
  if (s.stream) {
    s.stopped = true;
    s.stream.getTracks().forEach(t => t.stop());
  }
}

export function explainError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError') return 'カメラの使用が許可されていません。ブラウザの設定でカメラを許可してください。';
  if (name === 'NotFoundError') return 'カメラが見つかりません。';
  if (!window.isSecureContext) return 'カメラは https のページでしか使えません。';
  return 'カメラを起動できませんでした。' + (err && err.message ? `（${err.message}）` : '');
}
