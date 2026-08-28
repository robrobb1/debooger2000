import { encodeArrayBufferToBase64, getFileTypeFromName, isTextVirtualPath, normalizeVirtualPath } from './file-utils.js';

export const ZIP_LIMITS = Object.freeze({ maxArchiveBytes: 256 * 1024 * 1024, maxEntries: 10000, maxSingleUncompressedBytes: 128 * 1024 * 1024, maxTotalUncompressedBytes: 512 * 1024 * 1024, maxTotalCompressedBytes: 256 * 1024 * 1024, maxCompressionRatio: 250 });

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
  const JSZip = globalThis.JSZip;
  if (!JSZip) throw new Error('ZIP support is unavailable because the ZIP engine did not load.');
  const archiveBytes = Number(zipFile?.size || 0);
  if (archiveBytes > ZIP_LIMITS.maxArchiveBytes) throw new Error(`ZIP archive is too large; safety limit is ${Math.round(ZIP_LIMITS.maxArchiveBytes / 1024 / 1024)} MB.`);
  const source = typeof zipFile?.arrayBuffer === 'function' ? await zipFile.arrayBuffer() : zipFile;
  const zip = new JSZip();
  const contents = await zip.loadAsync(source);
  const entries = Object.entries(contents.files).filter(([, fileObj]) => !fileObj.dir);
  if (entries.length > ZIP_LIMITS.maxEntries) throw new Error(`ZIP has ${entries.length} files; safety limit is ${ZIP_LIMITS.maxEntries}.`);
  const planned = [];
  const seen = new Set();
  let declaredTotalUncompressed = 0;
  let declaredTotalCompressed = 0;
  for (const [rawPath, fileObj] of entries) {
    const originalPath = String(fileObj.unsafeOriginalName || rawPath || '');
    if (archivePathIsUnsafe(originalPath)) throw new Error(`Unsafe ZIP path rejected: ${originalPath}`);
    const path = normalizeVirtualPath(rawPath);
    if (!path || path.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/i.test(path)) continue;
    if (seen.has(path)) throw new Error(`ZIP contains duplicate normalized path: ${path}`);
    seen.add(path);
    const uncompressed = Number(fileObj?._data?.uncompressedSize || 0);
    const compressed = Number(fileObj?._data?.compressedSize || 0);
    if (![uncompressed, compressed].every(Number.isFinite) || uncompressed < 0 || compressed < 0) throw new Error(`ZIP entry has invalid size metadata: ${path}`);
    if (uncompressed > ZIP_LIMITS.maxSingleUncompressedBytes) throw new Error(`ZIP entry is too large after extraction: ${path}`);
    if (uncompressed > 1024 * 1024 && compressed > 0 && uncompressed / compressed > ZIP_LIMITS.maxCompressionRatio) throw new Error(`ZIP entry has an unsafe compression ratio: ${path}`);
    declaredTotalUncompressed += uncompressed;
    declaredTotalCompressed += compressed;
    if (declaredTotalUncompressed > ZIP_LIMITS.maxTotalUncompressedBytes) throw new Error('ZIP declares more uncompressed data than the safe total extraction limit.');
    if (declaredTotalCompressed > ZIP_LIMITS.maxTotalCompressedBytes) throw new Error('ZIP contains more compressed payload data than the safe archive limit.');
    planned.push({ path, fileObj });
  }
  const files = Object.create(null);
  let totalExtracted = 0;
  for (const { path, fileObj } of planned) {
    const type = getFileTypeFromName(path);
    if (isTextVirtualPath(path)) {
      const content = await fileObj.async('string');
      const size = new Blob([content]).size;
      if (size > ZIP_LIMITS.maxSingleUncompressedBytes) throw new Error(`ZIP entry is too large after extraction: ${path}`);
      totalExtracted += size;
      files[path] = { content, size, type, modified: false, binary: false };
    } else {
      const bytes = await fileObj.async('uint8array');
      if (bytes.byteLength > ZIP_LIMITS.maxSingleUncompressedBytes) throw new Error(`ZIP entry is too large after extraction: ${path}`);
      totalExtracted += bytes.byteLength;
      files[path] = { content: encodeArrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), size: bytes.byteLength, type, modified: false, binary: true, encoding: 'base64' };
    }
    if (totalExtracted > ZIP_LIMITS.maxTotalUncompressedBytes) throw new Error('ZIP expands beyond the safe total extraction limit.');
  }
  if (!Object.keys(files).length) throw new Error('ZIP did not contain usable project files.');
  return { projectName: String(zipFile?.name || 'project.zip').replace(/\.zip$/i, '') || 'project', files };
}
