const DB_NAME = 'debooger2000';
const DB_VERSION = 2;
const LIBRARY_STORE = 'library-items';
const LEGACY_STORE = 'project-cache';
const LEGACY_ACTIVE_KEY = 'active';
const LEGACY_HISTORY_KEY = 'history';

function normalizeLegacySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.files) return null;
  const id = String(snapshot.id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const savedAt = Number(snapshot.savedAt || Date.now());
  const size = Object.values(snapshot.files || {}).reduce((sum, file) => sum + Number(file?.size || 0), 0);
  return {
    id,
    name: String(snapshot.projectName || 'Project'),
    projectName: String(snapshot.projectName || 'Project'),
    projectType: String(snapshot.projectType || 'unknown'),
    entryFile: String(snapshot.entryFile || ''),
    files: snapshot.files,
    fileCount: Object.keys(snapshot.files || {}).length,
    size,
    savedAt,
    updatedAt: savedAt,
    folderId: 'root',
    auditFindings: [],
    auditScore: null,
    auditStatus: 'needs-audit'
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB is unavailable.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      const library = db.objectStoreNames.contains(LIBRARY_STORE)
        ? tx.objectStore(LIBRARY_STORE)
        : db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
      if (!library.indexNames.contains('savedAt')) library.createIndex('savedAt', 'savedAt');
      if (!library.indexNames.contains('folderId')) library.createIndex('folderId', 'folderId');
      if (!library.indexNames.contains('projectType')) library.createIndex('projectType', 'projectType');

      if (db.objectStoreNames.contains(LEGACY_STORE)) {
        const legacy = tx.objectStore(LEGACY_STORE);
        const historyRequest = legacy.get(LEGACY_HISTORY_KEY);
        const activeRequest = legacy.get(LEGACY_ACTIVE_KEY);
        let history = [];
        let active = null;
        let completed = 0;
        const finishMigration = () => {
          completed += 1;
          if (completed < 2) return;
          const unique = new Map();
          for (const snapshot of Array.isArray(history) ? history : []) {
            const item = normalizeLegacySnapshot(snapshot);
            if (item) unique.set(item.id, item);
          }
          const activeItem = normalizeLegacySnapshot(active);
          if (activeItem && !unique.has(activeItem.id)) unique.set(activeItem.id, activeItem);
          for (const item of unique.values()) library.put(item);
          db.deleteObjectStore(LEGACY_STORE);
        };
        historyRequest.onsuccess = () => { history = historyRequest.result; finishMigration(); };
        historyRequest.onerror = finishMigration;
        activeRequest.onsuccess = () => { active = activeRequest.result; finishMigration(); };
        activeRequest.onerror = finishMigration;
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open DEBOOGER storage.'));
  });
}

function requestResult(request, message) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error(message));
  });
}

function commitTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not write DEBOOGER storage.'));
    tx.onabort = () => reject(tx.error || new Error('DEBOOGER storage transaction was aborted.'));
  });
}

export async function saveLibraryItem(item) {
  if (!item?.id) throw new Error('Library item id is required.');
  const db = await openDatabase();
  try {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite');
    tx.objectStore(LIBRARY_STORE).put(item);
    await commitTransaction(tx);
    return item;
  } finally {
    db.close();
  }
}

export async function listLibraryItems() {
  const db = await openDatabase();
  try {
    const tx = db.transaction(LIBRARY_STORE, 'readonly');
    const result = await requestResult(tx.objectStore(LIBRARY_STORE).getAll(), 'Could not read the Files library.');
    return (Array.isArray(result) ? result : []).sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
  } finally {
    db.close();
  }
}

export async function getLibraryItem(id) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(LIBRARY_STORE, 'readonly');
    return await requestResult(tx.objectStore(LIBRARY_STORE).get(String(id)), 'Could not read the selected library item.');
  } finally {
    db.close();
  }
}

export async function updateLibraryItem(id, patch) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite');
    const store = tx.objectStore(LIBRARY_STORE);
    const existing = await requestResult(store.get(String(id)), 'Could not read the selected library item.');
    if (!existing) throw new Error('The selected library item no longer exists.');
    const next = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
    store.put(next);
    await commitTransaction(tx);
    return next;
  } finally {
    db.close();
  }
}

export async function deleteLibraryItem(id) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite');
    tx.objectStore(LIBRARY_STORE).delete(String(id));
    await commitTransaction(tx);
  } finally {
    db.close();
  }
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try { return Boolean(await navigator.storage.persist()); }
  catch { return false; }
}
