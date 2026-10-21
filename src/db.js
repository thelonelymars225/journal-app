// Journal storage.
// - In the desktop app, entries live in a plain JSON file in the app's data
//   folder (see electron/main.cjs). Files aren't subject to browser storage
//   cleanup, are easy to back up, and survive app updates.
// - In a browser, entries live in IndexedDB on this machine.
// When cloud sync is on (see sync.js), this local copy is also an offline
// cache: every change is noted here and uploaded to Supabase.

const fileApi = typeof window !== 'undefined' ? window.journalFile : undefined;
export const storageKind = fileApi ? 'file' : 'browser';

// ---------- IndexedDB ----------

const DB_NAME = 'journal';
const DB_VERSION = 1;
let dbPromise;

function openIdb() {
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
  const db = await openIdb();
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

const idb = {
  entries: {
    all: () => tx('entries', 'readonly', (s) => wrap(s.getAll())),
    get: (id) => tx('entries', 'readonly', (s) => wrap(s.get(id))),
    put: (entry) => tx('entries', 'readwrite', (s) => wrap(s.put(entry))),
    remove: (id) => tx('entries', 'readwrite', (s) => wrap(s.delete(id))),
    clear: () => tx('entries', 'readwrite', (s) => wrap(s.clear())),
  },
  settings: {
    get: (key) => tx('settings', 'readonly', (s) => wrap(s.get(key))),
    set: (key, value) => tx('settings', 'readwrite', (s) => wrap(s.put(value, key))),
  },
};

// Asks the browser to never clear our data to free up space, and reports
// whether it agreed: 'file' (desktop app), 'protected', 'unprotected' or 'unknown'.
export async function protectStorage() {
  if (fileApi) return 'file';
  if (!navigator.storage?.persist) return 'unknown';
  try {
    if (await navigator.storage.persisted()) return 'protected';
    return (await navigator.storage.persist()) ? 'protected' : 'unprotected';
  } catch {
    return 'unknown';
  }
}

// ---------- JSON file (desktop) ----------

let doc; // { version, entries: { [id]: entry }, settings: { [key]: value } }
let docPromise;

async function hasIdbData() {
  try {
    return (await idb.entries.all()).length > 0;
  } catch {
    return false;
  }
}

function loadDoc() {
  if (!docPromise) {
    docPromise = (async () => {
      doc = await fileApi.load();
      if (!doc) {
        doc = { version: 1, entries: {}, settings: {} };
        // Earlier desktop builds kept entries in IndexedDB; move them into the file once.
        if (await hasIdbData()) {
          for (const e of await idb.entries.all()) doc.entries[e.id] = e;
          for (const key of ['topics', 'threshold', 'autoload', 'suggest', 'dismissed']) {
            const v = await idb.settings.get(key);
            if (v !== undefined) doc.settings[key] = v;
          }
        }
        await fileApi.save(doc);
      }
      doc.entries ||= {};
      doc.settings ||= {};
      return doc;
    })();
  }
  return docPromise;
}

// Every change is written right away; the main process serializes the writes.
const persist = () => fileApi.save(doc);

const file = {
  entries: {
    all: async () => Object.values((await loadDoc()).entries),
    get: async (id) => (await loadDoc()).entries[id],
    put: async (entry) => { (await loadDoc()).entries[entry.id] = structuredClone(entry); await persist(); },
    remove: async (id) => { delete (await loadDoc()).entries[id]; await persist(); },
    clear: async () => { (await loadDoc()).entries = {}; await persist(); },
  },
  settings: {
    get: async (key) => (await loadDoc()).settings[key],
    set: async (key, value) => { (await loadDoc()).settings[key] = structuredClone(value); await persist(); },
  },
};

// The storage on this device, without change tracking (sync.js writes here).
export const local = fileApi ? file : idb;

// sync.js registers here to hear about every change the app makes.
let changeHook = null;
export const onLocalChange = (fn) => { changeHook = fn; };
const notify = (kind, key) => changeHook?.(kind, key);

export const entries = {
  ...local.entries,
  put: async (entry) => { await local.entries.put(entry); notify('entry', entry.id); },
  remove: async (id) => { await local.entries.remove(id); notify('entry', id); },
};
export const settings = {
  ...local.settings,
  set: async (key, value) => { await local.settings.set(key, value); notify('setting', key); },
};
export const dataLocation = () => (fileApi ? fileApi.location() : Promise.resolve(null));
export const revealData = () => fileApi?.reveal();
