import { BUILD_VERSION, resetState, state } from './state.js';
import { formatBytes } from './file-utils.js';
import { applyVirtualProject, detectProjectTypeAndEntry, ingestFileList } from './project-engine.js';
import { selectPreviewRoute } from './runtime-router.js';
import { clearProjectSnapshot, loadProjectSnapshot, saveProjectSnapshot } from './storage.js';
import { looksLikeZip, parseZipArchive } from './zip-engine.js';

const fileInput = document.getElementById('file-input');
const status = document.getElementById('status');
const projectPanel = document.getElementById('project-panel');
const clearButton = document.getElementById('clear-project');
document.getElementById('build-badge').textContent = BUILD_VERSION;

function setStatus(message, isError = false) { status.textContent = message; status.classList.toggle('error', isError); }
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
}
function snapshotFromState() { return { projectName: state.projectName, projectType: state.projectType, entryFile: state.entryFile, files: state.files, savedAt: Date.now() }; }

async function handleFiles(files) {
  setStatus('Reading project…');
  try {
    const selected = Array.from(files || []);
    if (selected.length === 1 && looksLikeZip(selected[0])) { const extracted = await parseZipArchive(selected[0]); applyVirtualProject(extracted.files, extracted.projectName); }
    else await ingestFileList(files);
    await saveProjectSnapshot(snapshotFromState());
    renderProject();
    const route = selectPreviewRoute();
    setStatus(`${Object.keys(state.files).length} files loaded. Preview route: ${route.mode}.`);
  } catch (error) { setStatus(error?.message || 'Could not load the selected project.', true); }
  finally { fileInput.value = ''; }
}
fileInput.addEventListener('change', () => handleFiles(fileInput.files));
clearButton.addEventListener('click', async () => { resetState(); await clearProjectSnapshot().catch(() => undefined); renderProject(); setStatus('Ready.'); });
async function restoreLastProject() {
  try {
    const saved = await loadProjectSnapshot();
    if (!saved?.files || !Object.keys(saved.files).length) return;
    state.projectName = String(saved.projectName || 'Project'); state.files = saved.files; detectProjectTypeAndEntry(); renderProject();
    const route = selectPreviewRoute(); setStatus(`Restored last project. Preview route: ${route.mode}.`);
  } catch { setStatus('Ready.'); }
}
restoreLastProject();
