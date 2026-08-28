import { state } from './state.js';
import { encodeArrayBufferToBase64, getFileTypeFromName, isTextVirtualPath, normalizeVirtualPath } from './file-utils.js';

const IGNORED_PATH = /(^|\/)(?:node_modules|\.git|\.next|\.cache|coverage)(?:\/|$)/i;
const IGNORED_FILE = /(^|\/)(?:\.DS_Store|Thumbs\.db)$/i;
const IMAGE_FILE = /\.(?:svg|png|jpe?g|gif|webp|ico)$/i;

export async function ingestFileList(fileList) {
  if (!fileList || !fileList.length) throw new Error('No files were selected.');
  const selected = Array.from(fileList);
  const nextFiles = Object.create(null);
  const usable = selected.filter((file) => {
    const path = normalizeVirtualPath(file.webkitRelativePath || file.name);
    return path && !IGNORED_PATH.test(path) && !IGNORED_FILE.test(path) && !path.startsWith('__MACOSX/');
  });
  if (!usable.length) throw new Error('No usable project files were found.');
  for (const file of usable) {
    const path = normalizeVirtualPath(file.webkitRelativePath || file.name);
    const type = getFileTypeFromName(path);
    if (isTextVirtualPath(path)) {
      const content = await file.text();
      nextFiles[path] = { content, size: file.size || new Blob([content]).size, type, binary: false, modified: false };
    } else {
      const content = encodeArrayBufferToBase64(await file.arrayBuffer());
      nextFiles[path] = { content, size: file.size, type, binary: true, encoding: 'base64', modified: false };
    }
  }
  state.files = stripCommonProjectRoot(nextFiles);
  state.projectName = deriveProjectName(selected, state.files);
  detectProjectTypeAndEntry();
  return state;
}

export function stripCommonProjectRoot(files) {
  const keys = Object.keys(files);
  if (!keys.length) return files;
  const first = keys[0].split('/')[0];
  const canStrip = first && keys.every((key) => key.includes('/') && key.split('/')[0] === first);
  if (!canStrip) return files;
  const normalized = Object.create(null);
  for (const key of keys) {
    const stripped = key.split('/').slice(1).join('/');
    if (stripped) normalized[stripped] = files[key];
  }
  return Object.keys(normalized).length ? normalized : files;
}

function deriveProjectName(selected, files) {
  const first = selected[0];
  if (first.webkitRelativePath) return first.webkitRelativePath.split('/')[0] || first.name;
  if (Object.keys(files).length === 1) return first.name.replace(/\.[^.]+$/, '') || first.name;
  return first.name ? `${first.name} +${Math.max(0, selected.length - 1)}` : 'project';
}

export function applyVirtualProject(files, projectName = 'project') {
  state.files = stripCommonProjectRoot(files || Object.create(null));
  state.projectName = String(projectName || 'project');
  detectProjectTypeAndEntry();
  return state;
}

export function isReactProjectFiles(files = state.files) {
  const keys = Object.keys(files || {});
  if (keys.some((key) => /\.(?:tsx|jsx)$/i.test(key))) return true;
  const pkgKey = keys.find((key) => /(^|\/)package\.json$/i.test(key));
  if (!pkgKey || files[pkgKey]?.binary) return false;
  try {
    const pkg = JSON.parse(String(files[pkgKey].content || '{}'));
    return Boolean(pkg?.dependencies?.react || pkg?.dependencies?.['react-dom'] || pkg?.devDependencies?.react || pkg?.devDependencies?.['react-dom']);
  } catch { return false; }
}

function classifyLooseSingle(path, file) {
  if (/\.html?$/i.test(path)) return 'single-html';
  if (IMAGE_FILE.test(path)) return 'image-file';
  if (file?.binary) return 'binary-file';
  const type = getFileTypeFromName(path);
  if (['javascript', 'jsx', 'tsx', 'typescript', 'css', 'json'].includes(type)) return 'source-file';
  return 'text-file';
}

export function detectProjectTypeAndEntry() {
  const keys = Object.keys(state.files);
  const packageKey = keys.find((key) => /(^|\/)package\.json$/i.test(key));
  let pkg = null;
  if (packageKey && !state.files[packageKey]?.binary) {
    try { pkg = JSON.parse(String(state.files[packageKey].content || '{}')); } catch { pkg = null; }
  }
  const hasElectron = Boolean(pkg && (pkg?.devDependencies?.electron || pkg?.dependencies?.electron || (pkg.main && /(?:^|\/)(?:electron|main)\.(?:c?js|mjs|ts)$/i.test(String(pkg.main)))));
  const hasNext = Boolean(pkg && (pkg?.dependencies?.next || pkg?.devDependencies?.next));
  const hasReact = isReactProjectFiles(state.files);
  const hasNode = Boolean(pkg && (pkg?.dependencies?.express || pkg?.dependencies?.fastify || pkg?.dependencies?.koa || pkg?.dependencies?.hapi));
  const lowerKeys = keys.map((key) => key.toLowerCase());
  const hasHtml = lowerKeys.some((key) => /\.html?$/.test(key));
  if (hasElectron) state.projectType = 'electron';
  else if (hasNext) state.projectType = 'nextjs';
  else if (hasReact) state.projectType = 'react-vite';
  else if (hasNode) state.projectType = 'node-service';
  else if (lowerKeys.some((key) => /\.(?:py|vbs|sh|db|sqlite|sqlite3)$/.test(key)) && !hasHtml) state.projectType = 'backend-service';
  else if (keys.length === 1) state.projectType = classifyLooseSingle(keys[0], state.files[keys[0]]);
  else if (hasHtml) state.projectType = 'html-static';
  else state.projectType = 'file-bundle';
  state.entryFile = chooseVisualEntry(keys) || keys[0] || '';
  return { projectType: state.projectType, entryFile: state.entryFile };
}

export function chooseVisualEntry(keys = Object.keys(state.files)) {
  const score = (path) => {
    const lower = path.toLowerCase();
    let value = 0;
    if (/(^|\/)(?:dist|build|out)\/index\.html?$/.test(lower)) value += 1000;
    if (/(^|\/)(?:public|static|client|frontend|web|renderer)\/index\.html?$/.test(lower)) value += 800;
    if (/(^|\/)index\.html?$/.test(lower)) value += 700;
    if (/\.html?$/.test(lower)) value += 300;
    value -= path.split('/').length * 5;
    return value;
  };
  return keys.filter((key) => /\.html?$/i.test(key)).sort((a, b) => score(b) - score(a) || a.length - b.length)[0] || null;
}
