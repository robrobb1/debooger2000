const TEXT_EXTENSIONS = new Set([
  'html','htm','css','js','mjs','cjs','jsx','ts','tsx','json','md','txt','xml','svg','py','sh','vbs','yml','yaml','env','gitignore'
]);

export function normalizeVirtualPath(path) {
  const parts = String(path || '').replace(/\\/g, '/').split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function getFileTypeFromName(path) {
  const lower = String(path || '').toLowerCase();
  if (/\.html?$/.test(lower)) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (/\.(?:mjs|cjs|js)$/.test(lower)) return 'javascript';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.json')) return 'json';
  const ext = lower.split('.').pop();
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'binary';
}

export function isTextVirtualPath(path) {
  return getFileTypeFromName(path) !== 'binary';
}

export function encodeArrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function decodeBase64ToUint8Array(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
