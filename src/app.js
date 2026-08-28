import { BUILD_VERSION, resetState, state } from './state.js';
import { auditScore, buildAuditReport, buildRepairPrompt, runProjectAudit } from './audit-engine.js';
import { formatBytes } from './file-utils.js';
import { buildStandaloneHtml, createProjectZip, projectZipFilename, standaloneHtmlFilename, standaloneHtmlPlan } from './export-engine.js';
import { applyVirtualProject, detectProjectTypeAndEntry, ingestFileList } from './project-engine.js';
import { buildStaticPreviewDocument } from './preview-engine.js';
import { appendClipboardText, buildPastedPreviewDocument, createDownloadBlob, detectPastedType, filenameForPasted } from './paste-engine.js';
import { currentWebContainerEnvironment, selectPreviewRoute } from './runtime-router.js';
import { createFolder, deleteFolder, deleteLibraryItem, duplicateLibraryItem, getLibraryItem, listFolders, listLibraryItems, renameFolder, requestPersistentStorage, saveLibraryItem, updateLibraryItem } from './storage.js';
import { clearSharePayloadFromAddress, readSharePayload } from './share-intake.js';
import { ViewerController } from './viewer.js';
import { WebContainerEngine } from './webcontainer-engine.js';
import { looksLikeZip, parseZipArchive } from './zip-engine.js';

const byId = (id) => document.getElementById(id);
const fileInput = byId('file-input');
const status = byId('status');
const projectPanel = byId('project-panel');
const snapshotDialog = byId('snapshot-dialog');
const snapshotImage = byId('snapshot-image');
const snapshotSave = byId('snapshot-save');
const pasteDialog = byId('paste-dialog');
const pasteEditor = byId('paste-editor');
const pasteType = byId('paste-type');
const pasteDownload = byId('paste-download');
const pasteSave = byId('paste-save');
const auditCard = byId('audit-card');
const auditList = byId('audit-list');
const libraryList = byId('library-list');
const librarySummary = byId('library-summary');
const folderList = byId('folder-list');
const projectHtml = byId('project-html');
const projectExport = byId('project-export');
const projectOpen = byId('project-open');
const itemMenuDialog = byId('item-menu-dialog');
const nameDialog = byId('name-dialog');
const nameDialogInput = byId('name-dialog-input');
const nameDialogTitle = byId('name-dialog-title');
const nameDialogLabel = byId('name-dialog-label');
const moveDialog = byId('move-dialog');
const moveFolderList = byId('move-folder-list');
const folderDialog = byId('folder-dialog');

const libraryUi = {
  view: 'files',
  folderId: 'root',
  search: '',
  filter: 'all',
  sort: 'saved-desc',
  actionItemId: '',
  nameMode: '',
  nameTargetId: '',
  selectedMeta: null
};

document.getElementById('build-badge').textContent = BUILD_VERSION;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function newLibraryId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function stateSize() {
  return Object.values(state.files || {}).reduce((sum, file) => sum + Number(file?.size || 0), 0);
}

function basename(path) { return String(path || '').split('/').filter(Boolean).at(-1) || 'Project'; }
function extension(path) { const name = basename(path); const at = name.lastIndexOf('.'); return at > 0 ? name.slice(at) : ''; }
function withoutExtension(name) { const at = String(name || '').lastIndexOf('.'); return at > 0 ? String(name).slice(0, at) : String(name || ''); }

function displayNameFromState() {
  const keys = Object.keys(state.files || {});
  return keys.length === 1 ? basename(keys[0]) : String(state.projectName || 'Project');
}

function libraryItemFromState(id = state.libraryItemId || newLibraryId()) {
  const now = Date.now();
  return {
    id,
    name: displayNameFromState(),
    projectName: String(state.projectName || 'Project'),
    projectType: String(state.projectType || 'unknown'),
    entryFile: String(state.entryFile || ''),
    files: state.files,
    fileCount: Object.keys(state.files || {}).length,
    size: stateSize(),
    savedAt: now,
    updatedAt: now,
    folderId: libraryUi.folderId || 'root',
    auditFindings: state.auditFindings,
    auditScore: auditScore(state.auditFindings),
    auditStatus: state.auditFindings.some((item) => item.severity === 'critical' || item.severity === 'error') ? 'issues' : 'clean'
  };
}

function loadItemIntoState(item) {
  resetState();
  state.libraryItemId = String(item.id || '');
  state.projectName = String(item.projectName || item.name || 'Project');
  state.files = item.files || Object.create(null);
  state.runtimeErrors = [];
  detectProjectTypeAndEntry();
  state.auditFindings = Array.isArray(item.auditFindings) ? item.auditFindings : [];
  libraryUi.selectedMeta = item;
}

function refreshExportActions() {
  const hasProject = Boolean(Object.keys(state.files).length);
  projectExport.disabled = !hasProject;
  projectOpen.disabled = !hasProject;
  const plan = hasProject ? standaloneHtmlPlan(state.files, state.projectType) : { supported: false, reason: 'Load a project first.' };
  projectHtml.disabled = !plan.supported;
  projectHtml.title = plan.reason;
}

function renderProject() {
  const keys = Object.keys(state.files);
  projectPanel.hidden = !keys.length;
  byId('project-title').textContent = libraryUi.selectedMeta?.name || state.projectName || 'Project';
  byId('project-type').textContent = String(state.projectType || 'unknown').toUpperCase();
  byId('file-count').textContent = String(keys.length);
  byId('entry-file').textContent = state.entryFile || '—';
  byId('total-size').textContent = formatBytes(stateSize());
  byId('saved-date').textContent = libraryUi.selectedMeta?.savedAt ? new Date(libraryUi.selectedMeta.savedAt).toLocaleString() : '—';
  const currentScore = auditScore(state.auditFindings);
  byId('audit-state').textContent = keys.length ? `${currentScore} · ${state.auditFindings.length ? 'review findings' : 'clean'}` : '—';
  const list = byId('file-list');
  list.replaceChildren(...keys.sort().map((path) => {
    const item = document.createElement('li');
    const code = document.createElement('code');
    const size = document.createElement('span');
    code.textContent = path;
    size.textContent = formatBytes(state.files[path]?.size || 0);
    item.append(code, size);
    return item;
  }));
  refreshExportActions();
}

function refreshAudit() {
  state.auditFindings = runProjectAudit(state.files, { projectType: state.projectType, runtimeErrors: state.runtimeErrors });
  const findings = state.auditFindings;
  auditCard.hidden = !Object.keys(state.files).length;
  byId('audit-count').textContent = `${findings.length} finding${findings.length === 1 ? '' : 's'}`;
  byId('audit-score').textContent = String(auditScore(findings));
  if (!findings.length) {
    const empty = document.createElement('div');
    empty.className = 'audit-empty';
    empty.textContent = 'No confirmed errors or audit warnings found.';
    auditList.replaceChildren(empty);
    renderProject();
    return;
  }
  auditList.replaceChildren(...findings.map((item) => {
    const row = document.createElement('div');
    row.className = `audit-item ${item.severity}`;
    const title = document.createElement('div');
    title.className = 'audit-title';
    const name = document.createElement('span');
    name.textContent = item.title;
    const meta = document.createElement('span');
    meta.textContent = `${item.severity.toUpperCase()} · ${item.confidence.toUpperCase()}`;
    title.append(name, meta);
    const evidence = document.createElement('div');
    evidence.className = 'audit-evidence';
    evidence.textContent = `${item.file || 'project'}${item.line ? `:${item.line}` : ''} — ${item.evidence}`;
    row.append(title, evidence);
    return row;
  }));
  renderProject();
}

async function persistCurrentAudit() {
  if (!state.libraryItemId) return;
  const score = auditScore(state.auditFindings);
  const auditStatus = state.auditFindings.some((item) => item.severity === 'critical' || item.severity === 'error') ? 'issues' : 'clean';
  try {
    const updated = await updateLibraryItem(state.libraryItemId, { auditFindings: state.auditFindings, auditScore: score, auditStatus });
    libraryUi.selectedMeta = updated;
    await renderLibrary();
  } catch {}
}

const viewer = new ViewerController({
  shell: byId('viewer-shell'), stage: byId('viewer-stage'), surface: byId('viewer-surface'), frame: byId('viewer-frame'), status: byId('viewer-status'), zoomOut: byId('viewer-zoom-out'), zoomIn: byId('viewer-zoom-in'), fit: byId('viewer-fit'), snapshot: byId('viewer-snapshot'), full: byId('viewer-full'), exit: byId('viewer-exit')
}, {
  onRuntimeError: (item) => { state.runtimeErrors.push({ message: String(item.message || 'Runtime error'), file: String(item.source || 'preview'), line: Number(item.line || 0) }); refreshAudit(); persistCurrentAudit(); },
  onSnapshot: (dataUrl) => { snapshotImage.src = dataUrl; snapshotSave.href = dataUrl; snapshotDialog.hidden = false; },
  onSnapshotError: (message) => setStatus(`Snapshot failed: ${message}`, true),
  onExit: async () => { await webcontainer.dispose(); viewer.hide(); setStatus('Viewer closed.'); }
});

const webcontainer = new WebContainerEngine((message) => {
  state.runtimeErrors.push({ message, file: 'WebContainer', line: 0 });
  viewer.setStatus(message);
  refreshAudit();
  persistCurrentAudit();
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function scoreClass(score) {
  if (!Number.isFinite(score)) return '';
  if (score >= 90) return 'good';
  if (score >= 70) return 'warn';
  return 'bad';
}

function itemMatchesType(item) {
  const type = String(item.projectType || '').toLowerCase();
  if (libraryUi.filter === 'html') return ['single-html', 'html-static'].includes(type);
  if (libraryUi.filter === 'react') return ['react-vite', 'nextjs'].includes(type);
  if (libraryUi.filter === 'node') return ['node-service', 'electron', 'backend-service'].includes(type);
  return true;
}

function itemMatchesSearch(item) {
  const q = libraryUi.search.trim().toLowerCase();
  if (!q) return true;
  const fileNames = Object.keys(item.files || {}).join(' ');
  return [item.name, item.projectName, item.projectType, item.entryFile, fileNames].some((value) => String(value || '').toLowerCase().includes(q));
}

function sortItems(items) {
  const next = [...items];
  const sort = libraryUi.sort;
  next.sort((a, b) => {
    if (sort === 'saved-asc') return Number(a.savedAt || 0) - Number(b.savedAt || 0);
    if (sort === 'name-asc') return String(a.name || '').localeCompare(String(b.name || ''));
    if (sort === 'size-desc') return Number(b.size || 0) - Number(a.size || 0);
    if (sort === 'score-desc') return Number(b.auditScore ?? -1) - Number(a.auditScore ?? -1);
    return Number(b.savedAt || 0) - Number(a.savedAt || 0);
  });
  return next;
}

async function renderFolders(folders = null) {
  const all = folders || await listFolders();
  folderList.replaceChildren();
  const root = document.createElement('button');
  root.type = 'button';
  root.className = `folder-chip ${libraryUi.folderId === 'root' ? 'active' : ''}`.trim();
  root.textContent = 'On My DEBOOGER';
  root.addEventListener('click', () => { libraryUi.folderId = 'root'; libraryUi.view = 'files'; syncViewButtons(); renderLibrary(); });
  folderList.append(root);
  for (const folder of all) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `folder-chip ${libraryUi.folderId === folder.id ? 'active' : ''}`.trim();
    button.textContent = folder.name;
    button.addEventListener('click', () => { libraryUi.folderId = folder.id; libraryUi.view = 'files'; syncViewButtons(); renderLibrary(); });
    folderList.append(button);
  }
  byId('folder-options').hidden = libraryUi.folderId === 'root' || libraryUi.view === 'recents';
}

function syncViewButtons() {
  byId('view-files').classList.toggle('active', libraryUi.view === 'files');
  byId('view-recents').classList.toggle('active', libraryUi.view === 'recents');
}

async function renderLibrary() {
  let items = [];
  let folders = [];
  try { [items, folders] = await Promise.all([listLibraryItems(), listFolders()]); }
  catch (error) {
    const row = document.createElement('p');
    row.className = 'history-empty';
    row.textContent = error?.message || 'Files library is unavailable.';
    libraryList.replaceChildren(row);
    librarySummary.textContent = 'Local storage could not be read.';
    return;
  }
  await renderFolders(folders);
  let visible = items;
  if (libraryUi.view === 'files') visible = visible.filter((item) => String(item.folderId || 'root') === libraryUi.folderId);
  else visible = [...visible].sort((a, b) => Number(b.updatedAt || b.savedAt || 0) - Number(a.updatedAt || a.savedAt || 0)).slice(0, 20);
  visible = visible.filter(itemMatchesType).filter(itemMatchesSearch);
  visible = libraryUi.view === 'recents' ? visible : sortItems(visible);
  const label = libraryUi.view === 'recents' ? 'recent item' : 'item';
  librarySummary.textContent = `${visible.length} ${label}${visible.length === 1 ? '' : 's'}`;
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = libraryUi.search ? 'No matching files.' : 'No files in this view.';
    libraryList.replaceChildren(empty);
    return;
  }
  libraryList.replaceChildren(...visible.map((item) => {
    const row = document.createElement('div');
    row.className = 'files-row';
    row.dataset.libraryId = item.id;
    const main = document.createElement('div');
    main.className = 'files-main';
    main.tabIndex = 0;
    main.setAttribute('role', 'button');
    main.setAttribute('aria-label', `Open ${item.name || item.projectName || 'item'}`);
    const name = document.createElement('div');
    name.className = 'files-name';
    name.textContent = item.name || item.projectName || 'Project';
    const meta = document.createElement('div');
    meta.className = 'files-meta';
    const when = item.savedAt ? new Date(item.savedAt).toLocaleString() : 'Saved';
    const count = Number(item.fileCount || Object.keys(item.files || {}).length);
    meta.textContent = `${String(item.projectType || 'unknown').toUpperCase()} · ${count} file${count === 1 ? '' : 's'} · ${formatBytes(item.size || 0)} · ${when}`;
    main.append(name, meta);
    const openFromMain = () => openLibraryItem(item.id);
    main.addEventListener('click', openFromMain);
    main.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFromMain(); } });

    const actions = document.createElement('div');
    actions.className = 'files-actions-row';
    const score = document.createElement('span');
    score.className = `files-score ${scoreClass(Number(item.auditScore))}`.trim();
    score.textContent = Number.isFinite(Number(item.auditScore)) && item.auditScore !== null ? String(item.auditScore) : 'Audit';
    score.title = 'Saved audit score';
    const more = document.createElement('button');
    more.type = 'button';
    more.textContent = 'More';
    more.setAttribute('aria-label', `More actions for ${item.name || item.projectName || 'item'}`);
    more.addEventListener('click', () => openItemMenu(item.id));
    actions.append(score, more);
    row.append(main, actions);
    return row;
  }));
}

async function copyRepairPrompt() {
  const prompt = buildRepairPrompt(state.auditFindings);
  try { await navigator.clipboard.writeText(prompt); setStatus('AI repair prompt copied.'); }
  catch { setStatus('Clipboard access is unavailable in this browser.', true); }
}

function downloadAudit() {
  if (!Object.keys(state.files).length) return;
  downloadBlob(new Blob([buildAuditReport(state.auditFindings)], { type: 'text/plain' }), 'debooger-audit-report.txt');
}

function currentPasteType() {
  const detected = detectPastedType(pasteEditor.value);
  pasteType.textContent = `${detected.label.toUpperCase()} · ${detected.extension}${detected.confidence === 'low' ? ' · LOW CONFIDENCE' : ''}`;
  pasteDownload.textContent = `Download ${detected.extension}`;
  return detected;
}

function openPasteDialog() {
  pasteDialog.hidden = false;
  currentPasteType();
  requestAnimationFrame(() => {
    const end = pasteEditor.value.length;
    pasteEditor.setSelectionRange(end, end);
    pasteEditor.scrollTop = pasteEditor.scrollHeight;
    pasteEditor.focus();
  });
}

function closePasteDialog() { pasteDialog.hidden = true; }

function downloadPaste() {
  if (!pasteEditor.value.trim()) return;
  const detected = currentPasteType();
  const url = URL.createObjectURL(createDownloadBlob(pasteEditor.value, detected));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filenameForPasted(detected);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveCurrentStateToLibrary() {
  refreshAudit();
  const item = libraryItemFromState();
  state.libraryItemId = item.id;
  await saveLibraryItem(item);
  libraryUi.selectedMeta = item;
  await requestPersistentStorage();
  await renderLibrary();
  renderProject();
  setStatus(`Saved and audited ${item.name}.`);
  return item;
}

async function savePastedContent({ openAfter = false } = {}) {
  const content = pasteEditor.value;
  if (!content.trim()) return null;
  const detected = currentPasteType();
  const filename = filenameForPasted(detected);
  applyVirtualProject({ [filename]: { content, binary: false, type: detected.label.toLowerCase(), size: new Blob([content]).size, modified: false } }, withoutExtension(filename) || 'Pasted code');
  state.libraryItemId = '';
  const item = await saveCurrentStateToLibrary();
  closePasteDialog();
  if (openAfter) await openPreview();
  return item;
}

function renderPastePreview() {
  const content = pasteEditor.value;
  if (!content.trim()) return;
  const detected = currentPasteType();
  const previewContent = buildPastedPreviewDocument(content, detected);
  const previewFiles = { 'preview.html': { content: previewContent, binary: false, type: 'html', size: new Blob([previewContent]).size } };
  viewer.setFrameDocument(buildStaticPreviewDocument(previewFiles, 'preview.html'));
  viewer.setStatus(`Pasted ${detected.label} · ${detected.extension}`);
  setStatus(`Pasted content previewed as ${detected.label}.`);
}

async function openPreview() {
  state.runtimeErrors = [];
  const route = selectPreviewRoute();
  viewer.setStatus(`${state.projectType} · ${route.mode}`);
  if (!route.runnable) { viewer.hide(); setStatus(route.reason, true); return; }
  if (route.mode === 'webcontainer') {
    viewer.setStatus('Starting real project runtime…');
    viewer.show();
    try {
      const ready = await webcontainer.run(state.files, currentWebContainerEnvironment());
      viewer.setFrameUrl(ready.url);
      viewer.setStatus(`${state.projectType} · port ${ready.port}`);
      setStatus('Project opened in real browser runtime.');
    } catch (error) {
      const fallback = selectPreviewRoute(state.files, state.projectType, { ...currentWebContainerEnvironment(), embedded: true });
      if (fallback.entry) {
        viewer.setFrameDocument(buildStaticPreviewDocument(state.files, fallback.entry));
        viewer.setStatus(`${state.projectType} · static fallback`);
        setStatus(`Real runtime unavailable; opened browser-compatible fallback. ${error?.message || ''}`.trim());
      } else { viewer.hide(); setStatus(error?.message || 'Real runtime could not start.', true); }
    }
    return;
  }
  viewer.setFrameDocument(buildStaticPreviewDocument(state.files, route.entry));
  viewer.setStatus(`${state.projectType} · ${route.entry}`);
  setStatus('Project opened in viewer.');
}

async function handleFiles(files) {
  setStatus('Importing and auditing…');
  try {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    await webcontainer.dispose();
    viewer.hide();
    resetState();
    libraryUi.selectedMeta = null;
    if (selected.length === 1 && looksLikeZip(selected[0])) {
      const extracted = await parseZipArchive(selected[0]);
      applyVirtualProject(extracted.files, extracted.projectName);
    } else await ingestFileList(files);
    await saveCurrentStateToLibrary();
  } catch (error) { setStatus(error?.message || 'Could not import the selected item.', true); viewer.hide(); }
  finally { fileInput.value = ''; }
}

async function openLibraryItem(id) {
  try {
    const item = await getLibraryItem(id);
    if (!item?.files || !Object.keys(item.files).length) throw new Error('The selected item has no saved files.');
    await webcontainer.dispose();
    viewer.hide();
    loadItemIntoState(item);
    renderProject();
    refreshAudit();
    await openPreview();
  } catch (error) { setStatus(error?.message || 'Could not open the selected item.', true); }
}

function closeCurrentDetails() {
  resetState();
  libraryUi.selectedMeta = null;
  renderProject();
  refreshAudit();
}

async function exportCurrentZip() {
  if (!Object.keys(state.files).length) return;
  try { setStatus('Creating project ZIP…'); downloadBlob(await createProjectZip(state.files), projectZipFilename(state.projectName)); setStatus('Project ZIP ready.'); }
  catch (error) { setStatus(error?.message || 'Project ZIP could not be created.', true); }
}

function downloadStandaloneHtml() {
  try { const html = buildStandaloneHtml(state.files, state.projectType); downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), standaloneHtmlFilename(state.projectName)); setStatus('Standalone HTML ready.'); }
  catch (error) { setStatus(error?.message || 'Standalone HTML could not be created.', true); }
}

function openItemMenu(id) { libraryUi.actionItemId = String(id); itemMenuDialog.hidden = false; }
function closeItemMenu() { itemMenuDialog.hidden = true; }
function closeNameDialog() { nameDialog.hidden = true; libraryUi.nameMode = ''; libraryUi.nameTargetId = ''; }
function closeMoveDialog() { moveDialog.hidden = true; }
function closeFolderDialog() { folderDialog.hidden = true; }

async function openRenameItem() {
  const item = await getLibraryItem(libraryUi.actionItemId);
  if (!item) return;
  closeItemMenu();
  libraryUi.nameMode = 'item';
  libraryUi.nameTargetId = item.id;
  nameDialogTitle.textContent = 'Rename item';
  nameDialogLabel.textContent = 'New name';
  nameDialogInput.value = item.name || item.projectName || '';
  nameDialog.hidden = false;
  requestAnimationFrame(() => { nameDialogInput.focus(); nameDialogInput.select(); });
}

function openNewFolder() {
  libraryUi.nameMode = 'new-folder';
  libraryUi.nameTargetId = '';
  nameDialogTitle.textContent = 'New folder';
  nameDialogLabel.textContent = 'Folder name';
  nameDialogInput.value = '';
  nameDialog.hidden = false;
  requestAnimationFrame(() => nameDialogInput.focus());
}

async function openRenameFolder() {
  const folders = await listFolders();
  const folder = folders.find((item) => item.id === libraryUi.folderId);
  if (!folder) return;
  closeFolderDialog();
  libraryUi.nameMode = 'folder';
  libraryUi.nameTargetId = folder.id;
  nameDialogTitle.textContent = 'Rename folder';
  nameDialogLabel.textContent = 'New name';
  nameDialogInput.value = folder.name;
  nameDialog.hidden = false;
  requestAnimationFrame(() => { nameDialogInput.focus(); nameDialogInput.select(); });
}

async function saveNameDialog() {
  const clean = nameDialogInput.value.trim();
  if (!clean) { setStatus('Name cannot be empty.', true); return; }
  try {
    if (libraryUi.nameMode === 'new-folder') {
      const folder = await createFolder(clean);
      libraryUi.folderId = folder.id;
      libraryUi.view = 'files';
      setStatus(`Created folder ${folder.name}.`);
    } else if (libraryUi.nameMode === 'folder') {
      const folder = await renameFolder(libraryUi.nameTargetId, clean);
      setStatus(`Renamed folder to ${folder.name}.`);
    } else if (libraryUi.nameMode === 'item') {
      const item = await getLibraryItem(libraryUi.nameTargetId);
      if (!item) throw new Error('The selected item no longer exists.');
      const keys = Object.keys(item.files || {});
      let patch = { name: clean, projectName: clean };
      if (keys.length === 1) {
        const oldPath = keys[0];
        const oldExt = extension(oldPath);
        const directory = oldPath.includes('/') ? `${oldPath.slice(0, oldPath.lastIndexOf('/') + 1)}` : '';
        const requestedBase = withoutExtension(basename(clean)) || 'file';
        const newFileName = `${requestedBase}${oldExt}`;
        const newPath = `${directory}${newFileName}`;
        const files = { [newPath]: item.files[oldPath] };
        const findings = runProjectAudit(files, { projectType: item.projectType, runtimeErrors: [] });
        patch = { ...patch, name: newFileName, projectName: withoutExtension(newFileName), files, entryFile: item.entryFile === oldPath ? newPath : item.entryFile, auditFindings: findings, auditScore: auditScore(findings), auditStatus: findings.some((f) => f.severity === 'critical' || f.severity === 'error') ? 'issues' : 'clean' };
      }
      const updated = await updateLibraryItem(item.id, patch);
      if (state.libraryItemId === item.id) { loadItemIntoState(updated); renderProject(); refreshAudit(); }
      setStatus(`Renamed to ${updated.name}.`);
    }
    closeNameDialog();
    syncViewButtons();
    await renderLibrary();
  } catch (error) { setStatus(error?.message || 'Could not save the new name.', true); }
}

async function openMoveItem() {
  const item = await getLibraryItem(libraryUi.actionItemId);
  if (!item) return;
  closeItemMenu();
  const folders = await listFolders();
  moveFolderList.replaceChildren();
  const options = [{ id: 'root', name: 'On My DEBOOGER' }, ...folders];
  for (const folder of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = folder.name;
    button.disabled = String(item.folderId || 'root') === folder.id;
    button.addEventListener('click', async () => {
      try {
        await updateLibraryItem(item.id, { folderId: folder.id });
        closeMoveDialog();
        await renderLibrary();
        setStatus(`Moved ${item.name || 'item'} to ${folder.name}.`);
      } catch (error) { setStatus(error?.message || 'Could not move the item.', true); }
    });
    moveFolderList.append(button);
  }
  moveDialog.hidden = false;
}

async function duplicateSelectedItem() {
  try {
    const copy = await duplicateLibraryItem(libraryUi.actionItemId);
    closeItemMenu();
    await renderLibrary();
    setStatus(`Duplicated as ${copy.name}.`);
  } catch (error) { setStatus(error?.message || 'Could not duplicate the item.', true); }
}

async function deleteSelectedItem() {
  const id = libraryUi.actionItemId;
  if (!id) return;
  try {
    await deleteLibraryItem(id);
    closeItemMenu();
    if (state.libraryItemId === id) closeCurrentDetails();
    await renderLibrary();
    setStatus('Selected item deleted.');
  } catch (error) { setStatus(error?.message || 'Could not delete the selected item.', true); }
}

async function deleteCurrentFolder() {
  if (libraryUi.folderId === 'root') return;
  try {
    await deleteFolder(libraryUi.folderId);
    libraryUi.folderId = 'root';
    closeFolderDialog();
    await renderLibrary();
    setStatus('Folder deleted. Its files were moved to On My DEBOOGER.');
  } catch (error) { setStatus(error?.message || 'Could not delete the folder.', true); }
}

async function loadSharedText() {
  let shared = null;
  try { shared = readSharePayload(); }
  catch (error) { setStatus(error?.message || 'Shared text could not be loaded.', true); return; }
  if (!shared) return;
  pasteEditor.value = shared;
  if (!pasteEditor.value.endsWith('\n')) pasteEditor.value += '\n';
  clearSharePayloadFromAddress();
  try { await savePastedContent({ openAfter: false }); }
  catch (error) { setStatus(error?.message || 'Shared text could not be saved.', true); }
}

fileInput.addEventListener('change', () => handleFiles(fileInput.files));
byId('open-paste').addEventListener('click', openPasteDialog);
byId('new-folder').addEventListener('click', openNewFolder);
byId('paste-close').addEventListener('click', closePasteDialog);
byId('paste-preview').addEventListener('click', renderPastePreview);
byId('audit-copy').addEventListener('click', copyRepairPrompt);
byId('audit-download').addEventListener('click', downloadAudit);
projectOpen.addEventListener('click', openPreview);
projectExport.addEventListener('click', exportCurrentZip);
projectHtml.addEventListener('click', downloadStandaloneHtml);
pasteDownload.addEventListener('click', downloadPaste);
pasteSave.addEventListener('click', () => savePastedContent({ openAfter: false }).catch((error) => setStatus(error?.message || 'Pasted code could not be saved.', true)));
pasteEditor.addEventListener('input', currentPasteType);
pasteEditor.addEventListener('paste', (event) => { const text = event.clipboardData?.getData('text/plain'); if (typeof text !== 'string') return; event.preventDefault(); appendClipboardText(pasteEditor, text); currentPasteType(); });
byId('clear-project').addEventListener('click', async () => { await webcontainer.dispose(); viewer.hide(); closeCurrentDetails(); setStatus('Ready.'); });
byId('snapshot-close').addEventListener('click', () => { snapshotDialog.hidden = true; snapshotImage.removeAttribute('src'); snapshotSave.removeAttribute('href'); });
byId('view-files').addEventListener('click', () => { libraryUi.view = 'files'; syncViewButtons(); renderLibrary(); });
byId('view-recents').addEventListener('click', () => { libraryUi.view = 'recents'; syncViewButtons(); renderLibrary(); });
byId('library-search').addEventListener('input', (event) => { libraryUi.search = event.target.value; renderLibrary(); });
byId('library-filter').addEventListener('change', (event) => { libraryUi.filter = event.target.value; renderLibrary(); });
byId('library-sort').addEventListener('change', (event) => { libraryUi.sort = event.target.value; renderLibrary(); });
byId('folder-options').addEventListener('click', () => { folderDialog.hidden = false; });
byId('item-menu-close').addEventListener('click', closeItemMenu);
byId('item-rename').addEventListener('click', () => openRenameItem().catch((error) => setStatus(error?.message || 'Could not rename item.', true)));
byId('item-move').addEventListener('click', () => openMoveItem().catch((error) => setStatus(error?.message || 'Could not move item.', true)));
byId('item-duplicate').addEventListener('click', duplicateSelectedItem);
byId('item-delete').addEventListener('click', deleteSelectedItem);
byId('name-dialog-close').addEventListener('click', closeNameDialog);
byId('name-dialog-save').addEventListener('click', saveNameDialog);
nameDialogInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') saveNameDialog(); });
byId('move-dialog-close').addEventListener('click', closeMoveDialog);
byId('folder-dialog-close').addEventListener('click', closeFolderDialog);
byId('folder-rename').addEventListener('click', () => openRenameFolder().catch((error) => setStatus(error?.message || 'Could not rename folder.', true)));
byId('folder-delete').addEventListener('click', deleteCurrentFolder);

syncViewButtons();
renderLibrary().finally(loadSharedText);
