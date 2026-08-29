import { state } from './state.js';
import { buildStaticPreviewDocument } from './preview-engine.js';

const BROWSER_BINARY_FILE = /\.(?:svg|png|jpe?g|gif|webp|ico|pdf|mp3|wav|m4a|aac|ogg|oga|mp4|m4v|mov|webm|ogv)$/i;
const CONTENT_SEARCH_CHARS = 256 * 1024;

export function projectFileCanPreview(path, file) {
  return Boolean(file && (!file.binary || BROWSER_BINARY_FILE.test(String(path || ''))));
}

export function projectFileMatchesQuery(path, file, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if (String(path || '').toLowerCase().includes(q)) return true;
  if (file?.binary) return false;
  return String(file?.content ?? '').slice(0, CONTENT_SEARCH_CHARS).toLowerCase().includes(q);
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

export function filterProjectFileList(list, query = '', summary = null) {
  const rows = Array.from(list?.children || []);
  let visible = 0;
  for (const row of rows) {
    const path = rowPath(row);
    const match = projectFileMatchesQuery(path, state.files?.[path], query);
    row.hidden = !match;
    if (match) visible += 1;
  }
  if (summary) summary.textContent = String(query || '').trim() ? `${visible} of ${rows.length} files` : `${rows.length} file${rows.length === 1 ? '' : 's'}`;
  return visible;
}

export function decorateProjectFileList(list, query = '', summary = null) {
  for (const row of Array.from(list?.children || [])) decorateRow(row);
  return filterProjectFileList(list, query, summary);
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

export function registerProjectFileBrowser(
  list = globalThis.document?.getElementById?.('file-list'),
  search = globalThis.document?.getElementById?.('project-file-search'),
  summary = globalThis.document?.getElementById?.('project-file-summary')
) {
  if (!list) return null;
  const query = () => String(search?.value || '');
  const refresh = () => decorateProjectFileList(list, query(), summary);
  const openRow = (row) => {
    if (!row?.classList?.contains('previewable') || row.hidden) return;
    try { openProjectFile(rowPath(row)); } catch (error) { reportError(error); }
  };
  list.addEventListener('click', (event) => openRow(event.target?.closest?.('li')));
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target?.closest?.('li');
    if (!row?.classList?.contains('previewable') || row.hidden) return;
    event.preventDefault();
    openRow(row);
  });
  let searchTimer = 0;
  search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => filterProjectFileList(list, query(), summary), 90);
  });
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(list, { childList: true });
  return observer;
}

function start() { registerProjectFileBrowser(); }
if (globalThis.document) {
  if (document.readyState === 'loading') globalThis.addEventListener?.('DOMContentLoaded', start, { once: true });
  else start();
}
