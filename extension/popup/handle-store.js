// Persists the picked directory handle in IndexedDB (usable from pages and the service worker).
const DB = "snippet-sync";
const STORE = "h";
const KEY = "dir";

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const PENDING = "pending";

export const putHandle = (handle) => tx("readwrite", (s) => s.put(handle, KEY));

// A freshly picked folder waits here until the service worker, inside its queue, makes it the active one.
// Handles cannot travel in runtime messages (JSON only), and queued syncs must keep using the old folder
// together with the old sync state until the switch.
export const putPendingHandle = (handle) => tx("readwrite", (s) => s.put(handle, PENDING));
export async function promotePendingHandle() {
  const handle = await tx("readonly", (s) => s.get(PENDING));
  if (!handle) return undefined;
  await tx("readwrite", (s) => { s.put(handle, KEY); return s.delete(PENDING); });
  return handle;
}
export const getHandle = () => tx("readonly", (s) => s.get(KEY));
export const deleteHandle = () => tx("readwrite", (s) => s.delete(KEY));
