function formatStorageBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export async function readStorageHealth(storage = globalThis.navigator?.storage) {
  if (!storage) return { supported: false, persistent: null, usage: null, quota: null };
  let persistent = null;
  let usage = null;
  let quota = null;
  try {
    if (typeof storage.persisted === 'function') persistent = Boolean(await storage.persisted());
  } catch {}
  try {
    if (typeof storage.estimate === 'function') {
      const estimate = await storage.estimate();
      if (Number.isFinite(Number(estimate?.usage))) usage = Number(estimate.usage);
      if (Number.isFinite(Number(estimate?.quota))) quota = Number(estimate.quota);
    }
  } catch {}
  return { supported: persistent !== null || usage !== null || quota !== null, persistent, usage, quota };
}

export function storageHealthText(health) {
  if (!health?.supported) return 'Storage details are unavailable in this browser.';
  const parts = [];
  if (health.persistent === true) parts.push('Persistent storage: on');
  else if (health.persistent === false) parts.push('Persistent storage: not guaranteed');
  if (health.usage !== null && health.quota !== null && health.quota > 0) {
    const percent = Math.min(100, Math.max(0, (health.usage / health.quota) * 100));
    parts.push(`${formatStorageBytes(health.usage)} used of ${formatStorageBytes(health.quota)} (${percent.toFixed(percent < 10 ? 1 : 0)}%)`);
  } else if (health.usage !== null) parts.push(`${formatStorageBytes(health.usage)} used`);
  return parts.join(' · ') || 'Storage details are unavailable in this browser.';
}

export async function refreshStorageHealth(doc = globalThis.document) {
  const target = doc?.getElementById?.('storage-health');
  if (!target) return null;
  const health = await readStorageHealth();
  target.textContent = storageHealthText(health);
  return health;
}

function start() {
  refreshStorageHealth();
  globalThis.document?.getElementById?.('library-tools')?.addEventListener?.('click', () => { refreshStorageHealth(); });
}

if (globalThis.document) {
  if (document.readyState === 'loading') globalThis.addEventListener?.('DOMContentLoaded', start, { once: true });
  else start();
}
