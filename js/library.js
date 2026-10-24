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
  await db.remove('children', id);
}

// ---- 本・シリーズ ----
export async function bookByIsbn(isbn) {
  const [book] = await db.byIndex('books', 'isbn', isbn);
  return book || null;
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

// ---- 借りたい本（段階2で一覧画面を作る。今は追加だけ） ----
export async function addWish(childId, bookId, source = 'manual') {
  const list = await db.byIndex('wishlist', 'childId', childId);
  if (list.some(w => w.bookId === bookId)) return false;
  await db.put('wishlist', {
    id: db.newId(), childId, bookId, source, status: 'none',
    order: list.length, createdAt: new Date().toISOString(),
  });
  return true;
}

export async function isWished(childId, bookId) {
  return (await db.byIndex('wishlist', 'childId', childId)).some(w => w.bookId === bookId);
}
