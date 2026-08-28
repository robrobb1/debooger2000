import { encodeArrayBufferToBase64, getFileTypeFromName, isTextVirtualPath, normalizeVirtualPath } from './file-utils.js';
import { decodeZip } from './zip-codec.js';

export const ZIP_LIMITS = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 10000,
  maxSingleUncompressedBytes: 128 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxTotalCompressedBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 250
});

export function archivePathIsUnsafe(path) {
  const raw = String(path || '').replace(/\\/g, '/');
  if (!raw || raw.includes('\u0000') || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) return true;
  return raw.split('/').some((part) => part === '..');
}

export function looksLikeZip(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return name.endsWith('.zip') || type.includes('zip');
}

export async function parseZipArchive(zipFile) {
  const archiveBytes = Number(zipFile?.size || 0);
  if (archiveBytes > ZIP_LIMITS.maxArchiveBytes) throw new Error(`ZIP archive is too large; safety limit is ${Math.round(ZIP_LIMITS.maxArchiveBytes / 1024 / 1024)} MB.`);
  const source = typeof zipFile?.arrayBuffer === 'function' ? await zipFile.arrayBuffer() : zipFile;
  const entries = await decodeZip(source, ZIP_LIMITS, archivePathIsUnsafe);
  const files = Object.create(null);
  for (const { path: rawPath, data } of entries) {
    const path = normalizeVirtualPath(rawPath);
    if (!path || path.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/i.test(path)) continue;
    const type = getFileTypeFromName(path);
    if (isTextVirtualPath(path)) {
      const content = new TextDecoder('utf-8', { fatal: false }).decode(data);
      files[path] = { content, size: data.byteLength, type, modified: false, binary: false };
    } else {
      files[path] = { content: encodeArrayBufferToBase64(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)), size: data.byteLength, type, modified: false, binary: true, encoding: 'base64' };
    }
  }
  if (!Object.keys(files).length) throw new Error('ZIP did not contain usable project files.');
  return { projectName: String(zipFile?.name || 'project.zip').replace(/\.zip$/i, '') || 'project', files };
}
