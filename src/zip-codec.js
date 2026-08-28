const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

let crcTable = null;
function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}
export function crc32(bytes) {
  let c = 0xffffffff;
  const t = table();
  for (let i = 0; i < bytes.length; i += 1) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(view, at) { return view.getUint16(at, true); }
function u32(view, at) { return view.getUint32(at, true); }
function findEocd(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.length - 65557);
  for (let at = bytes.length - 22; at >= start; at -= 1) if (u32(view, at) === SIG_EOCD) return at;
  return -1;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress DEFLATE ZIP entries.');
  let stream;
  try { stream = new DecompressionStream('deflate-raw'); }
  catch { throw new Error('This browser does not support raw DEFLATE ZIP decompression.'); }
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

export async function decodeZip(arrayBuffer, limits, unsafePath) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error('ZIP central directory was not found; the archive may be corrupted.');
  const entries = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12);
  const centralOffset = u32(view, eocd + 16);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported by this browser build yet.');
  if (entries > limits.maxEntries) throw new Error(`ZIP has ${entries} files; safety limit is ${limits.maxEntries}.`);
  if (centralOffset + centralSize > bytes.length) throw new Error('ZIP central directory points outside the archive.');

  const planned = [];
  const seen = new Set();
  let at = centralOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  for (let i = 0; i < entries; i += 1) {
    if (at + 46 > bytes.length || u32(view, at) !== SIG_CENTRAL) throw new Error('ZIP central directory is malformed.');
    const flags = u16(view, at + 8);
    const method = u16(view, at + 10);
    const expectedCrc = u32(view, at + 16);
    const compressedSize = u32(view, at + 20);
    const uncompressedSize = u32(view, at + 24);
    const nameLen = u16(view, at + 28);
    const extraLen = u16(view, at + 30);
    const commentLen = u16(view, at + 32);
    const localOffset = u32(view, at + 42);
    if (flags & 1) throw new Error('Encrypted ZIP entries are not supported.');
    if (![0, 8].includes(method)) throw new Error(`ZIP compression method ${method} is not supported.`);
    const end = at + 46 + nameLen + extraLen + commentLen;
    if (end > bytes.length) throw new Error('ZIP filename or metadata extends outside the archive.');
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at = end;
    if (!name || name.endsWith('/')) continue;
    if (unsafePath(name)) throw new Error(`Unsafe ZIP path rejected: ${name}`);
    if (seen.has(name)) throw new Error(`ZIP contains duplicate path: ${name}`);
    seen.add(name);
    if (uncompressedSize > limits.maxSingleUncompressedBytes) throw new Error(`ZIP entry is too large after extraction: ${name}`);
    if (uncompressedSize > 1024 * 1024 && compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) throw new Error(`ZIP entry has an unsafe compression ratio: ${name}`);
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (totalCompressed > limits.maxTotalCompressedBytes) throw new Error('ZIP compressed payload exceeds the safe archive limit.');
    if (totalUncompressed > limits.maxTotalUncompressedBytes) throw new Error('ZIP uncompressed payload exceeds the safe extraction limit.');
    planned.push({ name, method, expectedCrc, compressedSize, uncompressedSize, localOffset });
  }

  const out = [];
  for (const item of planned) {
    const lo = item.localOffset;
    if (lo + 30 > bytes.length || u32(view, lo) !== SIG_LOCAL) throw new Error(`ZIP local header is missing for ${item.name}.`);
    const nameLen = u16(view, lo + 26);
    const extraLen = u16(view, lo + 28);
    const start = lo + 30 + nameLen + extraLen;
    const end = start + item.compressedSize;
    if (end > bytes.length) throw new Error(`ZIP data extends outside the archive for ${item.name}.`);
    const packed = bytes.subarray(start, end);
    const data = item.method === 0 ? new Uint8Array(packed) : await inflateRaw(packed);
    if (data.byteLength !== item.uncompressedSize) throw new Error(`ZIP size check failed for ${item.name}.`);
    if (crc32(data) !== item.expectedCrc) throw new Error(`ZIP CRC check failed for ${item.name}.`);
    out.push({ path: item.name, data });
  }
  return out;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31);
  const day = ((year - 1980) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}
function put16(view, at, value) { view.setUint16(at, value, true); }
function put32(view, at, value) { view.setUint32(at, value >>> 0, true); }

export function encodeStoredZip(entries) {
  const items = entries.map(({ path, data }) => ({ name: encoder.encode(path), path, data: data instanceof Uint8Array ? data : new Uint8Array(data), crc: crc32(data instanceof Uint8Array ? data : new Uint8Array(data)) }));
  let localBytes = 0;
  for (const i of items) localBytes += 30 + i.name.length + i.data.length;
  let centralBytes = 0;
  for (const i of items) centralBytes += 46 + i.name.length;
  const total = localBytes + centralBytes + 22;
  if (total > 0xffffffff) throw new Error('ZIP export exceeds the standard ZIP size limit.');
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  const { time, day } = dosDateTime();
  let at = 0;
  for (const i of items) {
    i.offset = at;
    put32(view, at, SIG_LOCAL); put16(view, at + 4, 20); put16(view, at + 6, 0x0800); put16(view, at + 8, 0);
    put16(view, at + 10, time); put16(view, at + 12, day); put32(view, at + 14, i.crc); put32(view, at + 18, i.data.length); put32(view, at + 22, i.data.length);
    put16(view, at + 26, i.name.length); put16(view, at + 28, 0); output.set(i.name, at + 30); output.set(i.data, at + 30 + i.name.length);
    at += 30 + i.name.length + i.data.length;
  }
  const centralOffset = at;
  for (const i of items) {
    put32(view, at, SIG_CENTRAL); put16(view, at + 4, 20); put16(view, at + 6, 20); put16(view, at + 8, 0x0800); put16(view, at + 10, 0);
    put16(view, at + 12, time); put16(view, at + 14, day); put32(view, at + 16, i.crc); put32(view, at + 20, i.data.length); put32(view, at + 24, i.data.length);
    put16(view, at + 28, i.name.length); put16(view, at + 30, 0); put16(view, at + 32, 0); put16(view, at + 34, 0); put16(view, at + 36, 0); put32(view, at + 38, 0); put32(view, at + 42, i.offset);
    output.set(i.name, at + 46); at += 46 + i.name.length;
  }
  put32(view, at, SIG_EOCD); put16(view, at + 4, 0); put16(view, at + 6, 0); put16(view, at + 8, items.length); put16(view, at + 10, items.length);
  put32(view, at + 12, at - centralOffset); put32(view, at + 16, centralOffset); put16(view, at + 20, 0);
  return output;
}
