import { BUILD_VERSION, resetState, state } from './state.js';
import { auditScore, buildAuditReport, buildRepairPrompt, runProjectAudit } from './audit-engine.js';
import { formatBytes } from './file-utils.js';
import { buildStandaloneHtml, createProjectZip, projectZipFilename, standaloneHtmlFilename, standaloneHtmlPlan } from './export-engine.js';
import { applyVirtualProject, detectProjectTypeAndEntry, ingestFileList } from './project-engine.js';
import { buildStaticPreviewDocument } from './preview-engine.js';
import { appendClipboardText, buildPastedPreviewDocument, createDownloadBlob, detectPastedType, filenameForPasted } from './paste-engine.js';
import { currentWebContainerEnvironment, selectPreviewRoute } from './runtime-router.js';
import { deleteLibraryItem, getLibraryItem, listLibraryItems, requestPersistentStorage, saveLibraryItem, updateLibraryItem } from './storage.js';
import { clearSharePayloadFromAddress, readSharePayload } from './share-intake.js';
import { ViewerController } from './viewer.js';
import { WebContainerEngine } from './webcontainer-engine.js';
import { looksLikeZip, parseZipArchive } from './zip-engine.js';

const fileInput = document.getElementById('file-input');
const status = document.getElementById('status');
const projectPanel = document.getElementById('project-panel');
const clearButton = document.getElementById('clear-project');
const snapshotDialog = document.getElementById('snapshot-dialog');
const snapshotImage = document.getElementById('snapshot-image');
const snapshotSave = document.getElementById('snapshot-save');
const pasteDialog = document.getElementById('paste-dialog');
const pasteEditor = document.getElementById('paste-editor');
const pasteType = document.getElementById('paste-type');
const pasteDownload = document.getElementById('paste-download');
const pasteSave = document.getElementById('paste-save');
const auditCard = document.getElementById('audit-card');
const auditList = document.getElementById('audit-list');
const libraryList = document.getElementById('library-list');
const librarySummary = document.getElementById('library-summary');
const projectHtml = document.getElementById('project-html');
const projectExport = document.getElementById('project-export');
const projectOpen = document.getElementById('project-open');

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

function libraryItemFromState(id = state.libraryItemId || newLibraryId()) {
  const now = Date.now();
  return {
    id,
    name: String(state.projectName || 'Project'),
    projectName: String(state.projectName || 'Project'),
    projectType: String(state.projectType || 'unknown'),
    entryFile: String(state.entryFile || ''),
    files: state.files,
    fileCount: Object.keys(state.files || {}).length,
    size: stateSize(),
    savedAt: now,
    updatedAt: now,
    folderId: 'root',
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
  document.getElementById('project-title').textContent = state.projectName || 'Project';
  document.getElementById('project-type').textContent = String(state.projectType || 'unknown').toUpperCase();
  document.getElementById('file-count').textContent = String(keys.length);
  document.getElementById('entry-file').textContent = state.entryFile || '—';
  document.getElementById('total-size').textContent = formatBytes(stateSize());
  const list = document.getElementById('file-list');
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
  document.getElementById('audit-count').textContent = `${findings.length} finding${findings.length === 1 ? '' : 's'}`;
  document.getElementById('audit-score').textContent = String(auditScore(findings));
  if (!findings.length) {
    const empty = document.createElement('div');
    empty.className = 'audit-empty';
    empty.textContent = 'No confirmed errors or audit warnings found.';
    auditList.replaceChildren(empty);
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
}

async function persistCurrentAudit() {
  if (!state.libraryItemId) return;
  const score = auditScore(state.auditFindings);
  const auditStatus = state.auditFindings.some((item) => item.severity === 'critical' || item.severity === 'error') ? 'issues' : 'clean';
  try {
    await updateLibraryItem(state.libraryItemId, { auditFindings: state.auditFindings, auditScore: score, auditStatus });
    await renderLibrary();
  } catch {}
}

const viewer = new ViewerController({
  shell: document.getElementById('viewer-shell'),
  stage: document.getElementById('viewer-stage'),
  surface: document.getElementById('viewer-surface'),
  frame: document.getElementById('viewer-frame'),
  status: document.getElementById('viewer-status'),
  zoomOut: document.getElementById('viewer-zoom-out'),
  zoomIn: document.getElementById('viewer-zoom-in'),
  fit: document.getElementById('viewer-fit'),
  snapshot: document.getElementById('viewer-snapshot'),
  full: document.getElementById('viewer-full'),
  exit: document.getElementById('viewer-exit')
}, {
  onRuntimeError: (item) => {
    state.runtimeErrors.push({ message: String(item.message || 'Runtime error'), file: String(item.source || 'preview'), line: Number(item.line || 0) });
    refreshAudit();
    persistCurrentAudit();
  },
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

async function renderLibrary() {
  let items = [];
  try { items = await listLibraryItems(); }
  catch (error) {
    libraryList.replaceChildren();
    const row = document.createElement('p');
    row.className = 'history-empty';
    row.textContent = error?.message || 'Files library is unavailable.';
    libraryList.append(row);
    librarySummary.textContent = 'Local storage could not be read.';
    return;
  }
  librarySummary.textContent = `${items.length} saved item${items.length === 1 ? '' : 's'} · newest saves first`;
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'No saved files yet. Import a file, ZIP or project to add it here.';
    libraryList.replaceChildren(empty);
    return;
  }
  libraryList.replaceChildren(...items.map((item) => {
    const row = document.createElement('div');
    row.className = 'files-row';
    row.dataset.libraryId = item.id;
    const main = document.createElement('div');
    main.className = 'files-main';
    const name = document.createElement('div');
    name.className = 'files-name';
    name.textContent = item.name || item.projectName || 'Project';
    const meta = document.createElement('div');
    meta.className = 'files-meta';
    const when = item.savedAt ? new Date(item.savedAt).toLocaleString() : 'Saved';
    const count = Number(item.fileCount || Object.keys(item.files || {}).length);
    meta.textContent = `${String(item.projectType || 'unknown').toUpperCase()} · ${count} file${count === 1 ? '' : 's'} · ${formatBytes(item.size || 0)} · ${when}`;
    main.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'files-actions-row';
    const score = document.createElement('span');
    score.className = `files-score ${scoreClass(Number(item.auditScore))}`.trim();
    score.textContent = Number.isFinite(Number(item.auditScore)) && item.auditScore !== null ? String(item.auditScore) : 'Audit';
    score.title = 'Saved audit score';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open';
    open.addEventListener('click', () => openLibraryItem(item.id));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'files-delete';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      await deleteLibraryItem(item.id);
      if (state.libraryItemId === item.id) closeCurrentDetails();
      await renderLibrary();
      setStatus('Selected item deleted.');
    });
    actions.append(score, open, remove);
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
  applyVirtualProject({
    [filename]: {
      content,
      binary: false,
      type: detected.label.toLowerCase(),
      size: new Blob([content]).size,
      modified: false
    }
  }, filename.replace(/\.[^.]+$/, '') || 'Pasted code');
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
  if (!route.runnable) {
    viewer.hide();
    setStatus(route.reason, true);
    return;
  }
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
      } else {
        viewer.hide();
        setStatus(error?.message || 'Real runtime could not start.', true);
      }
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
    if (selected.length === 1 && looksLikeZip(selected[0])) {
      const extracted = await parseZipArchive(selected[0]);
      applyVirtualProject(extracted.files, extracted.projectName);
    } else {
      await ingestFileList(files);
    }
    await saveCurrentStateToLibrary();
  } catch (error) {
    setStatus(error?.message || 'Could not import the selected item.', true);
    viewer.hide();
  } finally {
    fileInput.value = '';
  }
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
  } catch (error) {
    setStatus(error?.message || 'Could not open the selected item.', true);
  }
}

function closeCurrentDetails() {
  resetState();
  renderProject();
  refreshAudit();
}

async function exportCurrentZip() {
  if (!Object.keys(state.files).length) return;
  try {
    setStatus('Creating project ZIP…');
    downloadBlob(await createProjectZip(state.files), projectZipFilename(state.projectName));
    setStatus('Project ZIP ready.');
  } catch (error) { setStatus(error?.message || 'Project ZIP could not be created.', true); }
}

function downloadStandaloneHtml() {
  try {
    const html = buildStandaloneHtml(state.files, state.projectType);
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), standaloneHtmlFilename(state.projectName));
    setStatus('Standalone HTML ready.');
  } catch (error) { setStatus(error?.message || 'Standalone HTML could not be created.', true); }
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
document.getElementById('open-paste').addEventListener('click', openPasteDialog);
document.getElementById('paste-close').addEventListener('click', closePasteDialog);
document.getElementById('paste-preview').addEventListener('click', renderPastePreview);
document.getElementById('audit-copy').addEventListener('click', copyRepairPrompt);
document.getElementById('audit-download').addEventListener('click', downloadAudit);
projectOpen.addEventListener('click', openPreview);
projectExport.addEventListener('click', exportCurrentZip);
projectHtml.addEventListener('click', downloadStandaloneHtml);
pasteDownload.addEventListener('click', downloadPaste);
pasteSave.addEventListener('click', () => savePastedContent({ openAfter: false }).catch((error) => setStatus(error?.message || 'Pasted code could not be saved.', true)));
pasteEditor.addEventListener('input', currentPasteType);
pasteEditor.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain');
  if (typeof text !== 'string') return;
  event.preventDefault();
  appendClipboardText(pasteEditor, text);
  currentPasteType();
});
clearButton.addEventListener('click', async () => { await webcontainer.dispose(); viewer.hide(); closeCurrentDetails(); setStatus('Ready.'); });
document.getElementById('snapshot-close').addEventListener('click', () => { snapshotDialog.hidden = true; snapshotImage.removeAttribute('src'); snapshotSave.removeAttribute('href'); });

renderLibrary().finally(loadSharedText);
