const CHUNK_BYTES = 512 * 1024;

function nativeHandler() {
  return globalThis.webkit?.messageHandlers?.deboogerNative || null;
}

export function nativeInboxAvailable() {
  return Boolean(nativeHandler());
}

function decodeBase64(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readNativeFile(itemId, descriptor) {
  const chunks = [];
  let total = 0;
  let offset = 0;
  while (true) {
    const result = await nativeHandler().postMessage({
      action: 'readChunk',
      itemId,
      relativePath: descriptor.relativePath,
      offset,
      length: CHUNK_BYTES
    });
    const bytes = decodeBase64(result?.base64);
    if (bytes.byteLength) {
      chunks.push(bytes);
      total += bytes.byteLength;
    }
    offset = Number(result?.nextOffset ?? (offset + bytes.byteLength));
    if (result?.eof || bytes.byteLength === 0) break;
  }
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { merged.set(chunk, cursor); cursor += chunk.byteLength; }
  const file = new File([merged], descriptor.name || 'shared-item', { type: descriptor.mimeType || 'application/octet-stream', lastModified: Number(descriptor.modifiedAt || Date.now()) });
  if (descriptor.relativePath) {
    try { Object.defineProperty(file, 'webkitRelativePath', { value: descriptor.relativePath.replace(/^files\//, ''), configurable: true }); } catch {}
  }
  return file;
}

async function dispatchNativeFiles(item, files) {
  return new Promise((resolve) => {
    const detail = {
      itemId: item.id,
      files,
      complete: () => resolve(true),
      fail: () => resolve(false)
    };
    dispatchEvent(new CustomEvent('debooger-native-files', { detail }));
  });
}

async function importPendingItem(item) {
  if (!item?.id || !Array.isArray(item.files) || !item.files.length) return false;
  const files = [];
  for (const descriptor of item.files) files.push(await readNativeFile(item.id, descriptor));
  const saved = await dispatchNativeFiles(item, files);
  if (!saved) return false;
  await nativeHandler().postMessage({ action: 'ackInbox', itemId: item.id });
  return true;
}

let intakeRunning = false;
export async function importNativeInbox() {
  if (!nativeInboxAvailable() || intakeRunning) return 0;
  intakeRunning = true;
  let imported = 0;
  try {
    const result = await nativeHandler().postMessage({ action: 'listInbox' });
    const items = Array.isArray(result?.items) ? result.items : [];
    for (const item of items) {
      try { if (await importPendingItem(item)) imported += 1; }
      catch { break; }
    }
    return imported;
  } finally {
    intakeRunning = false;
  }
}

function refreshOnForeground() {
  if (!document.hidden) importNativeInbox();
}

if (nativeInboxAvailable()) {
  addEventListener('focus', refreshOnForeground);
  document.addEventListener('visibilitychange', refreshOnForeground);
  queueMicrotask(() => importNativeInbox());
}
