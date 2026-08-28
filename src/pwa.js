export async function registerOfflineShell() {
  if (!('serviceWorker' in navigator)) return null;
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    return await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
  } catch {
    return null;
  }
}

registerOfflineShell();
