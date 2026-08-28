import { decodeBase64ToUint8Array } from './file-utils.js';
import { listFolders, listLibraryItems } from './storage.js';
import { encodeStoredZip } from './zip-codec.js';

const MAX_BACKUP_ENTRIES = 65000;
const encoder = new TextEncoder();

function safeSegment(value, fallback = 'item') {
  const clean = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+$/, '').slice(0, 120);
  return clean || fallback;
}

function safeRelativePath(value) {
  const out = [];
  for (const part of String(value || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.push('__parent__');
    else out.push(part.replace(/[\u0000-\u001f]/g, '_'));
  }
  return out.join('/') || 'unnamed-file';
}

export function buildLibraryBackupEntries(items, folders, createdAt = new Date().toISOString()) {
  const entries = [];
  const manifestItems = [];
  const sourceItems = Array.isArray(items) ? items : [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index] || {};
    const archiveRoot = `items/${String(index + 1).padStart(4, '0')}-${safeSegment(item.id, 'item')}`;
    const fileRecords = [];
    for (const [path, file] of Object.entries(item.files || {})) {
      const safePath = safeRelativePath(path);
      const archivePath = `${archiveRoot}/${safePath}`;
      const data = file?.binary
        ? decodeBase64ToUint8Array(String(file.content || ''))
        : encoder.encode(String(file?.content ?? ''));
      entries.push({ path: archivePath, data });
      fileRecords.push({
        path,
        archivePath,
        binary: Boolean(file?.binary),
        encoding: file?.encoding || (file?.binary ? 'base64' : 'utf-8'),
        type: String(file?.type || ''),
        size: Number(file?.size || data.byteLength),
        modified: Boolean(file?.modified)
      });
    }
    const { files, ...metadata } = item;
    manifestItems.push({ ...metadata, archiveRoot, files: fileRecords });
  }

  if (entries.length + 1 > MAX_BACKUP_ENTRIES) {
    throw new Error(`Library backup has too many files for a standard ZIP. Limit: ${MAX_BACKUP_ENTRIES - 1} saved files.`);
  }

  const manifest = {
    format: 'DEBOOGER2000_LIBRARY_BACKUP',
    formatVersion: 1,
    createdAt,
    folderCount: Array.isArray(folders) ? folders.length : 0,
    itemCount: sourceItems.length,
    fileCount: entries.length,
    folders: Array.isArray(folders) ? folders : [],
    items: manifestItems
  };
  entries.unshift({ path: 'DEBOOGER-BACKUP.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) });
  return { entries, manifest };
}

export async function createLibraryBackupBlob() {
  const [items, folders] = await Promise.all([listLibraryItems(), listFolders()]);
  if (!items.length) throw new Error('There are no saved library items to back up.');
  const { entries, manifest } = buildLibraryBackupEntries(items, folders);
  return { blob: new Blob([encodeStoredZip(entries)], { type: 'application/zip' }), manifest };
}

function backupFilename(date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return `DEBOOGER2000-Library-Backup-${stamp}.zip`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setStatus(message, isError = false) {
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', Boolean(isError));
}

export async function backupLibrary() {
  setStatus('Creating full library backup…');
  try {
    const { blob, manifest } = await createLibraryBackupBlob();
    downloadBlob(blob, backupFilename());
    setStatus(`Library backup ready · ${manifest.itemCount} item${manifest.itemCount === 1 ? '' : 's'} · ${manifest.fileCount} file${manifest.fileCount === 1 ? '' : 's'}.`);
    return manifest;
  } catch (error) {
    setStatus(error?.message || 'Library backup could not be created.', true);
    return null;
  }
}

function registerBackupButton() {
  const button = document.getElementById('backup-library');
  if (!button) return;
  button.addEventListener('click', backupLibrary);
}

if (globalThis.document) {
  if (document.readyState === 'loading') globalThis.addEventListener?.('DOMContentLoaded', registerBackupButton, { once: true });
  else registerBackupButton();
}
