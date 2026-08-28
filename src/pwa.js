let updateReady = false;

function showUpdateReady() {
  updateReady = true;
  const status = globalThis.document?.getElementById?.('status');
  if (!status || status.classList?.contains?.('error')) return;
  const current = String(status.textContent || '').trim();
  if (current !== 'Ready.' && !current.startsWith('Update ready.')) return;
  status.textContent = 'Update ready. Close and reopen DEBOOGER to apply safely.';
}

export function watchOfflineShellRegistration(registration) {
  if (!registration) return null;
  if (registration.waiting && globalThis.navigator?.serviceWorker?.controller) showUpdateReady();
  registration.addEventListener?.('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener?.('statechange', () => {
      if (worker.state === 'installed' && globalThis.navigator?.serviceWorker?.controller) showUpdateReady();
    });
  });
  return registration;
}

export async function registerOfflineShell() {
  if (!('serviceWorker' in navigator)) return null;
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
    watchOfflineShellRegistration(registration);
    return registration;
  } catch {
    return null;
  }
}

globalThis.addEventListener?.('focus', () => {
  if (updateReady) showUpdateReady();
});

registerOfflineShell();
