// 書誌データの取得。openBD と国立国会図書館サーチ（NDL）を併用し、結果をまとめる。
import { toIsbn13 } from './isbn.js';

const NS_DC = 'http://purl.org/dc/elements/1.1/';
const NS_DCNDL = 'http://ndl.go.jp/dcndl/terms/';
const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';

// 国会図書館サーチは、初めての検索語だと10秒ほどかかることがあるので長めに待つ
// 同時に送る問い合わせは4件まで。多すぎると iPhone で応答が返らなくなることがある
const MAX_PARALLEL = 4;
let running = 0;
const waiting = [];
async function slot(fn) {
  if (running >= MAX_PARALLEL) await new Promise(r => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

// 本文の読み込みまで含めて時間切れにする（ヘッダーだけ届いて本文が来ないことがあるため）
function fetchBody(url, kind, ms = 20000) {
  return slot(() => {
    const ctrl = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, ms); });
    const work = (async () => {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return kind === 'json' ? res.json() : res.text();
    })();
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  });
}

function toHalfWidth(s) {
  return String(s || '').replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ').trim();
}

// 「3」「第3巻」「３」などから巻数を取り出す
export function parseVolume(s) {
  const m = toHalfWidth(s).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// "中川, 李枝子, 1935-" → "中川李枝子"
function cleanPerson(s) {
  return toHalfWidth(s).replace(/,\s*\d{4}-(\d{4})?\s*$/, '').replace(/,\s*/g, '').trim();
}

function googleCoverUrl(isbn) {
  return `https://books.google.com/books/content?vid=ISBN${isbn}&printsec=frontcover&img=1&zoom=1`;
}

// ---- openBD ----
async function fromOpenBD(isbn) {
  const [item] = await fetchBody(`https://api.openbd.jp/v1/get?isbn=${isbn}`, 'json');
  if (!item || !item.summary) return null;
  const s = item.summary;
  const subjects = item.onix?.DescriptiveDetail?.Subject || [];
  const cCode = subjects.find(x => x.SubjectSchemeIdentifier === '78')?.SubjectCode || null;
  return {
    // openBD は「書名. 2」の形で巻数を書名に含めるので「書名 2」にそろえる
    title: toHalfWidth(s.title).replace(/\.\s*(\d+)$/, ' $1'),
    author: s.author ? s.author.split(/\s+/).map(cleanPerson).filter(Boolean).join('、') : '',
    publisher: s.publisher || '',
    pubdate: s.pubdate || '',
    coverUrl: s.cover || null,
    series: s.series ? { title: toHalfWidth(s.series), volume: parseVolume(s.volume) } : null,
    cCode,
  };
}

// ---- NDL ----
function text(el, ns, tag) {
  const n = el.getElementsByTagNameNS(ns, tag)[0];
  return n ? n.textContent.trim() : '';
}

// 「2026.7」「2026-07-15」「202607」「2026」を「2026-07」「2026」の形にする
export function normalizePubdate(s) {
  const t = toHalfWidth(s || '');
  let m = t.match(/(\d{4})[.\-/年](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = t.match(/^(\d{4})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  m = t.match(/(\d{4})/);
  return m ? m[1] : '';
}

function parseNdlItem(el) {
  const ids = [...el.getElementsByTagNameNS(NS_DC, 'identifier')];
  const isbnEl = ids.find(n => (n.getAttributeNS(NS_XSI, 'type') || n.getAttribute('xsi:type')) === 'dcndl:ISBN');
  const isbn = isbnEl ? toIsbn13(isbnEl.textContent) : null;
  const title = toHalfWidth(text(el, NS_DC, 'title'));
  const volumeRaw = text(el, NS_DCNDL, 'volume');
  const seriesRaw = text(el, NS_DCNDL, 'seriesTitle');
  const creators = [...el.getElementsByTagNameNS(NS_DC, 'creator')].map(n => cleanPerson(n.textContent));

  // シリーズ候補: 巻数つきの本はその書名をシリーズとみなす。なければ「叢書名 ; 巻」を使う
  let series = null;
  if (volumeRaw && parseVolume(volumeRaw) != null) {
    series = { title, volume: parseVolume(volumeRaw) };
  } else if (seriesRaw) {
    // 「ポプラ社の新・小さな童話 ; 206. かいけつゾロリシリーズ」のように、レーベルの後ろに本当のシリーズ名が続くことがある
    const parts = seriesRaw.split(/\.\s+/);
    if (parts.length > 1) {
      series = { title: toHalfWidth(parts[parts.length - 1]).split(/\s*;\s*/)[0], volume: null };
    } else {
      const [st, sv] = seriesRaw.split(/\s*;\s*/);
      series = { title: toHalfWidth(st), volume: parseVolume(sv) };
    }
  }
  return {
    isbn,
    title: volumeRaw ? `${title} ${toHalfWidth(volumeRaw)}` : title,
    author: [...new Set(creators)].join('、'),
    publisher: text(el, NS_DC, 'publisher'),
    // dcterms:issued は「2026.7」のように月まで入っていることが多いので、こちらを優先して「2026-07」にそろえる
    pubdate: normalizePubdate(text(el, 'http://purl.org/dc/terms/', 'issued') || text(el, NS_DC, 'date')),
    volume: volumeRaw ? toHalfWidth(volumeRaw) : '',
    series,
    isChildren: text(el, NS_DCNDL, 'genre').includes('児童'),
  };
}

async function ndlSearch(params) {
  const qs = new URLSearchParams({ cnt: '30', mediatype: 'books', ...params });
  const xml = new DOMParser().parseFromString(await fetchBody(`https://ndlsearch.ndl.go.jp/api/opensearch?${qs}`, 'text'), 'application/xml');
  return [...xml.getElementsByTagName('item')].map(parseNdlItem);
}

async function fromNdl(isbn) {
  const items = await ndlSearch({ isbn });
  return items.find(i => i.isbn === isbn) || null;
}

// ISBN から本の情報を取得する。どちらか一方でも取れれば返す。
export async function lookupIsbn(isbn) {
  const [obd, ndl] = await Promise.allSettled([fromOpenBD(isbn), fromNdl(isbn)]);
  const a = obd.status === 'fulfilled' ? obd.value : null;
  const b = ndl.status === 'fulfilled' ? ndl.value : null;
  if (!a && !b) {
    if (obd.status === 'rejected' && ndl.status === 'rejected') throw new Error('書誌データに接続できません');
    return null;
  }
  return {
    isbn,
    // NDL は巻数を分けて持っているので書名は NDL を優先する
    title: b?.title || a?.title || '',
    author: b?.author || a?.author || '',
    publisher: a?.publisher || b?.publisher || '',
    pubdate: a?.pubdate || b?.pubdate || '',
    coverUrl: a?.coverUrl || googleCoverUrl(isbn),
    seriesCandidate: b?.series || a?.series || null,
    cCode: a?.cCode || null,
    isChildren: Boolean(b?.isChildren || (a?.cCode && a.cCode[1] === '8')),
  };
}

// シリーズ名で多めに検索する（新刊のお知らせ用）。巻数・出版日つきで返す
export async function searchSeries(title) {
  const items = await ndlSearch({ title, cnt: '200' });
  return items.filter(i => i.isbn).map(i => ({ ...i, coverUrl: googleCoverUrl(i.isbn) }));
}

// 書名で検索する（S-05）。ISBN ごとに重複を除く。
export async function searchTitle(q) {
  const items = await ndlSearch({ title: q });
  const seen = new Set();
  return items.filter(i => {
    const key = i.isbn || `${i.title}|${i.publisher}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(i => ({
    ...i,
    coverUrl: i.isbn ? googleCoverUrl(i.isbn) : null,
    seriesCandidate: i.series,
  }));
}
