// Minimal IndexedDB wrapper. Everything lives in one "sessions" store.
const DB_NAME = 'gym-tracker';
const STORE = 'sessions';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export const getAll = () => run('readonly', s => s.getAll());
export const put = obj => run('readwrite', s => s.put(JSON.parse(JSON.stringify(obj))));
export const remove = id => run('readwrite', s => s.delete(id));
export const putMany = list => run('readwrite', s => { list.forEach(o => s.put(o)); });

// Ask Chrome not to evict our data under storage pressure.
export async function persist() {
  try {
    if (navigator.storage?.persisted && await navigator.storage.persisted()) return true;
    return navigator.storage?.persist ? await navigator.storage.persist() : false;
  } catch { return false; }
}
