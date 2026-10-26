// アプリのデータ操作。画面からは db.js を直接触らず、ここを通す。
import * as db from './db.js';
import { today } from './ui.js';

// ---- 子供 ----
export async function children() {
  return (await db.all('children')).sort((a, b) => a.order - b.order);
}

export async function saveChild(child) {
  if (!child.id) {
    const list = await children();
    child.id = db.newId();
    child.order = list.length ? Math.max(...list.map(c => c.order)) + 1 : 0;
  }
  return db.put('children', child);
}

// 子供を削除すると、その子の貸出履歴と借りたい本も消える
export async function deleteChild(id) {
  for (const loan of await db.byIndex('loans', 'childId', id)) await db.remove('loans', loan.id);
  for (const w of await db.byIndex('wishlist', 'childId', id)) await db.remove('wishlist', w.id);
  for (const p of await db.all('seriesProgress')) {
    if (p.childId === id) await db.remove('seriesProgress', [p.childId, p.seriesId]);
  }
  await db.setSetting('favorites', (await allFavorites()).filter(f => f.childId !== id));
  await db.remove('children', id);
}

// ---- お気に入り ----
// 子供ごとのお気に入りの本。設定に [{ childId, bookId, at }] の形で置く（バックアップにも含まれる）
export function allFavorites() {
  return db.getSetting('favorites', []);
}

export async function favoritesOf(childId) {
  return new Set((await allFavorites()).filter(f => f.childId === childId).map(f => f.bookId));
}

// お気に入りにする／外す。お気に入りになったら true を返す
export async function toggleFavorite(childId, bookId) {
  const list = await allFavorites();
  const i = list.findIndex(f => f.childId === childId && f.bookId === bookId);
  if (i >= 0) list.splice(i, 1); else list.push({ childId, bookId, at: today() });
  await db.setSetting('favorites', list);
  return i < 0;
}

// ---- 本・シリーズ ----
export async function bookByIsbn(isbn) {
  const [book] = await db.byIndex('books', 'isbn', isbn);
  return book || null;
}

export function allBooks() {
  return db.all('books');
}

export function getBook(id) {
  return db.get('books', id);
}

export async function seriesList() {
  return (await db.all('series')).sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}

export function getSeries(id) {
  return id ? db.get('series', id) : null;
}

export async function findSeriesByTitle(title) {
  const [s] = await db.byIndex('series', 'title', title);
  return s || null;
}

export async function ensureSeries(title) {
  title = (title || '').trim();
  if (!title) return null;
  const found = await findSeriesByTitle(title);
  if (found) return found;
  return db.put('series', { id: db.newId(), title });
}

// 書誌情報（または手入力）から本を作る。同じ ISBN の本があればそれを返す。
export async function ensureBook(info) {
  if (info.isbn) {
    const found = await bookByIsbn(info.isbn);
    if (found) return found;
  }
  const book = {
    id: db.newId(),
    isbn: info.isbn || null,
    title: info.title || '（書名不明）',
    author: info.author || '',
    publisher: info.publisher || '',
    pubdate: info.pubdate || '',
    coverUrl: info.coverUrl || null,
    coverDriveId: null,
    seriesId: null,
    volume: null,
    cCode: info.cCode || null,
    isChildren: Boolean(info.isChildren),
    fetchedAt: new Date().toISOString(),
  };
  return db.put('books', book);
}

export async function updateBook(book) {
  return db.put('books', book);
}

// 同じ本が2冊に分かれて登録されているとき、from の貸出・借りたい本を into に移して from を消す
export async function mergeBook(fromId, intoId) {
  if (fromId === intoId) return;
  for (const l of await db.byIndex('loans', 'bookId', fromId)) {
    const dup = (await db.byIndex('loans', 'bookId', intoId)).some(x => x.childId === l.childId && (x.borrowedAt || null) === (l.borrowedAt || null));
    if (dup) await db.remove('loans', l.id); else await db.put('loans', { ...l, bookId: intoId });
  }
  for (const w of await db.all('wishlist')) {
    if (w.bookId !== fromId) continue;
    const dup = (await db.byIndex('wishlist', 'childId', w.childId)).some(x => x.bookId === intoId);
    if (dup) await db.remove('wishlist', w.id); else await db.put('wishlist', { ...w, bookId: intoId });
  }
  const favs = await allFavorites();
  if (favs.some(f => f.bookId === fromId)) {
    const moved = favs.map(f => (f.bookId === fromId ? { ...f, bookId: intoId } : f));
    await db.setSetting('favorites', moved.filter((f, i) => moved.findIndex(x => x.childId === f.childId && x.bookId === f.bookId) === i));
  }
  const from = await db.get('books', fromId), into = await db.get('books', intoId);
  if (from?.seriesId && into && !into.seriesId) await db.put('books', { ...into, seriesId: from.seriesId, volume: from.volume });
  await db.remove('books', fromId);
}

// 間違えて登録した本を本棚から消す。家族全員の貸出記録・借りたい本・お気に入りもまとめて消す
export async function deleteBook(bookId) {
  for (const l of await db.byIndex('loans', 'bookId', bookId)) await db.remove('loans', l.id);
  for (const w of await db.all('wishlist')) if (w.bookId === bookId) await db.remove('wishlist', w.id);
  await db.setSetting('favorites', (await allFavorites()).filter(f => f.bookId !== bookId));
  await db.remove('books', bookId);
}

export async function setBookSeries(book, seriesTitle, volume) {
  const series = await ensureSeries(seriesTitle);
  book.seriesId = series ? series.id : null;
  book.volume = series && volume ? Number(volume) : null;
  await db.put('books', book);
  return book;
}

// ---- 貸出履歴 ----
export async function loansOf(childId, bookId) {
  return (await db.byIndex('loans', 'bookId', bookId)).filter(l => l.childId === childId);
}

export async function loansOfBook(bookId) {
  return db.byIndex('loans', 'bookId', bookId);
}

// 子供の履歴を新しい順に、本の情報と合わせて返す
export async function historyOf(childId) {
  const loans = await db.byIndex('loans', 'childId', childId);
  const books = new Map((await db.all('books')).map(b => [b.id, b]));
  return loans
    .map(l => ({ ...l, book: books.get(l.bookId) }))
    .filter(l => l.book)
    .sort((a, b) => (b.borrowedAt || '').localeCompare(a.borrowedAt || '') || b.createdAt.localeCompare(a.createdAt));
}

// 家族全体の履歴。同じ本を同じ日に兄弟で借りた記録は1つにまとめ、誰が借りたか（kids）を持たせる
export async function familyHistory() {
  const kidsById = new Map((await children()).map(c => [c.id, c]));
  const books = new Map((await db.all('books')).map(b => [b.id, b]));
  const merged = new Map();
  for (const l of await db.all('loans')) {
    const book = books.get(l.bookId);
    if (!book || !kidsById.has(l.childId)) continue;
    const k = `${l.bookId}|${l.borrowedAt || ''}`;
    if (!merged.has(k)) merged.set(k, { bookId: l.bookId, borrowedAt: l.borrowedAt, createdAt: l.createdAt, book, kids: [] });
    const m = merged.get(k);
    if (!m.kids.some(c => c.id === l.childId)) m.kids.push(kidsById.get(l.childId));
  }
  return [...merged.values()]
    .sort((a, b) => (b.borrowedAt || '').localeCompare(a.borrowedAt || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function addLoan(childId, bookId, borrowedAt = today()) {
  const loan = { id: db.newId(), childId, bookId, borrowedAt, createdAt: new Date().toISOString() };
  await db.put('loans', loan);
  // 借りた本は借りたい本リストから外す
  for (const w of await db.byIndex('wishlist', 'childId', childId)) {
    if (w.bookId === bookId) await db.remove('wishlist', w.id);
  }
  return loan;
}

export function updateLoan(loan) {
  return db.put('loans', loan);
}

export function deleteLoan(id) {
  return db.remove('loans', id);
}

// ---- シリーズの読み進め ----
// シリーズの巻は「そのシリーズに属する本」を巻数順（巻数がなければ出版順）に並べたもの。
// 次の巻 = その子がまだ借りていない最初の巻。手元にない巻は、シリーズ詳細で図書館データから追加する。
export function sortVolumes(books) {
  return [...books].sort((a, b) =>
    (a.volume ?? Infinity) - (b.volume ?? Infinity) || (a.pubdate || '').localeCompare(b.pubdate || '') || a.title.localeCompare(b.title, 'ja'));
}

export async function seriesBooks(seriesId) {
  return sortVolumes(await db.byIndex('books', 'seriesId', seriesId));
}

export async function getProgress(childId, seriesId) {
  return db.get('seriesProgress', [childId, seriesId]);
}

export async function setProgress(childId, seriesId, status) {
  return db.put('seriesProgress', { childId, seriesId, status, updatedAt: new Date().toISOString() });
}

export function saveSeries(series) {
  return db.put('series', series);
}

export async function deleteSeries(seriesId) {
  for (const b of await db.byIndex('books', 'seriesId', seriesId)) {
    b.seriesId = null;
    b.volume = null;
    await db.put('books', b);
  }
  for (const p of await db.all('seriesProgress')) {
    if (p.seriesId === seriesId) await db.remove('seriesProgress', [p.childId, p.seriesId]);
  }
  await db.remove('series', seriesId);
}

// 子供ごとのシリーズの状況。1冊でも借りたシリーズが対象で、状態は明示がなければ「読み進め中」
export async function seriesStatusOf(childId) {
  const loans = await db.byIndex('loans', 'childId', childId);
  const borrowed = new Set(loans.map(l => l.bookId));
  const books = await db.all('books');
  const bySeries = new Map();
  for (const b of books) {
    if (!b.seriesId) continue;
    if (!bySeries.has(b.seriesId)) bySeries.set(b.seriesId, []);
    bySeries.get(b.seriesId).push(b);
  }
  const result = [];
  for (const [seriesId, list] of bySeries) {
    const vols = sortVolumes(list);
    const read = vols.filter(b => borrowed.has(b.id));
    const progress = await getProgress(childId, seriesId);
    if (!read.length && !progress) continue;
    const series = await db.get('series', seriesId);
    if (!series) continue;
    result.push({
      series,
      books: vols,
      readCount: read.length,
      status: progress?.status || 'reading',
      next: vols.find(b => !borrowed.has(b.id)) || null,
      borrowed,
    });
  }
  return result.sort((a, b) => a.series.title.localeCompare(b.series.title, 'ja'));
}

// ---- 借りたい本 ----
// status: none（まだ予約していない）/ reserved（予約済み）。source: manual / author / ai / series
export async function addWish(childId, bookId, source = 'manual', status = 'none') {
  const list = await db.byIndex('wishlist', 'childId', childId);
  const found = list.find(w => w.bookId === bookId);
  if (found) {
    if (status === 'reserved' && found.status !== 'reserved') await db.put('wishlist', { ...found, status, reservedAt: today() });
    return false;
  }
  await db.put('wishlist', {
    id: db.newId(), childId, bookId, source, status,
    order: list.length ? Math.max(...list.map(w => w.order)) + 1 : 0,
    createdAt: new Date().toISOString(),
    ...(status === 'reserved' ? { reservedAt: today() } : {}),
  });
  return true;
}

export async function isWished(childId, bookId) {
  return (await db.byIndex('wishlist', 'childId', childId)).some(w => w.bookId === bookId);
}

export async function wishesOf(childId) {
  const list = await db.byIndex('wishlist', 'childId', childId);
  const out = [];
  for (const w of list.sort((a, b) => a.order - b.order)) {
    const book = await db.get('books', w.bookId);
    if (book) out.push({ ...w, book });
  }
  return out;
}

export function removeWish(id) {
  return db.remove('wishlist', id);
}

export async function updateWish(wish) {
  const { book, ...row } = wish;
  return db.put('wishlist', row);
}

// 並べ替え: dir = -1（上へ）/ 1（下へ）
export async function moveWish(childId, id, dir) {
  const list = (await db.byIndex('wishlist', 'childId', childId)).sort((a, b) => a.order - b.order);
  const i = list.findIndex(w => w.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) {
    if (list[k].order !== k) await db.put('wishlist', { ...list[k], order: k });
  }
}

// ---- 予約 ----
// 子供ごとの予約候補: シリーズの次の巻 → 借りたい本（未予約）の順。予約済みは別に返す
export async function reservationPlan() {
  const kids = await children();
  const plan = [];
  for (const child of kids) {
    const wishes = await wishesOf(child.id);
    const wishedIds = new Set(wishes.map(w => w.bookId));
    const reading = (await seriesStatusOf(child.id)).filter(s => s.status === 'reading');
    // シリーズの次の巻。借りたい本リストに入っている巻も、ここに「シリーズの続き」として出す
    const nextOf = new Map(reading.filter(s => s.next).map(s => [s.next.id, s]));
    const pendingWishes = wishes.filter(w => w.status !== 'reserved');
    const series = [
      ...reading.filter(s => s.next && !wishedIds.has(s.next.id))
        .map(s => ({ kind: 'series', key: `s:${child.id}:${s.next.id}`, childId: child.id, book: s.next, series: s.series })),
      ...pendingWishes.filter(w => nextOf.has(w.bookId))
        .map(w => ({ kind: 'wish', key: `w:${w.id}`, childId: child.id, book: w.book, wish: w, series: nextOf.get(w.bookId).series })),
    ].sort((a, b) => a.series.title.localeCompare(b.series.title, 'ja'));
    const pending = pendingWishes.filter(w => !nextOf.has(w.bookId))
      .map(w => ({ kind: 'wish', key: `w:${w.id}`, childId: child.id, book: w.book, wish: w }));
    const reserved = wishes.filter(w => w.status === 'reserved');
    // 次の巻がまだ登録されていないシリーズ（シリーズ詳細で追加してもらう）
    const needVolume = reading.filter(s => !s.next);
    plan.push({ child, series, pending, reserved, needVolume });
  }
  return plan;
}

// 選んだ候補を予約済みにする。シリーズの次の巻は借りたい本（予約済み）として記録する
export async function confirmReservation(items) {
  for (const it of items) {
    if (it.kind === 'series') await addWish(it.childId, it.book.id, 'series', 'reserved');
    else await updateWish({ ...it.wish, status: 'reserved', reservedAt: today() });
  }
  await db.setSetting('lastReservedAt', today());
}

export async function reserveSettings() {
  return {
    targetCount: await db.getSetting('targetCount', 15),
    maxCount: await db.getSetting('maxCount', 40),
    lastReservedAt: await db.getSetting('lastReservedAt', null),
  };
}

export function saveSetting(key, value) {
  return db.setSetting(key, value);
}
