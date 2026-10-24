// IndexedDB の薄いラッパー。全ストアは最初のバージョンで作っておき、段階2以降のマイグレーションを避ける。
const DB_NAME = 'library-log';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('children', { keyPath: 'id' });
      const books = db.createObjectStore('books', { keyPath: 'id' });
      books.createIndex('isbn', 'isbn');
      books.createIndex('seriesId', 'seriesId');
      const series = db.createObjectStore('series', { keyPath: 'id' });
      series.createIndex('title', 'title');
      const loans = db.createObjectStore('loans', { keyPath: 'id' });
      loans.createIndex('childId', 'childId');
      loans.createIndex('bookId', 'bookId');
      db.createObjectStore('seriesProgress', { keyPath: ['childId', 'seriesId'] });
      const wishlist = db.createObjectStore('wishlist', { keyPath: 'id' });
      wishlist.createIndex('childId', 'childId');
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const STORES = ['children', 'books', 'series', 'loans', 'seriesProgress', 'wishlist', 'settings'];

export async function get(name, key) {
  return wrap((await store(name)).get(key));
}

export async function all(name) {
  return wrap((await store(name)).getAll());
}

export async function byIndex(name, index, value) {
  return wrap((await store(name)).index(index).getAll(value));
}

export async function put(name, value) {
  await wrap((await store(name, 'readwrite')).put(value));
  return value;
}

export async function remove(name, key) {
  return wrap((await store(name, 'readwrite')).delete(key));
}

export async function getSetting(key, fallback) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  return put('settings', { key, value });
}

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// 手動バックアップ用: 全ストアを1つのオブジェクトにまとめる
export async function exportAll() {
  const data = { app: 'library-log', version: DB_VERSION, exportedAt: new Date().toISOString() };
  for (const name of STORES) data[name] = await all(name);
  return data;
}

export async function importAll(data) {
  if (!data || data.app !== 'library-log') throw new Error('このアプリのバックアップファイルではありません');
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) {
    const s = tx.objectStore(name);
    s.clear();
    for (const row of data[name] || []) s.put(row);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
