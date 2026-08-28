const DB_NAME = 'debooger2000';
const DB_VERSION = 1;
const STORE_NAME = 'project-cache';
const ACTIVE_KEY = 'active';
const HISTORY_KEY = 'history';
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_ITEM_BYTES = 40 * 1024 * 1024;
const MAX_HISTORY_TOTAL_BYTES = 120 * 1024 * 1024;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB is unavailable.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open project storage.'));
  });
}

function snapshotBytes(snapshot) {
  return Object.values(snapshot?.files || {}).reduce((sum, file) => sum + Number(file?.size || 0), 0);
}

function requestValue(store, key) {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('Could not read project storage.'));
  });
}

function commitTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not write project storage.'));
    tx.onabort = () => reject(tx.error || new Error('Project storage transaction was aborted.'));
  });
}

export async function saveProjectSnapshot(snapshot, { addToHistory = true } = {}) {
  const db = await openDatabase();
  try {
    const readTx = db.transaction(STORE_NAME, 'readonly');
    const existing = await requestValue(readTx.objectStore(STORE_NAME), HISTORY_KEY);
    const history = Array.isArray(existing) ? existing : [];
    let nextHistory = history;
    if (addToHistory && snapshot && snapshotBytes(snapshot) <= MAX_HISTORY_ITEM_BYTES) {
      nextHistory = [snapshot, ...history.filter((item) => item?.id !== snapshot.id)].slice(0, MAX_HISTORY_ITEMS);
      let total = 0;
      nextHistory = nextHistory.filter((item) => {
        const size = snapshotBytes(item);
        if (total + size > MAX_HISTORY_TOTAL_BYTES) return false;
        total += size;
        return true;
      });
    }
    const writeTx = db.transaction(STORE_NAME, 'readwrite');
    const store = writeTx.objectStore(STORE_NAME);
    store.put(snapshot, ACTIVE_KEY);
    if (nextHistory !== history) store.put(nextHistory, HISTORY_KEY);
    await commitTransaction(writeTx);
    return { historySaved: nextHistory !== history, history: nextHistory };
  } finally {
    db.close();
  }
}

export async function loadProjectSnapshot() {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    return await requestValue(tx.objectStore(STORE_NAME), ACTIVE_KEY);
  } finally {
    db.close();
  }
}

export async function loadProjectHistory() {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const result = await requestValue(tx.objectStore(STORE_NAME), HISTORY_KEY);
    return Array.isArray(result) ? result : [];
  } finally {
    db.close();
  }
}

export async function removeProjectHistory(id) {
  const db = await openDatabase();
  try {
    const readTx = db.transaction(STORE_NAME, 'readonly');
    const existing = await requestValue(readTx.objectStore(STORE_NAME), HISTORY_KEY);
    const next = (Array.isArray(existing) ? existing : []).filter((item) => item?.id !== id);
    const writeTx = db.transaction(STORE_NAME, 'readwrite');
    writeTx.objectStore(STORE_NAME).put(next, HISTORY_KEY);
    await commitTransaction(writeTx);
    return next;
  } finally {
    db.close();
  }
}

export async function clearProjectSnapshot() {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(ACTIVE_KEY);
    await commitTransaction(tx);
  } finally {
    db.close();
  }
}
