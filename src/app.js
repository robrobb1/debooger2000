import { BUILD_VERSION, resetState, state } from './state.js';
import { auditScore, buildAuditReport, buildRepairPrompt, runProjectAudit } from './audit-engine.js';
import { formatBytes } from './file-utils.js';
import { buildStandaloneHtml, createProjectZip, projectZipFilename, standaloneHtmlFilename, standaloneHtmlPlan } from './export-engine.js';
import { applyVirtualProject, detectProjectTypeAndEntry, ingestFileList } from './project-engine.js';
import { buildStaticPreviewDocument } from './preview-engine.js';
import { appendClipboardText, buildPastedPreviewDocument, createDownloadBlob, detectPastedType, filenameForPasted } from './paste-engine.js';
import { currentWebContainerEnvironment, selectPreviewRoute } from './runtime-router.js';
import { clearProjectSnapshot, loadProjectHistory, loadProjectSnapshot, removeProjectHistory, saveProjectSnapshot } from './storage.js';
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
const auditCard = document.getElementById('audit-card');
const auditList = document.getElementById('audit-list');
const historyList = document.getElementById('history-list');
const projectHtml = document.getElementById('project-html');
const projectExport = document.getElementById('project-export');

document.getElementById('build-badge').textContent = BUILD_VERSION;

function setStatus(message, isError = false) { status.textContent = message; status.classList.toggle('error', isError); }

const viewer = new ViewerController({
  shell: document.getElementById('viewer-shell'), stage: document.getElementById('viewer-stage'), surface: document.getElementById('viewer-surface'), frame: document.getElementById('viewer-frame'), status: document.getElementById('viewer-status'), zoomOut: document.getElementById('viewer-zoom-out'), zoomIn: document.getElementById('viewer-zoom-in'), fit: document.getElementById('viewer-fit'), snapshot: document.getElementById('viewer-snapshot'), full: document.getElementById('viewer-full'), exit: document.getElementById('viewer-exit')
}, {
  onRuntimeError: (item) => { state.runtimeErrors.push({ message: String(item.message || 'Runtime error'), file: String(item.source || 'preview'), line: Number(item.line || 0) }); refreshAudit(); },
  onSnapshot: (dataUrl) => { snapshotImage.src = dataUrl; snapshotSave.href = dataUrl; snapshotDialog.hidden = false; },
  onSnapshotError: (message) => setStatus(`Snapshot failed: ${message}`, true)
});

const webcontainer = new WebContainerEngine((message) => { state.runtimeErrors.push({ message, file: 'WebContainer', line: 0 }); viewer.setStatus(message); refreshAudit(); });

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

function newSnapshotId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function refreshExportActions() {
  const hasProject = Boolean(Object.keys(state.files).length);
  projectExport.disabled = !hasProject;
  const plan = hasProject ? standaloneHtmlPlan(state.files, state.projectType) : { supported: false, reason: 'Load a project first.' };
  projectHtml.disabled = !plan.supported;
  projectHtml.title = plan.supported ? plan.reason : plan.reason;
}

function renderProject() {
  const keys = Object.keys(state.files);
  projectPanel.hidden = !keys.length;
  document.getElementById('project-title').textContent = state.projectName || 'Project';
  document.getElementById('project-type').textContent = String(state.projectType || 'unknown').toUpperCase();
  document.getElementById('file-count').textContent = String(keys.length);
  document.getElementById('entry-file').textContent = state.entryFile || '—';
  document.getElementById('total-size').textContent = formatBytes(keys.reduce((sum, path) => sum + Number(state.files[path]?.size || 0), 0));
  const list = document.getElementById('file-list');
  list.replaceChildren(...keys.sort().map((path) => { const item = document.createElement('li'); const code = document.createElement('code'); const size = document.createElement('span'); code.textContent = path; size.textContent = formatBytes(state.files[path]?.size || 0); item.append(code, size); return item; }));
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

async function copyRepairPrompt() {
  const prompt = buildRepairPrompt(state.auditFindings);
  try { await navigator.clipboard.writeText(prompt); setStatus('AI repair prompt copied.'); }
  catch { setStatus('Clipboard access is unavailable in this browser.', true); }
}

function downloadAudit() {
  const url = URL.createObjectURL(new Blob([buildAuditReport(state.auditFindings)], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'debooger-audit-report.txt';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function currentPasteType() {
  const detected = detectPastedType(pasteEditor.value);
  pasteType.textContent = `${detected.label.toUpperCase()} · ${detected.extension}${detected.confidence === 'low' ? ' · LOW CONFIDENCE' : ''}`;
  pasteDownload.textContent = `Download ${detected.extension}`;
  return detected;
}

function renderPastePreview() {
  const content = pasteEditor.value;
  if (!content.trim()) return;
  const detected = currentPasteType();
  const previewContent = buildPastedPreviewDocument(content, detected);
  const previewFiles = { 'preview.html': { content: previewContent, binary: false, type: 'html', size: new Blob([previewContent]).size } };
  viewer.setFrameDocument(buildStaticPreviewDocument(previewFiles, 'preview.html'));
  viewer.setStatus(`Pasted ${detected.label} · ${detected.extension}`);
  setStatus(`Pasted content detected as ${detected.label}.`);
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

function snapshotFromState(id = newSnapshotId()) { return { id, projectName: state.projectName, projectType: state.projectType, entryFile: state.entryFile, files: state.files, savedAt: Date.now() }; }

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
      } else {
        viewer.hide(); setStatus(error?.message || 'Real runtime could not start.', true);
      }
    }
    return;
  }
  viewer.setFrameDocument(buildStaticPreviewDocument(state.files, route.entry));
  viewer.setStatus(`${state.projectType} · ${route.entry}`);
  setStatus('Project opened in viewer.');
}

async function handleFiles(files) {
  setStatus('Reading project…');
  try {
    const selected = Array.from(files || []);
    if (selected.length === 1 && looksLikeZip(selected[0])) { const extracted = await parseZipArchive(selected[0]); applyVirtualProject(extracted.files, extracted.projectName); }
    else await ingestFileList(files);
    const snapshot = snapshotFromState();
    await saveProjectSnapshot(snapshot).catch(() => undefined);
    await renderHistory();
    renderProject();
    refreshAudit();
    await openPreview();
  } catch (error) { setStatus(error?.message || 'Could not load the selected project.', true); viewer.hide(); }
  finally { fileInput.value = ''; }
}

async function openHistorySnapshot(snapshot) {
  if (!snapshot?.files || !Object.keys(snapshot.files).length) return;
  await webcontainer.dispose();
  viewer.hide();
  state.projectName = String(snapshot.projectName || 'Project');
  state.files = snapshot.files;
  state.runtimeErrors = [];
  detectProjectTypeAndEntry();
  await saveProjectSnapshot(snapshot, { addToHistory: false }).catch(() => undefined);
  renderProject();
  refreshAudit();
  await openPreview();
}

async function renderHistory() {
  let history = [];
  try { history = await loadProjectHistory(); } catch { history = []; }
  if (!history.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'No saved projects yet.';
    historyList.replaceChildren(empty);
    return;
  }
  historyList.replaceChildren(...history.map((snapshot) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    const main = document.createElement('div');
    main.className = 'history-main';
    const name = document.createElement('div');
    name.className = 'history-name';
    name.textContent = snapshot.projectName || 'Project';
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const count = Object.keys(snapshot.files || {}).length;
    const when = snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleString() : 'Saved project';
    meta.textContent = `${when} · ${count} file${count === 1 ? '' : 's'} · ${String(snapshot.projectType || 'unknown').toUpperCase()}`;
    main.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'history-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open';
    open.addEventListener('click', () => openHistorySnapshot(snapshot));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history-delete';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => { await removeProjectHistory(snapshot.id).catch(() => undefined); await renderHistory(); });
    actions.append(open, remove);
    row.append(main, actions);
    return row;
  }));
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

fileInput.addEventListener('change', () => handleFiles(fileInput.files));

document.getElementById('open-paste').addEventListener('click', openPasteDialog);
document.getElementById('paste-close').addEventListener('click', closePasteDialog);
document.getElementById('paste-preview').addEventListener('click', renderPastePreview);
document.getElementById('audit-copy').addEventListener('click', copyRepairPrompt);
document.getElementById('audit-download').addEventListener('click', downloadAudit);
projectExport.addEventListener('click', exportCurrentZip);
projectHtml.addEventListener('click', downloadStandaloneHtml);
pasteDownload.addEventListener('click', downloadPaste);
pasteEditor.addEventListener('input', currentPasteType);
pasteEditor.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain');
  if (typeof text !== 'string') return;
  event.preventDefault();
  appendClipboardText(pasteEditor, text);
  currentPasteType();
  renderPastePreview();
});

clearButton.addEventListener('click', async () => { await webcontainer.dispose(); viewer.hide(); resetState(); await clearProjectSnapshot().catch(() => undefined); renderProject(); refreshAudit(); setStatus('Ready.'); });
document.getElementById('snapshot-close').addEventListener('click', () => { snapshotDialog.hidden = true; snapshotImage.removeAttribute('src'); snapshotSave.removeAttribute('href'); });


function loadSharedText() {
  let shared = null;
  try { shared = readSharePayload(); }
  catch (error) { setStatus(error?.message || 'Shared text could not be loaded.', true); return; }
  if (!shared) return;
  pasteEditor.value = shared;
  if (!pasteEditor.value.endsWith('\n')) pasteEditor.value += '\n';
  clearSharePayloadFromAddress();
  openPasteDialog();
  renderPastePreview();
}

async function restoreLastProject() {
  await renderHistory();
  try {
    const saved = await loadProjectSnapshot();
    if (!saved?.files || !Object.keys(saved.files).length) return;
    state.projectName = String(saved.projectName || 'Project'); state.files = saved.files; detectProjectTypeAndEntry(); renderProject(); refreshAudit();
    setStatus('Restored last project.');
  } catch { setStatus('Ready.'); }
}
restoreLastProject().finally(loadSharedText);
