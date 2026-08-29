function closeTools(dialog) {
  if (!dialog) return;
  dialog.hidden = true;
}

export function registerLibraryTools(doc = globalThis.document) {
  const dialog = doc?.getElementById?.('library-tools-dialog');
  const open = doc?.getElementById?.('library-tools');
  const close = doc?.getElementById?.('library-tools-close');
  if (!dialog || !open || !close) return false;

  open.addEventListener('click', () => {
    dialog.hidden = false;
    requestAnimationFrame(() => close.focus());
  });
  close.addEventListener('click', () => closeTools(dialog));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeTools(dialog);
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTools(dialog);
      open.focus();
    }
  });
  return true;
}

function start() { registerLibraryTools(); }
if (globalThis.document) {
  if (document.readyState === 'loading') globalThis.addEventListener?.('DOMContentLoaded', start, { once: true });
  else start();
}
