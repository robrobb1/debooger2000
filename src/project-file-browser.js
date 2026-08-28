import { state } from './state.js';
import { buildStaticPreviewDocument } from './preview-engine.js';

const IMAGE_FILE = /\.(?:svg|png|jpe?g|gif|webp|ico)$/i;

export function projectFileCanPreview(path, file) {
  return Boolean(file && (!file.binary || IMAGE_FILE.test(String(path || ''))));
}

function rowPath(row) {
  return String(row?.querySelector?.('code')?.textContent || '');
}

function decorateRow(row) {
  const path = rowPath(row);
  const file = state.files?.[path];
  const previewable = projectFileCanPreview(path, file);
  row.classList.toggle('previewable', previewable);
  if (previewable) {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Open ${path} in viewer`);
  } else {
    row.removeAttribute('tabindex');
    row.removeAttribute('role');
    row.removeAttribute('aria-label');
  }
}

export function decorateProjectFileList(list) {
  for (const row of Array.from(list?.children || [])) decorateRow(row);
}

export function openProjectFile(path) {
  const file = state.files?.[path];
  if (!projectFileCanPreview(path, file)) throw new Error('This binary file type does not have a safe browser preview.');
  const html = buildStaticPreviewDocument(state.files, path);
  globalThis.dispatchEvent(new CustomEvent('debooger-open-document', { detail: { html, status: `FILE · ${path}` } }));
  const status = globalThis.document?.getElementById?.('status');
  if (status) {
    status.textContent = `Opened ${path} in viewer.`;
    status.classList.remove('error');
  }
  return html;
}

function reportError(error) {
  const status = globalThis.document?.getElementById?.('status');
  if (!status) return;
  status.textContent = error?.message || 'The selected project file could not be opened.';
  status.classList.add('error');
}

export function registerProjectFileBrowser(list = globalThis.document?.getElementById?.('file-list')) {
  if (!list) return null;
  const openRow = (row) => {
    if (!row?.classList?.contains('previewable')) return;
    try { openProjectFile(rowPath(row)); } catch (error) { reportError(error); }
  };
  list.addEventListener('click', (event) => openRow(event.target?.closest?.('li')));
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target?.closest?.('li');
    if (!row?.classList?.contains('previewable')) return;
    event.preventDefault();
    openRow(row);
  });
  decorateProjectFileList(list);
  const observer = new MutationObserver(() => decorateProjectFileList(list));
  observer.observe(list, { childList: true });
  return observer;
}

function start() { registerProjectFileBrowser(); }
if (globalThis.document) {
  if (document.readyState === 'loading') globalThis.addEventListener?.('DOMContentLoaded', start, { once: true });
  else start();
}
