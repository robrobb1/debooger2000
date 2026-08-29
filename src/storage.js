const DB_NAME = 'debooger2000';
const DB_VERSION = 4;
const LIBRARY_STORE = 'library-items';
const FOLDER_STORE = 'folders';
const DELETED_STORE = 'deleted-items';
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
      const folders = db.objectStoreNames.contains(FOLDER_STORE)
        ? tx.objectStore(FOLDER_STORE)
        : db.createObjectStore(FOLDER_STORE, { keyPath: 'id' });
      if (!folders.indexNames.contains('name')) folders.createIndex('name', 'name');
      const deleted = db.objectStoreNames.contains(DELETED_STORE)
        ? tx.objectStore(DELETED_STORE)
        : db.createObjectStore(DELETED_STORE, { keyPath: 'id' });
      if (!deleted.indexNames.contains('deletedAt')) deleted.createIndex('deletedAt', 'deletedAt');

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

function copyId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveLibraryItem(item) {
  if (!item?.id) throw new Error('Library item id is required.');
  const db = await openDatabase();
  try {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite');
    tx.objectStore(LIBRARY_STORE).put(item);
    await commitTransaction(tx);
    return item;
  } finally { db.close(); }
}

export async function listLibraryItems() {
  const db = await openDatabase();
  try {
    const tx = db.transaction(LIBRARY_STORE, 'readonly');
    const result = await requestResult(tx.objectStore(LIBRARY_STORE).getAll(), 'Could not read the Files library.');
    return Array.isArray(result) ? result : [];
  } finally { db.close(); }
}

export async function getLibraryItem(id) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(LIBRARY_STORE, 'readonly');
    return await requestResult(tx.objectStore(LIBRARY_STORE).get(String(id)), 'Could not read the selected library item.');
  } finally { db.close(); }
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
  } finally { db.close(); }
}

export async function deleteLibraryItem(id) {
  const key = String(id);
  const db = await openDatabase();
  try {
    const tx = db.transaction([LIBRARY_STORE, DELETED_STORE], 'readwrite');
    const library = tx.objectStore(LIBRARY_STORE);
    const deleted = tx.objectStore(DELETED_STORE);
    const existing = await requestResult(library.get(key), 'Could not read the selected library item.');
    if (!existing) throw new Error('The selected library item no longer exists.');
    deleted.put({ ...existing, deletedAt: Date.now(), originalFolderId: String(existing.folderId || 'root') });
    library.delete(key);
    await commitTransaction(tx);
  } finally { db.close(); }
}

export async function listDeletedLibraryItems() {
  const db = await openDatabase();
  try {
    const tx = db.transaction(DELETED_STORE, 'readonly');
    const result = await requestResult(tx.objectStore(DELETED_STORE).getAll(), 'Could not read Recently Deleted.');
    return (Array.isArray(result) ? result : []).sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
  } finally { db.close(); }
}

export async function restoreDeletedLibraryItem(id) {
  const key = String(id);
  const db = await openDatabase();
  try {
    const tx = db.transaction([DELETED_STORE, LIBRARY_STORE, FOLDER_STORE], 'readwrite');
    const deleted = tx.objectStore(DELETED_STORE);
    const library = tx.objectStore(LIBRARY_STORE);
    const folders = tx.objectStore(FOLDER_STORE);
    const existing = await requestResult(deleted.get(key), 'Could not read the deleted item.');
    if (!existing) throw new Error('The deleted item no longer exists.');
    let folderId = String(existing.originalFolderId || existing.folderId || 'root');
    if (folderId !== 'root') {
      const folder = await requestResult(folders.get(folderId), 'Could not verify the original folder.');
      if (!folder) folderId = 'root';
    }
    const { deletedAt, originalFolderId, ...rest } = existing;
    const restored = { ...rest, folderId, updatedAt: Date.now() };
    library.add(restored);
    deleted.delete(key);
    await commitTransaction(tx);
    return restored;
  } finally { db.close(); }
}

export async function deleteDeletedLibraryItem(id) {
  const db = await openDatabase();
  try {
    const tx = db.transaction(DELETED_STORE, 'readwrite');
    tx.objectStore(DELETED_STORE).delete(String(id));
    await commitTransaction(tx);
  } finally { db.close(); }
}

export async function duplicateLibraryItem(id) {
  const original = await getLibraryItem(id);
  if (!original) throw new Error('The selected library item no longer exists.');
  const now = Date.now();
  const copy = structuredClone(original);
  copy.id = copyId();
  copy.name = `${original.name || original.projectName || 'Project'} copy`;
  copy.projectName = copy.name;
  copy.savedAt = now;
  copy.updatedAt = now;
  await saveLibraryItem(copy);
  return copy;
}

export async function listFolders() {
  const db = await openDatabase();
  try {
    const tx = db.transaction(FOLDER_STORE, 'readonly');
    const result = await requestResult(tx.objectStore(FOLDER_STORE).getAll(), 'Could not read folders.');
    return (Array.isArray(result) ? result : []).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  } finally { db.close(); }
}

export async function createFolder(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Folder name is required.');
  const folder = { id: copyId(), name: clean, createdAt: Date.now(), updatedAt: Date.now() };
  const db = await openDatabase();
  try {
    const tx = db.transaction(FOLDER_STORE, 'readwrite');
    tx.objectStore(FOLDER_STORE).put(folder);
    await commitTransaction(tx);
    return folder;
  } finally { db.close(); }
}

export async function renameFolder(id, name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Folder name is required.');
  const db = await openDatabase();
  try {
    const tx = db.transaction(FOLDER_STORE, 'readwrite');
    const store = tx.objectStore(FOLDER_STORE);
    const existing = await requestResult(store.get(String(id)), 'Could not read the folder.');
    if (!existing) throw new Error('The folder no longer exists.');
    const next = { ...existing, name: clean, updatedAt: Date.now() };
    store.put(next);
    await commitTransaction(tx);
    return next;
  } finally { db.close(); }
}

export async function deleteFolder(id) {
  const folderId = String(id);
  const db = await openDatabase();
  try {
    const tx = db.transaction([FOLDER_STORE, LIBRARY_STORE], 'readwrite');
    const folders = tx.objectStore(FOLDER_STORE);
    const library = tx.objectStore(LIBRARY_STORE);
    const items = await requestResult(library.getAll(), 'Could not read the Files library.');
    for (const item of Array.isArray(items) ? items : []) {
      if (String(item.folderId || 'root') === folderId) library.put({ ...item, folderId: 'root', updatedAt: Date.now() });
    }
    folders.delete(folderId);
    await commitTransaction(tx);
  } finally { db.close(); }
}

export async function restoreLibraryBatch({ folders = [], items = [] } = {}) {
  if (!Array.isArray(folders) || !Array.isArray(items)) throw new Error('Restore batch must contain folder and item arrays.');
  const folderIds = new Set();
  for (const folder of folders) {
    const id = String(folder?.id || '');
    if (!id || id === 'root' || folderIds.has(id)) throw new Error('Restore batch contains an invalid or duplicate folder id.');
    folderIds.add(id);
  }
  const itemIds = new Set();
  for (const item of items) {
    const id = String(item?.id || '');
    if (!id || itemIds.has(id)) throw new Error('Restore batch contains an invalid or duplicate item id.');
    itemIds.add(id);
    const folderId = String(item?.folderId || 'root');
    if (folderId !== 'root' && !folderIds.has(folderId)) throw new Error('Restore batch item references a folder that is not in the same batch.');
  }

  const db = await openDatabase();
  try {
    const tx = db.transaction([FOLDER_STORE, LIBRARY_STORE], 'readwrite');
    const folderStore = tx.objectStore(FOLDER_STORE);
    const libraryStore = tx.objectStore(LIBRARY_STORE);
    for (const folder of folders) folderStore.add(folder);
    for (const item of items) libraryStore.add(item);
    await commitTransaction(tx);
    return { folderCount: folders.length, itemCount: items.length };
  } finally { db.close(); }
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try { return Boolean(await navigator.storage.persist()); }
  catch { return false; }
}
