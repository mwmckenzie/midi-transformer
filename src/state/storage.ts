// IndexedDB persistence so the library survives page reloads. Everything stays in the browser.

export interface StoredFile {
  id: string;
  name: string;
  bytes: Uint8Array;
  original: Uint8Array;
  addedAt: number;
  dirty?: boolean;
}

const DB = 'midi-transformer';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function loadAll(): Promise<StoredFile[]> {
  try {
    const all = (await tx<StoredFile[]>('readonly', (s) => s.getAll())) ?? [];
    return all.sort((a, b) => a.addedAt - b.addedAt);
  } catch {
    return [];
  }
}

export async function save(f: StoredFile) {
  try {
    await tx('readwrite', (s) => s.put(f));
  } catch {
    /* storage unavailable (private window etc.) — the app still works for this session */
  }
}

export async function remove(id: string) {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}
