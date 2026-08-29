import { deleteDeletedLibraryItem, emptyDeletedLibraryItems, listDeletedLibraryItems, restoreDeletedLibraryItem } from './storage.js';

function formatDeletedDate(value) {
  const time = Number(value || 0);
  return time ? new Date(time).toLocaleString() : 'Deleted';
}

function refreshMainLibrary(doc = globalThis.document) {
  const search = doc?.getElementById?.('library-search');
  search?.dispatchEvent?.(new Event('input', { bubbles: true }));
}

function setStatus(message, isError = false, doc = globalThis.document) {
  const status = doc?.getElementById?.('status');
  if (!status) return;
  status.textContent = String(message || '');
  status.classList.toggle('error', Boolean(isError));
}

export async function renderRecentlyDeleted(doc = globalThis.document) {
  const list = doc?.getElementById?.('recently-deleted-list');
  const summary = doc?.getElementById?.('recently-deleted-summary');
  if (!list || !summary) return [];
  const items = await listDeletedLibraryItems();
  summary.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  if (!items.length) {
    const empty = doc.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'Recently Deleted is empty.';
    list.replaceChildren(empty);
    return items;
  }
  const rows = items.map((item) => {
    const row = doc.createElement('div');
    row.className = 'files-row';
    const main = doc.createElement('div');
    main.className = 'files-main';
    const name = doc.createElement('div');
    name.className = 'files-name';
    name.textContent = item.name || item.projectName || 'Project';
    const meta = doc.createElement('div');
    meta.className = 'files-meta';
    meta.textContent = `Deleted ${formatDeletedDate(item.deletedAt)}`;
    main.append(name, meta);
    const actions = doc.createElement('div');
    actions.className = 'files-actions-row';
    const restore = doc.createElement('button');
    restore.type = 'button';
    restore.textContent = 'Restore';
    restore.addEventListener('click', async () => {
      try {
        await restoreDeletedLibraryItem(item.id);
        await renderRecentlyDeleted(doc);
        refreshMainLibrary(doc);
        setStatus(`Restored ${item.name || 'item'}.`, false, doc);
      } catch (error) { setStatus(error?.message || 'Could not restore the item.', true, doc); }
    });
    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Delete forever';
    remove.addEventListener('click', async () => {
      try {
        await deleteDeletedLibraryItem(item.id);
        await renderRecentlyDeleted(doc);
        setStatus(`Permanently deleted ${item.name || 'item'}.`, false, doc);
      } catch (error) { setStatus(error?.message || 'Could not permanently delete the item.', true, doc); }
    });
    actions.append(restore, remove);
    row.append(main, actions);
    return row;
  });
  list.replaceChildren(...rows);
  return items;
}

export function registerRecentlyDeleted(doc = globalThis.document) {
  const open = doc?.getElementById?.('open-recently-deleted');
  const dialog = doc?.getElementById?.('recently-deleted-dialog');
  const close = doc?.getElementById?.('recently-deleted-close');
  const empty = doc?.getElementById?.('empty-recently-deleted');
  if (!open || !dialog || !close || !empty) return false;
  open.addEventListener('click', async () => {
    dialog.hidden = false;
    await renderRecentlyDeleted(doc);
    requestAnimationFrame(() => close.focus());
  });
  close.addEventListener('click', () => { dialog.hidden = true; open.focus(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.hidden = true; });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.hidden = true;
      open.focus();
    }
  });
  empty.addEventListener('click', async () => {
    try {
      await emptyDeletedLibraryItems();
      await renderRecentlyDeleted(doc);
      setStatus('Recently Deleted emptied.', false, doc);
    } catch (error) { setStatus(error?.message || 'Could not empty Recently Deleted.', true, doc); }
  });
  return true;
}

function start() { registerRecentlyDeleted(); }
if (globalThis.document) {
  if (document.readyState === 'loading') globalThis.addEventListener?.('DOMContentLoaded', start, { once: true });
  else start();
}
