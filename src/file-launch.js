export async function filesFromLaunchParams(launchParams) {
  const handles = Array.from(launchParams?.files || []);
  const files = [];
  for (const handle of handles) {
    if (!handle || handle.kind !== 'file' || typeof handle.getFile !== 'function') continue;
    try { files.push(await handle.getFile()); } catch {}
  }
  return files;
}

export function forwardFilesToImport(files, input = globalThis.document?.getElementById?.('file-input')) {
  const selected = Array.from(files || []);
  if (!selected.length || !input || typeof globalThis.DataTransfer !== 'function') return false;
  const transfer = new DataTransfer();
  for (const file of selected) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function reportLaunchFailure(message) {
  const status = globalThis.document?.getElementById?.('status');
  if (!status) return;
  status.textContent = String(message || 'The launched file could not be imported.');
  status.classList.add('error');
}

export function registerFileLaunchIntake(queue = globalThis.launchQueue) {
  if (!queue || typeof queue.setConsumer !== 'function') return false;
  queue.setConsumer(async (launchParams) => {
    const files = await filesFromLaunchParams(launchParams);
    if (!files.length) return;
    if (!forwardFilesToImport(files)) reportLaunchFailure('This browser launched DEBOOGER with a file but could not hand it to the Import flow. Use Import instead.');
  });
  return true;
}

registerFileLaunchIntake();
