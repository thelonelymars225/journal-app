// Tiny IndexedDB wrapper. Everything stays in this browser profile on this machine.
const DB_NAME = 'journal';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) {
          const store = db.createObjectStore('entries', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const entries = {
  all: () => tx('entries', 'readonly', (s) => wrap(s.getAll())),
  get: (id) => tx('entries', 'readonly', (s) => wrap(s.get(id))),
  put: (entry) => tx('entries', 'readwrite', (s) => wrap(s.put(entry))),
  remove: (id) => tx('entries', 'readwrite', (s) => wrap(s.delete(id))),
  clear: () => tx('entries', 'readwrite', (s) => wrap(s.clear())),
};

export const settings = {
  get: (key) => tx('settings', 'readonly', (s) => wrap(s.get(key))),
  set: (key, value) => tx('settings', 'readwrite', (s) => wrap(s.put(value, key))),
};
