// お気に入りに似た本の提案。お気に入りの本の作者が書いたほかの本を国立国会図書館サーチで探し、
// その子がまだ借りていない本を予約候補の画面で提案する。シリーズものは、まだ読んでいないシリーズの最初の巻を出す
import * as db from './db.js';
import * as lib from './library.js';
import { searchAuthor, parseVolume } from './biblio.js';

const REFRESH_DAYS = 7;
const PER_AUTHOR = 3;
const PER_CHILD = 12;

const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s・!?、。,.「」『』()（）\[\]〜~ー\-:：!！?？]/g, '');
// 「サバイバー!! 13」「四つ子ぐらし（24） お花畑の…」「じごく小学校 [8]」から巻数の前までを取り出す
// 「おもしろい話、集めました。 C」のように英字1文字で巻を分けるものも同じシリーズとみなす
const baseTitle = t => String(t || '').normalize('NFKC').replace(/\s*[(\[]?\s*\d+\s*[)\]]?(\s.*)?$/, '').replace(/\s+[A-Z]$/, '').trim() || t;
// 似た名前のシリーズ（「こじまのもりの…」）は1つにまとめ、提案にいろいろな本が並ぶようにする
const groupKey = t => norm(baseTitle(t)).slice(0, 6);
// 日本語の本だけ（中国語版・英語の原書などは除く）
const isJapanese = t => /[ぁ-んァ-ヶ]/.test(t) && !/[가-힯]/.test(t) && !/^[A-Za-z]/.test(t) && !/(中国語|韓国語|英語)版|翻訳書名/.test(t);

// 「片山令子、片山健」の最初の人（ふつうは文を書いた人）。外国の作者は「ロバート・マックロスキー」のようなカタカナ表記を使う
export function mainAuthor(author) {
  const names = String(author || '').split('、').map(s => s.trim()).filter(Boolean);
  if (!names.length) return null;
  if (!/^[A-Za-z]/.test(names[0])) return names[0];
  return names.find(n => /^[ァ-ヶー]+・[ァ-ヶー・]+$/.test(n)) || null;
}

export async function suggestionsOf(childId) {
  const data = await db.getSetting('suggestions', null);
  const dismissed = new Set(await db.getSetting('suggestDismissed', []));
  const wished = new Set();
  for (const w of await db.byIndex('wishlist', 'childId', childId)) {
    const b = await db.get('books', w.bookId);
    if (b?.isbn) wished.add(b.isbn);
  }
  return (data?.byChild?.[childId] || []).filter(s => !dismissed.has(`${childId}|${s.isbn}`) && !wished.has(s.isbn));
}

export async function dismissSuggestion(childId, isbn) {
  const list = await db.getSetting('suggestDismissed', []);
  await db.setSetting('suggestDismissed', [...list, `${childId}|${isbn}`]);
}

// 提案を借りたい本に入れる（予約候補の「借りたい本」に並ぶ）
export async function wishSuggestion(childId, s) {
  const book = await lib.ensureBook(s);
  await lib.addWish(childId, book.id, 'favorite');
}

// お気に入りが変わったか、前回から日がたっていれば探し直す
export async function needsRefresh() {
  const data = await db.getSetting('suggestions', null);
  const key = favKey(await lib.allFavorites());
  if (!key) return false;
  return !data || data.key !== key || Date.now() - new Date(data.at).getTime() > REFRESH_DAYS * 86400000;
}

const favKey = favs => favs.map(f => `${f.childId}:${f.bookId}`).sort().join(',');

let running = null;
export function refreshSuggestions() {
  if (running) return running;
  running = (async () => {
    try {
      const favs = await lib.allFavorites();
      const books = new Map((await lib.allBooks()).map(b => [b.id, b]));
      const kids = await lib.children();

      // 子供ごとに、お気に入りの作者と、その作者のお気に入りの本
      const authorsOf = new Map();
      for (const f of favs) {
        const a = mainAuthor(books.get(f.bookId)?.author);
        if (!a) continue;
        if (!authorsOf.has(f.childId)) authorsOf.set(f.childId, new Map());
        const m = authorsOf.get(f.childId);
        if (!m.has(a)) m.set(a, []);
        m.get(a).push(books.get(f.bookId));
      }

      // 作者ごとに1回だけ調べる（兄弟で同じ作者がお気に入りのとき）。4件ずつ同時に問い合わせる
      const names = [...new Set([...authorsOf.values()].flatMap(m => [...m.keys()]))];
      const found = new Map();
      const queue = [...names];
      const work = async () => {
        while (queue.length) {
          const n = queue.shift();
          found.set(n, await searchAuthor(n).catch(() => []));
        }
      };
      await Promise.all([work(), work(), work(), work()]);

      const byChild = {};
      for (const k of kids) {
        const authors = authorsOf.get(k.id);
        if (!authors) continue;
        // この子が借りた本と、読んだことのあるシリーズ
        // お気に入りにした本そのもの（借りていなくても）も、読んだ本として扱う
        const read = [...(await lib.historyOf(k.id)).map(l => l.book), ...[...authors.values()].flat()];
        const readIsbn = new Set(read.map(b => b.isbn).filter(Boolean));
        const readBase = new Set(read.map(b => norm(baseTitle(b.title))));
        const readGroup = new Set(read.map(b => groupKey(b.title)));
        const readSeries = (await lib.seriesStatusOf(k.id)).map(s => norm(s.series.title)).filter(Boolean);

        const out = [];
        // お気に入りの多い作者から
        for (const [author, favBooks] of [...authors].sort((a, b) => b[1].length - a[1].length)) {
          const groups = new Map();
          for (const c of found.get(author) || []) {
            if (readIsbn.has(c.isbn) || !isJapanese(c.title) || c.title.includes('|')) continue;   // 「|」つきは章や付録だけの記録
            // 作者名が一致しない本（同じ名前を含む別の人）は除く
            if (!norm(c.author).includes(norm(author))) continue;
            const name = c.title;
            const base = norm(baseTitle(name));
            if (!base || readBase.has(base) || readGroup.has(groupKey(name)) || readSeries.some(s => base.startsWith(s) || s.startsWith(base) || (s.length >= 4 && base.includes(s)))) continue;
            // シリーズは1つにまとめ、いちばん若い巻（巻数がなければ古い方）を出す
            const vol = parseVolume(c.volume) ?? null;
            const key = groupKey(name);
            const g = groups.get(key);
            const better = !g || (vol ?? Infinity) < (g.vol ?? Infinity) || ((vol ?? null) === (g.vol ?? null) && (c.pubdate || '') < (g.pubdate || ''));
            if (better) groups.set(key, { ...c, vol, latest: Math.max(g?.latest || 0, Number((c.pubdate || '').slice(0, 4)) || 0) });
            else g.latest = Math.max(g.latest || 0, Number((c.pubdate || '').slice(0, 4)) || 0);
          }
          // 児童書を優先し、その中では新しく出ているシリーズ・本から
          const picks = [...groups.values()]
            .sort((a, b) => (b.isChildren - a.isChildren) || (b.latest - a.latest))
            .slice(0, PER_AUTHOR);
          for (const c of picks) {
            out.push({ isbn: c.isbn, title: c.title, author: c.author, publisher: c.publisher, pubdate: c.pubdate,
              coverUrl: c.coverUrl, isChildren: c.isChildren, because: favBooks[0].title, authorName: author });
          }
          if (out.length >= PER_CHILD) break;
        }
        byChild[k.id] = out.slice(0, PER_CHILD);
      }
      await db.setSetting('suggestions', { at: new Date().toISOString(), key: favKey(favs), byChild });
      return byChild;
    } finally {
      running = null;
    }
  })();
  return running;
}
