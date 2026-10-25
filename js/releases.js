// 新刊のお知らせ。読み進めているシリーズを国立国会図書館サーチで調べ、
// 本棚にあるいちばん大きい巻より後の巻（巻数がない本は、いちばん新しい出版月より後に出た本）を見つける。
// 発売の少し前から載る本もあるので、その場合は「発売予定」として知らせる
import * as db from './db.js';
import * as lib from './library.js';
import { searchSeries, parseVolume, normalizePubdate } from './biblio.js';

const CHECK_EVERY_DAYS = 3;
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s・!?、。,.「」『』()〜~ー\-:：!！?？]/g, '');

export async function releases() {
  return (await db.getSetting('newReleases', [])).filter(r => !r.dismissed);
}

export async function dismissRelease(isbn) {
  const list = await db.getSetting('newReleases', []);
  await db.setSetting('newReleases', list.map(r => (r.isbn === isbn ? { ...r, dismissed: true } : r)));
}

let running = null;

// force: 前回の確認から日がたっていなくても調べる。onProgress(済んだ数, 全体の数)
export function checkNewReleases({ force = false, onProgress } = {}) {
  if (running) return running;
  running = (async () => {
    try {
      const last = await db.getSetting('releasesCheckedAt', null);
      if (!force && last && Date.now() - new Date(last).getTime() < CHECK_EVERY_DAYS * 86400000) return { added: 0, skipped: true };

      // 誰かが読み進めている（中断していない）シリーズと、それを読んでいる子
      const target = new Map();
      for (const k of await lib.children()) {
        for (const s of await lib.seriesStatusOf(k.id)) {
          if (s.status === 'paused') continue;
          if (!target.has(s.series.id)) target.set(s.series.id, { series: s.series, books: s.books, childIds: [] });
          target.get(s.series.id).childIds.push(k.id);
        }
      }
      const known = new Set((await lib.allBooks()).map(b => b.isbn).filter(Boolean));
      const prev = await db.getSetting('newReleases', []);
      const prevIsbn = new Set(prev.map(r => r.isbn));
      const found = [];
      const y = new Date();
      const recent = `${y.getFullYear() - 1}-${String(y.getMonth() + 1).padStart(2, '0')}`;
      let done = 0;
      const entries = [...target.values()];

      // 図書館サーチへの問い合わせは4件ずつ同時に行う（それ以上は biblio.js 側で待たされる）
      const queue = [...entries];
      const work = async () => { while (queue.length) await one(queue.shift()); };
      const one = async t => {
        const name = t.series.title;
        const vols = t.books.map(b => Number(b.volume)).filter(v => v > 0);
        const maxVol = vols.length ? Math.max(...vols) : null;
        const dates = t.books.map(b => normalizePubdate(b.pubdate)).filter(d => d.length === 7);
        const maxDate = dates.length ? dates.sort().at(-1) : null;
        if (maxVol === null && maxDate === null) { onProgress?.(++done, entries.length); return; }

        const res = await searchSeries(name).catch(() => []);
        for (const c of res) {
          if (known.has(c.isbn) || prevIsbn.has(c.isbn) || found.some(f => f.isbn === c.isbn)) continue;
          if (/[가-힯]/.test(c.title) || !norm(c.title).startsWith(norm(name))) continue;   // 外国語版・別のシリーズ
          const vol = parseVolume(c.volume) ?? parseVolume(c.title.slice(c.title.indexOf(name) + name.length));
          const date = c.pubdate;
          // 新刊＝この1年に出た本。まだ読んでいない古い巻や、書名の数字を巻と取り違えた本（「〇〇クイズ300」など）は除く
          if (!(date.length === 7 && date >= recent)) continue;
          if (vol !== null && maxVol !== null && vol > maxVol + 20) continue;
          const isNew = maxVol !== null && vol !== null ? vol > maxVol : (maxDate && date > maxDate);
          if (!isNew) continue;
          found.push({ isbn: c.isbn, title: c.title, author: c.author, publisher: c.publisher, pubdate: date, volume: vol,
            seriesId: t.series.id, seriesTitle: name, childIds: t.childIds, foundAt: new Date().toISOString() });
        }
        onProgress?.(++done, entries.length);
      };
      await Promise.all([work(), work(), work(), work()]);
      // 同じシリーズで同じ巻が何冊も見つかったとき（新装版など）は、新しい方だけにする
      const byKey = new Map();
      for (const f of found) {
        const key = `${f.seriesId}|${f.volume ?? f.isbn}`;
        if (!byKey.has(key) || (f.pubdate || '') > (byKey.get(key).pubdate || '')) byKey.set(key, f);
      }
      const added = [...byKey.values()];
      await db.setSetting('newReleases', [...prev, ...added]);
      await db.setSetting('releasesCheckedAt', new Date().toISOString());
      return { added: added.length };
    } finally {
      running = null;
    }
  })();
  return running;
}

// お知らせの本を、そのシリーズを読んでいる子の借りたい本に入れる
export async function wishRelease(r) {
  const book = await lib.ensureBook({ isbn: r.isbn, title: r.title, author: r.author, publisher: r.publisher, pubdate: r.pubdate,
    coverUrl: `https://books.google.com/books/content?vid=ISBN${r.isbn}&printsec=frontcover&img=1&zoom=1` });
  if (!book.seriesId) await lib.setBookSeries(book, r.seriesTitle, r.volume);
  for (const id of r.childIds) await lib.addWish(id, book.id, 'series');
  await dismissRelease(r.isbn);
}
