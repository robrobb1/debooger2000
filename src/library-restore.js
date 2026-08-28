import { auditScore, runProjectAudit } from './audit-engine.js';
import { encodeArrayBufferToBase64, getFileTypeFromName, normalizeVirtualPath } from './file-utils.js';
import { restoreLibraryBatch } from './storage.js';
import { decodeZip } from './zip-codec.js';
import { ZIP_LIMITS, archivePathIsUnsafe } from './zip-engine.js';

const decoder = new TextDecoder('utf-8', { fatal: false });

function newRestoreId(prefix) {
  try { if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`; } catch {}
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanName(value, fallback) {
  return (String(value || fallback).trim() || fallback).slice(0, 120);
}

function validatedVirtualPath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || archivePathIsUnsafe(raw)) throw new Error(`Backup contains an unsafe saved file path: ${raw || '(empty)'}`);
  const normalized = normalizeVirtualPath(raw);
  if (!normalized || normalized !== raw) throw new Error(`Backup contains a non-normal saved file path: ${raw}`);
  return normalized;
}

function validateManifest(manifest) {
  if (!manifest || manifest.format !== 'DEBOOGER2000_LIBRARY_BACKUP' || manifest.formatVersion !== 1) {
    throw new Error('This ZIP is not a supported DEBOOGER2000 library backup.');
  }
  if (!Array.isArray(manifest.items) || !Array.isArray(manifest.folders)) throw new Error('Backup manifest is missing items or folders.');
  if (!manifest.items.length) throw new Error('Backup contains no library items.');
  const declaredFiles = Number(manifest.fileCount);
  const actualFiles = manifest.items.reduce((sum, item) => sum + (Array.isArray(item?.files) ? item.files.length : 0), 0);
  if (!Number.isFinite(declaredFiles) || declaredFiles !== actualFiles) throw new Error('Backup file count does not match its manifest.');
  if (Number(manifest.itemCount) !== manifest.items.length || Number(manifest.folderCount) !== manifest.folders.length) {
    throw new Error('Backup item or folder count does not match its manifest.');
  }
}

export async function decodeLibraryBackup(source) {
  const entries = await decodeZip(source, ZIP_LIMITS, archivePathIsUnsafe);
  const map = new Map(entries.map((entry) => [entry.path, entry.data]));
  const manifestBytes = map.get('DEBOOGER-BACKUP.json');
  if (!manifestBytes) throw new Error('Backup is missing DEBOOGER-BACKUP.json.');
  let manifest;
  try { manifest = JSON.parse(decoder.decode(manifestBytes)); }
  catch { throw new Error('DEBOOGER-BACKUP.json is not valid JSON.'); }
  validateManifest(manifest);

  const now = Date.now();
  const folderMap = new Map();
  const folders = [];
  const sourceFolderIds = new Set();
  for (const source of manifest.folders) {
    const oldId = String(source?.id || '');
    if (!oldId || oldId === 'root' || sourceFolderIds.has(oldId)) throw new Error('Backup contains an invalid or duplicate folder id.');
    sourceFolderIds.add(oldId);
    const id = newRestoreId('folder');
    folderMap.set(oldId, id);
    folders.push({
      id,
      name: cleanName(source?.name, 'Restored folder'),
      createdAt: Number(source?.createdAt || now),
      updatedAt: now,
      restoredFromId: oldId
    });
  }

  const expectedArchivePaths = new Set();
  const items = [];
  for (const source of manifest.items) {
    if (!Array.isArray(source?.files) || !source.files.length) throw new Error('Backup contains a library item with no files.');
    const files = Object.create(null);
    let totalSize = 0;
    for (const record of source.files) {
      const path = validatedVirtualPath(record?.path);
      const archivePath = String(record?.archivePath || '');
      if (!archivePath || archivePathIsUnsafe(archivePath) || !archivePath.startsWith('items/')) throw new Error(`Backup contains an invalid archive path for ${path}.`);
      if (expectedArchivePaths.has(archivePath)) throw new Error(`Backup manifest references the same archive file twice: ${archivePath}`);
      expectedArchivePaths.add(archivePath);
      const data = map.get(archivePath);
      if (!data) throw new Error(`Backup is missing saved file data: ${archivePath}`);
      const binary = Boolean(record?.binary);
      const type = String(record?.type || getFileTypeFromName(path));
      const content = binary
        ? encodeArrayBufferToBase64(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
        : decoder.decode(data);
      files[path] = {
        content,
        size: data.byteLength,
        type,
        binary,
        encoding: binary ? 'base64' : undefined,
        modified: Boolean(record?.modified)
      };
      totalSize += data.byteLength;
    }

    const projectType = String(source?.projectType || 'unknown').slice(0, 80);
    const findings = runProjectAudit(files, { projectType, runtimeErrors: [] });
    const oldFolderId = String(source?.folderId || 'root');
    const folderId = oldFolderId === 'root' ? 'root' : (folderMap.get(oldFolderId) || 'root');
    const paths = Object.keys(files);
    const requestedEntry = String(source?.entryFile || '');
    const entryFile = requestedEntry && files[requestedEntry] ? requestedEntry : paths[0];
    items.push({
      id: newRestoreId('item'),
      name: cleanName(source?.name, source?.projectName || 'Restored item'),
      projectName: cleanName(source?.projectName, source?.name || 'Restored item'),
      projectType,
      entryFile,
      files,
      fileCount: paths.length,
      size: totalSize,
      savedAt: Number(source?.savedAt || now),
      updatedAt: now,
      folderId,
      auditFindings: findings,
      auditScore: auditScore(findings),
      auditStatus: findings.some((item) => item.severity === 'critical' || item.severity === 'error') ? 'issues' : 'clean',
      restoredFromId: String(source?.id || '')
    });
  }

  const actualArchivePaths = [...map.keys()].filter((path) => path !== 'DEBOOGER-BACKUP.json');
  if (actualArchivePaths.length !== expectedArchivePaths.size || actualArchivePaths.some((path) => !expectedArchivePaths.has(path))) {
    throw new Error('Backup contains unexpected or unreferenced archive files.');
  }

  return { manifest, folders, items };
}

export async function restoreLibraryBackupFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Select a DEBOOGER library backup ZIP first.');
  if (Number(file.size || 0) > ZIP_LIMITS.maxArchiveBytes) throw new Error(`Backup ZIP is too large; safety limit is ${Math.round(ZIP_LIMITS.maxArchiveBytes / 1024 / 1024)} MB.`);
  const decoded = await decodeLibraryBackup(await file.arrayBuffer());
  const result = await restoreLibraryBatch({ folders: decoded.folders, items: decoded.items });
  return { ...result, fileCount: decoded.manifest.fileCount };
}

function setStatus(message, isError = false) {
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', Boolean(isError));
}

async function handleRestoreSelection(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  setStatus('Validating and restoring library backup…');
  try {
    const result = await restoreLibraryBackupFile(file);
    setStatus(`Restored ${result.itemCount} item${result.itemCount === 1 ? '' : 's'} and ${result.folderCount} folder${result.folderCount === 1 ? '' : 's'}. Reloading Files…`);
    setTimeout(() => location.reload(), 350);
  } catch (error) {
    setStatus(error?.message || 'Library backup could not be restored.', true);
  }
}

function registerRestoreUi() {
  const button = document.getElementById('restore-library');
  const input = document.getElementById('restore-library-input');
  if (!button || !input) return;
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => handleRestoreSelection(input));
}

if (globalThis.document) {
  if (document.readyState === 'loading') globalThis.addEventListener?.('DOMContentLoaded', registerRestoreUi, { once: true });
  else registerRestoreUi();
}
