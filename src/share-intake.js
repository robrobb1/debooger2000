const MAX_SHARE_CHARS = 512 * 1024;
const SHARE_KEYS = ['share', 'title', 'text', 'url'];

function cleanPart(value) {
  return String(value || '').trim();
}

function composeSharePayload(params) {
  const direct = cleanPart(params.get('share'));
  if (direct) return direct;
  const parts = [];
  for (const key of ['title', 'text', 'url']) {
    const value = cleanPart(params.get(key));
    if (value && !parts.includes(value)) parts.push(value);
  }
  return parts.join('\n');
}

export function readSharePayload(locationLike = globalThis.location) {
  if (!locationLike) return null;
  let raw = '';
  try {
    const search = new URLSearchParams(String(locationLike.search || ''));
    raw = composeSharePayload(search);
    if (!raw && locationLike.hash) {
      const hash = new URLSearchParams(String(locationLike.hash).replace(/^#/, ''));
      raw = composeSharePayload(hash);
    }
  } catch { return null; }
  if (!raw) return null;
  if (raw.length > MAX_SHARE_CHARS) throw new Error('Shared text is too large for browser URL intake. Open DEBOOGER and paste the text directly instead.');
  return raw;
}

export function clearSharePayloadFromAddress(historyLike = globalThis.history, locationLike = globalThis.location) {
  if (!historyLike?.replaceState || !locationLike) return;
  try {
    const url = new URL(locationLike.href);
    for (const key of SHARE_KEYS) url.searchParams.delete(key);
    if (url.hash) {
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      for (const key of SHARE_KEYS) hash.delete(key);
      url.hash = hash.toString() ? `#${hash.toString()}` : '';
    }
    historyLike.replaceState(historyLike.state, '', url.href);
  } catch {}
}

export function shortcutUrl(baseUrl, text) {
  const url = new URL(String(baseUrl));
  url.searchParams.set('share', String(text ?? ''));
  return url.href;
}
