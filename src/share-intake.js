const MAX_SHARE_CHARS = 512 * 1024;

export function readSharePayload(locationLike = globalThis.location) {
  if (!locationLike) return null;
  let raw = '';
  try {
    const search = new URLSearchParams(String(locationLike.search || ''));
    raw = search.get('share') || '';
    if (!raw && locationLike.hash) {
      const hash = String(locationLike.hash).replace(/^#/, '');
      raw = new URLSearchParams(hash).get('share') || '';
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
    url.searchParams.delete('share');
    if (url.hash) {
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      hash.delete('share');
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
