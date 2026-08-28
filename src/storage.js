const DB_NAME = 'debooger2000';
const DB_VERSION = 1;
const STORE_NAME = 'project-cache';

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

export async function saveProjectSnapshot(snapshot) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(snapshot, 'active');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save project snapshot.'));
    });
  } finally {
    db.close();
  }
}

export async function loadProjectSnapshot() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get('active');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Could not load project snapshot.'));
    });
  } finally {
    db.close();
  }
}

export async function clearProjectSnapshot() {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete('active');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not clear project snapshot.'));
    });
  } finally {
    db.close();
  }
}
